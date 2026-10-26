// Strudel patterns are built here from validated documents, through named
// library calls only. Version 1 trees and version 2 expressions both play;
// neither is converted into the other.
import * as core from '@strudel/core';
import type { Pattern } from '@strudel/core';
import { mini } from '@strudel/mini';
import type { MusicNode, ClipDocument } from './music.ts';
import type { Expr, ExprDocument, Mini } from './expr.ts';

// The published typings omit several runtime exports and controls; these are
// the calls this file is allowed to make.
interface P extends Omit<Pattern,"gain"|"lpf"|"room"|"fast"|"slow"|"rev"|"s"> {s(v:unknown):P;pan(v:number):P;release(v:number):P;gain(v:number):P;lpf(v:number):P;room(v:number):P;fast(v:number):P;slow(v:number):P;rev():P}
const lib = core as unknown as {s(p:unknown):P;note(p:unknown):P;stack(...p:P[]):P;sequence(...p:P[]):P;timeCat(...p:[number,P][]):P;pure(v:unknown):P;silence:P};
const {s,note,stack,sequence,timeCat,pure,silence}=lib;

export function compile(n: MusicNode): P {
  if(n.kind === 'sound') return s(mini(n.steps.map(x=>x??'~').join(' ')));
  if(n.kind === 'notes') return note(mini(n.steps.map(x=>x??'~').join(' '))).s(n.synth);
  if(n.kind === 'stack') return stack(...n.children.map(compile));
  const child = compile(n.child);
  return n.op === 'rev' ? child.rev() : child[n.op](n.value!);
}

function sequenceOf(m: Mini): P {
  if (m.t !== 'seq') return compileMini(m);
  return m.items.every(x => x.weight === 1)
    ? sequence(...m.items.map(x => compileMini(x.node)))
    : timeCat(...m.items.map(x => [x.weight, compileMini(x.node)] as [number, P]));
}
export function compileMini(m: Mini): P {
  switch (m.t) {
    case 'word': return pure(m.v);
    case 'rest': return silence;
    case 'seq': return sequenceOf(m);
    case 'stack': return stack(...m.items.map(compileMini));
    // Strudel's <a b, c d e>: each layer advances one step per cycle.
    case 'alt': return stack(...m.layers.map(layer => sequenceOf(layer).slow(layer.t === 'seq' ? layer.items.reduce((n, x) => n + x.weight, 0) : 1)));
    case 'fast': return compileMini(m.node).fast(m.n);
    case 'slow': return compileMini(m.node).slow(m.n);
  }
}
export function compileExpr(e: Expr): P {
  switch (e.k) {
    case 'sound': return s(compileMini(e.mini));
    case 'note': return note(compileMini(e.mini)).s(e.voice);
    case 'stack': return stack(...e.items.map(compileExpr));
    case 'set': {
      const child = compileExpr(e.child);
      switch (e.ctl) {
        case 'gain': return child.gain(e.value);
        case 'lpf': return child.lpf(e.value);
        case 'room': return child.room(e.value);
        case 'pan': return child.pan(e.value);
        case 'release': return child.release(e.value);
      }
    }
    case 'time': return e.op === 'fast' ? compileExpr(e.child).fast(e.value) : compileExpr(e.child).slow(e.value);
    case 'rev': return compileExpr(e.child).rev();
  }
}
export function compileDocument(doc: ClipDocument | ExprDocument): Pattern {
  return (doc.schemaVersion === 2 ? compileExpr(doc.root) : compile(doc.root)) as unknown as Pattern;
}
