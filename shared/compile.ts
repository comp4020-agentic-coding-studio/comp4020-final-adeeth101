import { s, note, stack, type Pattern } from '@strudel/core';
import { mini } from '@strudel/mini';
import type { MusicNode } from './music.ts';
export function compile(n: MusicNode): Pattern {
  if(n.kind === 'sound') return s(mini(n.steps.map(x=>x??'~').join(' ')));
  if(n.kind === 'notes') return note(mini(n.steps.map(x=>x??'~').join(' '))).s(n.synth);
  if(n.kind === 'stack') return stack(...n.children.map(compile));
  const child = compile(n.child);
  return n.op === 'rev' ? child.rev() : child[n.op](n.value!);
}
