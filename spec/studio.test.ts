import {expect,it,inject} from 'vitest';
import {randomUUID} from 'node:crypto';
import {emptyClip} from '../shared/music.ts';
import type {Snapshot} from '../shared/studio.ts';
const base=inject('baseUrl');
async function visitor(){const res=await fetch(`${base}/api/me`);return res.headers.get('set-cookie')!.split(';')[0];}
async function post(cookie:string,path:string,body:unknown){const res=await fetch(`${base}${path}`,{method:'POST',headers:{cookie,'content-type':'application/json'},body:JSON.stringify(body)});return {status:res.status,body:await res.json() as any};}
const get=(cookie:string,id:string)=>fetch(`${base}/api/projects/${id}`,{headers:{cookie}}).then(r=>r.json() as Promise<Snapshot>);
const command=(cookie:string,id:string,type:string,payload:unknown={},expectedRevision?:number,commandId=randomUUID())=>post(cookie,`/api/projects/${id}/commands`,{commandId,type,payload,expectedRevision});
async function piece(){const cookie=await visitor(),made=await post(cookie,'/api/projects',{title:'Integration piece'});expect(made.status).toBe(201);return {cookie,id:made.body.id};}
it('owns tracks, rejects foreign edits and preserves invalid-code drafts without publishing',async()=>{
  const {cookie,id}=await piece(),other=await visitor();
  const made=await command(cookie,id,'track.create',{kind:'drums'});expect(made.status).toBe(200);
  const trackId=made.body.entityId,state=await get(cookie,id),clip=state.tracks[0].clips.A!;
  const foreign=await command(other,id,'clip.publish',{trackId,slot:'A',document:emptyClip()},clip.revision);expect(foreign.status).toBe(403);
  const invalid=await command(cookie,id,'clip.publish',{trackId,slot:'A',document:emptyClip(),source:'fetch("/api/me")'},clip.revision);expect(invalid.status).toBe(422);
  const after=await get(cookie,id);expect(after.revision).toBe(state.revision);expect(after.tracks[0].clips.A?.revision).toBe(1);
});
it('applies a command once and conflicts on stale revisions',async()=>{
  const {cookie,id}=await piece(),made=await command(cookie,id,'track.create',{kind:'melody'}),trackId=made.body.entityId;
  const cid=randomUUID(),payload={trackId,name:'New name'};
  const first=await command(cookie,id,'track.rename',payload,1,cid),retry=await command(cookie,id,'track.rename',payload,1,cid);
  expect(retry.body).toEqual(first.body);expect((await get(cookie,id)).tracks[0].revision).toBe(2);
  expect((await command(cookie,id,'track.rename',{trackId,name:'Old write'},1)).status).toBe(409);
  expect((await command(cookie,id,'track.rename',{trackId,name:'Different'},1,cid)).status).toBe(409);
});
it('limits active tracks transactionally and can archive/recover an owned track',async()=>{
  const {cookie,id}=await piece();const a=await command(cookie,id,'track.create',{kind:'drums'});await command(cookie,id,'track.create',{kind:'melody'});
  expect((await command(cookie,id,'track.create',{kind:'melody'})).status).toBe(409);
  expect((await command(cookie,id,'track.archive',{trackId:a.body.entityId},1)).status).toBe(200);
  expect((await command(cookie,id,'track.restore',{trackId:a.body.entityId},2)).status).toBe(200);
});
it('conductor can launch and arrange but cannot edit another persons music',async()=>{
  const {cookie,id}=await piece(),other=await visitor();await command(cookie,id,'track.create',{kind:'drums'});await command(other,id,'track.create',{kind:'melody'});
  let state=await get(cookie,id);expect((await command(other,id,'transport.start',{},state.transport.revision)).status).toBe(403);
  expect((await command(cookie,id,'conductor.claim',{},state.transport.revision)).status).toBe(200);
  state=await get(cookie,id);expect((await command(other,id,'conductor.claim',{},state.transport.revision)).status).toBe(409);
  expect((await command(cookie,id,'transport.start',{},state.transport.revision)).status).toBe(200);
  state=await get(cookie,id);const scene=await command(cookie,id,'scene.launch',{scene:'B'},state.transport.revision);expect(scene.status).toBe(200);expect(scene.body.effectiveCycle).toBeGreaterThanOrEqual(0);
  state=await get(cookie,id);const mine=state.tracks[0];const mix=await command(cookie,id,'track.mix',{trackId:mine.id,gain:0.4,mute:false},mine.revision);expect(mix.status).toBe(200);
  state=await get(cookie,id);const last=state.plans.at(-1)!;expect(last.scene).toBe('B');expect(last.mix[mine.id].gain).toBe(0.4);
  expect((await command(cookie,id,'arrangement.start',{},state.transport.revision)).status).toBe(200);
  state=await get(cookie,id);expect(state.plans.at(-1)?.arrangement).not.toBeNull();
  await command(cookie,id,'transport.stop',{},state.transport.revision);
});
it('SSE announces committed changes and snapshot agrees with cursor',async()=>{
  const {cookie,id}=await piece(),state=await get(cookie,id),controller=new AbortController();
  const stream=await fetch(`${base}/api/projects/${id}/events?since=${state.eventId}`,{headers:{cookie},signal:controller.signal});
  expect(stream.headers.get('content-type')).toContain('text/event-stream');const reader=stream.body!.getReader();await reader.read();
  const changed=await command(cookie,id,'track.create',{kind:'drums'});const chunk=await reader.read();expect(new TextDecoder().decode(chunk.value)).toContain(`id: ${changed.body.eventId}`);
  expect((await get(cookie,id)).eventId).toBe(changed.body.eventId);controller.abort();
});
it('exports music and imports it under new identity/IDs',async()=>{
  const {cookie,id}=await piece(),t=await command(cookie,id,'track.create',{kind:'melody'}),doc=emptyClip('melody');(doc.root as any).steps[0]=60;
  await command(cookie,id,'clip.publish',{trackId:t.body.entityId,slot:'A',document:doc},1);
  const exported=await (await fetch(`${base}/api/projects/${id}/export`,{headers:{cookie}})).json();expect(JSON.stringify(exported)).not.toContain('visitor_secret');
  const other=await visitor(),imported=await post(other,'/api/import',exported);expect(imported.status).toBe(201);const loaded=await get(other,imported.body.id);expect(loaded.tracks[0].clips.A?.document).toEqual(doc);expect(loaded.tracks[0].id).not.toBe(t.body.entityId);
});
it('refuses non-JSON mutations and oversized bodies with their own statuses',async()=>{
  const {cookie,id}=await piece();
  const form=await fetch(`${base}/api/projects/${id}/commands`,{method:'POST',headers:{cookie,'content-type':'text/plain'},body:'{}'});expect(form.status).toBe(415);
  const huge=await fetch(`${base}/api/projects/${id}/commands`,{method:'POST',headers:{cookie,'content-type':'application/json'},body:JSON.stringify({pad:'x'.repeat(70*1024)})});expect(huge.status).toBe(413);
  expect((await huge.json()).error).toBeTruthy();
});
