import {it,expect,inject} from 'vitest';
import {visitor,mix,act,room,wait} from './helpers.ts';
const base=inject('baseUrl');

it('Stop keeps a durable plan and its mix settings for the next Play',async()=>{
  const v=await visitor(base),id=await mix(v);
  const trackId=(await act(v,id,'part.add',{presetId:'warm-pocket',play:true})).body.entityId;
  const before=await room(v,id);
  const change=await act(v,id,'part.mix',{trackId,gain:0.23,mute:true},before.parts[0].revision);
  expect(change.status).toBe(200);
  // Let the queued mix reach its bar: Stop intentionally cancels future plans.
  await wait(Math.max(0,before.transport.epochMs+change.body.effectiveCycle*240000/before.settings.bpm-Date.now()+50));
  expect((await act(v,id,'transport.stop')).status).toBe(200);
  const stopped=await room(v,id);
  expect(stopped.transport.status).toBe('stopped');
  expect(stopped.plans).toHaveLength(1);
  expect(stopped.plans[0].mix[trackId]).toEqual({gain:0.23,mute:true});
  expect((await act(v,id,'transport.start')).status).toBe(200);
  expect((await room(v,id)).plans[0].mix[trackId]).toEqual({gain:0.23,mute:true});
});
