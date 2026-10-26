// Live performances: a third person listens and chats without any project
// access; guests perform without becoming members; ending keeps the project.
import {expect,it,inject,describe} from 'vitest';
import {randomUUID} from 'node:crypto';
import {visitor,get,post,act,mix,room,join,listen,openStream,wait,type V} from './helpers.ts';
const base=inject('baseUrl');
async function live(a:V,id:string,visibility:'public'|'unlisted'='unlisted'){const r=await post(a,`/api/projects/${id}/go-live`,{commandId:randomUUID(),title:'Tonight',visibility});expect(r.status).toBe(201);return r.body.id as string;}
async function listenLink(a:V,id:string,listener:V,perf:string){const t=(await room(a,id)).performance.listenToken;return post(listener,`/api/performances/${perf}/listen-link`,{token:t});}

describe('going live',()=>{
  it('is the host’s idempotent choice, shares the project clock, and never restarts the music',async()=>{
    const a=await visitor(base),b=await visitor(base),id=await mix(a);await act(a,id,'part.add',{presetId:'warm-pocket',play:true});await join(a,b,id);
    const before=await room(a,id);
    expect((await post(b,`/api/projects/${id}/go-live`,{commandId:randomUUID(),title:'Mine'})).status).toBe(403);
    const commandId=randomUUID(),first=await post(a,`/api/projects/${id}/go-live`,{commandId,title:'Tonight'}),again=await post(a,`/api/projects/${id}/go-live`,{commandId,title:'Tonight'});
    expect(again.body).toEqual(first.body);
    expect((await post(a,`/api/projects/${id}/go-live`,{commandId:randomUUID(),title:'Twice'})).status).toBe(409);
    const after=await room(a,id);expect(after.transport.epochMs).toBe(before.transport.epochMs);expect(after.transport.generation).toBe(before.transport.generation);
    expect(after.performance).toMatchObject({id:first.body.id,visibility:'unlisted'});
    const aud=await get(a,`/api/performances/${first.body.id}`);expect(aud.body.transport).toMatchObject({epochMs:before.transport.epochMs,generation:before.transport.generation});
  });
});

describe('the audience',()=>{
  it('listens to an unlisted performance only through its link, and sees the published mix, not the project',async()=>{
    const a=await visitor(base),c=await visitor(base),id=await mix(a);
    await act(a,id,'part.add',{presetId:'warm-anchor'});await post(a,`/api/projects/${id}/chat`,{clientId:randomUUID(),body:'members only'});
    const perf=await live(a,id);
    expect((await get(c,`/api/performances/${perf}`)).status).toBe(404);
    expect((await listen(c,`/api/performances/${perf}/events`,200)).status).toBe(404);
    expect((await post(c,`/api/performances/${perf}/listen-link`,{token:'not-the-token-not-the-token-xxx'})).status).toBe(404);
    expect((await listenLink(a,id,c,perf)).status).toBe(200);
    const aud=(await get(c,`/api/performances/${perf}`)).body;
    expect(aud.you.role).toBe('listener');expect(aud.projectId).toBeNull();expect(aud.plans.length).toBeGreaterThan(0);
    expect(JSON.stringify(aud)).not.toMatch(/members only|history|source|lease|viewToken|listenToken|invit/);
    expect(aud.parts[0]).toMatchObject({name:'Anchor',addedBy:a.handle});
    expect((await get(c,`/api/projects/${id}`)).status).toBe(404);
    expect((await get(c,'/api/live')).body.performances.some((p:any)=>p.id===perf)).toBe(false);
  });
  it('can chat and react but never change the music',async()=>{
    const a=await visitor(base),c=await visitor(base),id=await mix(a);const pid=(await act(a,id,'part.add',{presetId:'warm-pocket'})).body.entityId;
    const perf=await live(a,id,'public');
    expect((await get(c,'/api/live')).body.performances.find((p:any)=>p.id===perf)).toMatchObject({title:'Tonight',performers:[a.handle]});
    const clientId=randomUUID(),m1=await post(c,`/api/performances/${perf}/chat`,{clientId,body:'great!'}),m2=await post(c,`/api/performances/${perf}/chat`,{clientId,body:'great!'});
    expect(m1.status).toBe(200);expect(m2.body.message.id).toBe(m1.body.message.id);
    expect((await post(c,`/api/performances/${perf}/react`,{reaction:'clap'})).status).toBe(200);
    for(const [type,payload] of [['part.add',{presetId:'warm-glow'}],['part.edit',{trackId:pid,source:'s("bd")'}],['part.mix',{trackId:pid,mute:true}],['transport.stop',{}]] as const)
      expect((await act(c,id,type,payload)).status,type).toBe(404);
    expect((await post(c,`/api/performances/${perf}/commands`,{commandId:randomUUID(),type:'guest.add',payload:{presetId:'warm-glow'}})).status).toBe(403);
    expect((await post(c,`/api/performances/${perf}/end`,{})).status).toBe(403);
    expect((await post(c,`/api/performances/${perf}/moderate`,{action:'mute',visitorId:a.id})).status).toBe(403);
    expect((await room(a,id)).parts).toHaveLength(1);
  });
  it('is capped at 32 listeners with a clear refusal',async()=>{
    const a=await visitor(base),id=await mix(a);const perf=await live(a,id,'public');
    const streams=[];for(let i=0;i<32;i++){const v=await visitor(base);const s=openStream(v,`/api/performances/${perf}/events`);streams.push(s);expect(await s.ready).toBe(200);}
    const late=await visitor(base),refused=await get(late,`/api/performances/${perf}/events`);
    expect(refused.status).toBe(429);expect(refused.body.error).toMatch(/full \(32 listeners\)/);
    const snap=(await get(late,`/api/performances/${perf}`)).body;expect(snap.full).toBe(true);expect(snap.plans).toEqual([]);
    for(const s of streams)s.close();
  },30000);
});

describe('performers and moderation',()=>{
  it('a guest performer adds session parts without becoming a member; ending removes them and keeps the project',async()=>{
    const a=await visitor(base),g=await visitor(base),id=await mix(a);await act(a,id,'part.add',{presetId:'warm-pocket'});
    const perf=await live(a,id,'public');
    expect((await post(g,`/api/performances/${perf}/moderate`,{action:'request'})).status).toBe(200);
    expect((await get(a,`/api/performances/${perf}`)).body.requests.map((r:any)=>r.visitorId)).toEqual([g.id]);
    expect((await post(a,`/api/performances/${perf}/moderate`,{action:'accept',visitorId:g.id})).status).toBe(200);
    const added=await post(g,`/api/performances/${perf}/commands`,{commandId:randomUUID(),type:'guest.add',payload:{presetId:'night-stars'}});expect(added.status).toBe(200);
    let s=await room(a,id);const guest=s.parts.find((p:any)=>p.guest);expect(guest).toMatchObject({name:'Far Stars',addedBy:{id:g.id}});expect(s.plans.at(-1).catalog[guest.id]).toBeDefined();
    expect((await get(g,`/api/projects/${id}`)).status).toBe(404);
    expect((await act(a,id,'part.edit',{trackId:guest.id,source:'s("bd")'})).status).toBe(403);
    expect((await post(g,`/api/performances/${perf}/commands`,{commandId:randomUUID(),type:'guest.edit',payload:{trackId:s.parts[0].id,source:'s("bd")'}})).status).toBe(403);
    // A member may keep a credited copy in the project.
    expect((await act(a,id,'part.keep',{trackId:guest.id})).status).toBe(200);
    expect((await post(a,`/api/performances/${perf}/end`,{})).status).toBe(200);
    s=await room(a,id);
    expect(s.performance).toBeNull();expect(s.parts.filter((p:any)=>p.guest&&!p.archivedAt)).toEqual([]);expect(s.plans.at(-1).catalog[guest.id]).toBeUndefined();
    const kept=s.parts.find((p:any)=>!p.guest&&p.name==='Far Stars');expect(kept).toMatchObject({addedBy:{id:g.id}});expect(kept.clips.A.provenance).toMatchObject({fromPerformance:perf});
    expect(s.parts.filter((p:any)=>!p.archivedAt)).toHaveLength(2);
    expect((await get(g,`/api/performances/${perf}`)).status).toBe(404);
  });
  it('a performer invitation grants a performance role only, never membership',async()=>{
    const a=await visitor(base),g=await visitor(base),id=await mix(a);const perf=await live(a,id);
    const inv=await post(a,'/api/invitations',{kind:'perform',resourceId:perf});const [iid,token]=inv.body.path.replace('/invite/','').split('#');
    expect((await post(g,`/api/invitations/${iid}/preview`,{token})).body).toMatchObject({kind:'perform',role:'performer'});
    expect((await post(g,`/api/invitations/${iid}/accept`,{token})).body).toMatchObject({kind:'perform',performanceId:perf});
    expect((await get(g,`/api/performances/${perf}`)).body.you.role).toBe('performer');expect((await get(g,`/api/projects/${id}`)).status).toBe(404);
  });
  it('the host can remove a chat message, mute someone and remove them, which revokes their link admission',async()=>{
    const a=await visitor(base),c=await visitor(base),id=await mix(a);const perf=await live(a,id);await listenLink(a,id,c,perf);
    const m=await post(c,`/api/performances/${perf}/chat`,{clientId:randomUUID(),body:'rude words'});
    await post(a,`/api/performances/${perf}/moderate`,{action:'delete',messageId:m.body.message.id});
    expect((await get(c,`/api/performances/${perf}/chat`)).body.messages[0]).toMatchObject({deleted:true,body:null});
    await post(a,`/api/performances/${perf}/moderate`,{action:'mute',visitorId:c.id});
    expect((await post(c,`/api/performances/${perf}/chat`,{clientId:randomUUID(),body:'again'})).status).toBe(403);
    const stream=openStream(c,`/api/performances/${perf}/events`);expect(await stream.ready).toBe(200);await wait(100);
    await post(a,`/api/performances/${perf}/moderate`,{action:'remove',visitorId:c.id});await wait(200);
    expect(stream.text()).toContain('event: revoked');stream.close();
    expect((await get(c,`/api/performances/${perf}`)).status).toBe(404);
    expect((await listenLink(a,id,c,perf)).status).toBe(404);
  });
  it('rotating the listen link turns away earlier links but keeps members',async()=>{
    const a=await visitor(base),b=await visitor(base),c=await visitor(base),id=await mix(a);await join(a,b,id);const perf=await live(a,id);
    await listenLink(a,id,c,perf);const old=(await room(a,id)).performance.listenToken;
    await post(a,`/api/performances/${perf}/rotate-link`,{});
    expect((await get(c,`/api/performances/${perf}`)).status).toBe(404);
    expect((await post(await visitor(base),`/api/performances/${perf}/listen-link`,{token:old})).status).toBe(404);
    expect((await get(b,`/api/performances/${perf}`)).body.you.role).toBe('member');
  });
  it('after it ends the audience loses chat, and only the host can review it',async()=>{
    const a=await visitor(base),c=await visitor(base),id=await mix(a);const perf=await live(a,id,'public');
    await post(c,`/api/performances/${perf}/chat`,{clientId:randomUUID(),body:'bye'});await post(a,`/api/performances/${perf}/end`,{});
    expect((await get(c,`/api/performances/${perf}/chat`)).status).toBe(404);
    expect((await get(a,`/api/performances/${perf}/chat`)).body.messages.map((m:any)=>m.body)).toEqual(['bye']);
    expect((await get(c,'/api/live')).body.performances.some((p:any)=>p.id===perf)).toBe(false);
  });
});
