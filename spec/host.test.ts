// Hosting is one role. Reported by review: passing it in the room moved the
// transport but not the live performance, so the project said one person was
// host while the performance still obeyed another. Every path that changes the
// host -- pass, release, claim, takeover, removal, timeout -- moves both, and
// never resets musical phase.
//
// The host here is a member, not the owner, wherever that matters: the owner
// has powers of their own that would otherwise hide a lost host role.
import {expect,it,describe,inject} from 'vitest';
import {randomUUID} from 'node:crypto';
import {visitor,get,post,act,mix,room,join,wait,type V} from './helpers.ts';
const base=inject('baseUrl');

const beat=(v:V,id:string)=>post(v,`/api/projects/${id}/presence`,{});
const goLive=async(v:V,id:string)=>{const r=await post(v,`/api/projects/${id}/go-live`,{commandId:randomUUID(),title:'Tonight',visibility:'public'});expect(r.status).toBe(201);return r.body.id as string;};
const audience=async(v:V,perf:string)=>(await get(v,`/api/performances/${perf}`)).body;

describe('passing the host role while live',()=>{
  it('moves playback and live authority together, and credits follow',async()=>{
    const owner=await visitor(base),b=await visitor(base),c=await visitor(base),id=await mix(owner);
    await act(owner,id,'part.add',{presetId:'warm-pocket'});
    await join(owner,b,id);await join(owner,c,id);
    const perf=await goLive(owner,id);
    const before=await room(owner,id);
    await beat(owner,id);
    expect((await act(owner,id,'host.pass',{visitorId:b.id})).status).toBe(200);

    const after=await room(owner,id);
    expect(after.transport.hostId).toBe(b.id);
    // The stage agrees with the room.
    expect((await audience(b,perf)).you.role).toBe('host');
    expect((await audience(owner,perf)).you.role).not.toBe('host');
    expect((await audience(c,perf)).hostHandle).toBe(b.handle);
    expect((await audience(c,perf)).performers.find((p:any)=>p.role==='host').id).toBe(b.id);
    // Host-only live powers moved with it.
    expect((await post(b,`/api/performances/${perf}/moderate`,{action:'mute',visitorId:c.id})).status).toBe(200);
    expect((await post(owner,`/api/performances/${perf}/moderate`,{action:'mute',visitorId:c.id})).status).toBe(403);
    // The music did not restart.
    expect(after.transport.epochMs).toBe(before.transport.epochMs);
    expect(after.transport.generation).toBe(before.transport.generation);
  });

  it('the previous host, when not the owner, loses host-only powers',async()=>{
    const owner=await visitor(base),a=await visitor(base),b=await visitor(base),id=await mix(owner);
    await join(owner,a,id);await join(owner,b,id);
    // The owner hands hosting to a member (a fresh lease cannot be stolen),
    // so the host under test is not the owner.
    await beat(owner,id);
    expect((await act(owner,id,'host.pass',{visitorId:a.id})).status).toBe(200);
    const perf=await goLive(a,id);
    await beat(a,id);
    expect((await act(a,id,'host.pass',{visitorId:b.id})).status).toBe(200);
    // a is now an ordinary member on both sides.
    expect((await audience(a,perf)).you.role).toBe('member');
    expect((await post(a,`/api/performances/${perf}/end`,{})).status).toBe(403);
    expect((await act(a,id,'transport.start')).status).toBe(403);
    // b can do both.
    expect((await act(b,id,'transport.start')).status).toBe(200);
    expect((await post(b,`/api/performances/${perf}/end`,{})).status).toBe(200);
  });

  it('passing from the performance page moves the room’s transport too',async()=>{
    const owner=await visitor(base),b=await visitor(base),id=await mix(owner);
    await join(owner,b,id);
    const perf=await goLive(owner,id);
    await beat(owner,id);
    expect((await post(owner,`/api/performances/${perf}/moderate`,{action:'pass',visitorId:b.id})).status).toBe(200);
    expect((await room(owner,id)).transport.hostId).toBe(b.id);
    expect((await audience(b,perf)).you.role).toBe('host');
  });

  it('releasing the role frees it, and ends a performance nobody is hosting',async()=>{
    const owner=await visitor(base),b=await visitor(base),c=await visitor(base),id=await mix(owner);
    await join(owner,b,id);
    const perf=await goLive(owner,id);
    await beat(owner,id);
    expect((await act(owner,id,'host.release')).status).toBe(200);
    expect((await room(b,id)).transport.hostId).toBeNull();
    // A live performance cannot continue with nobody accountable for it, so
    // it ends, as it would if the host's connection died.
    expect((await audience(owner,perf)).status).toBe('ended');
    expect((await get(c,`/api/performances/${perf}`)).status).toBe(404);
    expect((await get(c,'/api/live')).body.performances.some((p:any)=>p.id===perf)).toBe(false);
    // The project is untouched and a member may take the free host role.
    expect((await act(b,id,'host.claim')).status).toBe(200);
    expect((await room(b,id)).transport.hostId).toBe(b.id);
  });

  it('removing the host frees the role on both sides',async()=>{
    const owner=await visitor(base),a=await visitor(base),id=await mix(owner);
    await join(owner,a,id);
    await beat(owner,id);
    expect((await act(owner,id,'host.pass',{visitorId:a.id})).status).toBe(200);
    await beat(a,id);
    const perf=await goLive(a,id);
    expect((await act(owner,id,'member.remove',{visitorId:a.id})).status).toBe(200);
    expect((await room(owner,id)).transport.hostId).toBeNull();
    // Removing the host leaves nobody accountable, so the performance ends,
    // and the removed person has no access to the project at all.
    expect((await get(a,`/api/projects/${id}`)).status).toBe(404);
    expect((await audience(owner,perf)).status).toBe('ended');
  });
});

describe('a host who goes away',()=>{
  it('loses the role when the lease lapses, the mix stops, and a member takes over',async()=>{
    const owner=await visitor(base),b=await visitor(base),id=await mix(owner);
    await act(owner,id,'part.add',{presetId:'warm-pocket',play:true});
    await join(owner,b,id);
    expect((await room(owner,id)).transport.status).toBe('playing');
    // No heartbeat: the 30 s lease lapses and the sweep stops the mix.
    await wait(33000);
    const after=await room(b,id);
    expect(after.transport.status).toBe('stopped');
    expect(after.transport.hostId).toBeNull();
    expect((await act(b,id,'host.claim')).status).toBe(200);
    expect((await room(b,id)).transport.hostId).toBe(b.id);
  },45000);
});
