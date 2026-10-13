import { SOUNDS, type ClipDocument, type Sound } from './music.ts';
export function random(seed: number) {
  let x = seed >>> 0 || 1;
  return () => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return (x >>> 0) / 4294967296; };
}
function shuffle<T>(list: T[], r: () => number): T[] {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
export function rhythmBot(seed: number, density: 'sparse'|'steady'|'busy'): ClipDocument {
  const r = random(seed), d = ['sparse','steady','busy'].indexOf(density);
  if (d < 0) throw new Error('Choose a density.');
  const positions = Array.from({length:16}, (_,i) => i);
  const picks = [[0, ...shuffle(positions.slice(1), r).slice(0, d + 1)], [4,12], shuffle(positions,r).slice(0,[4,8,12][d]), shuffle(positions.filter(i => i !== 4 && i !== 12),r).slice(0,d)];
  return { schemaVersion:1, root: {kind:'stack', children: SOUNDS.map((sound,i) => ({ kind:'sound', steps:positions.map(j => picks[i].includes(j) ? sound as Sound : null) }))} };
}
export function melodyBot(seed: number, root = 0, minor = false, count = 8): ClipDocument {
  if (!Number.isInteger(root) || root < 0 || root > 11 || ![4,8,12].includes(count)) throw new Error('Choose a key and density.');
  const r = random(seed), scale = minor ? [0,3,5,7,10] : [0,2,4,7,9];
  const pitches = Array.from({length:24}, (_,i) => i + 48).filter(n => scale.includes((n-root+120)%12));
  const positions = [0,...shuffle(Array.from({length:15},(_,i)=>i+1),r).slice(0,count-1)].sort((a,b)=>a-b);
  let index = pitches.indexOf(48 + root);
  const steps: (number|null)[] = Array(16).fill(null);
  positions.forEach((p,i) => { if(i) index = Math.max(0,Math.min(pitches.length-1,index+Math.floor(r()*3)-1)); steps[p] = pitches[index]; });
  return {schemaVersion:1, root:{kind:'notes',synth:'triangle',steps}};
}
