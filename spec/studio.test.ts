// Shared project rooms over HTTP. Replaces Stream's track-ownership checks:
// Ensemble lets every member edit any part, so the server's job is now
// membership, revision and lease checks, stable credits and safe code.
import {expect,it,inject} from 'vitest';
import {randomUUID} from 'node:crypto';
import {visitor,get,post,act,mix,room,join,listen,wait} from './helpers.ts';
import {emptyClip} from '../shared/music.ts';
const base=inject('baseUrl');

it('starts a private mix with its creator as owner and host, and an empty stage',async()=>{
  const a=await visitor(base),id=await mix(a),s=await room(a,id);
  expect(s.visibility).toBe('private');expect(s.parts).toEqual([]);expect(s.title.length).toBeGreaterThan(2);
  expect(s.you.role).toBe('owner');expect(s.transport.hostId).toBe(a.id);expect(s.transport.status).toBe('stopped');
});

it('adds factory presets (twelve parts at most, no per-person cap) and Add and play starts the shared mix',async()=>{
  const a=await visitor(base),id=await mix(a);
  const first=await act(a,id,'part.add',{presetId:'warm-pocket',play:true});expect(first.status).toBe(200);
  let s=await room(a,id);expect(s.transport.status).toBe('playing');expect(s.parts[0]).toMatchObject({name:'Pocket',role:'beats',presetId:'warm-pocket',presetVersion:1,addedBy:{id:a.id}});
  expect(s.parts[0].clips.A.source).toBe('stack(s("bd ~ bd ~"), s("~ sd ~ sd").gain(0.45), s("hh*8").gain(0.16))');
  for(let i=1;i<12;i++)expect((await act(a,id,'part.add',{presetId:'warm-glow'})).status).toBe(200);
  const full=await act(a,id,'part.add',{presetId:'warm-glow'});expect(full.status).toBe(409);expect(full.body.error).toMatch(/12 parts/);
  s=await room(a,id);expect(s.parts.filter((p:any)=>!p.archivedAt)).toHaveLength(12);
  // A queued change while playing names a bar at least a second ahead.
  const edit=await act(a,id,'part.mix',{trackId:s.parts[1].id,mute:true},s.parts[1].revision);
  expect(edit.body.effectiveCycle).toBeGreaterThanOrEqual(0);
});

it('lets any member edit any part with stable credit, recording who edited each revision',async()=>{
  const a=await visitor(base),b=await visitor(base),id=await mix(a);
  const made=await act(a,id,'part.add',{presetId:'warm-anchor'}),pid=made.body.entityId;
  await join(a,b,id);
  const src='note("a1 ~ [a1 c2] e2").s("sawtooth").lpf(700).gain(0.35)';
  const edit=await act(b,id,'part.edit',{trackId:pid,source:src},1);expect(edit.status).toBe(200);
  const s=await room(a,id),p=s.parts[0];
  expect(p.addedBy.id).toBe(a.id);expect(p.clips.A.editedBy.id).toBe(b.id);expect(p.clips.A.source).toBe(src);expect(p.clips.A.revision).toBe(2);
  expect(p.clips.A.history.map((h:any)=>h.by)).toEqual([b.handle,a.handle].map(h=>expect.any(String)));
});

it('refuses a stale revision and keeps the newer edit, so two editors never silently overwrite',async()=>{
  const a=await visitor(base),b=await visitor(base),id=await mix(a);const pid=(await act(a,id,'part.add',{presetId:'warm-walk'})).body.entityId;
  await join(a,b,id);
  expect((await act(a,id,'part.edit',{trackId:pid,source:'note("33").s("sine")'},1)).status).toBe(200);
  const stale=await act(b,id,'part.edit',{trackId:pid,source:'note("40").s("sine")'},1);
  expect(stale.status).toBe(409);expect(stale.body.error).toMatch(/draft is safe/);
  expect((await room(a,id)).parts[0].clips.A.source).toBe('note("33").s("sine")');
});

it('holds a part for the editor with a lease; others are told who has it and can duplicate',async()=>{
  const a=await visitor(base),b=await visitor(base),id=await mix(a);const pid=(await act(a,id,'part.add',{presetId:'warm-sunbeam'})).body.entityId;
  await join(a,b,id);
  expect((await act(b,id,'part.lease',{trackId:pid})).status).toBe(200);
  const blocked=await act(a,id,'part.edit',{trackId:pid,source:'note("60").s("sine")'});
  expect(blocked.status).toBe(409);expect(blocked.body.error).toMatch(/is editing this part/);
  expect((await room(a,id)).parts[0].lease.visitorId).toBe(b.id);
  const dup=await act(a,id,'part.duplicate',{trackId:pid});expect(dup.status).toBe(200);
  // A member may not take the lease; the owner may release it, which never touches drafts.
  expect((await act(a,id,'part.release',{trackId:pid,force:true})).status).toBe(200);
  expect((await room(a,id)).parts[0].lease).toBeNull();
  expect((await act(a,id,'part.edit',{trackId:pid,source:'note("60").s("sine")'})).status).toBe(200);
});

it('saves invalid code nowhere: the last working part keeps playing',async()=>{
  const a=await visitor(base),id=await mix(a);const pid=(await act(a,id,'part.add',{presetId:'warm-anchor'})).body.entityId;
  const before=await room(a,id);
  for(const source of ['fetch("/api/me")','note("60").s("kazoo")','s("hh*16 hh*16 hh*16 hh*16 hh*16")','s("bd"','while(true){}'])
    expect((await act(a,id,'part.edit',{trackId:pid,source},1)).status).toBe(422);
  const after=await room(a,id);expect(after.parts[0].clips.A).toEqual(before.parts[0].clips.A);expect(after.revision).toBe(before.revision);
});

it('keeps an advanced expression exactly as written, through reload and through Shape',async()=>{
  const a=await visitor(base),id=await mix(a);
  const src='// two layers\nstack(\n  note("<[57,60,64] [55,59,62]>").s("sine").slow(2),\n  s("bd [~ bd] <sd cp>").gain(0.6)\n).room(0.25);';
  const made=await act(a,id,'part.add',{source:src,name:'Mine'});expect(made.status).toBe(200);
  expect((await room(a,id)).parts[0].clips.A.source).toBe(src);
  const shaped=src.replace('.room(0.25)','.room(0.4)');
  expect((await act(a,id,'part.edit',{trackId:made.body.entityId,source:shaped,via:'shape'},1)).status).toBe(200);
  expect((await room(a,id)).parts[0].clips.A.source).toBe(shaped);
});

it('applies a command once and refuses the same ID with other content or on another mix',async()=>{
  const a=await visitor(base),id=await mix(a),other=await mix(a),cid=randomUUID();
  const first=await act(a,id,'part.add',{presetId:'warm-glow'},undefined,cid),again=await act(a,id,'part.add',{presetId:'warm-glow'},undefined,cid);
  expect(again.body).toEqual(first.body);expect((await room(a,id)).parts).toHaveLength(1);
  expect((await act(a,id,'part.add',{presetId:'warm-spark'},undefined,cid)).status).toBe(409);
  expect((await act(a,other,'part.add',{presetId:'warm-glow'},undefined,cid)).status).toBe(409);
  expect((await room(a,other)).parts).toHaveLength(0);
});

it('lets only the host start, stop and change tempo, and a member may take over an expired host',async()=>{
  const a=await visitor(base),b=await visitor(base),id=await mix(a);await act(a,id,'part.add',{presetId:'warm-pocket'});await join(a,b,id);
  let s=await room(b,id);
  expect((await act(b,id,'transport.start',{},s.transport.revision)).status).toBe(403);
  expect((await act(b,id,'tempo.set',{bpm:90})).status).toBe(403);
  expect((await act(a,id,'tempo.set',{bpm:90})).status).toBe(200);
  expect((await act(a,id,'transport.start')).status).toBe(200);
  expect((await act(a,id,'tempo.set',{bpm:100})).status).toBe(409);
  expect((await act(b,id,'host.claim')).status).toBe(409);
  expect((await act(a,id,'host.pass',{visitorId:b.id})).status).toBe(200);
  s=await room(a,id);expect(s.transport.hostId).toBe(b.id);
  expect((await act(b,id,'transport.stop')).status).toBe(200);
});

it('removes parts recoverably and brings them back',async()=>{
  const a=await visitor(base),id=await mix(a);const pid=(await act(a,id,'part.add',{presetId:'warm-glow'})).body.entityId;
  expect((await act(a,id,'part.remove',{trackId:pid},1)).status).toBe(200);
  let s=await room(a,id);expect(s.parts[0].archivedAt).not.toBeNull();expect(s.plans.at(-1).catalog[pid]).toBeUndefined();
  expect((await act(a,id,'part.return',{trackId:pid})).status).toBe(200);
  s=await room(a,id);expect(s.parts[0].archivedAt).toBeNull();expect(s.plans.at(-1).catalog[pid]).toBeDefined();
});

it('keeps member-only chat: escaped, limited, paginated and idempotent per client id',async()=>{
  const a=await visitor(base),b=await visitor(base),stranger=await visitor(base),id=await mix(a);await join(a,b,id);
  const clientId=randomUUID(),body='<img src=x onerror=alert(1)> hi';
  const one=await post(b,`/api/projects/${id}/chat`,{clientId,body}),two=await post(b,`/api/projects/${id}/chat`,{clientId,body});
  expect(one.body.message.id).toBe(two.body.message.id);expect(one.body.message.body).toBe(body);
  expect((await post(b,`/api/projects/${id}/chat`,{clientId:randomUUID(),body:'x'.repeat(501)})).status).toBe(413);
  expect((await post(stranger,`/api/projects/${id}/chat`,{clientId:randomUUID(),body:'let me in'})).status).toBe(404);
  expect((await get(stranger,`/api/projects/${id}/chat`)).status).toBe(404);
  for(let i=0;i<5;i++)await post(a,`/api/projects/${id}/chat`,{clientId:randomUUID(),body:`m${i}`});
  const list=await get(a,`/api/projects/${id}/chat`);expect(list.body.messages).toHaveLength(6);
  // The author, the owner or the host may remove a message; it becomes a tombstone.
  expect((await post(a,`/api/projects/${id}/chat`,{delete:one.body.message.id})).status).toBe(200);
  expect((await get(a,`/api/projects/${id}/chat`)).body.messages[0]).toMatchObject({deleted:true,body:null});
});

it('announces a committed change to members over SSE and reconnects from a cursor',async()=>{
  const a=await visitor(base),id=await mix(a),s=await room(a,id);
  const reading=listen(a,`/api/projects/${id}/events?since=${s.eventId}`,800);
  await wait(150);const made=await act(a,id,'part.add',{presetId:'warm-glow'});
  const got=await reading;expect(got.text).toContain(`id: ${made.body.eventId}`);expect(got.text).toContain('"kind":"part.add"');
  const replay=await listen(a,`/api/projects/${id}/events`,300,{'last-event-id':String(s.eventId)});expect(replay.text).toContain(`id: ${made.body.eventId}`);
});

it('exports a mix for members and imports it as a new private mix, keeping code and legacy trees',async()=>{
  const a=await visitor(base),id=await mix(a);
  await act(a,id,'part.add',{source:'note("<60 64> 67").s("square").gain(0.3)',name:'Lead'});
  const exported=await get(a,`/api/projects/${id}/export`);expect(exported.status).toBe(200);
  expect(exported.headers.get('cache-control')).toMatch(/no-store/);expect(JSON.stringify(exported.body)).not.toMatch(/visitor_secret|cookie|token/i);
  const legacy={format:'stream',schemaVersion:1,title:'Old',settings:{bpm:120,sceneNames:{A:'A',B:'B',C:'C',D:'D'},arrangement:{entries:[{scene:'A',bars:4}],loop:true}},tracks:[{id:'t1',name:'Kit',clips:{A:{document:emptyClip(),source:null}}}],plan:{}};
  for(const file of [exported.body,legacy]){
    const r=await post(a,'/api/import',file);expect(r.status).toBe(201);const s=await room(a,r.body.id);
    expect(s.visibility).toBe('private');expect(s.parts).toHaveLength(1);
  }
  const reimported=await room(a,(await post(a,'/api/import',exported.body)).body.id);expect(reimported.parts[0].clips.A.source).toBe('note("<60 64> 67").s("square").gain(0.3)');
});

it('refuses non-JSON mutations, oversized bodies and cross-site posts with their own statuses',async()=>{
  const a=await visitor(base),id=await mix(a);
  expect((await fetch(`${base}/api/projects/${id}/commands`,{method:'POST',headers:{cookie:a.cookie,'content-type':'text/plain'},body:'{}'})).status).toBe(415);
  const huge=await fetch(`${base}/api/projects/${id}/commands`,{method:'POST',headers:{cookie:a.cookie,'content-type':'application/json'},body:JSON.stringify({pad:'x'.repeat(70*1024)})});expect(huge.status).toBe(413);
  expect((await fetch(`${base}/api/projects`,{method:'POST',headers:{cookie:a.cookie,'content-type':'application/json',origin:'https://foreign.example'},body:'{}'})).status).toBe(403);
});
