import {it,expect,inject} from 'vitest';
import {randomUUID} from 'node:crypto';
import {visitor,get,post,mix,type V} from './helpers.ts';
const base=inject('baseUrl');
async function setup(){
  const host=await visitor(base),guest=await visitor(base),other=await visitor(base),id=await mix(host);
  await post(guest,'/api/handle',{handle:'Same guest'});await post(other,'/api/handle',{handle:'Same guest'});
  const perf=(await post(host,`/api/projects/${id}/go-live`,{commandId:randomUUID(),title:'Editable guests',visibility:'public'})).body.id;
  for(const v of [guest,other]){await post(v,`/api/performances/${perf}/moderate`,{action:'request'});await post(host,`/api/performances/${perf}/moderate`,{action:'accept',visitorId:v.id});}
  const command=(v:V,type:string,payload:unknown,expectedRevision?:number,commandId=randomUUID())=>post(v,`/api/performances/${perf}/commands`,{commandId,type,payload,expectedRevision});
  return {host,guest,other,id,perf,command};
}
it('gives a guest exact editable source only for their own session parts, using stable IDs',async()=>{
  const x=await setup(),source='// My own exact source\ns("bd ~ sd ~").gain(0.4);';
  const mine=(await x.command(x.guest,'guest.add',{name:'My part',source})).body.entityId;
  const theirs=(await x.command(x.other,'guest.add',{presetId:'warm-anchor'})).body.entityId;
  const a=(await get(x.guest,`/api/performances/${x.perf}`)).body,b=(await get(x.other,`/api/performances/${x.perf}`)).body;
  expect(a.yourParts).toEqual([expect.objectContaining({id:mine,source,revision:1})]);
  expect(b.yourParts.map((p:any)=>p.id)).toEqual([theirs]);
  expect(a.parts.find((p:any)=>p.id===mine).ownerId).toBe(x.guest.id);
  expect((await get(await visitor(base),`/api/performances/${x.perf}`)).body.yourParts).toEqual([]);
  expect((await get(x.host,`/api/performances/${x.perf}`)).body.yourParts).toEqual([]);
  expect((await get(x.guest,`/api/projects/${x.id}`)).status).toBe(404);
  expect((await x.command(x.other,'guest.edit',{trackId:mine,source:'s("cp")'},1)).status).toBe(403);
});
it('requires a revision, refuses stale or removed edits, and never publishes invalid code',async()=>{
  const x=await setup(),part=(await x.command(x.guest,'guest.add',{presetId:'warm-pocket'})).body.entityId;
  expect((await x.command(x.guest,'guest.edit',{trackId:part,source:'s("cp")'})).status).toBe(422);
  expect((await x.command(x.guest,'guest.edit',{trackId:part,source:'fetch("/api/me")'},1)).status).toBe(422);
  const cid=randomUUID(),payload={trackId:part,source:'s("bd cp").room(0.2)'};
  const ok=await x.command(x.guest,'guest.edit',payload,1,cid);expect(ok.status).toBe(200);
  expect((await x.command(x.guest,'guest.edit',payload,1,cid)).body).toEqual(ok.body);
  expect((await x.command(x.guest,'guest.edit',{trackId:part,source:'s("hh")'},1)).status).toBe(409);
  expect((await get(x.guest,`/api/performances/${x.perf}`)).body.yourParts[0]).toMatchObject({source:payload.source,revision:2});
  await x.command(x.guest,'guest.remove',{trackId:part});
  expect((await x.command(x.guest,'guest.edit',{trackId:part,source:'s("hh")'},2)).status).toBe(410);
});
