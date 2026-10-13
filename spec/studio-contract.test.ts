import {expect,it,inject} from 'vitest';
import {randomUUID} from 'node:crypto';
import {parseCode} from '../shared/code.ts';
import type {Snapshot} from '../shared/studio.ts';
import {resolvePlan} from '../shared/performance.ts';
const base=inject('baseUrl');
async function visitor(){const r=await fetch(`${base}/api/me`);return {cookie:r.headers.getSetCookie()[0].split(';')[0],...(await r.json())};}
async function post(v:any,path:string,body:any){return fetch(`${base}${path}`,{method:'POST',headers:{cookie:v.cookie,'content-type':'application/json'},body:JSON.stringify(body)});}
async function setup(){const a=await visitor(),b=await visitor();const project=await (await post(a,'/api/projects',{title:'Contract '+randomUUID().slice(0,8)})).json();return {a,b,id:project.id};}
async function state(v:any,id:string):Promise<Snapshot>{const r=await fetch(`${base}/api/projects/${id}`,{headers:{cookie:v.cookie}});expect(r.status).toBe(200);return r.json();}
const envelope=(type:string,payload:any,expectedRevision?:number)=>({commandId:randomUUID(),type,payload,expectedRevision});
async function act(v:any,id:string,type:string,payload:any={},expectedRevision?:number){const r=await post(v,`/api/projects/${id}/commands`,envelope(type,payload,expectedRevision));return {status:r.status,body:await r.json()};}
it('separates ownership, supports all safe code views and rejects execution',async()=>{
  const {a,b,id}=await setup();const tr=await act(a,id,'track.create',{kind:'melody'});expect(tr.status).toBe(200);
  const before=await state(a,id),track=before.tracks[0];const source='note("60 ~ 64 67").s("triangle").slow(2)';
  const result=await act(a,id,'clip.publish',{trackId:track.id,slot:'A',source,document:parseCode(source)},1);expect(result.status).toBe(200);
  expect((await state(b,id)).tracks[0].clips.A?.source).toBe(source);
  expect((await act(b,id,'clip.publish',{trackId:track.id,slot:'A',document:parseCode('s("bd")')},2)).status).toBe(403);
  expect((await act(a,id,'clip.publish',{trackId:track.id,slot:'A',source:'fetch("/api/me")',document:parseCode(source)},2)).status).toBe(422);
  expect((await state(a,id)).tracks[0].clips.A?.revision).toBe(2);
});
it('a committed command retries once and stale edits leave no state/event',async()=>{
  const {a,id}=await setup(),command=envelope('track.create',{kind:'drums'});
  const first=await (await post(a,`/api/projects/${id}/commands`,command)).json();const repeated=await (await post(a,`/api/projects/${id}/commands`,command)).json();expect(repeated).toEqual(first);
  const before=await state(a,id);expect(before.tracks).toHaveLength(1);
  const conflict=await act(a,id,'clip.publish',{trackId:first.entityId,slot:'A',document:parseCode('s("bd")')},0);expect(conflict.status).toBe(409);
  const after=await state(a,id);expect(after.eventId).toBe(before.eventId);expect(after.tracks[0].clips.A?.document).toEqual(before.tracks[0].clips.A?.document);
  command.payload={kind:'melody'};expect((await post(a,`/api/projects/${id}/commands`,command)).status).toBe(409);
});
it('limits tracks transactionally and checks conductor authority',async()=>{
  const {a,b,id}=await setup();expect((await act(a,id,'track.create',{kind:'drums'})).status).toBe(200);expect((await act(a,id,'track.create',{kind:'melody'})).status).toBe(200);expect((await act(a,id,'track.create',{kind:'drums'})).status).toBe(409);
  const initial=await state(a,id);expect((await act(a,id,'conductor.claim',{},initial.transport.revision)).status).toBe(200);
  expect((await act(b,id,'transport.start',{},(await state(b,id)).transport.revision)).status).toBe(403);
  expect((await act(b,id,'conductor.claim',{},(await state(b,id)).transport.revision)).status).toBe(409);
});
it('performance plans accumulate changes and manual silence wins over scene launches',async()=>{
  const {a,id}=await setup();const created=await act(a,id,'track.create',{kind:'drums'});const tr=created.body.entityId;
  await act(a,id,'clip.publish',{trackId:tr,slot:'A',document:parseCode('s("bd ~ sd ~")')},1);
  let s=await state(a,id);await act(a,id,'conductor.claim',{},s.transport.revision);s=await state(a,id);await act(a,id,'transport.start',{},s.transport.revision);
  s=await state(a,id);const mix=await act(a,id,'track.mix',{trackId:tr,gain:0.3,mute:false},s.tracks[0].revision);expect(mix.status).toBe(200);
  s=await state(a,id);const manual=await act(a,id,'track.launch',{trackId:tr,clipSlot:null},s.tracks[0].revision);expect(manual.status).toBe(200);
  s=await state(a,id);await act(a,id,'scene.launch',{scene:'B'},s.transport.revision);
  const p=(await state(a,id)).plans.at(-1)!;expect(p.mix[tr].gain).toBe(0.3);expect(p.manual[tr]).toBe(null);expect(resolvePlan(p,p.effectiveCycle)).toEqual([]);
});
it('export/import retains music, scene assignments and mixer while remapping IDs',async()=>{
  const {a,id}=await setup();const result=await act(a,id,'track.create',{kind:'melody'});let s=await state(a,id);const tr=result.body.entityId;
  await act(a,id,'clip.publish',{trackId:tr,slot:'B',document:parseCode('note("60 64").s("sine")')},0);
  s=await state(a,id);await act(a,id,'scene.assign',{trackId:tr,scene:'C',clipSlot:'B'},s.tracks[0].revision);
  s=await state(a,id);await act(a,id,'track.mix',{trackId:tr,gain:0.4,mute:true},s.tracks[0].revision);
  const exported=await (await fetch(`${base}/api/projects/${id}/export`,{headers:{cookie:a.cookie}})).json();
  expect(JSON.stringify(exported)).not.toMatch(/visitor_secret|cookie|signature/);
  const imported=await post(a,'/api/import',exported);expect(imported.status).toBe(201);const newid=(await imported.json()).id;
  const newstate=await state(a,newid),newtrack=newstate.tracks[0];expect(newtrack.id).not.toBe(tr);expect(newtrack.clips.B?.document).toEqual(parseCode('note("60 64").s("sine")'));
  const plan=newstate.plans.at(-1)!;expect(plan.sceneAssignments.C[newtrack.id]).toBe('B');expect(plan.mix[newtrack.id]).toEqual({gain:0.4,mute:true});
});
it('cross-site mutations fail before a piece is created',async()=>{
  const a=await visitor();const res=await fetch(`${base}/api/projects`,{method:'POST',headers:{cookie:a.cookie,'content-type':'application/json',origin:'https://foreign.example'},body:JSON.stringify({title:'not created'})});expect(res.status).toBe(403);
});
