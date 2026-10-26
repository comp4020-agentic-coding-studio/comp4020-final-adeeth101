// Diagnosed on 26 October 2026 against the Stream release: the sketchpad's
// public stream (/api/events) read every row of the shared event table, so a
// stranger replaying it from 0 saw each project's creation and track events,
// ids included. The stream now carries only the sketchpad's own kinds.
import {expect,it,inject} from 'vitest';
import {visitor,post,mix,act,listen} from './helpers.ts';
// The sketchpad's own kinds (src/events.ts LEGACY_KINDS); importing that module would open a database.
const LEGACY_KINDS=['trace.created','trace.updated','visitor.renamed'];
const base=inject('baseUrl');

it('the sketchpad stream never replays or announces project events',async()=>{
  const owner=await visitor(base),stranger=await visitor(base),id=await mix(owner);
  const live=listen(stranger,'/api/events?since=0',900);
  await new Promise(r=>setTimeout(r,200));
  const part=await act(owner,id,'part.add',{presetId:'warm-pocket'});
  await post(owner,'/api/act',{body:'s("bd ~ sd ~")'});
  const replay=await listen(stranger,'/api/events?since=0',400),got=await live;
  for(const text of [replay.text,got.text]){
    expect(text).not.toContain(id);expect(text).not.toContain(part.body.entityId);
    const kinds=[...text.matchAll(/^event: (.+)$/gm)].map(m=>m[1]);
    expect(kinds.every(k=>LEGACY_KINDS.includes(k))).toBe(true);
  }
  expect(got.text).toMatch(/event: trace\.(created|updated)/);
});
