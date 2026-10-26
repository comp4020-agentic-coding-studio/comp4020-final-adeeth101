// The version 2 expression grammar (shared/expr.ts): what it accepts, what it
// refuses, that its bounds are exact before anything is expanded, and that the
// patterns it builds agree with Strudel 1.2.6's own mini-notation parser.
import {expect,it,describe} from 'vitest';
import {mini} from '@strudel/mini';
import * as core from '@strudel/core';
import {parseSource,parseMini,miniBounds,exprBounds,validateExpr,shapeState,applyShape,noteValue,LIMITS} from '../shared/expr.ts';
import {compileMini,compileExpr} from '../shared/compile.ts';
import {PACKS,PRESETS} from '../shared/presets.ts';

const s=(core as any).s,note=(core as any).note;
const onsets=(p:any,c0:number,c1:number)=>p.queryArc(c0,c1).filter((h:any)=>h.hasOnset()).map((h:any)=>`${Number(h.whole.begin).toFixed(5)}|${Number(h.whole.end).toFixed(5)}|${JSON.stringify(h.value)}`).sort();

describe('mini-notation',()=>{
  const drums=['bd ~ bd ~','hh*8','[~ hh]*4','bd ~ [~ bd] ~','bd sd!3','bd! sd','bd@3 sd','<bd sd> hh','<bd sd, hh cp cp>','[bd,hh] sd','bd*2 <sd cp>/2','<bd [sd sd]>*2','bd/3 sd','bd [sd [hh hh]] cp','<bd sd cp hh>/2'];
  it.each(drums)('%s builds the same events as Strudel’s mini()',src=>{
    expect(onsets(s(compileMini(parseMini(src,'sound'))),0,24)).toEqual(onsets(s(mini(src)),0,24));
  });
  it.each([...drums.map(d=>[d,'sound'] as const),...['33 ~ 33 40','[57,60,64] ~','<81 84 88 86>','[69 72] ~ 76 ~ <74 71> ~ 72 ~','<[57,60,64] [55,59,62]>','33*4 40*4'].map(n=>[n,'note'] as const)])('%s never exceeds its computed bound and repeats on its computed period',(src,kind)=>{
    const m=parseMini(src,kind),b=miniBounds(m),pat=compileMini(m);
    let most=0;for(let c=0;c<4*b.period+8;c++)most=Math.max(most,onsets(pat,c,c+1).length);
    expect(most).toBeLessThanOrEqual(b.onsets);
    const shift=(xs:string[],by:number)=>xs.map(x=>{const [a,e,v]=x.split('|');return `${(Number(a)-by).toFixed(5)}|${(Number(e)-by).toFixed(5)}|${v}`;}).sort();
    expect(shift(onsets(pat,b.period,2*b.period),b.period)).toEqual(onsets(pat,0,b.period));
  });
  it('reads note names as Strudel does (octave 3 when none is written)',()=>{
    expect(noteValue('a')).toBe(57);expect(noteValue('a3')).toBe(57);expect(noteValue('c4')).toBe(60);expect(noteValue('c#4')).toBe(61);expect(noteValue('eb2')).toBe(39);expect(noteValue('45')).toBe(45);
    expect(onsets(note(compileMini(parseMini('a3 c4 e4','note'))),0,1)).toEqual(onsets(note(mini('57 60 64')),0,1));
  });
  it('covers MIDI 24–96 for bass and melody and refuses outside it',()=>{
    expect(()=>parseSource('note("24 96").s("sine")')).not.toThrow();
    expect(()=>parseSource('note("23").s("sine")')).toThrow(/outside MIDI 24–96/);
    expect(()=>parseSource('note("97").s("sine")')).toThrow(/outside MIDI 24–96/);
  });
});

describe('the expression grammar',()=>{
  it('accepts the minimum editing contract and keeps the source verbatim elsewhere',()=>{
    const ok=['s("bd ~ sd ~")','note("a2 c3").s("triangle")','stack(s("bd*2"), note("60").s("square"))','s("hh*4").gain(0.5).lpf(3000).room(0.3).pan(0.25).release(0.2)','note("60 64").s("sawtooth").fast(2)','s("bd sd").slow(2).rev()',
      '// a comment\ns("bd")','/* block */ s("bd");','s(`bd ~ sd`)','note(`c3 e3`).s(`sine`)','s("bd").fast(0.5)','stack(s("bd"))'];
    for(const src of ok)expect(()=>parseSource(src),src).not.toThrow();
  });
  it.each([
    ['fetch("/api/me")','not supported'],['s("bd").constructor("alert(1)")()','plain method calls'],['s(`bd ${x}`)','cannot contain'],['s("bd")["rev"]()','plain method'],
    ['s("bd").gain(1/2)','plain number'],['s("bd"); alert(1)','one Strudel expression'],['const a=s("bd")','one Strudel expression'],['s("bd").fast(1.5)','0.25, 0.5'],
    ['note("60").s("kazoo")','Unknown synth'],['s("kick")','Unknown sound'],['note("60")','Give the notes a synth'],['s("bd").gain(2)','takes 0 to 1'],
    ['s("bd*17")','1 to 16'],['s("bd").lpf(-5)','plain number'],['s("bd").lpf(20)','takes 60 to 16000'],['s(...a)','plainly'],['s("bd")?.rev()','Only pattern calls'],['"bd"','not a bare string'],['s("bd?")','not supported'],
    ['s("bd(3,8)")','not supported'],['s("bd").every(2, x => x.rev())','not supported'],['s(1)','quoted pattern'],['window.s("bd")','goes straight after note'],['s("bd").fast(Infinity)','plain number'],
  ])('refuses %s',(src,why)=>{expect(()=>parseSource(src)).toThrow(new RegExp(why.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));});
  it('points at the character that failed',()=>{
    try{parseSource('note("60 ~ q").s("sine")');throw new Error('accepted');}catch(e){expect((e as Error).message).toMatch(/character 12/);}
  });
  it('bounds density, period, size and nesting before expansion',()=>{
    // 5×16 hits in one bar: refused by the computed bound, not by sampling.
    expect(()=>parseSource('s("hh*16 hh*16 hh*16 hh*16 hh*16")')).toThrow(/80 sounds in one bar/);
    expect(()=>parseSource('s("hh*16").fast(8)')).toThrow(/sounds in one bar/);
    // Alternation and slowing multiply the period; 7·9·11 bars is refused.
    expect(()=>parseSource('s("<bd bd bd bd bd bd bd> <sd sd sd sd sd sd sd sd sd> <hh hh hh hh hh hh hh hh hh hh hh>")')).toThrow(/repeats after 693 bars/);
    expect(()=>parseSource('s("bd/16").slow(8)')).toThrow(/repeats after 128 bars/);
    expect(()=>parseSource(`s("${'['.repeat(20)}bd${']'.repeat(20)}")`)).toThrow(/nested too deeply/);
    expect(()=>parseSource(`s("${'bd!16 '.repeat(80)}")`)).toThrow(/at most|more than/);
    expect(()=>parseSource(`s("bd")${'.rev()'.repeat(40)}`)).toThrow(/nested too deeply/);
    expect(()=>parseSource('s("bd") '+' '.repeat(9000))).toThrow(/8 KB/);
  });
  it('rejects a pathological source quickly',()=>{
    const started=performance.now();
    for(const src of [`s("${'<'.repeat(200)}")`,`s("${'bd*16 '.repeat(2000)}")`,'stack('.repeat(500),`note("${'[60,'.repeat(300)}")`])expect(()=>parseSource(src)).toThrow();
    expect(performance.now()-started).toBeLessThan(500);
  });
  it('validates documents that arrive over the network with the same bounds',()=>{
    const {document}=parseSource('stack(s("bd ~"), note("60").s("sine").gain(0.5))');
    expect(validateExpr(JSON.parse(JSON.stringify(document)))).toEqual(document);
    expect(()=>validateExpr({schemaVersion:2,root:{k:'sound',mini:{t:'word',v:'boom'}}})).toThrow();
    expect(()=>validateExpr({schemaVersion:2,root:{k:'set',ctl:'gain',value:5,child:document.root}})).toThrow();
    const dense={schemaVersion:2,root:{k:'time',op:'fast',value:8,child:{k:'sound',mini:{t:'fast',n:16,node:{t:'word',v:'bd'}}}}};
    expect(()=>validateExpr(dense)).toThrow(/sounds in one bar/);
  });
  it('computes bounds through stack, speed and controls',()=>{
    expect(exprBounds(parseSource('stack(s("hh*8"), s("bd sd")).fast(2)').document.root)).toEqual({onsets:20,period:1});
    expect(exprBounds(parseSource('note("<60 62 64>").s("sine").slow(2)').document.root)).toEqual({onsets:1,period:6});
    expect(exprBounds(parseSource('s("<bd sd>").fast(2)').document.root)).toEqual({onsets:2,period:1});
  });
});

describe('Shape edits only what it can keep',()=>{
  it('replaces an outer control in place and leaves the rest of the text alone',()=>{
    const src='note("60 ~ 64").s("triangle")  .lpf(850) /* warm */ .gain(0.48)';
    expect(applyShape(src,'lpf',1200)).toBe('note("60 ~ 64").s("triangle")  .lpf(1200) /* warm */ .gain(0.48)');
  });
  it('appends a control that is absent everywhere',()=>{expect(applyShape('s("bd sd")','room',0.3)).toBe('s("bd sd").room(0.3)');});
  it('declines a control set inside one layer, so a layer’s own balance is never overwritten',()=>{
    const src='stack(s("bd ~ bd ~"), s("hh*8").gain(0.16))';
    expect(shapeState(src,'gain')).toMatchObject({available:false});expect(()=>applyShape(src,'gain',0.5)).toThrow(/inside the pattern/);
    expect(shapeState(src,'lpf')).toMatchObject({available:true,value:null});
  });
});

describe('the factory catalogue',()=>{
  it('has 24 presets: three packs of eight, two per role, stable ids',()=>{
    expect(PACKS.map(p=>[p.id,p.suggestedBpm,p.presets.length])).toEqual([['warm-circuit',100,8],['pocket-arcade',120,8],['after-hours',80,8]]);
    for(const p of PACKS)for(const role of ['beats','bass','melody','texture'])expect(p.presets.filter(x=>x.role===role)).toHaveLength(2);
    expect(new Set(PRESETS.map(p=>p.id)).size).toBe(24);
    for(const p of PRESETS){expect(p.version).toBe(1);expect(p.key).toBe('A minor');expect(p.attribution).toMatch(/No Incredibox/);expect(p.macros).toContain('gain');}
  });
  it.each(PRESETS.map(p=>[p.id,p.source]))('%s parses, stays within bounds and makes sound for 16 bars',(_id,src)=>{
    const {document,bounds}=parseSource(src);expect(bounds.onsets).toBeLessThanOrEqual(LIMITS.onsetsPerCycle);
    const pat=compileExpr(document.root),events=pat.queryArc(0,16).filter((h:any)=>h.hasOnset());
    expect(events.length).toBeGreaterThan(0);
    for(const h of events){const v=h.value as any;expect(['bd','sd','hh','cp','sine','triangle','square','sawtooth']).toContain(v.s);if(v.note!==undefined){expect(v.note).toBeGreaterThanOrEqual(24);expect(v.note).toBeLessThanOrEqual(96);}if(v.pan!==undefined){expect(v.pan).toBeGreaterThanOrEqual(0);expect(v.pan).toBeLessThanOrEqual(1);}}
  });
  it('no two presets in a pack are the same pattern under another name',()=>{
    const sig=(src:string)=>JSON.stringify(compileExpr(parseSource(src).document.root).queryArc(0,4).filter((h:any)=>h.hasOnset()).map((h:any)=>[Number(h.whole.begin),h.value.s,h.value.note]));
    for(const p of PACKS)expect(new Set(p.presets.map(x=>sig(x.source))).size).toBe(8);
  });
});
