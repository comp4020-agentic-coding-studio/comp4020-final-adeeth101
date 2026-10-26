// Live performances. A performance presents a project on that project's own
// transport and plans, so going live never starts a second scheduler or resets
// musical phase. The audience reads a separate snapshot built from the active
// plan, credits and audience presence; it never receives the project snapshot.
import {randomUUID} from 'node:crypto';
import {persist,type Visitor} from './identity.ts';
import {logAction} from './events.ts';
import {CommandError,need,hidden,text,code,one,rows,run,tx,limit,receiptFor,saveReceipt} from './errors.ts';
import {memberOf,performanceAccess,readPerformance,memberRole} from './access.ts';
import {addEvent,broadcast,openStream,revalidate,scopeListeners} from './hub.ts';
import {announce,setHost,onHostlessPerformance,replan,chatRow,chatBody,editCapacity,heartbeat,ROOM_LIMITS} from './studio.ts';
import {parseSource} from '../shared/expr.ts';
import {presetById,roleOf} from '../shared/presets.ts';
import {SLOTS,publishedPlan,type Plan} from '../shared/performance.ts';
import type {AudienceSnapshot} from '../shared/studio.ts';

type Row=Record<string,any>;
export const LIVE_LIMITS={listeners:32,reactionsPerSecond:2,chatRetentionDays:7};
const REACTIONS=['clap','heart','fire','wave'];
const handleOf=(id:string)=>one('select handle from visitor where id=?',id)?.handle??'someone';
const listenersOf=(id:string)=>new Set(scopeListeners(`audience:${id}`).map(l=>l.visitorId));
function audienceEvent(after:(f:()=>void)=>void,performanceId:string,kind:string,visitorId:string|null=null){const eid=addEvent(`audience:${performanceId}`,visitorId,kind,{});after(()=>broadcast(`audience:${performanceId}`,eid,kind));}
const plansFor=(projectId:string,generation:number):Plan[]=>rows('select plan_json from performance_plan where project_id=? and generation=? order by effective_cycle,plan_revision',projectId,generation).map(x=>JSON.parse(x.plan_json));

// --- lifecycle -------------------------------------------------------------------
export function startPerformance(v:Visitor,projectId:string,input:Row){
  const {cid,hash,replay}=receiptFor(v,input.commandId,`golive:${projectId}`,{title:input.title,visibility:input.visibility});
  if(replay)return replay;
  const title=text(input.title,60,'the performance a name'),visibility=input.visibility==='public'?'public':input.visibility==='unlisted'||input.visibility==null?'unlisted':null;
  need(visibility,'Choose public or unlisted.');
  return tx(after=>{
    const a=memberOf(v,projectId),now=Date.now(),t=one('select * from transport where project_id=?',projectId)!;
    need(t.conductor_id===v.id&&t.lease_until>now,'Only the host can go live. Take the host role first.',403);
    need(!one("select id from performance where project_id=? and status='live'",projectId),'This mix is already live.',409);
    const id=randomUUID();
    run("insert into performance(id,project_id,title,visibility,status,host_id,started_by,started_at) values(?,?,?,?,'live',?,?,?)",id,projectId,title,visibility,v.id,v.id,now);
    run("insert into performance_participant(performance_id,visitor_id,role,admitted_at) values(?,?,'host',?)",id,v.id,now);
    run('update project set revision=revision+1 where id=?',projectId);
    announce(after,v,projectId,'performance.started',id,null,{audience:false,log:{performance:id.slice(0,8),visibility,projectVisibility:a.project.visibility}});
    const result={ok:true,id};saveReceipt(v,cid,hash,result);return result;
  });
}
// Releasing or losing the host leaves a live performance with nobody
// accountable; studio.ts reports it here and it ends, as a restart would.
onHostlessPerformance((after,performance,reason,by)=>endIn(after,performance,reason,by));
export function endPerformance(v:Visitor,performanceId:string,reason='ended'){
  const r=tx(after=>{
    const a=readPerformance(v,performanceId),p=a.performance;
    need(p.status==='live','This performance has already ended.',409);
    need(a.role==='host'||memberRole(p.project_id,v.id)==='owner','Only the host ends the performance.',403);
    endIn(after,p,reason,v);return {ok:true};
  });
  revalidate();return r;
}
function endIn(after:(f:()=>void)=>void,p:Row,reason:string,v:Visitor|null){
  const now=Date.now();
  run("update performance set status='ended',ended_at=?,end_reason=? where id=?",now,reason,p.id);
  // Guest parts leave the mix at the next boundary; kept copies are separate parts.
  const removed=run('update track set archived_at=? where guest_performance_id=? and archived_at is null',now,p.id).changes;
  if(removed)replan(p.project_id);
  run('update project set revision=revision+1 where id=?',p.project_id);
  audienceEvent(after,p.id,'performance.ended');
  announce(after,v,p.project_id,'performance.ended',p.id,null,{log:{performance:p.id.slice(0,8),reason,guestParts:removed}});
}
// Ends live performances whose host has lost the project's host lease long
// enough for the transport to stop: a live room is not left unattended.
export function sweepPerformances(){
  const now=Date.now();
  for(const p of rows("select p.* from performance p join transport t on t.project_id=p.project_id where p.status='live' and (t.conductor_id is null or t.lease_until<=?) and p.started_at<?",now,now-ROOM_LIMITS.hostLeaseMs)){
    try{tx(after=>{const fresh=one('select * from performance where id=?',p.id)!;if(fresh.status!=='live')return;endIn(after,fresh,'host-left',null);});revalidate();}
    catch(e){console.error(JSON.stringify({at:now,level:'error',msg:'performance sweep failed',message:e instanceof Error?e.message:String(e)}));}
  }
  run('delete from performance_chat where performance_id in (select id from performance where status=? and ended_at<?)','ended',now-LIVE_LIMITS.chatRetentionDays*86400000);
}
setInterval(sweepPerformances,3000).unref();

// --- what the audience sees ------------------------------------------------------------
export function audienceSnapshot(v:Visitor,performanceId:string):AudienceSnapshot{
  const a=readPerformance(v,performanceId),p=a.performance,project=one('select id,title from project where id=?',p.project_id)!;
  const here=listenersOf(p.id),full=a.role==='listener'&&!here.has(v.id)&&here.size>=LIVE_LIMITS.listeners;
  const live=p.status==='live'&&!full,t=one('select * from transport where project_id=?',p.project_id)!,bpm=one('select bpm from project_settings where project_id=?',p.project_id)!.bpm;
  const part=one('select * from performance_participant where performance_id=? and visitor_id=?',p.id,v.id);
  // Published mix: each plan reduced to the musical revisions this
  // performance can reach (publishedPlan in shared/performance.ts). A clip no
  // scene, override or running arrangement selects is the project members’
  // own workspace and never reaches a listener; the plan that first needs one
  // carries it, at the bar that change takes effect. Source, history,
  // provenance, drafts, members and chat are never included.
  const plans=live?plansFor(p.project_id,t.generation).map(publishedPlan):[];
  const parts=live?rows('select t.id,t.name,t.role,t.guest_performance_id,v.handle from track t join visitor v on v.id=t.owner_id where t.project_id=? and t.archived_at is null order by t.position',p.project_id).map(x=>({id:x.id,name:x.name,role:roleOf(x.role),addedBy:x.handle,guest:!!x.guest_performance_id})):[];
  const performers=rows("select pp.visitor_id,pp.role,v.handle from performance_participant pp join visitor v on v.id=pp.visitor_id where pp.performance_id=? and pp.removed=0 and pp.role in ('host','performer')",p.id).map(x=>({id:x.visitor_id,handle:x.handle,role:x.visitor_id===p.host_id?'host':x.role}));
  const credits=new Map(performers.map(x=>[x.id,x]));
  for(const x of rows('select distinct t.owner_id,v.handle from track t join visitor v on v.id=t.owner_id where t.project_id=? and t.archived_at is null',p.project_id))if(!credits.has(x.owner_id))credits.set(x.owner_id,{id:x.owner_id,handle:x.handle,role:'composer'});
  const host=a.role==='host';
  return {id:p.id,projectId:a.role==='listener'||a.role==='performer'?null:project.id,title:p.title,projectTitle:project.title,visibility:p.visibility,status:p.status,endReason:p.end_reason,
    serverNowMs:Date.now(),eventId:Number(one('select coalesce(max(id),0) as id from event where scope=?',`audience:${p.id}`)!.id),bpm,
    transport:live?{status:t.status,epochMs:t.epoch_ms,generation:t.generation}:{status:'stopped',epochMs:null,generation:t.generation},
    plans,performers:[...credits.values()],parts,audience:here.size,capacity:LIVE_LIMITS.listeners,full,
    you:{id:v.id,handle:handleOf(v.id),code:one('select friend_code from visitor where id=?',v.id)?.friend_code??'',role:a.role,muted:!!part?.muted,request:one('select status from performance_request where performance_id=? and visitor_id=?',p.id,v.id)?.status??null},
    ...(host?{requests:rows("select r.visitor_id,v.handle from performance_request r join visitor v on v.id=r.visitor_id where r.performance_id=? and r.status='pending' order by r.created_at",p.id).map(x=>({visitorId:x.visitor_id,handle:x.handle}))}:{}),
    hostHandle:handleOf(p.host_id)};
}
export function audienceStream(v:Visitor,performanceId:string,res:import('node:http').ServerResponse,cursor:number){
  const a=readPerformance(v,performanceId);
  need(a.performance.status==='live','This performance has ended.',410);
  // Listeners count against the audience cap; performers and members do not.
  if(a.role==='listener'){const here=listenersOf(performanceId);need(here.has(v.id)||here.size<LIVE_LIMITS.listeners,`This performance is full (${LIVE_LIMITS.listeners} listeners). Try again in a little while.`,429);}
  heartbeat(v);
  openStream(res,v.id,`audience:${performanceId}`,cursor,()=>{const x=performanceAccess(v,performanceId);return !!x&&x.performance.status==='live';});
  if(a.role==='listener'){
    persist(v);run("insert into performance_participant(performance_id,visitor_id,role,admitted_at) values(?,?,'listener',?) on conflict do nothing",performanceId,v.id,Date.now());
    broadcast(`audience:${performanceId}`,0,'audience');res.on('close',()=>broadcast(`audience:${performanceId}`,0,'audience'));
  }
}
export function livePerformances(page:number){
  const offset=Math.max(0,Math.floor(page))*24;
  return rows("select p.id,p.title,p.started_at as startedAt,pr.title as projectTitle,v.handle as host from performance p join project pr on pr.id=p.project_id join visitor v on v.id=p.host_id where p.status='live' and p.visibility='public' order by p.started_at desc limit 25 offset ?",offset).map(p=>({...p,
    performers:rows("select v.handle from performance_participant pp join visitor v on v.id=pp.visitor_id where pp.performance_id=? and pp.role in ('host','performer') and pp.removed=0",p.id).map(x=>x.handle),
    audience:listenersOf(p.id).size,capacity:LIVE_LIMITS.listeners}));
}

// --- audience chat and reactions ------------------------------------------------------------
export function performanceChat(v:Visitor,performanceId:string){
  const a=readPerformance(v,performanceId);
  // Once it ends, chat is for the host's review only, for seven days.
  if(a.performance.status!=='live')need(a.role==='host'||memberRole(a.performance.project_id,v.id)==='owner','Chat closed when the performance ended.',410);
  return {messages:rows('select c.*,v.handle from performance_chat c join visitor v on v.id=c.visitor_id where c.performance_id=? order by c.id desc limit 80',performanceId).reverse().map(chatRow)};
}
export function sendPerformanceChat(v:Visitor,performanceId:string,input:Row){
  const clientId=typeof input.clientId==='string'&&/^[0-9a-f-]{36}$/i.test(input.clientId)?input.clientId:null;need(clientId,'Message needs a client id.');
  const body=chatBody(input.body);persist(v);
  return tx(after=>{
    const a=readPerformance(v,performanceId);need(a.performance.status==='live','Chat closed when the performance ended.',410);
    const part=one('select muted from performance_participant where performance_id=? and visitor_id=?',performanceId,v.id);need(!part?.muted,'The host has muted you in this chat.',403);
    const existing=one('select c.*,v.handle from performance_chat c join visitor v on v.id=c.visitor_id where performance_id=? and visitor_id=? and client_id=?',performanceId,v.id,clientId);
    if(existing)return {message:chatRow(existing)};
    limit(`pchat:${v.id}`,5,0.5,'You are sending messages quickly. Wait a moment.');
    const id=Number(run('insert into performance_chat(performance_id,visitor_id,client_id,body,created_at) values(?,?,?,?,?)',performanceId,v.id,clientId,body,Date.now()).lastInsertRowid);
    audienceEvent(after,performanceId,'chat',v.id);after(()=>logAction(v,'performance.chat',{performance:performanceId.slice(0,8),message:id}));
    return {message:chatRow(one('select c.*,v.handle from performance_chat c join visitor v on v.id=c.visitor_id where c.id=?',id)!)};
  });
}
// Reactions are not stored: a rate-limited broadcast, gone once shown.
export function react(v:Visitor,performanceId:string,reaction:unknown){
  const a=readPerformance(v,performanceId);need(a.performance.status==='live','This performance has ended.',410);
  need(REACTIONS.includes(reaction as string),'Choose a reaction.');
  limit(`react:${v.id}`,4,LIVE_LIMITS.reactionsPerSecond,'Easy on the applause.');
  broadcast(`audience:${performanceId}`,0,'reaction',{reaction});return {ok:true};
}

// --- performers, requests and moderation --------------------------------------------------------
export function moderate(v:Visitor,performanceId:string,input:Row){
  const action=text(input.action,20,'an action');persist(v);
  const r=tx(after=>{
    const a=readPerformance(v,performanceId),p=a.performance,now=Date.now();
    need(p.status==='live','This performance has ended.',409);
    const target=typeof input.visitorId==='string'?input.visitorId:'';
    if(action==='request'){
      need(a.role==='listener','You are already performing.',409);
      limit(`req:${v.id}`,3,1/60,'You asked recently. The host will see it.');
      run("insert into performance_request values(?,?,'pending',?) on conflict(performance_id,visitor_id) do update set status='pending',created_at=excluded.created_at",p.id,v.id,now);
      audienceEvent(after,p.id,'request',v.id);return {ok:true};
    }
    need(a.role==='host','Only the host can do that.',403);
    if(action!=='delete')need(target&&target!==v.id,'Choose someone else.');
    switch(action){
      case 'accept':case 'decline':{
        const req=one("select * from performance_request where performance_id=? and visitor_id=? and status='pending'",p.id,target);need(req,'That request is no longer waiting.',404);
        run('update performance_request set status=? where performance_id=? and visitor_id=?',action==='accept'?'accepted':'declined',p.id,target);
        if(action==='accept'){
          const cap=editCapacity(p.project_id,target);need(cap.youCanEdit,cap.reason!,409);
          run("insert into performance_participant(performance_id,visitor_id,role,admitted_at) values(?,?,'performer',?) on conflict(performance_id,visitor_id) do update set role='performer'",p.id,target,now);
        }
        break;
      }
      case 'mute':case 'unmute':run(`insert into performance_participant(performance_id,visitor_id,role,admitted_at,muted) values(?,?,'listener',?,?) on conflict(performance_id,visitor_id) do update set muted=excluded.muted`,p.id,target,now,action==='mute'?1:0);break;
      case 'remove':{
        // Removes performance access for this identity, including link
        // admission, and takes their guest parts out at the next boundary.
        need(!memberRole(p.project_id,target),'Project members are managed in the project, not the audience.',409);
        run("insert into performance_participant(performance_id,visitor_id,role,admitted_at,removed) values(?,?,'listener',?,1) on conflict(performance_id,visitor_id) do update set removed=1",p.id,target,now);
        run("delete from capability_grant where kind='listen' and resource_id=? and visitor_id=?",p.id,target);
        if(run('update track set archived_at=? where guest_performance_id=? and owner_id=? and archived_at is null',now,p.id,target).changes)replan(p.project_id);
        break;
      }
      case 'delete':{run('update performance_chat set deleted_at=? where id=? and performance_id=?',now,input.messageId,p.id);break;}
      case 'pass':{
        need(memberRole(p.project_id,target),'Hosting passes to a member of the project.',404);
        // One operation for both entry points, so the room and the stage
        // can never disagree about who is hosting.
        setHost(p.project_id,target,now);
        announce(after,v,p.project_id,'host.passed',target,null);break;
      }
      default:throw new CommandError('Unknown action.');
    }
    audienceEvent(after,p.id,`moderation.${action}`);
    after(()=>logAction(v,`performance.${action}`,{performance:p.id.slice(0,8),target:target.slice(0,8)}));
    return {ok:true};
  });
  revalidate();return r;
}
export function rotateListenLink(v:Visitor,performanceId:string){
  return tx(after=>{
    const a=readPerformance(v,performanceId);need(a.role==='host','Only the host can change the listen link.',403);
    run('update performance set link_version=link_version+1 where id=?',performanceId);
    run("delete from capability_grant where kind='listen' and resource_id=?",performanceId);
    announce(after,v,a.performance.project_id,'performance.link',performanceId,null);after(revalidate);return {ok:true};
  });
}
// A guest performer's own temporary parts: session-scoped, counted against
// the same twelve-part limit, never written into the project as its own.
export function guestCommand(v:Visitor,performanceId:string,input:Row){
  const type=text(input.type,30,'a command');
  persist(v);
  const {cid,hash,replay}=receiptFor(v,input.commandId,`perform:${performanceId}`,{type,payload:input.payload,expected:input.expectedRevision});
  if(replay)return replay;
  limit(`cmd:${v.id}`,20,5);
  const r=tx(after=>{
    const a=readPerformance(v,performanceId),p=a.performance,payload=input.payload??{},now=Date.now();
    need(p.status==='live','This performance has ended.',410);
    need(a.role==='performer','Only invited performers add guest parts. Members edit the mix in the project room.',403);
    let entityId:string;
    if(type==='guest.add'){
      need(Number(one('select count(*) as n from track where project_id=? and archived_at is null',p.project_id)!.n)<ROOM_LIMITS.parts,`The stage has room for ${ROOM_LIMITS.parts} parts.`,409);
      need(Number(one('select count(*) as n from track where guest_performance_id=? and owner_id=? and archived_at is null',p.id,v.id)!.n)<3,'Guest performers bring up to three parts.',409);
      let name:string,role:string|null=null,source:string,provenance:Row;
      if(typeof payload.presetId==='string'){const pr=presetById(payload.presetId);need(pr,'That sound is not in the catalogue.',404);name=pr!.name;role=pr!.role;source=pr!.source;provenance={preset:{id:pr!.id,version:pr!.version},guest:true};}
      else{source=code(payload.source);name=text(payload.name??'Guest part',40,'the part a name');provenance={via:'code',guest:true};}
      const doc=parseSource(source).document;entityId=randomUUID();
      const position=Number(one('select coalesce(max(position),-1)+1 as p from track where project_id=?',p.project_id)!.p);
      run('insert into track(id,project_id,owner_id,name,position,revision,archived_at,role,preset_id,preset_version,guest_performance_id) values(?,?,?,?,?,1,null,?,?,?,?)',entityId,p.project_id,v.id,name,position,role,typeof payload.presetId==='string'?payload.presetId:null,typeof payload.presetId==='string'?1:null,p.id);
      const clipId=randomUUID();run('insert into clip values(?,?,?,1)',clipId,entityId,'A');run('insert into clip_revision values(?,1,2,?,?,?,?,?)',clipId,JSON.stringify(doc),source,JSON.stringify(provenance),v.id,now);
      for(const s of SLOTS)run('insert into scene_assignment values(?,?,?,?)',p.project_id,s,entityId,'A');
    }else{
      const tr=one('select * from track where id=? and guest_performance_id=? and owner_id=?',payload.trackId,p.id,v.id);need(tr,'You can only change your own guest parts.',403);entityId=tr!.id;
      if(type==='guest.edit'){
        const source=code(payload.source),doc=parseSource(source).document,c=one("select * from clip where track_id=? and slot='A'",tr!.id)!;
        if(input.expectedRevision!==undefined&&c.current_revision!==input.expectedRevision)throw new CommandError('This part changed in another tab. Your draft is safe.',409);
        run('update clip set current_revision=? where id=?',c.current_revision+1,c.id);run('insert into clip_revision values(?,?,2,?,?,?,?,?)',c.id,c.current_revision+1,JSON.stringify(doc),source,JSON.stringify({via:'code',guest:true}),v.id,now);
      }else if(type==='guest.remove')run('update track set archived_at=? where id=?',now,tr!.id);
      else throw new CommandError('Unknown command.');
    }
    const effectiveCycle=replan(p.project_id);run('update project set revision=revision+1 where id=?',p.project_id);
    audienceEvent(after,p.id,type,v.id);announce(after,v,p.project_id,type,entityId,cid,{log:{performance:p.id.slice(0,8)}});
    const out={ok:true,commandId:cid,entityId,effectiveCycle};saveReceipt(v,cid,hash,out);return out;
  });
  return r;
}
// Hosting a performance needs the project's host lease. Host checks for the
// room live in studio.ts; this exposes the guard for the HTML page.
export const performanceTitleFor=(v:Visitor,id:string)=>{const a=performanceAccess(v,id);return a?a.performance.title as string:null;};
void hidden;
