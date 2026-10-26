// Friends, invitations and recoverable profiles. Friendship never grants
// access; invitations grant exactly the role they name, once, atomically.
import {expect,it,inject,describe} from 'vitest';
import {visitor,get,post,act,mix,room,listen,wait,type V} from './helpers.ts';
const base=inject('baseUrl');

async function named(name:string){const v=await visitor(base);await post(v,'/api/handle',{handle:name});const me=(await get(v,'/api/friends')).body.me;return {...v,code:me.code as string};}
async function befriend(a:V&{code:string},b:V&{code:string}){await post(b,'/api/friends',{action:'request',code:a.code});await post(a,'/api/friends',{action:'accept',visitorId:b.id});}

describe('friends',()=>{
  it('need a request and an acceptance, found by code, with decline, cancel, remove and block',async()=>{
    const a=await named('Ada'),b=await named('Bo'),c=await named('Cy');
    expect(a.code).toMatch(/^[2-9A-Z]{6}$/);
    expect((await post(b,'/api/friends',{action:'request',code:'NOPE00'})).status).toBe(404);
    expect((await post(b,'/api/friends',{action:'request',code:a.code.toLowerCase()})).body.status).toBe('pending');
    const view=(await get(a,'/api/friends')).body;expect(view.incoming.map((x:any)=>x.handle)).toEqual(['Bo']);expect(view.notifications[0].kind).toBe('friend.request');
    expect(view.friends).toEqual([]);
    expect((await post(a,'/api/friends',{action:'accept',visitorId:b.id})).body.status).toBe('accepted');
    expect((await get(b,'/api/friends')).body.friends.map((x:any)=>x.handle)).toEqual(['Ada']);
    await post(c,'/api/friends',{action:'request',code:a.code});expect((await post(c,'/api/friends',{action:'cancel',visitorId:a.id})).body.status).toBe('none');
    await post(c,'/api/friends',{action:'request',code:a.code});expect((await post(a,'/api/friends',{action:'decline',visitorId:c.id})).body.status).toBe('none');
    expect((await post(a,'/api/friends',{action:'remove',visitorId:b.id})).body.status).toBe('none');
    expect((await get(b,'/api/friends')).body.friends).toEqual([]);
  });
  it('blocking stops requests and invitations without telling the blocked person',async()=>{
    const a=await named('Ada'),b=await named('Bo');await befriend(a,b);
    await post(a,'/api/friends',{action:'block',visitorId:b.id});
    expect((await post(b,'/api/friends',{action:'request',code:a.code})).body.status).toBe('pending');
    expect((await get(a,'/api/friends')).body.incoming).toEqual([]);
    const id=await mix(a);expect((await post(a,'/api/invitations',{kind:'project',resourceId:id,friendId:b.id})).status).toBe(403);
  });
  it('rate-limits repeated requests',async()=>{
    const a=await named('Spam');let last=0;
    for(let i=0;i<25;i++){const t=await named(`T${i}`);last=(await post(a,'/api/friends',{action:'request',code:t.code})).status;if(last===429)break;}
    expect(last).toBe(429);
  });
  it('see each other’s generic online status, never which room, and friendship opens nothing',async()=>{
    const a=await named('Ada'),b=await named('Bo');await befriend(a,b);
    const id=await mix(a);await act(a,id,'project.rename',{title:'Top secret'});await post(a,`/api/projects/${id}/presence`,{});
    const seen=(await get(b,'/api/friends')).body;
    expect(seen.friends[0]).toMatchObject({handle:'Ada',online:true});
    expect(JSON.stringify(seen)).not.toMatch(new RegExp(`${id}|Top secret|/p/`));
    expect((await get(b,`/api/projects/${id}`)).status).toBe(404);
    // Strangers don't see online status at all.
    const c=await named('Cy');expect(JSON.stringify((await get(c,'/api/friends')).body)).not.toContain('Ada');
    // Account streams carry no content, only a nudge to refetch.
    const stream=listen(b,'/api/account/events',600);await wait(100);await post(a,'/api/invitations',{kind:'project',resourceId:id,friendId:b.id});
    const got=await stream;expect(got.text).toContain('notification');expect(got.text).not.toContain('Top secret');expect(got.text).not.toContain(id);
  });
});

describe('invitations',()=>{
  it('a friend invitation notifies only that friend, who accepts or declines; previewing never redeems',async()=>{
    const a=await named('Ada'),b=await named('Bo'),c=await named('Cy');await befriend(a,b);const id=await mix(a);
    expect((await post(a,'/api/invitations',{kind:'project',resourceId:id,friendId:c.id})).status).toBe(403);
    const inv=await post(a,'/api/invitations',{kind:'project',resourceId:id,friendId:b.id});expect(inv.status).toBe(201);expect(inv.body.path).toBeUndefined();
    expect((await post(c,`/api/invitations/${inv.body.id}/preview`,{})).body.state).toBe('invalid');
    expect((await post(c,`/api/invitations/${inv.body.id}/accept`,{})).status).toBe(404);
    const note=(await get(b,'/api/friends')).body.notifications.find((n:any)=>n.kind==='invite');expect(note).toMatchObject({inviteKind:'project',from:{handle:'Ada'}});
    expect((await post(b,`/api/invitations/${inv.body.id}/preview`,{})).body).toMatchObject({state:'open',kind:'project',role:'member',from:'Ada'});
    expect((await get(b,`/api/projects/${id}`)).status).toBe(404);
    expect((await post(b,`/api/invitations/${inv.body.id}/accept`,{})).body).toMatchObject({kind:'project',projectId:id});
    expect((await room(b,id)).you.role).toBe('member');
    const second=await post(a,'/api/invitations',{kind:'project',resourceId:(await mix(a)),friendId:b.id});
    expect((await post(b,`/api/invitations/${second.body.id}/decline`,{})).body.declined).toBe(true);
  });
  it('a link needs its token, works once, and its preview hides the mix from anyone without it',async()=>{
    const a=await named('Ada'),b=await named('Bo'),c=await named('Cy'),id=await mix(a);
    const inv=await post(a,'/api/invitations',{kind:'project',resourceId:id});const [iid,token]=inv.body.path.replace('/invite/','').split('#');
    expect(token.length).toBeGreaterThanOrEqual(32);
    const anon=await post(c,`/api/invitations/${iid}/preview`,{token:'wrong-token-wrong-token'});expect(anon.body.state).toBe('invalid');expect(JSON.stringify(anon.body)).not.toMatch(/Ada|title/);
    expect((await post(b,`/api/invitations/${iid}/preview`,{token})).body.state).toBe('open');
    expect((await post(b,`/api/invitations/${iid}/accept`,{token})).status).toBe(200);
    const used=await post(c,`/api/invitations/${iid}/accept`,{token});expect(used.status).toBe(410);expect(used.body.error).toMatch(/already been used/);
    expect((await get(c,`/api/projects/${id}`)).status).toBe(404);
  });
  it('two people racing for a single-use link: exactly one gets in',async()=>{
    const a=await named('Ada'),id=await mix(a);
    const inv=await post(a,'/api/invitations',{kind:'project',resourceId:id});const [iid,token]=inv.body.path.replace('/invite/','').split('#');
    const people=await Promise.all(Array.from({length:6},()=>visitor(base)));
    const results=await Promise.all(people.map(p=>post(p,`/api/invitations/${iid}/accept`,{token})));
    expect(results.filter(r=>r.status===200)).toHaveLength(1);
    expect((await room(a,id)).members).toHaveLength(2);
  });
  it('a multi-use link stops at its limit; a revoked or expired one grants nothing',async()=>{
    const a=await named('Ada'),id=await mix(a);
    const multi=await post(a,'/api/invitations',{kind:'project',resourceId:id,maxUses:2});const [mid,mtok]=multi.body.path.replace('/invite/','').split('#');
    const outcomes=[];for(let i=0;i<3;i++)outcomes.push((await post(await visitor(base),`/api/invitations/${mid}/accept`,{token:mtok})).status);
    expect(outcomes).toEqual([200,200,410]);
    const rev=await post(a,'/api/invitations',{kind:'project',resourceId:id});const [rid,rtok]=rev.body.path.replace('/invite/','').split('#');
    await post(a,`/api/invitations/${rid}/revoke`,{});const c=await visitor(base);
    expect((await post(c,`/api/invitations/${rid}/preview`,{token:rtok})).body.state).toBe('revoked');
    expect((await post(c,`/api/invitations/${rid}/accept`,{token:rtok})).status).toBe(410);
  });
});
