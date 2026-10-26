// What a performance publishes to its audience. Reported by review: the
// audience snapshot carried every clip in the plan's catalog, so a private
// project's unused workspace clips reached an unrelated listener even though
// the project itself answered 404. An audience receives only the musical
// revisions its performance can actually reach.
import {expect,it,describe,inject} from 'vitest';
import {randomUUID} from 'node:crypto';
import {visitor,get,post,act,mix,room,wait,type V} from './helpers.ts';
import {publishedPlan,reachableScenes,blankPlan,resolvePlan,type Plan} from '../shared/performance.ts';
const base=inject('baseUrl');

const goLive=async(a:V,id:string,visibility:'public'|'unlisted'='public')=>{
  const r=await post(a,`/api/projects/${id}/go-live`,{commandId:randomUUID(),title:'Tonight',visibility});
  expect(r.status).toBe(201);return r.body.id as string;
};
const sources=(snapshot:any)=>JSON.stringify(snapshot);
const slotsOf=(snapshot:any,trackId:string)=>snapshot.plans.flatMap((p:any)=>Object.keys(p.catalog[trackId]??{}));

describe('the published plan',()=>{
  it('carries only what the current scene selects, not the rest of the workspace',()=>{
    const p=blankPlan();
    p.catalog.t={A:{revision:1,document:{schemaVersion:2,root:{k:'sound',mini:{t:'word',v:'bd'}}} as never},
                 B:{revision:9,document:{schemaVersion:2,root:{k:'note',voice:'sine',mini:{t:'word',v:95}}} as never}};
    p.sceneAssignments.A.t='A';p.sceneAssignments.B.t='B';p.scene='A';
    const out=publishedPlan(p);
    expect(Object.keys(out.catalog.t)).toEqual(['A']);
    // It still resolves to the same music as the full plan.
    expect(resolvePlan(out,0).map(x=>x.slot)).toEqual(resolvePlan(p,0).map(x=>x.slot));
  });
  it('keeps every scene a running arrangement can reach, so a transition has its music',()=>{
    const p=blankPlan();
    p.catalog.t={A:{revision:1,document:{} as never},B:{revision:2,document:{} as never},C:{revision:3,document:{} as never}};
    p.sceneAssignments.A.t='A';p.sceneAssignments.B.t='B';p.sceneAssignments.C.t='C';
    p.arrangement={entries:[{scene:'A',bars:2},{scene:'B',bars:2}],loop:true,startCycle:0};
    expect(reachableScenes(p).sort()).toEqual(['A','B']);
    expect(Object.keys(publishedPlan(p).catalog.t).sort()).toEqual(['A','B']);
  });
  it('follows a manual override instead of the scene, and drops a muted track',()=>{
    const p=blankPlan();
    p.catalog.t={A:{revision:1,document:{} as never},D:{revision:4,document:{} as never}};
    p.sceneAssignments.A.t='A';p.manual.t='D';
    expect(Object.keys(publishedPlan(p).catalog.t)).toEqual(['D']);
    p.mix.t={gain:0.7,mute:true};
    expect(publishedPlan(p).catalog.t).toBeUndefined();
  });
  it('is silence, not an error, when a track has nothing selected',()=>{
    const p=blankPlan();p.catalog.t={A:{revision:1,document:{} as never}};p.manual.t=null;
    const out=publishedPlan(p);expect(out.catalog.t).toBeUndefined();expect(resolvePlan(out,0)).toEqual([]);
  });
});

describe('an audience of a private project',()=>{
  it('never receives a clip the performance is not playing',async()=>{
    const a=await visitor(base),c=await visitor(base),id=await mix(a);
    const part=(await act(a,id,'part.add',{presetId:'warm-pocket'})).body.entityId;
    // A private draft in another slot: never selected, never assigned, never scheduled.
    expect((await act(a,id,'part.edit',{trackId:part,slot:'B',source:'note("95").s("sine")'},0)).status).toBe(200);
    const perf=await goLive(a,id);
    expect((await get(c,`/api/projects/${id}`)).status).toBe(404);
    const aud=await get(c,`/api/performances/${perf}`);
    expect(aud.status).toBe(200);
    expect(slotsOf(aud.body,part)).toEqual(['A']);
    // The private note itself, not the digits: ids contain digits too.
    const notes=JSON.stringify(aud.body.plans).match(/"v":d+/g)??[];
    expect(notes).not.toContain('"v":95');
    // Nor through any other audience route.
    expect(sources((await get(c,`/api/performances/${perf}/chat`)).body)).not.toContain('95');
  });
  it('receives a newly needed clip when the host launches the scene that uses it',async()=>{
    const a=await visitor(base),c=await visitor(base),id=await mix(a);
    const part=(await act(a,id,'part.add',{presetId:'warm-pocket'})).body.entityId;
    await act(a,id,'part.edit',{trackId:part,slot:'C',source:'note("72 76").s("triangle")'},0);
    await act(a,id,'scene.assign',{trackId:part,scene:'C',clipSlot:'C'});
    const perf=await goLive(a,id);
    // Scene C is not current, so its music is not published yet.
    expect(slotsOf((await get(c,`/api/performances/${perf}`)).body,part)).toEqual(['A']);
    await act(a,id,'transport.start');
    const launch=await act(a,id,'scene.launch',{scene:'C'});
    expect(launch.status).toBe(200);
    const after=(await get(c,`/api/performances/${perf}`)).body;
    // The plan that makes scene C current carries scene C's clip, at its bar.
    const queued=after.plans.find((p:any)=>p.scene==='C');
    expect(queued,'the scene launch published no plan').toBeTruthy();
    expect(Object.keys(queued.catalog[part])).toContain('C');
    expect(queued.effectiveCycle).toBe(launch.body.effectiveCycle);
  });
  it('receives an arrangement’s scenes together, so a transition is never silent',async()=>{
    const a=await visitor(base),c=await visitor(base),id=await mix(a);
    const part=(await act(a,id,'part.add',{presetId:'warm-pocket'})).body.entityId;
    await act(a,id,'part.edit',{trackId:part,slot:'B',source:'s("cp cp")'},0);
    await act(a,id,'scene.assign',{trackId:part,scene:'B',clipSlot:'B'});
    await act(a,id,'arrangement.save',{entries:[{scene:'A',bars:2},{scene:'B',bars:2}],loop:true});
    const perf=await goLive(a,id);
    await act(a,id,'transport.start');
    expect((await act(a,id,'arrangement.start')).status).toBe(200);
    const plans=(await get(c,`/api/performances/${perf}`)).body.plans;
    const arranged=plans.find((p:any)=>p.arrangement);
    expect(arranged,'no arranged plan was published').toBeTruthy();
    expect(Object.keys(arranged.catalog[part]).sort()).toEqual(['A','B']);
  });
  it('loses a muted part’s music, and gets it back when it is unmuted',async()=>{
    const a=await visitor(base),c=await visitor(base),id=await mix(a);
    const part=(await act(a,id,'part.add',{presetId:'warm-pocket'})).body.entityId;
    const perf=await goLive(a,id);
    const rev=(await room(a,id)).parts[0].revision;
    await act(a,id,'part.mix',{trackId:part,mute:true},rev);
    expect(slotsOf((await get(c,`/api/performances/${perf}`)).body,part)).toEqual([]);
    await act(a,id,'part.mix',{trackId:part,mute:false});
    expect(slotsOf((await get(c,`/api/performances/${perf}`)).body,part)).toContain('A');
  });
  it('is given no source, history, drafts or private identity material',async()=>{
    const a=await visitor(base),c=await visitor(base),id=await mix(a);
    await act(a,id,'part.add',{presetId:'warm-pocket'});
    await post(a,`/api/projects/${id}/chat`,{clientId:randomUUID(),body:'members only'});
    const perf=await goLive(a,id);
    const text=sources((await get(c,`/api/performances/${perf}`)).body);
    for(const secret of ['members only','"source"','"history"','"provenance"','"lease"','listenToken','viewToken','friend_code','recovery'])
      expect(text,`audience payload leaked ${secret}`).not.toContain(secret);
  });
});
