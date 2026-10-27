// Project rooms: the shared mix, its parts, membership, the host's transport,
// performance plans, chat, import/export and restart handling. Every function
// that reads or changes a project checks access first (src/access.ts); a
// change and its scoped events commit in one transaction and are announced
// only after commit.
import {randomUUID} from 'node:crypto';
import './schema.ts';
import {db} from './db.ts';
import {persist,derive,type Visitor} from './identity.ts';
import {logAction} from './events.ts';
import {CommandError,need,hidden,text,code,one,rows,run,tx,receiptFor,saveReceipt,limit} from './errors.ts';
import {projectAccess,memberRole,readProject,type ProjectAccess} from './access.ts';
import {addEvent,broadcast,openStream,revalidate,type Scope} from './hub.ts';
import {emptyClip,validateDocument} from '../shared/music.ts';
import {parseCode} from '../shared/code.ts';
import {validateAny,sourceOf,type AnyDocument} from '../shared/clip.ts';
import {parseSource} from '../shared/expr.ts';
import {presetById,roleOf,ROLES} from '../shared/presets.ts';
import {blankPlan,nextBoundary,sceneAt,cycleAt,planAt,planAtRestart,SLOTS,type Slot,type Plan} from '../shared/performance.ts';
import type {RoomSnapshot,ViewSnapshot,Part,Arrangement,Member} from '../shared/studio.ts';

export {CommandError};
type Row=Record<string,any>;
export const ROOM_LIMITS={parts:12,editors:8,leaseMs:30000,hostLeaseMs:30000,editingWindowMs:60000,chatLength:500,chatPage:50,revisionsKept:200};
const VISIBILITIES=['private','unlisted','public'];

// Ephemeral state: lost on restart by design, which is how a restart releases
// part leases and room presence.
const leases=new Map<string,{visitorId:string;handle:string;until:number;projectId:string}>();
const editing=new Map<string,Map<string,number>>();
const roomPresence=new Map<string,Map<string,{handle:string;until:number}>>();
const sweepRoom=(m:Map<string,{handle:string;until:number}>)=>{const now=Date.now();for(const [k,x] of m)if(x.until<now)m.delete(k);return m;};
const online=new Map<string,number>();

const slot=(x:unknown):Slot=>{need(SLOTS.includes(x as Slot),'Choose clip or scene A–D.');return x as Slot;};
const handleOf=(id:string)=>one('select handle from visitor where id=?',id)?.handle??'someone';
const partLabel=(trackId:unknown)=>{const t=typeof trackId==='string'?one('select t.name,v.handle as owner from track t join visitor v on v.id=t.owner_id where t.id=?',trackId):undefined;return t?{track:t.name,owner:t.owner}:{};};
const livePerformance=(projectId:string)=>one("select * from performance where project_id=? and status='live'",projectId);

// Writes the member event (and, where the change is visible to them, the
// public-view and audience events) inside the caller's transaction, and queues
// the broadcasts and the log line for after commit.
export function announce(after:(f:()=>void)=>void,v:Visitor|null,projectId:string,kind:string,entityId:string|null,commandId:string|null,opts:{view?:boolean;audience?:boolean;log?:Record<string,unknown>|false}={}){
  const p=one('select visibility,revision from project where id=?',projectId)!;
  const payload={projectRevision:p.revision,entityId};
  const memberEvent=addEvent(`member:${projectId}`,v?.id??null,kind,payload,projectId,commandId);
  const extra:[Scope,number][]=[];
  if(opts.view&&p.visibility!=='private')extra.push([`view:${projectId}`,addEvent(`view:${projectId}`,null,kind,{},projectId,null)]);
  const perf=opts.audience?livePerformance(projectId):undefined;
  if(perf)extra.push([`audience:${perf.id}`,addEvent(`audience:${perf.id}`,null,kind,{},projectId,null)]);
  after(()=>{
    broadcast(`member:${projectId}`,memberEvent,kind,payload);
    for(const [scope,id] of extra)broadcast(scope,id,kind);
    if(opts.log!==false)logAction(v,kind,{project:projectId.slice(0,8),event:memberEvent,...(entityId&&entityId!==projectId?{entity:entityId.slice(0,8)}:{}),...partLabel(entityId),...(opts.log??{})});
  });
  return memberEvent;
}

// --- creating and listing projects -----------------------------------------
const ADJ=['Velvet','Neon','Paper','Copper','Midnight','Lucky','Sunny','Tidal','Pocket','Cosmic','Quiet','Bright'];
const NOUN=['Parade','Orbit','Garden','Signal','Circuit','Lantern','Harbour','Comet','Echo','Meadow','Engine','Window'];
const generatedTitle=()=>`${ADJ[Math.floor(Math.random()*ADJ.length)]} ${NOUN[Math.floor(Math.random()*NOUN.length)]}`;
function savePlan(id:string,p:Plan){run('insert into performance_plan values(?,?,?,?,?,?)',id,p.generation,p.planRevision,p.effectiveCycle,JSON.stringify(p),Date.now());}
function newProject(v:Visitor,title:string,visibility='private',hostNow=true){
  persist(v);const id=randomUUID(),now=Date.now();
  run('insert into project(id,title,created_by,created_at,updated_at,revision,visibility) values(?,?,?,?,?,1,?)',id,title,v.id,now,now,visibility);
  run('insert into project_member values(?,?,?,?,null)',id,v.id,'owner',now);
  run('insert into project_settings values(?,100,?,?,1)',id,JSON.stringify({A:'A · Intro',B:'B · Build',C:'C · Lift',D:'D · Outro'}),JSON.stringify({entries:[{scene:'A',bars:4},{scene:'B',bars:4},{scene:'C',bars:4},{scene:'D',bars:4}],loop:true}));
  // The creator starts as host so a first mix never needs a podium claimed.
  run("insert into transport values(?,0,'stopped',null,?,?,1)",id,hostNow?v.id:null,hostNow?now+ROOM_LIMITS.hostLeaseMs:0);
  savePlan(id,blankPlan());return id;
}
export function createProject(v:Visitor,rawTitle:unknown){
  limit(`create:${v.id}`,10,0.2,'You are starting mixes very quickly. Try again shortly.');
  const title=rawTitle==null||rawTitle===''?generatedTitle():text(rawTitle,60,'the mix a name');
  return tx(after=>{const id=newProject(v,title);announce(after,v,id,'project.created',id,null);return {id};});
}
export function myProjects(v:Visitor){
  return rows(`select p.id,p.title,p.visibility,p.updated_at as updatedAt,m.role,(select count(*) from track t where t.project_id=p.id and t.archived_at is null and t.guest_performance_id is null) as parts,
    (select count(*) from project_member x where x.project_id=p.id and x.removed_at is null) as members
    from project_member m join project p on p.id=m.project_id where m.visitor_id=? and m.removed_at is null order by p.updated_at desc limit 50`,v.id);
}
export function publicProjects(page:number){
  const offset=Math.max(0,Math.floor(page))*24;
  return rows(`select p.id,p.title,p.updated_at as updatedAt,(select count(*) from track t where t.project_id=p.id and t.archived_at is null and t.guest_performance_id is null) as parts
    from project p where p.visibility='public' order by p.updated_at desc limit 25 offset ?`,offset);
}

// --- plans ----------------------------------------------------------------
function plansFor(id:string,generation:number):Plan[]{return rows('select plan_json from performance_plan where project_id=? and generation=? order by effective_cycle,plan_revision',id,generation).map(x=>JSON.parse(x.plan_json));}
function syncCatalog(id:string,p:Plan){
  const active=rows('select * from track where project_id=? and archived_at is null order by position',id),ids=new Set(active.map(x=>x.id));
  for(const key of Object.keys(p.catalog))if(!ids.has(key)){delete p.catalog[key];delete p.manual[key];delete p.mix[key];for(const s of SLOTS)delete p.sceneAssignments[s][key];}
  for(const t of active){
    p.catalog[t.id]=Object.fromEntries(rows('select c.slot,c.current_revision,r.document_json from clip c join clip_revision r on r.clip_id=c.id and r.revision=c.current_revision where c.track_id=?',t.id).map(c=>[c.slot,{revision:c.current_revision,document:JSON.parse(c.document_json)}]));
    p.mix[t.id]??={gain:0.7,mute:false};
    for(const s of SLOTS)p.sceneAssignments[s][t.id]=one('select clip_slot from scene_assignment where project_id=? and track_id=? and scene=?',id,t.id,s)?.clip_slot??null;
  }
}
function updatePlan(id:string,t:Row,bpm:number,edit:(p:Plan)=>void=()=>{}){
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
// Exposed for performances, whose guest parts join and leave the same plan.
export function replan(id:string){const t=one('select * from transport where project_id=?',id)!,s=one('select bpm from project_settings where project_id=?',id)!;return updatePlan(id,t,s.bpm);}
// The one way the host changes. Hosting is a single role: it controls the
// shared transport and, while a performance is live, that performance. Moving
// it in two places let the room and the stage disagree about who was in
// charge, so every path -- pass, release, claim, takeover, removal, timeout --
// goes through here, inside the caller’s transaction.
// Filled in by src/performances.ts at load: ending a performance belongs
// there, and studio.ts must not import it back.
let endLive:(after:(f:()=>void)=>void,performance:Row,reason:string,by:Visitor|null)=>void=()=>{};
export const onHostlessPerformance=(fn:typeof endLive)=>{endLive=fn;};
export function setHost(projectId:string,visitorId:string|null,now=Date.now()){
  run(`update transport set conductor_id=?,lease_until=?,revision=revision+1 where project_id=?`,visitorId,visitorId?now+ROOM_LIMITS.hostLeaseMs:0,projectId);
  const perf=livePerformance(projectId);
  if(!perf)return null;
  const previous=perf.host_id as string;
  if(visitorId){
    // A live performance follows the room. Its host row is what src/access.ts
    // reads for host-only powers, and its participant rows are its credits.
    run(`update performance set host_id=? where id=?`,visitorId,perf.id);
    run("insert into performance_participant(performance_id,visitor_id,role,admitted_at) values(?,?,'host',?) on conflict(performance_id,visitor_id) do update set role='host',removed=0",perf.id,visitorId,now);
    // Whoever held it before keeps no host-only power. The performance itself
    // continues at the same phase: nothing restarts.
    if(previous!==visitorId)run("update performance_participant set role='performer' where performance_id=? and visitor_id=? and role='host'",perf.id,previous);
    return null;
  }
  // Nobody is hosting. A live performance cannot continue unattended, and
  // leaving host_id naming the departed host would keep handing them
  // host-only powers, so the caller is told to end it.
  return perf;
}

function startTransport(id:string,t:Row,now:number){
  const p=structuredClone(plansFor(id,t.generation).at(-1)??blankPlan());p.generation=t.generation+1;p.planRevision=0;p.effectiveCycle=0;p.arrangement=null;syncCatalog(id,p);
  run("update transport set status='playing',epoch_ms=?,generation=generation+1,revision=revision+1 where project_id=?",now+1200,id);savePlan(id,p);
  run('delete from performance_plan where project_id=? and generation<?',id,t.generation+1);
}
function stopTransport(id:string,t:Row,bpm:number,now:number,releaseHost=false){
  const cycle=t.epoch_ms?cycleAt(now,t.epoch_ms,bpm):0;
  const latest=structuredClone(planAt(plansFor(id,t.generation),cycle)??plansFor(id,t.generation).at(-1)??blankPlan());latest.scene=sceneAt(latest,cycle);syncCatalog(id,latest);latest.generation=t.generation+1;latest.planRevision=0;latest.effectiveCycle=0;latest.arrangement=null;
  run("update transport set status='stopped',epoch_ms=null,generation=generation+1,revision=revision+1 where project_id=?",id);
  if(releaseHost)setHost(id,null,now);
  savePlan(id,latest);
  run('delete from performance_plan where project_id=? and generation<?',id,t.generation+1);
}

// --- snapshots --------------------------------------------------------------
export const isOnline=(visitorId:string)=>(online.get(visitorId)??0)>Date.now();
export function heartbeat(v:Visitor){online.set(v.id,Date.now()+30000);if(online.size>5000)for(const [k,u] of online)if(u<Date.now())online.delete(k);}
function leaseOf(trackId:string){const l=leases.get(trackId);if(!l||l.until<Date.now()){leases.delete(trackId);return null;}return l;}
function editorsNow(id:string){const m=editing.get(id)??new Map<string,number>(),now=Date.now();for(const [k,u] of m)if(u<now)m.delete(k);editing.set(id,m);return m;}
function guestPerformers(id:string){const perf=livePerformance(id);return perf?rows("select visitor_id from performance_participant where performance_id=? and role='performer' and removed=0",perf.id).map(x=>x.visitor_id as string):[];}
export function editCapacity(id:string,visitorId:string){
  const active=new Set([...editorsNow(id).keys(),...guestPerformers(id)]);
  const can=active.has(visitorId)||active.size<ROOM_LIMITS.editors;
  return {count:active.size,limit:ROOM_LIMITS.editors,youCanEdit:can,...(can?{}:{reason:`${ROOM_LIMITS.editors} people are editing right now. You can listen and chat; editing opens when someone finishes.`})};
}
function claimEditing(id:string,v:Visitor){const cap=editCapacity(id,v.id);need(cap.youCanEdit,cap.reason!,409);editorsNow(id).set(v.id,Date.now()+ROOM_LIMITS.editingWindowMs);}
function clipsOf(trackId:string,history:boolean){
  return Object.fromEntries(rows('select c.*,r.schema_version,r.document_json,r.source_text,r.provenance_json,r.created_by,r.created_at,v.handle from clip c join clip_revision r on r.clip_id=c.id and r.revision=c.current_revision join visitor v on v.id=r.created_by where c.track_id=?',trackId).map(c=>{
    const document=JSON.parse(c.document_json) as AnyDocument;
    return [c.slot,{id:c.id,slot:c.slot,revision:c.current_revision,schemaVersion:c.schema_version,document,source:sourceOf(document,c.source_text),provenance:JSON.parse(c.provenance_json),editedBy:{id:c.created_by,handle:c.handle},editedAt:c.created_at,
      ...(history?{history:rows('select r.revision,r.created_at as createdAt,v.handle as by from clip_revision r join visitor v on v.id=r.created_by where clip_id=? order by revision desc limit 20',c.id)}:{})}];
  }));
}
function partsOf(id:string,includeArchived:boolean):Part[]{
  return rows(`select t.*,v.handle,v.friend_code from track t join visitor v on v.id=t.owner_id where t.project_id=? ${includeArchived?'':'and t.archived_at is null'} and (t.guest_performance_id is null or t.archived_at is null) order by t.position`,id).map(t=>({
    id:t.id,name:t.name,role:roleOf(t.role),presetId:t.preset_id,presetVersion:t.preset_version,addedBy:{id:t.owner_id,handle:t.handle},revision:t.revision,archivedAt:t.archived_at,guest:!!t.guest_performance_id,clips:clipsOf(t.id,true),lease:leaseOf(t.id)}));
}
function settingsOf(id:string){const s=one('select * from project_settings where project_id=?',id)!;return {bpm:s.bpm,sceneNames:JSON.parse(s.scene_names_json),arrangement:JSON.parse(s.arrangement_json) as Arrangement,revision:s.settings_revision};}
function transportOf(id:string,now:number){const t=one('select * from transport where project_id=?',id)!;const hostId=t.lease_until>now?t.conductor_id:null;return {generation:t.generation,status:t.status,epochMs:t.epoch_ms,hostId,hostHandle:hostId?handleOf(hostId):null,leaseUntil:t.lease_until,revision:t.revision};}
export function roomSnapshot(v:Visitor,id:string):RoomSnapshot{
  db.exec('begin');
  try{
    const a=projectAccess(v,id);if(!a||a.read!=='member')throw hidden();
    const p=a.project,now=Date.now(),here=sweepRoom(roomPresence.get(id)??new Map());
    const members:Member[]=rows('select m.visitor_id,m.role,v.handle,v.friend_code from project_member m join visitor v on v.id=m.visitor_id where m.project_id=? and m.removed_at is null order by m.joined_at',id).map(m=>({id:m.visitor_id,handle:m.handle,code:m.friend_code??'',role:m.role,online:isOnline(m.visitor_id),here:here.has(m.visitor_id)}));
    const t=one('select generation from transport where project_id=?',id)!,perf=livePerformance(id);
    const me=one('select handle,friend_code from visitor where id=?',v.id);
    const result:RoomSnapshot={access:'member',id,title:p.title,visibility:p.visibility,migratedPublic:!!p.migrated_public&&a.role==='owner',revision:p.revision,eventId:Number(one("select coalesce(max(id),0) as id from event where scope=?",`member:${id}`)!.id),serverNowMs:now,
      you:{id:v.id,handle:me?.handle??v.handle,code:me?.friend_code??'',role:a.role!},members,parts:partsOf(id,true),settings:settingsOf(id),transport:transportOf(id,now),plans:plansFor(id,t.generation),
      presence:[...here].map(([pid,x])=>({id:pid,handle:x.handle})),
      performance:perf?{id:perf.id,title:perf.title,visibility:perf.visibility,hostId:perf.host_id,startedAt:perf.started_at,...(perf.visibility==='unlisted'?{listenToken:derive(`listen:${perf.id}:${perf.link_version}`)}:{})}:null,
      editors:editCapacity(id,v.id),
      viewToken:a.role==='owner'&&p.visibility==='unlisted'?derive(`view:${id}:${p.view_link_version}`):null};
    db.exec('commit');return result;
  }catch(e){db.exec('rollback');throw e;}
}
// What a non-member may see of a public or unlisted project: the saved mix and
// public credits. No members, chat, drafts, history, presence or invitations.
export function viewSnapshot(v:Visitor,id:string):ViewSnapshot{
  const a=readProject(v,id),p=a.project,t=one('select generation from transport where project_id=?',id)!;
  const plan=plansFor(id,t.generation).at(-1)??blankPlan();
  const perf=livePerformance(id);
  return {access:'view',id,title:p.title,visibility:p.visibility,bpm:settingsOf(id).bpm,
    parts:rows("select t.id,t.name,t.role,v.handle from track t join visitor v on v.id=t.owner_id where t.project_id=? and t.archived_at is null and t.guest_performance_id is null order by t.position",id).map(t=>{
      const c=one("select c.current_revision,r.document_json,r.source_text from clip c join clip_revision r on r.clip_id=c.id and r.revision=c.current_revision where c.track_id=? and c.slot='A'",t.id);
      const document=c?JSON.parse(c.document_json):emptyClip();
      return {id:t.id,name:t.name,role:roleOf(t.role),addedBy:t.handle,document,source:sourceOf(document,c?.source_text),gain:plan.mix[t.id]?.gain??0.7,mute:plan.mix[t.id]?.mute??false};
    }),
    performance:perf&&perf.visibility==='public'?{id:perf.id,title:perf.title}:null};
}
export function snapshot(v:Visitor,id:string){const a=projectAccess(v,id);if(!a)throw hidden();return a.read==='member'?roomSnapshot(v,id):viewSnapshot(v,id);}

// --- commands ---------------------------------------------------------------
type Envelope={commandId?:unknown;type?:unknown;expectedRevision?:unknown;payload?:any};
export function command(v:Visitor,id:string,input:Envelope){
  const type=text(input.type,50,'a command type'),payload=input.payload&&typeof input.payload==='object'?input.payload:{};
  try{
    const {cid,hash,replay}=receiptFor(v,input.commandId,`project:${id}`,{type,payload,expectedRevision:input.expectedRevision});
    if(replay)return replay;
    limit(`cmd:${v.id}`,20,5);
    const result=tx(after=>{
      const a=projectAccess(v,id);if(!a)throw hidden();
      need(a.read==='member','Only members of this mix can change it. Ask the owner for an invitation.',403);
      persist(v);
      const out=apply(v,a,type,payload,input.expectedRevision,cid,after);
      saveReceipt(v,cid,hash,out);return out;
    });
    return result;
  }catch(e){
    const refused=e instanceof CommandError?e:new CommandError(e instanceof Error?e.message:'Invalid command.');
    // A refusal is the other half of who-did-what.
    logAction(v,`${type}.refused`,{project:id.slice(0,8),status:refused.status,reason:refused.message,...partLabel(payload.trackId)},'warn');
    throw refused;
  }
}
function apply(v:Visitor,a:ProjectAccess,type:string,payload:any,expected:unknown,cid:string,after:(f:()=>void)=>void){
  const id=a.project.id as string,now=Date.now(),owner=a.role==='owner';
  const t=one('select * from transport where project_id=?',id)!,settings=one('select * from project_settings where project_id=?',id)!;
  const hostId=t.lease_until>now?t.conductor_id:null,isHost=hostId===v.id;
  let entityId:string|null=null,entityRevision=0,effectiveCycle:number|undefined,kind=type,view=false,audience=false,changed=true;
  const version=(row:Row,key='revision')=>{if(expected!==undefined&&row[key]!==expected)throw new CommandError('This changed in another session. Your draft is safe.',409,row);};
  const plan=(edit?:(p:Plan)=>void)=>{effectiveCycle=updatePlan(id,one('select * from transport where project_id=?',id)!,settings.bpm,edit);audience=true;view=true;};
  const host=()=>need(isHost,hostId?`${handleOf(hostId)} is hosting. Ask them, or wait for the host role to free up.`:'Take the host role first.',403);
  const part=(trackId:unknown,allowGuest=false)=>{const tr=one('select * from track where id=? and project_id=?',trackId,id);need(tr,'That part is not in this mix.',404);if(!allowGuest)need(!tr!.guest_performance_id,'Guest parts belong to their performer. Use Keep in project to save a copy.',403);return tr!;};
  const free=(tr:Row)=>{const l=leaseOf(tr.id);if(l&&l.visitorId!==v.id)throw new CommandError(`${l.handle} is editing this part. Duplicate it, ask in chat, or try again when they finish.`,409,{lease:l});};
  const capacity=()=>need(Number(one('select count(*) as n from track where project_id=? and archived_at is null',id)!.n)<ROOM_LIMITS.parts,`This mix has room for ${ROOM_LIMITS.parts} parts. Remove one to add another.`,409);
  const touchTrack=(tr:Row)=>{run('update track set revision=revision+1 where id=?',tr.id);entityId=tr.id;entityRevision=tr.revision+1;};
  const writeRevision=(tr:Row,s:Slot,doc:AnyDocument,source:string|null,provenance:Row)=>{
    const c=one('select * from clip where track_id=? and slot=?',tr.id,s);
    if(expected!==undefined&&(c?.current_revision??0)!==expected)throw new CommandError('Someone saved this part while you were editing. Your draft is safe: keep it, load theirs, or save yours as a new part.',409,{clip:c?{revision:c.current_revision}:null});
    const revision=(c?.current_revision??0)+1,schema=doc.schemaVersion;
    let clipId=c?.id as string|undefined;
    if(c)run('update clip set current_revision=? where id=?',revision,c.id);
    else{clipId=randomUUID();run('insert into clip values(?,?,?,?)',clipId,tr.id,s,revision);}
    run('insert into clip_revision values(?,?,?,?,?,?,?,?)',clipId,revision,schema,JSON.stringify(doc),source,JSON.stringify(provenance),v.id,now);
    run('delete from clip_revision where clip_id=? and revision<=?',clipId,revision-ROOM_LIMITS.revisionsKept);
    entityId=tr.id;entityRevision=revision;
  };
  const newPart=(name:string,role:string|null,presetId:string|null,presetVersion:number|null,source:string,provenance:Row,owner:string=v.id,guest:string|null=null)=>{
    const doc=parseSource(source).document,trackId=randomUUID(),position=Number(one('select coalesce(max(position),-1)+1 as p from track where project_id=?',id)!.p);
    run('insert into track(id,project_id,owner_id,name,position,revision,archived_at,role,preset_id,preset_version,guest_performance_id) values(?,?,?,?,?,1,null,?,?,?,?)',trackId,id,owner,name,position,role,presetId,presetVersion,guest);
    const clipId=randomUUID();run('insert into clip values(?,?,?,1)',clipId,trackId,'A');
    run('insert into clip_revision values(?,1,2,?,?,?,?,?)',clipId,JSON.stringify(doc),source,JSON.stringify(provenance),v.id,now);
    for(const s of SLOTS)run('insert into scene_assignment values(?,?,?,?)',id,s,trackId,'A');
    entityId=trackId;entityRevision=1;return trackId;
  };
  const sound=(p:any)=>{
    if(typeof p.presetId==='string'){const preset=presetById(p.presetId,typeof p.presetVersion==='number'?p.presetVersion:undefined);need(preset,'That sound is not in the catalogue.',404);return {name:preset!.name,role:preset!.role,presetId:preset!.id,presetVersion:preset!.version,source:preset!.source,provenance:{preset:{id:preset!.id,version:preset!.version}}};}
    if(typeof p.soundId==='string'){const s=one('select * from user_sound where id=? and visitor_id=?',p.soundId,v.id);need(s,'That saved sound is not yours or no longer exists.',404);return {name:s!.name,role:s!.role,presetId:null,presetVersion:null,source:s!.source,provenance:{sound:{id:s!.id,...JSON.parse(s!.attribution_json)}}};}
    const source=code(p.source),name=text(p.name??'My part',40,'the part a name');parseSource(source);
    return {name,role:(ROLES as readonly string[]).includes(p.role)?p.role:null,presetId:null,presetVersion:null,source,provenance:{via:'code'}};
  };
  switch(type){
    case 'part.add':{
      capacity();claimEditing(id,v);const s=sound(payload);
      newPart(s.name,s.role,s.presetId,s.presetVersion,s.source,s.provenance);plan();
      // "Add and play": the host's first addition may start the shared mix.
      if(payload.play===true&&t.status==='stopped'&&(isHost||!hostId)){
        setHost(id,v.id,now);
        startTransport(id,one('select * from transport where project_id=?',id)!,now);effectiveCycle=0;
      }
      break;
    }
    case 'part.edit':case 'part.swap':case 'part.restore':{
      const tr=part(payload.trackId),s=slot(payload.slot??'A');need(!tr.archived_at,'Bring this part back first.',409);free(tr);claimEditing(id,v);
      if(type==='part.edit'){
        const source=code(payload.source),doc=parseSource(source).document;
        writeRevision(tr,s,doc,source,{via:payload.via==='shape'?'shape':'code',...(tr.preset_id?{basedOn:{preset:tr.preset_id,version:tr.preset_version}}:{})});
      }else if(type==='part.swap'){
        const n=sound(payload);writeRevision(tr,s,parseSource(n.source).document,n.source,{...n.provenance,via:'swap'});
        run('update track set name=?,role=?,preset_id=?,preset_version=? where id=?',n.name,n.role,n.presetId,n.presetVersion,tr.id);
      }else{
        const c=one('select * from clip where track_id=? and slot=?',tr.id,s);const old=c&&one('select * from clip_revision where clip_id=? and revision=?',c.id,payload.revision);need(old,'That revision is unavailable.',404);
        const doc=validateAny(JSON.parse(old!.document_json));writeRevision(tr,s,doc,old!.source_text,{restoredFrom:payload.revision});
      }
      run('update track set revision=revision+1 where id=?',tr.id);plan();
      break;
    }
    case 'part.mix':{
      const tr=part(payload.trackId,true);version(tr);
      if(tr.guest_performance_id)need(tr.owner_id===v.id,'Guest parts belong to their performer.',403);
      const current=(plansFor(id,t.generation).at(-1)?.mix[tr.id])??{gain:0.7,mute:false};
      const gain=payload.gain===undefined?current.gain:payload.gain,mute=payload.mute===undefined?current.mute:payload.mute;
      need(typeof gain==='number'&&Number.isFinite(gain)&&gain>=0&&gain<=1&&typeof mute==='boolean','Volume is 0–1 and mute is on or off.');
      touchTrack(tr);plan(p=>{p.mix[tr.id]={gain,mute};});break;
    }
    case 'part.rename':{const tr=part(payload.trackId);version(tr);run('update track set name=? where id=?',text(payload.name,40,'the part a name'),tr.id);touchTrack(tr);view=true;audience=true;break;}
    case 'part.remove':{const tr=part(payload.trackId);version(tr);free(tr);run('update track set archived_at=? where id=?',now,tr.id);leases.delete(tr.id);touchTrack(tr);plan();break;}
    case 'part.return':{const tr=part(payload.trackId);need(tr.archived_at,'That part is already in the mix.',409);capacity();run('update track set archived_at=null where id=?',tr.id);touchTrack(tr);plan();break;}
    case 'part.duplicate':case 'part.keep':{
      const tr=part(payload.trackId,type==='part.keep');capacity();claimEditing(id,v);
      if(type==='part.keep')need(tr.guest_performance_id,'Only guest parts need keeping.',409);
      const c=one("select r.*,c.slot from clip c join clip_revision r on r.clip_id=c.id and r.revision=c.current_revision where c.track_id=? and c.slot=?",tr.id,payload.slot??'A');need(c,'That part has no saved sound to copy.',404);
      const doc=validateAny(JSON.parse(c!.document_json)),source=sourceOf(doc,c!.source_text);
      const provenance=type==='part.keep'?{keptBy:v.handle,fromPerformance:tr.guest_performance_id}:{duplicatedFrom:{part:tr.name,by:handleOf(tr.owner_id)}};
      newPart(type==='part.keep'?tr.name:`${tr.name} copy`.slice(0,40),tr.role,tr.preset_id,tr.preset_version,source,provenance,type==='part.keep'?tr.owner_id:v.id);
      plan();break;
    }
    case 'part.slot':{
      const tr=part(payload.trackId);version(tr);touchTrack(tr);
      plan(p=>{if(payload.slot==='follow')delete p.manual[tr.id];else p.manual[tr.id]=payload.slot===null?null:slot(payload.slot);});break;
    }
    case 'scene.assign':{const tr=part(payload.trackId);version(tr);run('update scene_assignment set clip_slot=? where project_id=? and scene=? and track_id=?',payload.clipSlot===null?null:slot(payload.clipSlot),id,slot(payload.scene),tr.id);touchTrack(tr);plan();break;}
    case 'part.lease':{
      const tr=part(payload.trackId,true);if(tr.guest_performance_id)need(tr.owner_id===v.id,'Guest parts belong to their performer.',403);
      free(tr);claimEditing(id,v);const had=leaseOf(tr.id);leases.set(tr.id,{visitorId:v.id,handle:handleOf(v.id),until:now+ROOM_LIMITS.leaseMs,projectId:id});
      entityId=tr.id;changed=!had;break;
    }
    case 'part.release':{
      const tr=part(payload.trackId,true),l=leaseOf(tr.id);entityId=tr.id;
      if(l&&l.visitorId!==v.id)need(owner&&payload.force===true,`${l.handle} is editing this part.`,403);
      changed=!!l;leases.delete(tr.id);break;
    }
    case 'project.rename':{run('update project set title=? where id=?',text(payload.title,60,'the mix a name'),id);entityId=id;view=true;audience=true;break;}
    case 'project.visibility':{
      need(owner,'Only the owner can change who can see this mix.',403);need(VISIBILITIES.includes(payload.visibility),'Choose private, unlisted or public.');
      // Any change away from, or back to, unlisted retires the old view link.
      run('update project set visibility=?,view_link_version=view_link_version+?,migrated_public=0 where id=?',payload.visibility,a.project.visibility!==payload.visibility?1:0,id);
      run("delete from capability_grant where kind='view' and resource_id=?",id);
      entityId=id;after(revalidate);break;
    }
    case 'project.rotateLink':{need(owner,'Only the owner can change the view link.',403);run('update project set view_link_version=view_link_version+1 where id=?',id);run("delete from capability_grant where kind='view' and resource_id=?",id);entityId=id;after(revalidate);break;}
    case 'project.acknowledge':{need(owner,'Only the owner sees this note.',403);run('update project set migrated_public=0 where id=?',id);entityId=id;break;}
    case 'member.remove':case 'member.leave':{
      const target=type==='member.leave'?v.id:payload.visitorId;
      if(type==='member.remove')need(owner,'Only the owner manages membership.',403);
      const m=one('select * from project_member where project_id=? and visitor_id=? and removed_at is null',id,target);need(m,'That person is not a member.',404);
      need(m!.role!=='owner','The owner stays with the mix. Make it private instead of leaving.',409);
      run('update project_member set removed_at=? where project_id=? and visitor_id=?',now,id,target);
      for(const [k,l] of leases)if(l.projectId===id&&l.visitorId===target)leases.delete(k);
      if(hostId===target){const orphaned=setHost(id,null,now);if(orphaned)endLive(after,orphaned,'host-left',v);}
      entityId=target;after(revalidate);break;
    }
    case 'host.claim':{need(!hostId||isHost,`${hostId?handleOf(hostId):'Someone'} is hosting.`,409);setHost(id,v.id,now);entityRevision=t.revision+1;break;}
    case 'host.pass':{host();need(memberRole(id,payload.visitorId),'Hosting passes to a member of this mix.',404);setHost(id,payload.visitorId,now);entityId=payload.visitorId;audience=true;break;}
    case 'host.release':{host();const orphaned=setHost(id,null,now);if(orphaned)endLive(after,orphaned,'host-left',v);break;}
    case 'transport.start':{
      need(t.status==='stopped','The mix is already playing.',409);
      if(!isHost){need(!hostId,`${hostId?handleOf(hostId):''} is hosting. Only the host starts the shared mix.`,403);setHost(id,v.id,now);}
      startTransport(id,one('select * from transport where project_id=?',id)!,now);entityRevision=t.revision+1;audience=true;break;
    }
    case 'transport.stop':{need(t.status==='playing','The mix is already stopped.',409);need(isHost||owner,'Only the host stops the shared mix.',403);stopTransport(id,t,settings.bpm,now);entityRevision=t.revision+1;audience=true;break;}
    case 'tempo.set':{host();need(t.status==='stopped','Stop the mix before changing tempo.',409);need(Number.isInteger(payload.bpm)&&payload.bpm>=60&&payload.bpm<=180,'Tempo is 60–180 BPM.');run('update project_settings set bpm=?,settings_revision=settings_revision+1 where project_id=?',payload.bpm,id);plan();break;}
    case 'scene.rename':{host();const names=JSON.parse(settings.scene_names_json);names[slot(payload.scene)]=text(payload.name,30,'the scene a name');run('update project_settings set scene_names_json=?,settings_revision=settings_revision+1 where project_id=?',JSON.stringify(names),id);break;}
    case 'arrangement.save':{host();run('update project_settings set arrangement_json=?,settings_revision=settings_revision+1 where project_id=?',JSON.stringify(arrangement(payload)),id);break;}
    case 'scene.launch':case 'arrangement.start':case 'arrangement.stop':{
      host();
      plan(p=>{
        if(type==='scene.launch'){p.scene=slot(payload.scene);p.arrangement=null;}
        if(type==='arrangement.start'){need(t.status==='playing','Start the mix first.',409);p.arrangement={...arrangement(JSON.parse(settings.arrangement_json)),startCycle:p.effectiveCycle};}
        if(type==='arrangement.stop'){p.scene=sceneAt(p,p.effectiveCycle);p.arrangement=null;}
      });
      run('update transport set revision=revision+1 where project_id=?',id);break;
    }
    default:throw new CommandError('Unknown command.');
  }
  if(changed){
    run('update project set revision=revision+1,updated_at=? where id=?',now,id);
    const eventId=announce(after,v,id,kind,entityId,cid,{view,audience});
    return {ok:true,commandId:cid,projectRevision:Number(a.project.revision)+1,entityId,entityRevision,eventId,...(effectiveCycle!==undefined?{effectiveCycle}:{})};
  }
  return {ok:true,commandId:cid,projectRevision:Number(a.project.revision),entityId,entityRevision,eventId:0};
}
function arrangement(raw:any):Arrangement{
  need(raw&&Array.isArray(raw.entries)&&raw.entries.length>0&&raw.entries.length<=8&&typeof raw.loop==='boolean','An arrangement has 1–8 entries and a Loop choice.');
  return {loop:raw.loop,entries:raw.entries.map((x:any)=>{need(Number.isInteger(x.bars)&&x.bars>=1&&x.bars<=16,'Each scene runs for 1–16 bars.');return {scene:slot(x.scene),bars:x.bars};})};
}

// --- presence, leases and streams ----------------------------------------------
// The room heartbeat keeps a member visible to the room and renews the host's
// lease: hosting lasts as long as the host's page is connected.
export function roomHeartbeat(v:Visitor,id:string){
  const a=projectAccess(v,id);if(!a||a.read!=='member')throw hidden();
  heartbeat(v);const p=roomPresence.get(id)??new Map(),first=!p.has(v.id);
  sweepRoom(p);need(p.has(v.id)||p.size<64,'Room presence is full.',429);
  p.set(v.id,{handle:handleOf(v.id),until:Date.now()+30000});roomPresence.set(id,p);
  const now=Date.now();
  run('update transport set lease_until=? where project_id=? and conductor_id=? and lease_until>?',now+ROOM_LIMITS.hostLeaseMs,id,v.id,now);
  for(const l of leases.values())if(l.projectId===id&&l.visitorId===v.id)l.until=now+ROOM_LIMITS.leaseMs;
  if(first){logAction(v,'presence.join',{project:id.slice(0,8)});broadcast(`member:${id}`,0,'presence');}
}
export function projectStream(id:string,v:Visitor,res:import('node:http').ServerResponse,cursor:number){
  const a=projectAccess(v,id);if(!a)throw hidden();
  if(a.read==='member')openStream(res,v.id,`member:${id}`,cursor,()=>!!memberRole(id,v.id));
  else openStream(res,v.id,`view:${id}`,cursor,()=>{const x=projectAccess(v,id);return !!x;});
}

// A host who has gone away does not leave the room playing unattended: once
// the lease lapses, the shared mix stops and any member may take over.
function sweepHosts(){
  const now=Date.now();
  for(const t of rows("select * from transport where status='playing' and lease_until<=?",now)){
    try{tx(after=>{const fresh=one('select * from transport where project_id=?',t.project_id)!;if(fresh.status!=='playing'||fresh.lease_until>now)return;
      const bpm=one('select bpm from project_settings where project_id=?',t.project_id)!.bpm;stopTransport(t.project_id,fresh,bpm,now,true);
      run('update project set revision=revision+1 where id=?',t.project_id);announce(after,null,t.project_id,'host.lost',null,null,{audience:true});});}
    catch(e){console.error(JSON.stringify({at:now,level:'error',msg:'host sweep failed',message:e instanceof Error?e.message:String(e)}));}
  }
  for(const [k,l] of leases)if(l.until<now){leases.delete(k);broadcast(`member:${l.projectId}`,0,'lease');}
}
setInterval(sweepHosts,2000).unref();

// --- chat (members only) ------------------------------------------------------
export function projectChat(v:Visitor,id:string,before:unknown){
  const a=projectAccess(v,id);if(!a||a.read!=='member')throw hidden();
  const cursor=Number(before);const limitRows=ROOM_LIMITS.chatPage;
  const list=rows(`select c.id,c.visitor_id,c.client_id,c.body,c.created_at,c.deleted_at,v.handle from project_chat c join visitor v on v.id=c.visitor_id where c.project_id=? and not exists(select 1 from block_link b where b.blocker_id=? and b.blocked_id=c.visitor_id) ${Number.isFinite(cursor)&&cursor>0?'and c.id<?':''} order by c.id desc limit ?`,...(Number.isFinite(cursor)&&cursor>0?[id,v.id,cursor,limitRows+1]:[id,v.id,limitRows+1]));
  return {messages:list.slice(0,limitRows).reverse().map(chatRow),more:list.length>limitRows};
}
export const chatRow=(c:Row)=>({id:c.id,authorId:c.visitor_id,author:c.handle,clientId:c.client_id,body:c.deleted_at?null:c.body,deleted:!!c.deleted_at,createdAt:c.created_at});
export function chatBody(x:unknown){need(typeof x==='string','Write a message.');const body=(x as string).replace(/\r\n?/g,'\n').trim();need(body.length>0,'Write a message.');need(body.length<=ROOM_LIMITS.chatLength,`Messages are at most ${ROOM_LIMITS.chatLength} characters.`,413);return body;}
export function sendProjectChat(v:Visitor,id:string,input:Row){
  const clientId=typeof input.clientId==='string'&&/^[0-9a-f-]{36}$/i.test(input.clientId)?input.clientId:null;need(clientId,'Message needs a client id.');
  const body=chatBody(input.body);
  return tx(after=>{
    const a=projectAccess(v,id);if(!a||a.read!=='member')throw hidden();
    // A retried send returns the message it already made.
    const existing=one('select c.*,v.handle from project_chat c join visitor v on v.id=c.visitor_id where project_id=? and visitor_id=? and client_id=?',id,v.id,clientId);
    if(existing)return {message:chatRow(existing)};
    limit(`chat:${v.id}`,6,1,'You are sending messages quickly. Wait a moment.');
    const msgId=Number(run('insert into project_chat(project_id,visitor_id,client_id,body,created_at) values(?,?,?,?,?)',id,v.id,clientId,body,Date.now()).lastInsertRowid);
    announce(after,v,id,'chat',String(msgId),null,{log:{message:msgId}});
    return {message:chatRow(one('select c.*,v.handle from project_chat c join visitor v on v.id=c.visitor_id where c.id=?',msgId)!)};
  });
}
export function deleteProjectChat(v:Visitor,id:string,messageId:unknown){
  return tx(after=>{
    const a=projectAccess(v,id);if(!a||a.read!=='member')throw hidden();
    const m=one('select * from project_chat where id=? and project_id=?',messageId,id);need(m,'That message is gone.',404);
    const t=one('select * from transport where project_id=?',id)!;
    need(m!.visitor_id===v.id||a.role==='owner'||(t.conductor_id===v.id&&t.lease_until>Date.now()),'Only the author, the owner or the host can remove a message.',403);
    run('update project_chat set deleted_at=?,deleted_by=? where id=?',Date.now(),v.id,m!.id);
    announce(after,v,id,'chat.deleted',String(m!.id),null);return {ok:true};
  });
}

// --- saved sounds ("My sounds") ------------------------------------------------
export function mySounds(v:Visitor){return rows('select id,name,role,source,attribution_json,created_at as createdAt from user_sound where visitor_id=? order by created_at desc limit 100',v.id).map(s=>({id:s.id,name:s.name,role:roleOf(s.role),source:s.source,attribution:JSON.parse(s.attribution_json),createdAt:s.createdAt}));}
export function saveSound(v:Visitor,input:Row){
  const name=text(input.name,40,'the sound a name'),source=code(input.source);parseSource(source);
  limit(`sound:${v.id}`,10,0.2);persist(v);
  need(Number(one('select count(*) as n from user_sound where visitor_id=?',v.id)!.n)<100,'You can keep 100 sounds. Delete one first.',409);
  const from=typeof input.from==='object'&&input.from?{part:typeof input.from.part==='string'?input.from.part.slice(0,40):undefined,preset:typeof input.from.preset==='string'?input.from.preset.slice(0,40):undefined,addedBy:typeof input.from.addedBy==='string'?input.from.addedBy.slice(0,40):undefined}:{};
  const sid=randomUUID();run('insert into user_sound values(?,?,?,?,?,?,?)',sid,v.id,name,(ROLES as readonly string[]).includes(input.role)?input.role:null,source,JSON.stringify({savedBy:handleOf(v.id),...from}),Date.now());
  return {id:sid};
}
export function deleteSound(v:Visitor,soundId:unknown){need(run('delete from user_sound where id=? and visitor_id=?',soundId,v.id).changes,'That sound is not yours.',404);return {ok:true};}

// --- export and import (members only) ---------------------------------------------
export function exportProject(v:Visitor,id:string){
  const s=roomSnapshot(v,id);
  return {format:'ensemble',schemaVersion:2,title:s.title,settings:{bpm:s.settings.bpm,sceneNames:s.settings.sceneNames,arrangement:s.settings.arrangement},
    parts:s.parts.filter(p=>!p.archivedAt&&!p.guest).map(p=>({id:p.id,name:p.name,role:p.role==='custom'?null:p.role,presetId:p.presetId,presetVersion:p.presetVersion,clips:Object.fromEntries(Object.entries(p.clips).map(([k,c])=>[k,{document:c!.document,source:c!.source,provenance:c!.provenance}]))})),
    plan:(()=>{const p=s.plans.at(-1)!;return {mix:p.mix,manual:p.manual,sceneAssignments:p.sceneAssignments,scene:p.scene};})()};
}
export function importProject(v:Visitor,input:Row){
  limit(`create:${v.id}`,10,0.2,'You are starting mixes very quickly. Try again shortly.');
  const stream=input.format==='stream'&&input.schemaVersion===1,ensemble=input.format==='ensemble'&&input.schemaVersion===2;
  need(stream||ensemble,'This is not an Ensemble or Stream project file.');
  const list=(stream?input.tracks:input.parts) as Row[];need(Array.isArray(list)&&list.length<=24,'A project file holds at most 24 parts.');
  const title=text(input.title,60,'the mix a name');need(Number.isInteger(input.settings?.bpm)&&input.settings.bpm>=60&&input.settings.bpm<=180,'Invalid tempo.');
  const arr=arrangement(input.settings?.arrangement);
  return tx(after=>{
    const id=newProject(v,title),mapping:Record<string,string>={},now=Date.now();
    list.forEach((raw,i)=>{
      need(raw&&typeof raw==='object'&&raw.clips&&typeof raw.clips==='object'&&Object.keys(raw.clips).length<=4,'Each part has at most four clip slots.');
      const trackId=randomUUID();mapping[String(raw.id??i)]=trackId;
      // Parts beyond the twelve-part limit arrive removed, not dropped.
      run('insert into track(id,project_id,owner_id,name,position,revision,archived_at,role,preset_id,preset_version) values(?,?,?,?,?,1,?,?,?,?)',trackId,id,v.id,text(raw.name,40,'each part a name'),i,i>=ROOM_LIMITS.parts?now:null,(ROLES as readonly string[]).includes(raw.role)?raw.role:null,typeof raw.presetId==='string'?raw.presetId:null,Number.isInteger(raw.presetVersion)?raw.presetVersion:null);
      for(const [s,c] of Object.entries(raw.clips) as [string,Row][]){
        slot(s);let doc:AnyDocument,source:string|null=c.source??null;
        if(c.document?.schemaVersion===2){need(typeof source==='string','Expression parts carry their source.');doc=parseSource(source!).document;}
        else{doc=validateDocument(c.document);if(source!=null)need(JSON.stringify(parseCode(text(source,8192,'the code')))===JSON.stringify(doc),'Imported code disagrees with its pattern.');}
        const clipId=randomUUID();run('insert into clip values(?,?,?,1)',clipId,trackId,s);
        run('insert into clip_revision values(?,1,?,?,?,?,?,?)',clipId,doc.schemaVersion,JSON.stringify(doc),source,JSON.stringify({imported:true}),v.id,now);
      }
      if(!Object.keys(raw.clips).length){const clipId=randomUUID();run('insert into clip values(?,?,?,1)',clipId,trackId,'A');run('insert into clip_revision values(?,1,1,?,null,?,?,?)',clipId,JSON.stringify(emptyClip()),JSON.stringify({imported:true}),v.id,now);}
      for(const s of SLOTS)run('insert into scene_assignment values(?,?,?,?)',id,s,trackId,'A');
    });
    const names=Object.fromEntries(SLOTS.map(s=>[s,text(input.settings.sceneNames?.[s]??s,30,'each scene a name')]));
    run('update project_settings set bpm=?,scene_names_json=?,arrangement_json=? where project_id=?',input.settings.bpm,JSON.stringify(names),JSON.stringify(arr),id);
    const p=blankPlan();
    for(const [oldId,newId] of Object.entries(mapping)){
      for(const scene of SLOTS){const assignment=input.plan?.sceneAssignments?.[scene]?.[oldId];if(assignment!==undefined)run('update scene_assignment set clip_slot=? where project_id=? and scene=? and track_id=?',assignment===null?null:slot(assignment),id,scene,newId);}
      const mix=input.plan?.mix?.[oldId];
      if(mix!==undefined){need(typeof mix.gain==='number'&&Number.isFinite(mix.gain)&&mix.gain>=0&&mix.gain<=1&&typeof mix.mute==='boolean','Invalid imported mixer.');p.mix[newId]={gain:mix.gain,mute:mix.mute};}
      if(input.plan?.manual&&Object.hasOwn(input.plan.manual,oldId))p.manual[newId]=input.plan.manual[oldId]===null?null:slot(input.plan.manual[oldId]);
    }
    if(input.plan?.scene!==undefined)p.scene=slot(input.plan.scene);
    syncCatalog(id,p);p.planRevision=1;savePlan(id,p);
    announce(after,v,id,'project.imported',id,null);return {id};
  });
}

// --- boot: legacy sketches, then restart handling ----------------------------------
// Import each old trace once, preserving unsupported code verbatim as an archive.
function migrateLegacy(){
  const old=rows('select t.*,v.handle from trace t join visitor v on v.id=t.visitor_id where t.id not in(select trace_id from legacy_import) order by t.id');
  if(!old.length)return;
  db.exec('begin immediate');try{
    const first=old[0],v:Visitor={id:first.visitor_id,handle:first.handle,fresh:false};
    let id=one("select id from project where title='Earlier sketches' limit 1")?.id;if(!id)id=newProject(v,'Earlier sketches','private',false);
    for(const row of old){
      try{const doc=parseCode(row.body),count=Number(one('select count(*) as n from track where project_id=? and archived_at is null',id)!.n);
        const trackId=randomUUID(),position=Number(one('select coalesce(max(position),-1)+1 as p from track where project_id=?',id)!.p);
        run('insert into track(id,project_id,owner_id,name,position,revision,archived_at) values(?,?,?,?,?,1,?)',trackId,id,row.visitor_id,`${row.handle} sketch`.slice(0,40),position,count>=ROOM_LIMITS.parts?Date.now():null);
        const clipId=randomUUID();run('insert into clip values(?,?,?,1)',clipId,trackId,'A');
        run('insert into clip_revision values(?,1,1,?,?,?,?,?)',clipId,JSON.stringify(doc),row.body,'{}',row.visitor_id,Date.now());
        for(const s of SLOTS)run('insert into scene_assignment values(?,?,?,?)',id,s,trackId,'A');
        run("insert or ignore into project_member values(?,?,'member',?,null)",id,row.visitor_id,Date.now());
        run('insert into legacy_import values(?,?,?,null)',row.id,clipId,row.body);
      }catch(e){run('insert into legacy_import values(?,null,?,?)',row.id,row.body,e instanceof Error?e.message:'Unsupported sketch');}
    }
    const p=blankPlan();syncCatalog(id,p);p.planRevision=(plansFor(id,0).at(-1)?.planRevision??0)+1;savePlan(id,p);db.exec('commit');
  }catch(e){db.exec('rollback');throw e;}
}
migrateLegacy();
// A restart ends live performances (interrupted, guest parts removed), stops
// every transport, releases hosts and cancels queued plan changes. Saved music,
// members, friends, invitations, chat and revisions stay. The crash instant is
// unknown, so the last durable write stands in for it: a plan already sounding
// by then is kept, and anything still queued after it is cancelled.
for(const perf of rows("select * from performance where status='live'")){
  tx(after=>{
    run("update performance set status='ended',ended_at=?,end_reason='interrupted' where id=?",Date.now(),perf.id);
    run('update track set archived_at=? where guest_performance_id=? and archived_at is null',Date.now(),perf.id);
    announce(after,null,perf.project_id,'performance.interrupted',perf.id,null,{log:{performance:perf.id.slice(0,8)}});
  });
}
for(const t of rows("select * from transport where status='playing' or conductor_id is not null")){
  db.exec('begin immediate');try{
    const plans=plansFor(t.project_id,t.generation),bpm=one('select bpm from project_settings where project_id=?',t.project_id)!.bpm;
    const lastWrite=Math.max(Number(one('select max(created_at) as at from performance_plan where project_id=? and generation=?',t.project_id,t.generation)?.at??0),Number(one('select max(created_at) as at from event where project_id=?',t.project_id)?.at??0));
    const p=planAtRestart(plans,t.status==='playing'?t.epoch_ms:null,bpm,lastWrite);p.generation=t.generation+1;p.effectiveCycle=0;p.planRevision=0;p.arrangement=null;syncCatalog(t.project_id,p);
    run("update transport set status='stopped',epoch_ms=null,conductor_id=null,lease_until=0,generation=generation+1,revision=revision+1 where project_id=?",t.project_id);savePlan(t.project_id,p);
    run('delete from performance_plan where project_id=? and generation<?',t.project_id,t.generation+1);
    addEvent(`member:${t.project_id}`,null,'transport.reset',{},t.project_id,null);db.exec('commit');logAction(null,'transport.reset',{project:t.project_id.slice(0,8)});
  }catch(e){db.exec('rollback');throw e;}
}
export function legacyArchive(){return rows('select l.trace_id,l.archived_source,l.reason,v.handle from legacy_import l join trace t on t.id=l.trace_id join visitor v on v.id=t.visitor_id where new_clip_id is null');}
export const leaseCount=()=>leases.size;
