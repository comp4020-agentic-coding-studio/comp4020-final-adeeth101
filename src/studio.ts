import {randomUUID,createHash} from 'node:crypto';
import type {ServerResponse} from 'node:http';
import {db} from './db.ts';
import {persist,type Visitor} from './identity.ts';
import {logAction} from './events.ts';
import {emptyClip,validateDocument} from '../shared/music.ts';
import {parseCode} from '../shared/code.ts';
import {blankPlan,nextBoundary,sceneAt,cycleAt,planAt,planAtRestart,SLOTS,type Slot,type Plan} from '../shared/performance.ts';
import type {Snapshot,Track,Arrangement} from '../shared/studio.ts';

// New migrations are append-only. Legacy trace tables remain intact.
db.exec(`create table if not exists studio_migration (version integer primary key, applied_at integer not null)`);
if(!db.prepare('select version from studio_migration where version=1').get()){
  // SQLite creates a consistent backup even if the legacy DB has a WAL.
  const path=db.prepare('pragma database_list').get() as {file:string};
  if(path.file && (db.prepare('select count(*) as n from trace').get() as {n:number}).n>0){
    const backup=`${path.file}.before-studio-${Date.now()}.db`;
    db.exec(`vacuum into '${backup.replaceAll("'","''")}'`);
  }
  db.exec(`begin immediate;
  create table project (id text primary key,title text not null,created_by text not null references visitor(id),created_at integer not null,updated_at integer not null,revision integer not null);
  create table track (id text primary key,project_id text not null references project(id),owner_id text not null references visitor(id),name text not null,position integer not null,revision integer not null,archived_at integer);
  create index track_project on track(project_id,position);
  create table clip (id text primary key,track_id text not null references track(id),slot text not null,current_revision integer not null,unique(track_id,slot));
  create table clip_revision (clip_id text not null references clip(id),revision integer not null,schema_version integer not null,document_json text not null,source_text text,provenance_json text not null,created_by text not null,created_at integer not null,primary key(clip_id,revision));
  create table scene_assignment (project_id text not null references project(id),scene text not null,track_id text not null references track(id),clip_slot text,primary key(project_id,scene,track_id));
  create table project_settings (project_id text primary key references project(id),bpm integer not null,scene_names_json text not null,arrangement_json text not null,settings_revision integer not null);
  create table transport (project_id text primary key references project(id),generation integer not null,status text not null,epoch_ms integer,conductor_id text,lease_until integer not null,revision integer not null);
  create table performance_plan (project_id text not null references project(id),generation integer not null,plan_revision integer not null,effective_cycle integer not null,plan_json text not null,created_at integer not null,primary key(project_id,generation,plan_revision));
  create table command_receipt (visitor_id text not null,command_id text not null,request_hash text not null,response_json text not null,created_at integer not null,primary key(visitor_id,command_id));
  create table legacy_import (trace_id integer primary key,new_clip_id text,archived_source text not null,reason text);
  alter table event add column project_id text;
  alter table event add column command_id text;
  create index event_project on event(project_id,id);
  insert into studio_migration values(1,strftime('%s','now')*1000);
  commit;`);
}
type Row=Record<string,any>;
const one=(sql:string,...args:any[]):Row|undefined=>db.prepare(sql).get(...args) as Row|undefined;
const rows=(sql:string,...args:any[]):Row[]=>db.prepare(sql).all(...args) as Row[];
const run=(sql:string,...args:any[])=>db.prepare(sql).run(...args);
const listeners=new Map<string,Set<{visitorId:string;res:ServerResponse}>>();
const presence=new Map<string,Map<string,{handle:string;route:string;until:number}>>();
const buckets=new Map<string,{tokens:number;at:number}>();
export class CommandError extends Error {
  status:number;current?:unknown;
  constructor(message:string,status=422,current?:unknown){super(message);this.status=status;this.current=current;}
}
function need(test:unknown,message:string,status=422):asserts test {if(!test)throw new CommandError(message,status);}
const text=(x:unknown,max:number)=>{need(typeof x==='string'&&x.trim().length>0&&x.length<=max,`Use 1–${max} characters.`);return (x as string).trim();};
const slot=(x:unknown):Slot=>{need(SLOTS.includes(x as Slot),'Choose clip or scene A–D.');return x as Slot;};
// Track name and owner turn an id into something a person can narrate from the logs.
const trackLabel=(trackId:unknown)=>{const t=typeof trackId==='string'?one('select t.name,v.handle as owner from track t join visitor v on v.id=t.owner_id where t.id=?',trackId):undefined;return t?{track:t.name,owner:t.owner}:{};};
function emit(v:Visitor,projectId:string,eventId:number,kind:string,entityId:string|null,commandId:string|null){
  logAction(v,kind,{project:projectId.slice(0,8),event:eventId,...(entityId?{entity:entityId.slice(0,8)}:{}),...trackLabel(entityId)});
  const revision=one('select revision from project where id=?',projectId)?.revision??0;
  const data=JSON.stringify({projectId,projectRevision:revision,kind,entityId,commandId});
  for(const {res} of listeners.get(projectId)??[]){if(res.writableLength>128*1024){res.end();continue;}res.write(`id: ${eventId}\nevent: change\ndata: ${data}\n\n`);}
}
function event(projectId:string,visitorId:string|null,kind:string,entityId:string|null,commandId:string|null){
  return Number(run('insert into event(visitor_id,kind,payload,created_at,project_id,command_id) values(?,?,?,?,?,?)',visitorId,kind,JSON.stringify({entityId}),Date.now(),projectId,commandId).lastInsertRowid);
}
function newProject(v:Visitor,title:string){
  persist(v);const id=randomUUID(),now=Date.now();
  run('insert into project values(?,?,?,?,?,1)',id,title,v.id,now,now);
  run('insert into project_settings values(?,120,?,?,1)',id,JSON.stringify({A:'A · Intro',B:'B · Build',C:'C · Lift',D:'D · Outro'}),JSON.stringify({entries:[{scene:'A',bars:4},{scene:'B',bars:4},{scene:'C',bars:4},{scene:'D',bars:4}],loop:true}));
  run("insert into transport values(?,0,'stopped',null,null,0,1)",id);
  savePlan(id,blankPlan());return id;
}
function savePlan(id:string,p:Plan){run('insert into performance_plan values(?,?,?,?,?,?)',id,p.generation,p.planRevision,p.effectiveCycle,JSON.stringify(p),Date.now());}
function newClip(v:Visitor,trackId:string,s:Slot,document:unknown,source:string|null=null,provenance:Row={}){
  const id=randomUUID(),doc=validateDocument(document);
  run('insert into clip values(?,?,?,1)',id,trackId,s);
  run('insert into clip_revision values(?,1,1,?,?,?,?,?)',id,JSON.stringify(doc),source,JSON.stringify(provenance),v.id,Date.now());
  return id;
}
function newTrack(v:Visitor,id:string,name:string,kind:'drums'|'melody',archived=false){
  const trackId=randomUUID(),position=Number(one('select coalesce(max(position),-1)+1 as p from track where project_id=?',id)!.p);
  run('insert into track values(?,?,?,?,?,1,?)',trackId,id,v.id,name,position,archived?Date.now():null);
  newClip(v,trackId,'A',emptyClip(kind));
  for(const s of SLOTS)run('insert into scene_assignment values(?,?,?,?)',id,s,trackId,'A');
  return trackId;
}
export function createProject(v:Visitor,rawTitle:unknown){
  const title=text(rawTitle??'Untitled piece',60);db.exec('begin immediate');
  try{const id=newProject(v,title),eid=event(id,v.id,'project.created',id,null);db.exec('commit');emit(v,id,eid,'project.created',id,null);return {id};}catch(e){db.exec('rollback');throw e;}
}
function plansFor(id:string,generation:number):Plan[]{return rows('select plan_json from performance_plan where project_id=? and generation=? order by effective_cycle,plan_revision',id,generation).map(x=>JSON.parse(x.plan_json));}
export function snapshot(id:string,v:Visitor):Snapshot {
  db.exec('begin');
  try{
    const p=one('select * from project where id=?',id);need(p,'Piece not found.',404);
    const settings=one('select * from project_settings where project_id=?',id)!,t=one('select * from transport where project_id=?',id)!;
    const tracks:Track[]=rows('select t.*,v.handle from track t join visitor v on v.id=t.owner_id where project_id=? order by position',id).map(t=>({id:t.id,ownerId:t.owner_id,handle:t.handle,name:t.name,revision:t.revision,archivedAt:t.archived_at,clips:Object.fromEntries(rows('select c.*,r.document_json,r.source_text,r.provenance_json from clip c join clip_revision r on r.clip_id=c.id and r.revision=c.current_revision where c.track_id=?',t.id).map(c=>[c.slot,{id:c.id,revision:c.current_revision,document:JSON.parse(c.document_json),source:c.source_text,provenance:JSON.parse(c.provenance_json),history:rows('select revision,created_at as createdAt from clip_revision where clip_id=? order by revision desc limit 20',c.id)}]))}));
    const cursor=one('select coalesce(max(id),0) as id from event where project_id=?',id)!.id;
    const now=Date.now(),active=presence.get(id)??new Map();for(const [key,value] of active)if(value.until<now)active.delete(key);
    const result:Snapshot={id,title:p!.title,revision:p!.revision,eventId:cursor,serverNowMs:now,you:{id:v.id,handle:v.handle},tracks,settings:{bpm:settings.bpm,sceneNames:JSON.parse(settings.scene_names_json),arrangement:JSON.parse(settings.arrangement_json),revision:settings.settings_revision},transport:{generation:t.generation,status:t.status,epochMs:t.epoch_ms,conductorId:t.lease_until>now?t.conductor_id:null,leaseUntil:t.lease_until,revision:t.revision},plans:plansFor(id,t.generation),presence:[...active].map(([id,x])=>({id,handle:x.handle,route:x.route}))};
    db.exec('commit');return result;
  }catch(e){db.exec('rollback');throw e;}
}
function syncCatalog(id:string,p:Plan){
  const active=rows('select * from track where project_id=? and archived_at is null order by position',id),ids=new Set(active.map(x=>x.id));
  for(const key of Object.keys(p.catalog))if(!ids.has(key)){delete p.catalog[key];delete p.manual[key];delete p.mix[key];}
  for(const t of active){
    p.catalog[t.id]=Object.fromEntries(rows('select c.slot,c.current_revision,r.document_json from clip c join clip_revision r on r.clip_id=c.id and r.revision=c.current_revision where c.track_id=?',t.id).map(c=>[c.slot,{revision:c.current_revision,document:JSON.parse(c.document_json)}]));
    p.mix[t.id]??={gain:0.7,mute:false};
    for(const s of SLOTS)p.sceneAssignments[s][t.id]=one('select clip_slot from scene_assignment where project_id=? and track_id=? and scene=?',id,t.id,s)?.clip_slot??null;
  }
}
function updatePlan(id:string,t:Row,bpm:number,edit:(p:Plan)=>void){
  const last=plansFor(id,t.generation).at(-1)??blankPlan();const p=structuredClone(last);
  p.generation=t.generation;p.planRevision=last.planRevision+1;
  p.effectiveCycle=t.status==='playing'?Math.max(last.effectiveCycle,nextBoundary(Date.now(),t.epoch_ms,bpm)):0;
  syncCatalog(id,p);edit(p);savePlan(id,p);
  run('delete from performance_plan where project_id=? and generation=? and effective_cycle=? and plan_revision<?',id,t.generation,p.effectiveCycle,p.planRevision);
  // Keep the latest effective plan plus all future plans; snapshots stay small.
  const current=t.status==='playing'?cycleAt(Date.now(),t.epoch_ms,bpm):0;
  const keeper=one('select max(plan_revision) as r from performance_plan where project_id=? and generation=? and effective_cycle<=?',id,t.generation,current)?.r;
  if(keeper!==null)run('delete from performance_plan where project_id=? and generation=? and plan_revision<?',id,t.generation,keeper??0);
  return p.effectiveCycle;
}
function arrangement(raw:any):Arrangement{
  need(raw && Array.isArray(raw.entries)&&raw.entries.length>0&&raw.entries.length<=8&&typeof raw.loop==='boolean','An arrangement has 1–8 entries and a Loop choice.');
  return {loop:raw.loop,entries:raw.entries.map((x:any)=>{need(Number.isInteger(x.bars)&&x.bars>=1&&x.bars<=16,'Each scene runs for 1–16 bars.');return {scene:slot(x.scene),bars:x.bars};})};
}
export function command(v:Visitor,id:string,input:Record<string,any>){
  need(typeof input.commandId==='string'&&/^[0-9a-f-]{36}$/i.test(input.commandId),'Command needs a UUID.');
  const cid=input.commandId,type=text(input.type,50),payload=input.payload??{};
  const hash=createHash('sha256').update(JSON.stringify({id,type,payload,expectedRevision:input.expectedRevision})).digest('hex');
  const receipt=one('select * from command_receipt where visitor_id=? and command_id=?',v.id,cid);
  if(receipt){need(receipt.request_hash===hash,'Command ID was reused with different content.',409);return JSON.parse(receipt.response_json);}
  const now=Date.now(),bucket=buckets.get(v.id)??{tokens:20,at:now};bucket.tokens=Math.min(20,bucket.tokens+(now-bucket.at)*0.005);bucket.at=now;need(bucket.tokens>=1,'Too many changes. Try again shortly.',429);bucket.tokens--;buckets.set(v.id,bucket);if(buckets.size>1000)for(const [k,b]of buckets)if(now-b.at>60000)buckets.delete(k);
  db.exec('begin immediate');
  let entityId:string|null=null,entityRevision=0,effectiveCycle:number|undefined;
  try{
    const project=one('select * from project where id=?',id);need(project,'Piece not found.',404);persist(v);
    const t=one('select * from transport where project_id=?',id)!,settings=one('select * from project_settings where project_id=?',id)!;
    function version(row:Row,key='revision'){if(row[key]!==input.expectedRevision)throw new CommandError('This changed in another session. Your draft is safe.',409,row);}
    function ownTrack(trackId:any){const tr=one('select * from track where id=? and project_id=?',trackId,id);need(tr,'Track not found.',404);need(tr!.owner_id===v.id,'This track belongs to someone else.',403);return tr!;}
    function conductor(){need(t.conductor_id===v.id&&t.lease_until>now,'Take the conductor role first.',403);}
    const plan=(edit:(p:Plan)=>void=()=>{})=>{effectiveCycle=updatePlan(id,t,settings.bpm,edit);};
    const touchTrack=(tr:Row)=>{run('update track set revision=revision+1 where id=?',tr.id);entityId=tr.id;entityRevision=tr.revision+1;};
    if(type==='track.create'){
      const count=one('select count(*) as n from track where project_id=? and archived_at is null',id)!.n;
      const own=one('select count(*) as n from track where project_id=? and owner_id=? and archived_at is null',id,v.id)!.n;
      need(count<12&&own<2,'This piece has room for 12 tracks, with two per person.',409);
      need(['drums','melody'].includes(payload.kind),'Choose drums or melody.');
      entityId=newTrack(v,id,text(payload.name??(payload.kind==='drums'?'Drums':'Melody'),40),payload.kind);entityRevision=1;plan();
    }else if(['track.rename','track.archive','track.restore','scene.assign','track.launch','track.follow','track.mix'].includes(type)){
      const tr=ownTrack(payload.trackId);version(tr);
      if(type==='track.rename')run('update track set name=? where id=?',text(payload.name,40),tr.id);
      if(type==='track.archive')run('update track set archived_at=? where id=?',now,tr.id);
      if(type==='track.restore'){
        need(one('select count(*) as n from track where project_id=? and archived_at is null',id)!.n<12&&one('select count(*) as n from track where project_id=? and owner_id=? and archived_at is null',id,v.id)!.n<2,'No space for that track yet.',409);run('update track set archived_at=null where id=?',tr.id);
      }
      if(type==='scene.assign')run('update scene_assignment set clip_slot=? where project_id=? and scene=? and track_id=?',payload.clipSlot===null?null:slot(payload.clipSlot),id,slot(payload.scene),tr.id);
      touchTrack(tr);
      plan(p=>{
        if(type==='track.launch')p.manual[tr.id]=payload.clipSlot===null?null:slot(payload.clipSlot);
        if(type==='track.follow')delete p.manual[tr.id];
        if(type==='track.mix'){need(typeof payload.gain==='number'&&payload.gain>=0&&payload.gain<=1&&typeof payload.mute==='boolean','Mixer values are volume 0–1 and mute on/off.');p.mix[tr.id]={gain:payload.gain,mute:payload.mute};}
      });
    }else if(type==='clip.publish'||type==='clip.restore'){
      const tr=ownTrack(payload.trackId),s=slot(payload.slot);need(!tr.archived_at,'Restore the track first.',409);
      const c=one('select * from clip where track_id=? and slot=?',tr.id,s);
      if((c?.current_revision??0)!==input.expectedRevision)throw new CommandError('Clip changed in another session. Keep your draft or load the saved version.',409,c);
      let doc,source:string|null=null,provenance:Row={};
      if(type==='clip.restore'){
        const old=c&&one('select * from clip_revision where clip_id=? and revision=?',c.id,payload.revision);need(old,'That revision is unavailable.',404);doc=validateDocument(JSON.parse(old!.document_json));source=old!.source_text;provenance={restoredFrom:payload.revision};
      }else{
        doc=validateDocument(payload.document);provenance=payload.provenance&&typeof payload.provenance==='object'?{...payload.provenance}:{};
        need(JSON.stringify(provenance).length<=1024,'Proposal attribution is too long.');
        if(payload.source!=null){source=text(payload.source,8192);need(JSON.stringify(parseCode(source))===JSON.stringify(doc),'Code and visual pattern disagree.');}
      }
      entityRevision=(c?.current_revision??0)+1;
      if(c){entityId=c.id;run('update clip set current_revision=? where id=?',entityRevision,c.id);run('insert into clip_revision values(?,?,1,?,?,?,?,?)',c.id,entityRevision,JSON.stringify(doc),source,JSON.stringify(provenance),v.id,now);}
      else entityId=newClip(v,tr.id,s,doc,source,provenance);
      plan();
      run('delete from clip_revision where clip_id=? and revision<=?',entityId,entityRevision-20);
    }else if(type==='conductor.claim'){
      version(t);need(!t.conductor_id||t.lease_until<=now||t.conductor_id===v.id,'Someone is conducting. Wait or ask them to release.',409);
      run('update transport set conductor_id=?,lease_until=?,revision=revision+1 where project_id=?',v.id,now+30000,id);entityRevision=t.revision+1;
    }else if(type==='conductor.renew'){
      conductor();run('update transport set lease_until=? where project_id=?',now+30000,id);entityRevision=t.revision;
    }else if(type==='conductor.release'){
      conductor();version(t);run('update transport set conductor_id=null,lease_until=0,revision=revision+1 where project_id=?',id);entityRevision=t.revision+1;
    }else if(['tempo.set','scene.rename','arrangement.save'].includes(type)){
      conductor();version(settings,'settings_revision');
      if(type==='tempo.set'){need(t.status==='stopped','Stop the ensemble before changing tempo.',409);need(Number.isInteger(payload.bpm)&&payload.bpm>=60&&payload.bpm<=180,'Tempo is 60–180 BPM.');run('update project_settings set bpm=? where project_id=?',payload.bpm,id);}
      if(type==='scene.rename'){const names=JSON.parse(settings.scene_names_json);names[slot(payload.scene)]=text(payload.name,30);run('update project_settings set scene_names_json=? where project_id=?',JSON.stringify(names),id);}
      if(type==='arrangement.save')run('update project_settings set arrangement_json=? where project_id=?',JSON.stringify(arrangement(payload)),id);
      run('update project_settings set settings_revision=settings_revision+1 where project_id=?',id);entityRevision=settings.settings_revision+1;
    }else if(['transport.start','transport.stop','scene.launch','arrangement.start','arrangement.stop'].includes(type)){
      conductor();version(t);entityRevision=t.revision+1;
      if(type==='transport.start'){
        need(t.status==='stopped','The ensemble is already playing.',409);const p=structuredClone(plansFor(id,t.generation).at(-1)??blankPlan());p.generation=t.generation+1;p.planRevision=0;p.effectiveCycle=0;p.arrangement=null;syncCatalog(id,p);
        run("update transport set status='playing',epoch_ms=?,generation=generation+1 where project_id=?",now+1200,id);savePlan(id,p);
      }else if(type==='transport.stop'){
        const cycle=t.epoch_ms?cycleAt(now,t.epoch_ms,settings.bpm):0;
        const latest=structuredClone(planAt(plansFor(id,t.generation),cycle)??blankPlan());latest.scene=sceneAt(latest,cycle);syncCatalog(id,latest);latest.generation=t.generation+1;latest.planRevision=0;latest.effectiveCycle=0;latest.arrangement=null;
        run("update transport set status='stopped',epoch_ms=null,generation=generation+1 where project_id=?",id);savePlan(id,latest);
      }else plan(p=>{
        if(type==='scene.launch'){p.scene=slot(payload.scene);p.arrangement=null;}
        if(type==='arrangement.start'){need(t.status==='playing','Start the ensemble first.',409);p.arrangement={...arrangement(JSON.parse(settings.arrangement_json)),startCycle:p.effectiveCycle};}
        if(type==='arrangement.stop'){p.scene=sceneAt(p,p.effectiveCycle);p.arrangement=null;}
      });
      run('update transport set revision=revision+1 where project_id=?',id);
      run('delete from performance_plan where project_id=? and generation<(select generation from transport where project_id=?)',id,id);
    }else throw new CommandError('Unknown studio command.');
    // Lease renewal is durable, but not a stream of musical/history events.
    const silent=type==='conductor.renew';if(!silent)run('update project set revision=revision+1,updated_at=? where id=?',now,id);
    const eid=silent?Number(one('select coalesce(max(id),0) as id from event where project_id=?',id)!.id):event(id,v.id,type,entityId,cid);
    const result={ok:true,commandId:cid,projectRevision:Number(project!.revision)+(silent?0:1),entityId,entityRevision,eventId:eid,...(effectiveCycle!==undefined?{effectiveCycle}:{})};
    run('insert into command_receipt values(?,?,?,?,?)',v.id,cid,hash,JSON.stringify(result),now);
    run('delete from command_receipt where created_at<?',now-7*86400000);
    db.exec('commit');if(!silent)emit(v,id,eid,type,entityId,cid);return result;
  }catch(e){
    db.exec('rollback');const refused=e instanceof CommandError?e:new CommandError(e instanceof Error?e.message:'Invalid command.');
    // A refusal is the other half of who-did-what: someone tried to change what isn't theirs.
    logAction(v,`${type}.refused`,{project:id.slice(0,8),status:refused.status,reason:refused.message,...trackLabel(payload.trackId)},'warn');throw refused;
  }
}
export function projectStream(id:string,v:Visitor,res:ServerResponse,cursor:number){
  need(one('select id from project where id=?',id),'Piece not found.',404);
  const set=listeners.get(id)??new Set();need([...listeners.values()].reduce((n,s)=>n+s.size,0)<64&&[...set].filter(x=>x.visitorId===v.id).length<2,'Live connection capacity reached. Retry shortly.',429);
  const newest=one('select coalesce(max(id),0) as id from event where project_id=?',id)!.id;
  const missed=rows('select * from event where project_id=? and id>? order by id limit 501',id,cursor);
  res.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-cache, no-transform','x-accel-buffering':'no'});res.write(': open\n\n');
  if(missed.length>500)res.write(`id: ${newest}\nevent: reset\ndata: {}\n\n`);
  else for(const e of missed)res.write(`id: ${e.id}\nevent: change\ndata: ${JSON.stringify({projectId:id,kind:e.kind})}\n\n`);
  const listener={visitorId:v.id,res};set.add(listener);listeners.set(id,set);
  // A named beat, not a comment: browsers hide comments, and the client needs
  // a pulse to notice a connection that died without closing.
  const timer=setInterval(()=>res.write('event: beat\ndata: {}\n\n'),5000);res.on('close',()=>{clearInterval(timer);set.delete(listener);if(!set.size)listeners.delete(id);});
}
export function updatePresence(id:string,v:Visitor,route:unknown){
  need(one('select id from project where id=?',id),'Piece not found.',404);const p=presence.get(id)??new Map();
  for(const [key,value] of p)if(value.until<Date.now())p.delete(key);
  need(p.has(v.id)||p.size<64,'Presence capacity reached.',429);if(!p.has(v.id))logAction(v,'presence.join',{project:id.slice(0,8),route:route==='perform'?'perform':'compose'});p.set(v.id,{handle:v.handle,route:route==='perform'?'perform':'compose',until:Date.now()+30000});presence.set(id,p);
}
export function exportProject(id:string,v:Visitor){const s=snapshot(id,v);return {format:'stream',schemaVersion:1,title:s.title,settings:s.settings,tracks:s.tracks.filter(t=>!t.archivedAt).map(t=>({id:t.id,name:t.name,clips:Object.fromEntries(Object.entries(t.clips).map(([slot,c])=>[slot,{document:c!.document,source:c!.source,provenance:c!.provenance}]))})),plan:s.plans.at(-1)};}
export function importProject(v:Visitor,input:Row){
  need(input.format==='stream'&&input.schemaVersion===1&&Array.isArray(input.tracks)&&input.tracks.length<=12,'Invalid Stream project.');
  const title=text(input.title,60),arr=arrangement(input.settings?.arrangement);need(Number.isInteger(input.settings?.bpm)&&input.settings.bpm>=60&&input.settings.bpm<=180,'Invalid tempo.');
  db.exec('begin immediate');
  try{
    const id=newProject(v,title),mapping:Record<string,string>={};
    // Imports may contain >2 tracks; imported archive overflow stays recoverable.
    input.tracks.forEach((raw:Row,i:number)=>{
      const tr=newTrack(v,id,text(raw.name,40),'drums',i>=2);mapping[raw.id??String(i)]=tr;
      need(raw.clips&&Object.keys(raw.clips).length<=4,'Too many clip slots.');
      for(const [s,c]of Object.entries(raw.clips) as [string,Row][]){slot(s);const doc=validateDocument(c.document);if(c.source!=null)need(JSON.stringify(parseCode(text(c.source,8192)))===JSON.stringify(doc),'Imported code disagrees with its blocks.');
        const existing=one('select id from clip where track_id=? and slot=?',tr,s);
        if(existing)run('update clip_revision set document_json=?,source_text=?,provenance_json=? where clip_id=? and revision=1',JSON.stringify(doc),c.source??null,JSON.stringify({imported:true}),existing.id);
        else newClip(v,tr,s as Slot,doc,c.source??null,{imported:true});
      }
    });
    const names=Object.fromEntries(SLOTS.map(s=>[s,text(input.settings.sceneNames?.[s]??s,30)]));run('update project_settings set bpm=?,scene_names_json=?,arrangement_json=? where project_id=?',input.settings.bpm,JSON.stringify(names),JSON.stringify(arr),id);
    const p=blankPlan();syncCatalog(id,p);p.planRevision=1;
    for(const [oldId,newId] of Object.entries(mapping)){
      for(const scene of SLOTS){
        const assignment=input.plan?.sceneAssignments?.[scene]?.[oldId];
        if(assignment!==undefined){const chosen=assignment===null?null:slot(assignment);run('update scene_assignment set clip_slot=? where project_id=? and scene=? and track_id=?',chosen,id,scene,newId);p.sceneAssignments[scene][newId]=chosen;}
      }
      const mix=input.plan?.mix?.[oldId];
      if(mix!==undefined){need(typeof mix.gain==='number'&&Number.isFinite(mix.gain)&&mix.gain>=0&&mix.gain<=1&&typeof mix.mute==='boolean','Invalid imported mixer.');p.mix[newId]={gain:mix.gain,mute:mix.mute};}
      if(input.plan?.manual&&Object.hasOwn(input.plan.manual,oldId))p.manual[newId]=input.plan.manual[oldId]===null?null:slot(input.plan.manual[oldId]);
    }
    if(input.plan?.scene!==undefined)p.scene=slot(input.plan.scene);
    savePlan(id,p);
    const eid=event(id,v.id,'project.imported',id,null);db.exec('commit');emit(v,id,eid,'project.imported',id,null);return {id};
  }catch(e){db.exec('rollback');throw e;}
}
// Import each old trace once, preserving unsupported code verbatim as an archive.
function migrateLegacy(){
  const old=rows('select t.*,v.handle from trace t join visitor v on v.id=t.visitor_id where t.id not in(select trace_id from legacy_import) order by t.id');
  if(!old.length)return;
  db.exec('begin immediate');try{
    const first=old[0],v:Visitor={id:first.visitor_id,handle:first.handle,fresh:false};
    let id=one("select id from project where title='Earlier sketches' limit 1")?.id;if(!id)id=newProject(v,'Earlier sketches');
    for(const row of old){
      try{const doc=parseCode(row.body),owner={id:row.visitor_id,handle:row.handle,fresh:false};
        const count=one('select count(*) as n from track where project_id=? and archived_at is null',id)!.n, own=one('select count(*) as n from track where project_id=? and owner_id=? and archived_at is null',id,owner.id)!.n;
        const tr=newTrack(owner,id,`${row.handle} sketch`.slice(0,40),'drums',count>=12||own>=2);const c=one("select id from clip where track_id=? and slot='A'",tr)!;
        run('update clip_revision set document_json=?,source_text=? where clip_id=? and revision=1',JSON.stringify(doc),row.body,c.id);
        run('insert into legacy_import values(?,?,?,null)',row.id,c.id,row.body);
      }catch(e){run('insert into legacy_import values(?,null,?,?)',row.id,row.body,e instanceof Error?e.message:'Unsupported sketch');}
    }
    const p=blankPlan();syncCatalog(id,p);p.planRevision=(plansFor(id,0).at(-1)?.planRevision??0)+1;savePlan(id,p);db.exec('commit');
  }catch(e){db.exec('rollback');throw e;}
}
migrateLegacy();
// Restarts stop playback and release leases, while retaining saved music.
// The crash instant is unknown, so the last durable write stands in for it:
// a plan already sounding by then is kept, and anything still queued after it
// is cancelled rather than silently applied on the next start.
for(const t of rows("select * from transport where status='playing' or conductor_id is not null")){
  db.exec('begin immediate');try{
    const plans=plansFor(t.project_id,t.generation),bpm=one('select bpm from project_settings where project_id=?',t.project_id)!.bpm;
    const lastWrite=Math.max(Number(one('select max(created_at) as at from performance_plan where project_id=? and generation=?',t.project_id,t.generation)?.at??0),Number(one('select max(created_at) as at from event where project_id=?',t.project_id)?.at??0));
    const p=planAtRestart(plans,t.status==='playing'?t.epoch_ms:null,bpm,lastWrite);p.generation=t.generation+1;p.effectiveCycle=0;p.planRevision=0;p.arrangement=null;
    run("update transport set status='stopped',epoch_ms=null,conductor_id=null,lease_until=0,generation=generation+1,revision=revision+1 where project_id=?",t.project_id);savePlan(t.project_id,p);event(t.project_id,null,'transport.reset',null,null);db.exec('commit');logAction(null,'transport.reset',{project:t.project_id.slice(0,8)});
  }catch(e){db.exec('rollback');throw e;}
}
export function listProjects(){return rows('select id,title from project order by updated_at desc limit 24');}
export function legacyArchive(){return rows('select l.trace_id,l.archived_source,l.reason,v.handle from legacy_import l join trace t on t.id=l.trace_id join visitor v on v.id=t.visitor_id where new_clip_id is null');}
