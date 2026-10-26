// Friends, blocks, notifications, invitations and recoverable profiles.
// Friendship never grants access to anything: it lets two people see each
// other's generic online status and send invitations. Invitations carry the
// access, and only the kind they name.
import {randomUUID,randomBytes} from 'node:crypto';
import {db} from './db.ts';
import {persist,derive,sameToken,type Visitor} from './identity.ts';
import {logAction} from './events.ts';
import {CommandError,need,hidden,text,one,rows,run,tx,limit} from './errors.ts';
import {memberRole,tokenHash,newToken,projectAccess,performanceAccess} from './access.ts';
import {addEvent,broadcast,revalidate,openStream} from './hub.ts';
import {isOnline,heartbeat,announce,editCapacity,ROOM_LIMITS} from './studio.ts';

type Row=Record<string,any>;
export const SOCIAL_LIMITS={friends:200,requestsPerHour:20,invitesPerHour:30,linkUses:20,linkHours:24*7,recoveryAttempts:5};
const pair=(a:string,b:string)=>a<b?[a,b]:[b,a];
const handleOf=(id:string)=>one('select handle from visitor where id=?',id)?.handle??'someone';
const blocked=(a:string,b:string)=>!!one('select 1 from block_link where (blocker_id=? and blocked_id=?) or (blocker_id=? and blocked_id=?)',a,b,b,a);
export const areFriends=(a:string,b:string)=>{const [l,h]=pair(a,b);return one('select status from friend_link where low_id=? and high_id=?',l,h)?.status==='accepted';};

// Notifications are per account. The stream event carries no content: the page
// fetches its own notifications, so nothing private rides in the event.
function notify(after:(f:()=>void)=>void,visitorId:string,kind:string,payload:Row){
  const nid=Number(run('insert into notification(visitor_id,kind,payload_json,created_at) values(?,?,?,?)',visitorId,kind,JSON.stringify(payload),Date.now()).lastInsertRowid);
  const eid=addEvent(`account:${visitorId}`,null,'notification',{});
  after(()=>broadcast(`account:${visitorId}`,eid,'notification'));
  return nid;
}
function pingAccount(after:(f:()=>void)=>void,visitorId:string,kind:string){const eid=addEvent(`account:${visitorId}`,null,kind,{});after(()=>broadcast(`account:${visitorId}`,eid,kind));}

// --- the account view -----------------------------------------------------------
export function me(v:Visitor){
  const row=one('select handle,friend_code,recovery_hash from visitor where id=?',v.id);
  return {id:v.id,handle:row?.handle??v.handle,code:row?.friend_code??null,saved:!!row,hasRecovery:!!row?.recovery_hash};
}
// Opening Friends is a deliberate step towards being found, so it creates the
// visitor row (and friend code) that merely looking at other pages does not.
export function friendsView(v:Visitor){
  persist(v);heartbeat(v);
  const links=rows('select * from friend_link where low_id=? or high_id=?',v.id,v.id);
  const other=(l:Row)=>l.low_id===v.id?l.high_id:l.low_id;
  const person=(id:string)=>{const r=one('select handle,friend_code from visitor where id=?',id);return {id,handle:r?.handle??'someone',code:r?.friend_code??''};};
  return {
    me:me(v),
    // Online is generic: never which room, project or performance.
    friends:links.filter(l=>l.status==='accepted').map(l=>({...person(other(l)),online:isOnline(other(l))})),
    incoming:links.filter(l=>l.status==='pending'&&l.requested_by!==v.id).map(l=>person(other(l))),
    outgoing:links.filter(l=>l.status==='pending'&&l.requested_by===v.id).map(l=>person(other(l))),
    blocked:rows('select blocked_id from block_link where blocker_id=?',v.id).map(b=>person(b.blocked_id)),
    notifications:notifications(v),
  };
}
export function notifications(v:Visitor){
  return rows('select * from notification where visitor_id=? and cleared_at is null order by id desc limit 50',v.id).map(n=>{
    const p=JSON.parse(n.payload_json);
    // An invitation's details are shown only while it can still be used.
    if(n.kind==='invite'){const inv=one('select * from invitation where id=?',p.invitationId);const usable=inv&&!inv.revoked_at&&(!inv.expires_at||inv.expires_at>Date.now())&&inv.uses<inv.max_uses;return {id:n.id,kind:n.kind,createdAt:n.created_at,read:!!n.read_at,...(usable?p:{invitationId:p.invitationId,from:p.from,expired:true})};}
    return {id:n.id,kind:n.kind,createdAt:n.created_at,read:!!n.read_at,...p};
  });
}
export function clearNotification(v:Visitor,id:unknown){run('update notification set cleared_at=? where id=? and visitor_id=?',Date.now(),id,v.id);return {ok:true};}
export function accountStream(v:Visitor,res:import('node:http').ServerResponse,cursor:number){heartbeat(v);openStream(res,v.id,`account:${v.id}`,cursor,()=>true);}

// --- friends --------------------------------------------------------------------------
// Found by the short public code that is shown beside a handle; there is no
// search by name.
export function friendAction(v:Visitor,input:Row){
  const action=text(input.action,20,'an action');persist(v);
  return tx(after=>{
    const target=input.code?one('select id from visitor where friend_code=?',String(input.code).trim().toUpperCase().replace(/[^0-9A-Z]/g,''))?.id:one('select id from visitor where id=?',input.visitorId)?.id;
    need(target,'No one has that friend code. Check it with your friend.',404);need(target!==v.id,'That is your own code.',422);
    const [lo,hi]=pair(v.id,target!),link=one('select * from friend_link where low_id=? and high_id=?',lo,hi),now=Date.now();
    switch(action){
      case 'request':{
        limit(`friend:${v.id}`,SOCIAL_LIMITS.requestsPerHour,SOCIAL_LIMITS.requestsPerHour/3600,'You have sent a lot of friend requests. Try again later.');
        // A block makes the request look sent, so the blocked person learns nothing.
        if(blocked(v.id,target!))return {ok:true,status:'pending'};
        if(link?.status==='accepted')return {ok:true,status:'accepted'};
        if(link?.status==='pending'&&link.requested_by!==v.id){run("update friend_link set status='accepted',updated_at=? where low_id=? and high_id=?",now,lo,hi);notify(after,target!,'friend.accepted',{from:{id:v.id,handle:handleOf(v.id)}});pingAccount(after,v.id,'friends');return {ok:true,status:'accepted'};}
        if(link)return {ok:true,status:link.status};
        need(Number(one("select count(*) as n from friend_link where (low_id=? or high_id=?) and status='accepted'",v.id,v.id)!.n)<SOCIAL_LIMITS.friends,'You have reached the friend limit.',409);
        run("insert into friend_link values(?,?,'pending',?,?,?)",lo,hi,v.id,now,now);
        notify(after,target!,'friend.request',{from:{id:v.id,handle:handleOf(v.id),code:one('select friend_code from visitor where id=?',v.id)?.friend_code}});
        after(()=>logAction(v,'friend.request',{to:target!.slice(0,8)}));return {ok:true,status:'pending'};
      }
      case 'accept':{
        need(link?.status==='pending'&&link.requested_by!==v.id,'There is no request from this person.',404);
        run("update friend_link set status='accepted',updated_at=? where low_id=? and high_id=?",now,lo,hi);
        notify(after,target!,'friend.accepted',{from:{id:v.id,handle:handleOf(v.id)}});return {ok:true,status:'accepted'};
      }
      case 'decline':case 'cancel':case 'remove':{
        need(link,'You are not connected with this person.',404);
        if(action==='decline')need(link!.status==='pending'&&link!.requested_by!==v.id,'There is no request to decline.',409);
        if(action==='cancel')need(link!.status==='pending'&&link!.requested_by===v.id,'There is no request to cancel.',409);
        run('delete from friend_link where low_id=? and high_id=?',lo,hi);pingAccount(after,target!,'friends');return {ok:true,status:'none'};
      }
      case 'block':{
        run('delete from friend_link where low_id=? and high_id=?',lo,hi);run('insert or ignore into block_link values(?,?,?)',v.id,target,now);
        // Pending invitations between them stop working.
        run('update invitation set revoked_at=? where revoked_at is null and ((created_by=? and recipient_id=?) or (created_by=? and recipient_id=?))',now,v.id,target,target,v.id);
        pingAccount(after,target!,'friends');return {ok:true,status:'blocked'};
      }
      case 'unblock':{run('delete from block_link where blocker_id=? and blocked_id=?',v.id,target);return {ok:true,status:'none'};}
      default:throw new CommandError('Unknown friend action.');
    }
  });
}
export const blockedBy=(v:Visitor)=>new Set(rows('select blocked_id from block_link where blocker_id=?',v.id).map(b=>b.blocked_id as string));

// --- invitations -----------------------------------------------------------------------
// Kinds: project (collaborator membership), perform (a performance role only)
// and listen (an unlisted performance's audience). A link invitation stores
// only the token's hash; the token travels in the URL fragment, which browsers
// never send to the server, and is exchanged by POST.
type Kind='project'|'perform'|'listen';
function resourceFor(kind:Kind,resourceId:string){
  if(kind==='project'){const p=one('select id,title,visibility from project where id=?',resourceId);return p?{title:p.title,projectId:p.id}:null;}
  const perf=one('select p.id,p.title,p.status,p.project_id,pr.title as project_title from performance p join project pr on pr.id=p.project_id where p.id=?',resourceId);
  return perf?{title:perf.title,projectTitle:perf.project_title,projectId:perf.project_id,live:perf.status==='live'}:null;
}
export function createInvitation(v:Visitor,input:Row){
  const kind=input.kind as Kind;need(['project','perform'].includes(kind),'Choose a project or performance invitation.');
  const resourceId=String(input.resourceId??'');
  limit(`invite:${v.id}`,SOCIAL_LIMITS.invitesPerHour,SOCIAL_LIMITS.invitesPerHour/3600,'You have made a lot of invitations. Try again later.');
  return tx(after=>{
    if(kind==='project'){
      const a=projectAccess(v,resourceId);if(!a||a.read!=='member')throw hidden();
      need(a.role==='owner','Only the owner invites new members. Ask them to send an invitation.',403);
    }else{
      const p=performanceAccess(v,resourceId);if(!p)throw hidden();
      need(p.performance.status==='live','This performance has ended.',409);
      need(p.role==='host','Only the host invites performers.',403);
    }
    const id=randomUUID(),now=Date.now(),recipient=input.friendId?String(input.friendId):null;
    if(recipient){
      need(areFriends(v.id,recipient),'You can invite friends directly. For anyone else, share a link.',403);
      need(!blocked(v.id,recipient),'You cannot invite this person.',403);
      if(kind==='project')need(!memberRole(resourceId,recipient),`${handleOf(recipient)} is already in this mix.`,409);
    }
    const uses=recipient?1:Math.max(1,Math.min(SOCIAL_LIMITS.linkUses,Number.isInteger(input.maxUses)?input.maxUses:1));
    const hours=Math.max(1,Math.min(SOCIAL_LIMITS.linkHours,Number.isFinite(input.hours)?Number(input.hours):24));
    const token=recipient?null:newToken();
    run('insert into invitation values(?,?,?,?,?,?,?,?,0,?,null,1,?)',id,kind,resourceId,v.id,recipient,token?tokenHash(token):null,kind==='project'?'member':'performer',uses,now+hours*3600000,now);
    const res=resourceFor(kind,resourceId)!;
    if(recipient)notify(after,recipient,'invite',{invitationId:id,inviteKind:kind,from:{id:v.id,handle:handleOf(v.id)},title:res.title,...(kind==='perform'?{projectTitle:res.projectTitle}:{})});
    after(()=>logAction(v,'invite.created',{kind,resource:resourceId.slice(0,8),...(recipient?{to:recipient.slice(0,8)}:{link:true,uses})}));
    return {id,...(token?{path:`/invite/${id}#${token}`}:{}),expiresAt:now+hours*3600000,maxUses:uses};
  });
}
export function listInvitations(v:Visitor,kind:Kind,resourceId:string){
  if(kind==='project'){const a=projectAccess(v,resourceId);if(!a||a.read!=='member')throw hidden();}
  else{const p=performanceAccess(v,resourceId);if(!p||p.role!=='host')throw hidden();}
  return rows('select i.*,v.handle as recipient_handle from invitation i left join visitor v on v.id=i.recipient_id where i.kind=? and i.resource_id=? order by i.created_at desc limit 30',kind,resourceId).map(i=>({id:i.id,to:i.recipient_handle??null,link:!!i.token_hash,uses:i.uses,maxUses:i.max_uses,expiresAt:i.expires_at,revoked:!!i.revoked_at,createdBy:handleOf(i.created_by)}));
}
export function revokeInvitation(v:Visitor,id:unknown){
  return tx(()=>{
    const inv=one('select * from invitation where id=?',id);need(inv,'That invitation no longer exists.',404);
    const owner=inv!.kind==='project'?memberRole(inv!.resource_id,v.id)==='owner':performanceAccess(v,inv!.resource_id)?.role==='host';
    need(inv!.created_by===v.id||owner,'Only its maker or the owner can revoke an invitation.',403);
    run('update invitation set revoked_at=? where id=?',Date.now(),inv!.id);return {ok:true};
  });
}
// The landing page: who invited you to what, and in which role. Previewing
// never redeems. A link invitation needs its token even to preview; a friend
// invitation needs the right recipient. Otherwise the answer is generic.
function usable(inv:Row){
  if(inv.revoked_at)return {state:'revoked',message:'This invitation was withdrawn. Ask for a new one.'};
  if(inv.expires_at&&inv.expires_at<=Date.now())return {state:'expired',message:'This invitation has expired. Ask for a new one.'};
  if(inv.uses>=inv.max_uses)return {state:'used',message:'This invitation has already been used. Ask for a new one.'};
  return null;
}
function authorised(v:Visitor,inv:Row|undefined,token:unknown){
  if(!inv)return false;
  if(inv.recipient_id)return inv.recipient_id===v.id;
  return typeof token==='string'&&token.length>10&&tokenHash(token)===inv.token_hash;
}
export function previewInvitation(v:Visitor,id:string,token:unknown){
  const inv=one('select * from invitation where id=?',id);
  if(!authorised(v,inv,token))return {state:'invalid',message:'This invitation link is not valid. Check you copied all of it, or ask for a new one.'};
  const res=resourceFor(inv!.kind,inv!.resource_id);if(!res)return {state:'invalid',message:'This invitation link is not valid.'};
  const problem=usable(inv!);
  const already=inv!.kind==='project'&&memberRole(inv!.resource_id,v.id);
  return {state:problem?.state??(already?'member':'open'),message:problem?.message,kind:inv!.kind,role:inv!.role,from:handleOf(inv!.created_by),title:res.title,
    ...(inv!.kind==='project'?{projectId:inv!.resource_id}:{performanceId:inv!.resource_id,projectTitle:res.projectTitle,live:res.live})};
}
export function acceptInvitation(v:Visitor,id:string,token:unknown,decline=false){
  limit(`redeem:${v.id}`,20,0.2,'Too many attempts. Wait a minute.');
  persist(v);
  const result=tx(after=>{
    const inv=one('select * from invitation where id=?',id);
    need(authorised(v,inv,token),'This invitation link is not valid.',404);
    if(decline){need(inv!.recipient_id===v.id,'Only the invited person can decline.',403);run('update invitation set revoked_at=? where id=?',Date.now(),id);run("update notification set cleared_at=? where visitor_id=? and kind='invite' and json_extract(payload_json,'$.invitationId')=?",Date.now(),v.id,id);return {declined:true};}
    const now=Date.now();
    if(inv!.kind==='project'){
      if(memberRole(inv!.resource_id,v.id))return {kind:'project',projectId:inv!.resource_id,already:true};
      const problem=usable(inv!);if(problem)throw new CommandError(problem.message,410);
      // The use count and the membership change in one transaction, and the
      // update only succeeds while a use remains, so two people racing for a
      // single-use link cannot both get in.
      need(run('update invitation set uses=uses+1 where id=? and uses<max_uses and revoked_at is null',id).changes===1,'This invitation has already been used.',410);
      const old=one('select * from project_member where project_id=? and visitor_id=?',inv!.resource_id,v.id);
      if(old)run("update project_member set removed_at=null,role='member',joined_at=? where project_id=? and visitor_id=?",now,inv!.resource_id,v.id);
      else run("insert into project_member values(?,?,'member',?,null)",inv!.resource_id,v.id,now);
      run('insert or replace into invitation_receipt values(?,?,?)',id,v.id,now);
      run('update project set revision=revision+1 where id=?',inv!.resource_id);
      announce(after,v,inv!.resource_id,'member.joined',v.id,null,{log:{via:inv!.recipient_id?'friend-invite':'link'}});
      if(inv!.created_by!==v.id)notify(after,inv!.created_by,'invite.accepted',{from:{id:v.id,handle:handleOf(v.id)},title:resourceFor('project',inv!.resource_id)!.title});
      run("update notification set cleared_at=? where visitor_id=? and kind='invite' and json_extract(payload_json,'$.invitationId')=?",now,v.id,id);
      return {kind:'project',projectId:inv!.resource_id};
    }
    // A performer invitation adds a performance role only, never membership.
    const perf=one('select * from performance where id=?',inv!.resource_id);need(perf&&perf.status==='live','This performance has ended.',410);
    const part=one('select * from performance_participant where performance_id=? and visitor_id=?',perf!.id,v.id);
    need(!part?.removed,'The host removed you from this performance.',403);
    if(part?.role==='performer'||memberRole(perf!.project_id,v.id))return {kind:'perform',performanceId:perf!.id,already:true};
    const problem=usable(inv!);if(problem)throw new CommandError(problem.message,410);
    const cap=editCapacity(perf!.project_id,v.id);need(cap.youCanEdit,cap.reason!,409);
    need(run('update invitation set uses=uses+1 where id=? and uses<max_uses and revoked_at is null',id).changes===1,'This invitation has already been used.',410);
    run("insert into performance_participant(performance_id,visitor_id,role,admitted_at) values(?,?,'performer',?) on conflict(performance_id,visitor_id) do update set role='performer'",perf!.id,v.id,now);
    run('insert or replace into invitation_receipt values(?,?,?)',id,v.id,now);
    const eid=addEvent(`audience:${perf!.id}`,v.id,'performer.joined',{});after(()=>broadcast(`audience:${perf!.id}`,eid,'performer.joined'));
    announce(after,v,perf!.project_id,'performer.joined',v.id,null,{log:{performance:perf!.id.slice(0,8)}});
    run("update notification set cleared_at=? where visitor_id=? and kind='invite' and json_extract(payload_json,'$.invitationId')=?",now,v.id,id);
    return {kind:'perform',performanceId:perf!.id};
  });
  revalidate();return result;
}
// Bearer view and listen links: the token is derived from the server secret
// and the resource's link version, compared in constant time, and redeemed
// into a grant tied to this visitor and that version.
export function redeemViewLink(v:Visitor,projectId:string,token:unknown){
  limit(`redeem:${v.id}`,20,0.2,'Too many attempts. Wait a minute.');
  const p=one('select id,visibility,view_link_version from project where id=?',projectId);
  if(!p||p.visibility!=='unlisted'||!sameToken(token,derive(`view:${projectId}:${p.view_link_version}`)))throw hidden();
  persist(v);run('insert or replace into capability_grant values(?,?,?,?,?)',v.id,'view',projectId,p.view_link_version,Date.now());return {ok:true};
}
export function redeemListenLink(v:Visitor,performanceId:string,token:unknown){
  limit(`redeem:${v.id}`,20,0.2,'Too many attempts. Wait a minute.');
  const p=one("select id,visibility,link_version,status from performance where id=?",performanceId);
  if(!p||p.status!=='live'||p.visibility!=='unlisted'||!sameToken(token,derive(`listen:${performanceId}:${p.link_version}`)))throw hidden();
  const part=one('select removed from performance_participant where performance_id=? and visitor_id=?',performanceId,v.id);if(part?.removed)throw hidden();
  persist(v);run('insert or replace into capability_grant values(?,?,?,?,?)',v.id,'listen',performanceId,p.link_version,Date.now());return {ok:true};
}

// --- recoverable profiles ------------------------------------------------------------------
// The code is shown once, kept only as a hash, and can be rotated. Using it on
// another device signs that device in as the same visitor.
// 25 characters from a 32-letter alphabet: 125 bits, grouped in fives.
const ALPHABET='23456789ABCDEFGHJKLMNPQRSTUVWXYZ',RECOVERY_LENGTH=25;
export function makeRecovery(v:Visitor){
  limit(`recovery-make:${v.id}`,5,1/600,'You made a recovery code recently. Try again later.');
  persist(v);const b=randomBytes(RECOVERY_LENGTH),code=Array.from(b,x=>ALPHABET[x%32]).join('').match(/.{1,5}/g)!.join('-');
  run('update visitor set recovery_hash=?,recovery_rotated_at=? where id=?',tokenHash(normalCode(code)),Date.now(),v.id);
  logAction(v,'recovery.rotated');return {code};
}
const normalCode=(x:string)=>x.toUpperCase().replace(/[^0-9A-Z]/g,'');
const attempts=new Map<string,{n:number;at:number}>();
export function recover(v:Visitor,raw:unknown,ip:string){
  const now=Date.now();
  for(const key of [`ip:${ip}`,`v:${v.id}`]){const a=attempts.get(key);if(a&&now-a.at<600000&&a.n>=SOCIAL_LIMITS.recoveryAttempts)throw new CommandError('Too many attempts. Wait ten minutes and try again.',429);}
  const code=typeof raw==='string'?normalCode(raw):'';
  const row=code.length===RECOVERY_LENGTH?one('select id,handle from visitor where recovery_hash=?',tokenHash(code)):undefined;
  if(!row){for(const key of [`ip:${ip}`,`v:${v.id}`]){const a=attempts.get(key);attempts.set(key,a&&now-a.at<600000?{n:a.n+1,at:a.at}:{n:1,at:now});}
    if(attempts.size>5000)for(const [k,a] of attempts)if(now-a.at>600000)attempts.delete(k);
    throw new CommandError('That recovery code does not match a profile.',404);}
  logAction({id:row.id,handle:row.handle},'recovery.used',{device:'new'});
  return {id:row.id as string,handle:row.handle as string};
}
void db;
