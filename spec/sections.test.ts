// Sections and sequences, on the existing scene and arrangement model. Everyone
// follows one durable plan on one clock, so what a section contains and when it
// changes comes from the plan, not from any one page.
import {describe,it,expect,inject} from 'vitest';
import {visitor,get,post,act,mix,room,join,type V} from './helpers.ts';
import {resolvePlan,planAt,sceneAt,publishedPlan} from '../shared/performance.ts';
import {suggestSections} from '../shared/sections.ts';
const base=inject('baseUrl');
const sequence={entries:[{scene:'A',bars:8},{scene:'B',bars:4},{scene:'C',bars:4}],loop:false};
const two=async(a:V)=>{const id=await mix(a);const kick=(await act(a,id,'part.add',{presetId:'warm-pocket'})).body.entityId,bass=(await act(a,id,'part.add',{presetId:'warm-anchor'})).body.entityId;return {id,kick,bass};};

describe('a character that stops after eight bars',()=>{
  it('is a section it is not in, after a section of eight bars',async()=>{
    const a=await visitor(base),{id,kick,bass}=await two(a);
    await act(a,id,'scene.assign',{trackId:bass,scene:'B',clipSlot:null});
    await act(a,id,'arrangement.save',sequence);
    await act(a,id,'transport.start',{arrangement:true});
    const s=await room(a,id),plan=planAt(s.plans,0)!;
    expect(plan.arrangement).toMatchObject({startCycle:0,loop:false});
    const at=(c:number)=>resolvePlan(planAt(s.plans,c)!,c).map(x=>x.trackId).sort();
    expect(at(7)).toEqual([kick,bass].sort());expect(at(8)).toEqual([kick]);expect(at(11)).toEqual([kick]);expect(at(12)).toEqual([kick,bass].sort());
    // A sequence that does not loop rests on its last section.
    expect(sceneAt(plan,500)).toBe('C');
  });
});
describe('running a sequence',()=>{
  it('starts from bar one with the mix, or joins at the next bar without resetting the clock',async()=>{
    const a=await visitor(base),{id}=await two(a);await act(a,id,'arrangement.save',sequence);
    await act(a,id,'transport.start');const before=await room(a,id);
    const r=await act(a,id,'arrangement.start');expect(r.status).toBe(200);
    const s=await room(a,id);expect(s.transport.epochMs).toBe(before.transport.epochMs);expect(s.transport.generation).toBe(before.transport.generation);
    expect(s.plans.at(-1).arrangement.startCycle).toBe(r.body.effectiveCycle);
  });
  it('is the host’s: another member cannot run it, save it or launch a section',async()=>{
    const a=await visitor(base),b=await visitor(base),{id}=await two(a);await join(a,b,id);
    await act(a,id,'transport.start');
    for(const [type,payload] of [['arrangement.save',sequence],['arrangement.start',{}],['arrangement.stop',{}],['scene.launch',{scene:'B'}],['scene.rename',{scene:'A',name:'Mine'}]] as const)expect((await act(b,id,type,payload)).status,type).toBe(403);
  });
  it('any member can say who plays in a section',async()=>{
    const a=await visitor(base),b=await visitor(base),{id,bass}=await two(a);await join(a,b,id);
    expect((await act(b,id,'scene.assign',{trackId:bass,scene:'C',clipSlot:null})).status).toBe(200);
    expect((await room(a,id)).plans.at(-1).sceneAssignments.C[bass]).toBeNull();
  });
  it('refuses a sequence outside its bounds',async()=>{
    const a=await visitor(base),{id}=await two(a);
    for(const bad of [{entries:[],loop:true},{entries:[{scene:'A',bars:0}],loop:true},{entries:[{scene:'A',bars:17}],loop:true},{entries:[{scene:'Z',bars:4}],loop:true},{entries:Array.from({length:9},()=>({scene:'A',bars:1})),loop:true},{entries:[{scene:'A',bars:1}]}])expect((await act(a,id,'arrangement.save',bad)).status,JSON.stringify(bad)).toBe(422);
  });
  it('saving a new sequence does not touch the one sounding; only running it does',async()=>{
    const a=await visitor(base),{id}=await two(a);await act(a,id,'arrangement.save',sequence);await act(a,id,'transport.start',{arrangement:true});
    await act(a,id,'arrangement.save',{entries:[{scene:'D',bars:1}],loop:true});
    const s=await room(a,id);expect(s.settings.arrangement.entries).toEqual([{scene:'D',bars:1}]);expect(s.plans.at(-1).arrangement.entries).toEqual(sequence.entries);
  });
  it('stopping the sequence stays on the section it reached and hands back manual control',async()=>{
    const a=await visitor(base),{id}=await two(a);await act(a,id,'arrangement.save',sequence);await act(a,id,'transport.start',{arrangement:true});
    await act(a,id,'arrangement.stop');const p=(await room(a,id)).plans.at(-1);expect(p.arrangement).toBeNull();expect(p.scene).toBe('A');
    expect((await act(a,id,'scene.launch',{scene:'C'})).status).toBe(200);expect((await room(a,id)).plans.at(-1).scene).toBe('C');
  });
  it('Stop and Play keep the saved sequence and the section, and drop the running one',async()=>{
    const a=await visitor(base),{id}=await two(a);await act(a,id,'arrangement.save',sequence);await act(a,id,'transport.start',{arrangement:true});
    await act(a,id,'transport.stop');let s=await room(a,id);expect(s.plans.at(-1).arrangement).toBeNull();expect(s.settings.arrangement.entries).toEqual(sequence.entries);
    await act(a,id,'transport.start');s=await room(a,id);expect(s.plans.at(-1).arrangement).toBeNull();
  });
  it('passing the host keeps the sequence running on the same clock, and the new host controls it',async()=>{
    const a=await visitor(base),b=await visitor(base),{id}=await two(a);await join(a,b,id);await act(a,id,'arrangement.save',sequence);await act(a,id,'transport.start',{arrangement:true});
    const before=await room(a,id);await act(a,id,'host.pass',{visitorId:b.id});const after=await room(b,id);
    expect(after.transport.hostId).toBe(b.id);expect(after.transport.epochMs).toBe(before.transport.epochMs);expect(after.plans.at(-1).arrangement).toEqual(before.plans.at(-1).arrangement);
    expect((await act(a,id,'arrangement.stop')).status).toBe(403);expect((await act(b,id,'arrangement.stop')).status).toBe(200);
  });
  it('a late listener gets the same sequence, with every section it can reach and no others',async()=>{
    const a=await visitor(base),{id,kick,bass}=await two(a);
    await act(a,id,'scene.assign',{trackId:bass,scene:'D',clipSlot:null});
    await act(a,id,'arrangement.save',{entries:[{scene:'A',bars:2},{scene:'B',bars:2}],loop:true});await act(a,id,'transport.start',{arrangement:true});
    const perf=(await post(a,`/api/projects/${id}/go-live`,{commandId:crypto.randomUUID(),title:'Sequence',visibility:'public'})).body.id;
    const late=await visitor(base),aud=(await get(late,`/api/performances/${perf}`)).body,p=aud.plans.at(-1);
    expect(p.arrangement.entries).toHaveLength(2);expect(Object.keys(p.catalog).sort()).toEqual([kick,bass].sort());
    expect(p.sceneAssignments.D).toEqual({});
    expect(JSON.stringify(publishedPlan((await room(a,id)).plans.at(-1)))).toEqual(JSON.stringify(p));
  });
});
describe('suggesting a build-up',()=>{
  const band=[{id:'k',name:'Kick',role:'beats'},{id:'b',name:'Bass',role:'bass'},{id:'m',name:'Tune',role:'melody'},{id:'t',name:'Pad',role:'texture'}];
  it('is arithmetic on roles: the same band always gets the same answer, and it uses only who is there',()=>{
    expect(suggestSections(band)).toEqual(suggestSections(band));
    const s=suggestSections(band);
    expect(s.who).toEqual({A:['Tune','Pad'],B:['Bass','Tune','Pad'],C:['Kick','Bass','Tune','Pad'],D:['Kick','Pad']});
    expect(new Set(Object.values(s.assignments).flatMap(x=>Object.keys(x)))).toEqual(new Set(['k','b','m','t']));
  });
  it('never leaves a section empty, whatever the band',()=>{
    for(const only of ['beats','bass','melody','texture','custom'])for(const who of Object.values(suggestSections([{id:'x',name:'Solo',role:only}]).who))expect(who).toEqual(['Solo']);
  });
  it('applies as one change, for the host only, and everyone gets it from the plan',async()=>{
    const a=await visitor(base),b=await visitor(base),{id,kick,bass}=await two(a);await join(a,b,id);
    const s=await room(a,id),suggestion=suggestSections(s.parts);
    expect((await act(b,id,'sections.apply',{assignments:suggestion.assignments,arrangement:suggestion.arrangement})).status).toBe(403);
    const r=await act(a,id,'sections.apply',{assignments:suggestion.assignments,arrangement:suggestion.arrangement});expect(r.status).toBe(200);
    const after=await room(b,id);expect(after.settings.arrangement).toEqual(suggestion.arrangement);
    expect(after.plans.at(-1).sceneAssignments.B[kick]).toBeNull();expect(after.plans.at(-1).sceneAssignments.C[kick]).toBe('A');expect(after.plans.at(-1).sceneAssignments.D[bass]).toBeNull();
    expect((await act(a,id,'sections.apply',{assignments:{A:{}},arrangement:suggestion.arrangement})).status).toBe(422);
    expect((await act(a,id,'sections.apply',{assignments:{A:{nope:'A'},B:{},C:{},D:{}},arrangement:suggestion.arrangement})).status).toBe(404);
  });
});
