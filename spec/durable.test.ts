// What survives a restart, what a restart stops, recoverable profiles and
// expiring invitations. Each runs against a server of its own on a throwaway
// database, because a restart can only be tested by performing one and its
// database must be readable.
import {afterAll,expect,it,describe} from 'vitest';
import {randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {visitor,get,post,act,mix,room,join,ownServer,wait} from './helpers.ts';

describe('a restart',()=>{
  const srv=ownServer('spec-ensemble-restart-');
  afterAll(()=>srv.cleanup());
  it('keeps music, members, chat, friends and identity; ends live performances; stops sound; releases leases and hosts',async()=>{
    await srv.boot();
    const a=await visitor(srv.base),b=await visitor(srv.base),c=await visitor(srv.base),id=await mix(a);
    const pid=(await act(a,id,'part.add',{presetId:'warm-pocket',play:true})).body.entityId;await join(a,b,id);
    const src='note("<a2 c3> e3").s("triangle").room(0.2)';await act(b,id,'part.add',{source:src,name:'Mine'});
    await post(b,`/api/projects/${id}/chat`,{clientId:randomUUID(),body:'see you after the restart'});
    await act(b,id,'part.lease',{trackId:pid});
    const live=await post(a,`/api/projects/${id}/go-live`,{commandId:randomUUID(),title:'Tonight',visibility:'public'});expect(live.status).toBe(201);
    expect((await get(c,'/api/live')).body.performances).toHaveLength(1);
    const before=await room(a,id);expect(before.transport.status).toBe('playing');
    await srv.kill();await srv.boot();
    const after=await room(a,id);
    expect(after.transport.status).toBe('stopped');expect(after.transport.hostId).toBeNull();expect(after.performance).toBeNull();
    expect(after.parts.map((p:any)=>p.clips.A.source)).toEqual(before.parts.map((p:any)=>p.clips.A.source));expect(after.parts[1].clips.A.source).toBe(src);
    expect(after.parts.every((p:any)=>p.lease===null)).toBe(true);
    expect(after.members.map((m:any)=>m.id).sort()).toEqual([a.id,b.id].sort());
    expect((await get(b,`/api/projects/${id}/chat`)).body.messages.map((m:any)=>m.body)).toEqual(['see you after the restart']);
    expect((await get(c,'/api/live')).body.performances).toEqual([]);
    const ended=await get(a,`/api/performances/${live.body.id}`);expect(ended.body).toMatchObject({status:'ended',endReason:'interrupted'});
    expect((await get(c,`/api/performances/${live.body.id}`)).status).toBe(404);
    // A second restart finds nothing to reset.
    const eventId=after.eventId;await srv.kill();await srv.boot();expect((await room(a,id)).eventId).toBe(eventId);
    expect((await act(b,id,'part.edit',{trackId:pid,source:'s("bd sd")'},1)).status).toBe(200);
  },40000);
});

describe('profiles and expiring invitations',()=>{
  const srv=ownServer('spec-ensemble-profile-');
  afterAll(()=>srv.cleanup());
  it('a recovery code signs another device in as the same person; it is hashed, rotatable and guess-limited',async()=>{
    await srv.boot();
    const a=await visitor(srv.base),id=await mix(a);
    const {body:{code}}=await post(a,'/api/recovery',{});expect(code).toMatch(/^([2-9A-Z]{5}-){4}[2-9A-Z]{5}$/);
    const other=await visitor(srv.base);
    const r=await fetch(`${srv.base}/api/recover`,{method:'POST',headers:{cookie:other.cookie,'content-type':'application/json'},body:JSON.stringify({code:code.toLowerCase()})});
    expect(r.status).toBe(200);const device={...other,cookie:r.headers.getSetCookie()[0].split(';')[0]};
    expect((await get(device,'/api/me')).body.id).toBe(a.id);expect((await room(device,id)).you.role).toBe('owner');
    const db=new DatabaseSync(srv.DB_PATH,{readOnly:true});expect(JSON.stringify(db.prepare('select * from visitor where id=?').get(a.id))).not.toContain(code.replaceAll('-',''));db.close();
    expect(srv.out()).not.toContain(code);expect(srv.out()).not.toContain(code.replaceAll('-',''));
    await post(a,'/api/recovery',{});
    const guesser=await visitor(srv.base);const statuses:number[]=[];
    statuses.push((await post(guesser,'/api/recover',{code})).status);
    for(let i=0;i<6;i++)statuses.push((await post(guesser,'/api/recover',{code:'AAAAA-AAAAA-AAAAA-AAAAA-AAAAA'})).status);
    expect(statuses[0]).toBe(404);expect(statuses.at(-1)).toBe(429);
  });
  it('an expired invitation grants nothing and says so without naming the mix',async()=>{
    const a=await visitor(srv.base),c=await visitor(srv.base),id=await mix(a);
    const inv=await post(a,'/api/invitations',{kind:'project',resourceId:id});const [iid,token]=inv.body.path.replace('/invite/','').split('#');
    const db=new DatabaseSync(srv.DB_PATH);db.prepare('update invitation set expires_at=? where id=?').run(Date.now()-1000,iid);db.close();
    const preview=await post(c,`/api/invitations/${iid}/preview`,{token});expect(preview.body.state).toBe('expired');expect(preview.body.message).toMatch(/expired/);
    const accept=await post(c,`/api/invitations/${iid}/accept`,{token});expect(accept.status).toBe(410);
    expect((await get(c,`/api/projects/${id}`)).status).toBe(404);
  });
  it('stores only a hash of each link token',async()=>{
    const a=await visitor(srv.base),id=await mix(a);const inv=await post(a,'/api/invitations',{kind:'project',resourceId:id});const token=inv.body.path.split('#')[1];
    const db=new DatabaseSync(srv.DB_PATH,{readOnly:true});const row=db.prepare('select * from invitation where id=?').get(inv.body.id) as Record<string,unknown>;db.close();
    expect(JSON.stringify(row)).not.toContain(token);expect(row.token_hash).toMatch(/^[0-9a-f]{64}$/);
  });
  it('invitation tokens never reach the log',async()=>{
    const a=await visitor(srv.base),b=await visitor(srv.base),id=await mix(a);
    const inv=await post(a,'/api/invitations',{kind:'project',resourceId:id});const [iid,token]=inv.body.path.replace('/invite/','').split('#');
    await post(b,`/api/invitations/${iid}/accept`,{token});await wait(100);
    expect(srv.out()).toContain('member.joined');expect(srv.out()).not.toContain(token);
  });
});
