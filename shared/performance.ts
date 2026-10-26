import type { ClipDocument } from './music.ts';
export type Slot = 'A'|'B'|'C'|'D';
export const SLOTS: Slot[] = ['A','B','C','D'];
export type Plan = {
  generation: number; planRevision: number; effectiveCycle: number;
  catalog: Record<string,Partial<Record<Slot, {revision:number; document:ClipDocument}>>>;
  mix: Record<string,{gain:number;mute:boolean}>;
  sceneAssignments: Record<Slot,Record<string,Slot|null>>;
  manual: Record<string,Slot|null>;
  scene: Slot;
  arrangement: null | { entries: {scene:Slot;bars:number}[]; loop:boolean; startCycle:number };
};
export function blankPlan(): Plan {
  return {generation:0,planRevision:0,effectiveCycle:0,catalog:{},mix:{},sceneAssignments:{A:{},B:{},C:{},D:{}},manual:{},scene:'A',arrangement:null};
}
export function sceneAt(p: Plan, cycle: number): Slot {
  const a = p.arrangement;
  if (!a || !a.entries.length || cycle < a.startCycle) return p.scene;
  const total = a.entries.reduce((s,x)=>s+x.bars,0);
  let pos = Math.floor(cycle-a.startCycle);
  if(a.loop) pos %= total;
  for(const x of a.entries) { if(pos < x.bars) return x.scene; pos -= x.bars; }
  return a.entries.at(-1)!.scene;
}
export function planAt(plans: Plan[], cycle: number): Plan|undefined {
  return plans.filter(p=>p.effectiveCycle<=cycle).sort((a,b)=>b.effectiveCycle-a.effectiveCycle||b.planRevision-a.planRevision)[0];
}
export function resolvePlan(p: Plan, cycle: number) {
  const scene = sceneAt(p, cycle);
  return Object.entries(p.catalog).flatMap(([trackId,clips]) => {
    const slot = Object.hasOwn(p.manual,trackId) ? p.manual[trackId] : p.sceneAssignments[scene]?.[trackId];
    const clip = slot ? clips[slot] : undefined, mix = p.mix[trackId] ?? {gain:0.7,mute:false};
    return clip && !mix.mute ? [{trackId,slot:slot!,...clip,gain:mix.gain}] : [];
  });
}
export function cycleAt(nowMs:number, epochMs:number, bpm:number) { return (nowMs-epochMs)*bpm/240000; }
export function nextBoundary(nowMs:number,epochMs:number,bpm:number) { return Math.max(0,Math.ceil(cycleAt(nowMs+1000,epochMs,bpm))); }
// After a restart, keep what was sounding at the last durable write and drop
// anything still queued beyond it; the next start must not apply it silently.
export function planAtRestart(plans:Plan[],epochMs:number|null,bpm:number,lastWriteMs:number):Plan{
  if(epochMs===null)return structuredClone(plans.at(-1)??blankPlan());
  const cycle=cycleAt(lastWriteMs,epochMs,bpm),p=structuredClone(planAt(plans,cycle)??plans[0]??blankPlan());
  p.scene=sceneAt(p,Math.max(0,cycle));return p;
}

// What a listener is allowed to receive of a plan.
//
// A plan can only ever sound the clip each track is selected for: its manual
// override, or the slot its scene assigns. A running arrangement can reach
// every scene it lists, so all of those count; without one, only the current
// scene does. A muted track sounds nothing, and unmuting publishes a new plan,
// so its music is not needed either. Everything else in the catalog is
// somebody's private workspace and must not travel to an audience.
//
// Dropping a clip is safe because resolvePlan treats a missing slot as
// silence, and any change that makes a clip necessary (a scene launch, an
// unmute, a new arrangement) publishes a new plan carrying it, at the bar that
// change takes effect.
export function reachableScenes(p: Plan): Slot[] {
  const scenes = p.arrangement?.entries.length ? p.arrangement.entries.map(e => e.scene) : [p.scene];
  return [...new Set(scenes)];
}
export function publishedPlan(p: Plan): Plan {
  const scenes = reachableScenes(p);
  const catalog: Plan['catalog'] = {}, mix: Plan['mix'] = {};
  const sceneAssignments = {A:{},B:{},C:{},D:{}} as Plan['sceneAssignments'];
  for (const [trackId, clips] of Object.entries(p.catalog)) {
    if ((p.mix[trackId] ?? {mute:false}).mute) continue;
    const slots = new Set<Slot>();
    if (Object.hasOwn(p.manual, trackId)) { const s = p.manual[trackId]; if (s) slots.add(s); }
    else for (const scene of scenes) { const s = p.sceneAssignments[scene]?.[trackId]; if (s) slots.add(s); }
    const kept = [...slots].flatMap(s => clips[s] ? [[s, {revision: clips[s]!.revision, document: clips[s]!.document}] as const] : []);
    if (!kept.length) continue;
    catalog[trackId] = Object.fromEntries(kept);
    mix[trackId] = p.mix[trackId] ?? {gain:0.7, mute:false};
    for (const scene of scenes) sceneAssignments[scene][trackId] = p.sceneAssignments[scene]?.[trackId] ?? null;
  }
  const manual = Object.fromEntries(Object.entries(p.manual).filter(([trackId]) => Object.hasOwn(catalog, trackId)));
  return {generation:p.generation, planRevision:p.planRevision, effectiveCycle:p.effectiveCycle,
    catalog, mix, sceneAssignments, manual, scene:p.scene, arrangement:p.arrangement};
}
