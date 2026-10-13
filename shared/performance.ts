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
