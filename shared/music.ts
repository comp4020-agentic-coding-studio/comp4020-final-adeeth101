export const SOUNDS = ['bd', 'sd', 'hh', 'cp'] as const;
export const SYNTHS = ['sine', 'triangle', 'square', 'sawtooth'] as const;
export const OPS = ['fast', 'slow', 'rev', 'gain', 'lpf', 'room'] as const;
export type Sound = typeof SOUNDS[number];
export type Synth = typeof SYNTHS[number];
export type Op = typeof OPS[number];
export type MusicNode =
  | { kind: 'sound'; steps: (Sound | null)[] }
  | { kind: 'notes'; steps: (number | null)[]; synth: Synth }
  | { kind: 'stack'; children: MusicNode[] }
  | { kind: 'transform'; op: Op; value?: number; child: MusicNode };
export type ClipDocument = { schemaVersion: 1; root: MusicNode };
export function validateDocument(input: unknown): ClipDocument {
  const error = (message: string): never => { throw new Error(message); };
  if (!input || typeof input !== 'object' || (input as ClipDocument).schemaVersion !== 1) error('Unknown clip format.');
  let leaves = 0, transforms = 0, cells = 0;
  function walk(raw: unknown, depth: number, speed: number): MusicNode {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) || depth > 8) error('A clip must be a bounded music tree (depth ≤8).');
    const n = raw as Record<string, unknown>;
    if (n.kind === 'sound' || n.kind === 'notes') {
      if (!Array.isArray(n.steps) || n.steps.length < 1 || n.steps.length > 32) error('A sequence has 1–32 steps.');
      const steps = n.steps as unknown[];
      leaves++; cells += steps.length;
      if (speed < 0.25 || speed > 4) error('Combined speed must be between ¼ and 4×.');
      if (n.kind === 'sound') {
        if (steps.some(x => x !== null && !SOUNDS.includes(x as Sound))) error('Choose kick, snare, hat, clap or rest.');
        return { kind: 'sound', steps: [...steps] as (Sound|null)[] };
      }
      if (!SYNTHS.includes(n.synth as Synth) || steps.some(x => x !== null && (typeof x !== 'number' || !Number.isInteger(x) || x < 48 || x > 83))) error('Notes are MIDI 48–83; choose a supported synth.');
      return { kind: 'notes', synth: n.synth as Synth, steps: [...steps] as (number|null)[] };
    }
    if (n.kind === 'stack') {
      if (!Array.isArray(n.children) || n.children.length < 2 || n.children.length > 4) error('Together needs 2–4 patterns.');
      return { kind: 'stack', children: (n.children as unknown[]).map(x => walk(x, depth + 1, speed)) };
    }
    if (n.kind === 'transform' && OPS.includes(n.op as Op)) {
      transforms++;
      const op = n.op as Op, v = n.value;
      if (op !== 'rev') {
        if (typeof v !== 'number' || !Number.isFinite(v)) error('Effect values must be finite numbers.');
        const value = v as number;
        if ((op === 'fast' || op === 'slow') && value !== 2 && value !== 4) error('Speed factor is 2 or 4.');
        if (op === 'gain' && (value < 0 || value > 1)) error('Volume is 0–1.');
        if (op === 'lpf' && (value < 100 || value > 12000)) error('Filter is 100–12000 Hz.');
        if (op === 'room' && (value < 0 || value > 0.5)) error('Reverb is 0–0.5.');
      }
      return { kind: 'transform', op, ...(op !== 'rev' ? { value: v as number } : {}), child: walk(n.child, depth + 1, speed * (op === 'fast' ? v as number : op === 'slow' ? 1 / (v as number) : 1)) };
    }
    return error('Unsupported music block.');
  }
  const root = walk((input as ClipDocument).root, 1, 1);
  if (leaves > 4 || transforms > 8 || cells > 128) error('A clip supports four sequences, eight effects and 128 cells.');
  return { schemaVersion: 1, root };
}
export function emptyClip(kind: 'drums'|'melody' = 'drums'): ClipDocument {
  return { schemaVersion: 1, root: kind === 'melody'
    ? { kind: 'notes', synth: 'triangle', steps: Array(16).fill(null) }
    : { kind: 'stack', children: SOUNDS.map(() => ({ kind: 'sound', steps: Array(16).fill(null) })) } };
}
export function leavesOf(root: MusicNode): Extract<MusicNode, {kind:'sound'|'notes'}>[] {
  return root.kind === 'stack' ? root.children.flatMap(leavesOf) : root.kind === 'transform' ? leavesOf(root.child) : [root];
}
