// The step editor is a view of the source, not a second pattern. These tests
// hold the promises that make that true: reading changes nothing, an edit touches
// only what was edited, unsupported notation survives exactly, and what the grid
// writes sounds the same as what it read, according to Strudel 1.2.6 itself.
import {describe,it,expect} from 'vitest';
import {parseSource} from '../shared/expr.ts';
import {compileDocument} from '../shared/compile.ts';
import {PRESETS} from '../shared/presets.ts';
import {readPattern,writeLane,scaled,toggleHit,toggleNote,setVoice,setBars,canSetBars,addLayer,removeLayer,unrolledCopy,limitations,viewColumns,kitRows,noteName,swapToken} from '../shared/steps.ts';

// Every onset of a source over some bars, as Strudel computes it. A drum's length
// is fixed by its sound, not its step, so length counts only for notes.
function onsets(source:string,bars=16){
  const pattern=compileDocument(parseSource(source).document) as any;
  return pattern.queryArc(0,bars).filter((h:any)=>h.hasOnset()).map((h:any)=>`${Number(h.whole.begin).toFixed(6)}|${h.value.note===undefined?'':Number(h.duration).toFixed(6)}|${h.value.s}|${h.value.note??''}|${h.value.gain??''}`).sort();
}
const lane=(source:string,i=0)=>readPattern(source).lanes[i];

describe('reading',()=>{
  it('reads flat steps, rests, repeats, subdivisions, chords and weights exactly',()=>{
    expect(lane('s("bd ~ sd ~")').events).toEqual([{col:0,len:1,tokens:['bd']},{col:2,len:1,tokens:['sd']}]);
    expect(lane('s("hh*8")').columns).toBe(8);
    expect(lane('s("hh*8")').events).toHaveLength(8);
    const sub=lane('s("bd ~ [~ bd] ~")');expect(sub.columns).toBe(8);expect(sub.events.map(e=>e.col)).toEqual([0,5]);
    const chord=lane('note("[a3,c4,e4] ~").s("sine")');expect(chord.columns).toBe(2);expect(chord.events[0].tokens).toEqual([57,60,64]);
    const held=lane('note("c3@2 ~ e3").s("sine")');expect(held.columns).toBe(4);expect(held.events).toEqual([{col:0,len:2,tokens:[48]},{col:3,len:1,tokens:[52]}]);
    expect(lane('s("bd!3 sd")').events.map(e=>e.col)).toEqual([0,1,2,3]);
    expect(lane('s("bd ! sd")').events.map(e=>e.tokens[0])).toEqual(['bd','bd','sd']);
  });
  it('knows how long a layer is from the code around it',()=>{
    expect(lane('note("a3 c4").s("sine").slow(2)').bars).toBe(2);
    expect(lane('stack(s("bd"),s("hh")).slow(2)',1).bars).toBe(2);
    expect(lane('s("bd sd").fast(2)').bars).toBe(0.5);
    expect(lane('note("<a3 c4 e4>").s("sine")').alternates).toBe(true);
  });
  it('locks what it cannot show, says why, and keeps its time',()=>{
    const l=lane('note("[69 72] ~ 76 ~ <74 71> ~ 72 ~").s("sine")');
    expect(l.columns).toBe(16);expect(l.locked).toEqual([{col:8,len:2,text:'<74 71>',reason:'This step changes each bar.'}]);
    expect(lane('s("bd/2 sd")').locked[0].reason).toMatch(/several bars/);
    expect(lane('s("[bd sd, hh hh hh] ~")').locked[0].reason).toMatch(/layers/);
    expect(lane('s("bd*2, hh*4")').problem).toMatch(/commas/);
    expect(limitations(readPattern('s("<bd sd> hh")')).join(' ')).toMatch(/changes each bar.*stay exactly as written/);
    expect(limitations(readPattern('s("bd sd").rev()')).join(' ')).toMatch(/backwards/);
  });
  it('refuses nothing silently: more than 32 steps is a stated problem, not a truncation',()=>{
    const l=lane(`s("${Array.from({length:40},()=>'bd').join(' ')}")`);expect(l.problem).toMatch(/40 steps/);
    expect(()=>writeLane('s("bd")',{...l},8,[])).toThrow();
  });
  it('throws on invalid source, so Code stays the place that explains it',()=>{
    expect(()=>readPattern('note("a1").s("kazoo")')).toThrow(/Unknown synth/);
  });
});

describe('source stays faithful',()=>{
  it('an unedited grid writes back the same characters',()=>{
    for(const p of PRESETS){const v=readPattern(p.source);for(const l of v.lanes){if(l.problem)continue;expect(writeLane(p.source,l,l.columns,l.events)).toBe(p.source);}}
  });
  it('viewing at a finer resolution changes nothing until a step is edited',()=>{
    const source='s("bd ~ sd ~")',l=lane(source),view=scaled(l,16);
    expect(view.events.map(e=>e.col)).toEqual([0,8]);expect(writeLane(source,l,16,view.events)).toBe(source);
  });
  it('an edit touches only the piece it changes: comments, spacing and effects survive',()=>{
    const source='// my groove\nstack( s("bd  ~  [~ bd]  ~") , s("~ sd").room(0.3) ).gain(0.9) ;';
    const l=lane(source),next=writeLane(source,l,l.columns,toggleHit(l.events,l.locked,0,'bd'));
    expect(next).toBe('// my groove\nstack( s("~  ~  [~ bd]  ~") , s("~ sd").room(0.3) ).gain(0.9) ;');
  });
  it('a locked step keeps its exact text through edits around it',()=>{
    const source='note("[69 72] ~ 76 ~ <74 71> ~ 72 ~").s("sine").room(0.15).gain(0.3)',l=lane(source);
    const next=writeLane(source,l,l.columns*1,toggleNote(l.events,l.locked,l.columns,6,76));
    expect(next).toContain('<74 71>');expect(next).toContain('.room(0.15).gain(0.3)');
    expect(()=>toggleNote(l.events,l.locked,l.columns,l.locked[0].col,60)).toThrow(/locked/);
    expect(()=>toggleHit(l.events,l.locked,l.locked[0].col,60)).toThrow(/locked/);
  });
  it('expands a repeat only where a person edited it, and the rest of the bar stays compact',()=>{
    const source='note("33*4 40*4").s("sawtooth")',l=lane(source);
    const next=writeLane(source,l,l.columns,toggleNote(l.events,l.locked,l.columns,5,40));
    expect(next).toBe('note("33*4 [40 ~ 40 40]").s("sawtooth")');
    expect(writeLane('s("hh*8")',lane('s("hh*8")'),8,toggleHit(lane('s("hh*8")').events,[],3,'hh'))).toBe('s("hh hh hh ~ hh hh hh hh")');
  });
  it('keeps the number or name style of the notes already there',()=>{
    const names='note("a3 ~ ~ ~").s("sine")',digits='note("57 ~ ~ ~").s("sine")';
    expect(writeLane(names,lane(names),4,toggleNote(lane(names).events,[],4,2,60))).toBe('note("a3 ~ c4 ~").s("sine")');
    expect(writeLane(digits,lane(digits),4,toggleNote(lane(digits).events,[],4,2,60))).toBe('note("57 ~ 60 ~").s("sine")');
  });
  it('writes a new drum pattern and a new melody from nothing',()=>{
    let drums='s("~ ~ ~ ~ ~ ~ ~ ~")';
    for(const [col,hit] of [[0,'bd'],[4,'sd'],[2,'hh'],[6,'hh']] as const){const l=lane(drums);drums=writeLane(drums,l,8,toggleHit(l.events,l.locked,col,hit));}
    expect(drums).toBe('s("bd ~ hh ~ sd ~ hh ~")');
    let tune='note("~ ~ ~ ~ ~ ~ ~ ~").s("triangle")';
    for(const [col,midi,len] of [[0,57,2],[2,60,1],[4,64,4]] as const){const l=lane(tune);tune=writeLane(tune,l,8,toggleNote(l.events,l.locked,8,col,midi,len));}
    expect(tune).toBe('note("a3@2 c4 ~ e4@4").s("triangle")');
    expect(onsets(tune,1)).toHaveLength(3);
  });
  it('builds chords in one step, and a long note trims what was ringing',()=>{
    let s='note("a3@4 ~ ~ ~ ~").s("sine")';let l=lane(s);
    const placed=toggleNote(l.events,l.locked,l.columns,2,60);
    expect(placed.find(e=>e.col===0)!.len).toBe(2);
    s=writeLane(s,l,l.columns,placed);expect(s).toBe('note("a3@2 c4 ~ ~ ~ ~ ~").s("sine")');
    l=lane(s);s=writeLane(s,l,l.columns,toggleNote(l.events,l.locked,l.columns,2,64));
    expect(lane(s).events.find(e=>e.tokens.length===2)?.tokens).toEqual([60,64]);
  });
  it('removes a note from anywhere along its length',()=>{
    const s='note("a3@4 ~ ~ ~ ~").s("sine")',l=lane(s);
    expect(toggleNote(l.events,l.locked,l.columns,3,57)).toEqual([]);
  });
  it('refuses a change that would break the density bound and leaves the source alone',()=>{
    const source=`stack(${Array.from({length:8},()=>`s("${Array.from({length:8},()=>'hh').join(' ')}")`).join(',')})`;
    const l=lane(source),more=[...scaled(l,16).events,{col:1,len:1,tokens:['hh']}];
    expect(()=>writeLane(source,l,16,more)).toThrow(/limit is 64/);
  });
});

describe('what the grid writes sounds the same',()=>{
  it.each(PRESETS.map(p=>[p.id,p.source]))('%s: rewriting every step leaves every onset unchanged',(_id,source)=>{
    let next=source;
    for(const l0 of readPattern(source).lanes){
      const l=readPattern(next).lanes[l0.index];if(l.problem)continue;
      next=writeLane(next,l,l.columns,l.events,true);
    }
    parseSource(next);expect(onsets(next)).toEqual(onsets(source));
  });
  it('lengthening repeats the pattern and is inaudible',()=>{
    for(const source of ['s("bd ~ sd ~")','note("a3 c4 e4 ~").s("sine").gain(0.5)','stack(s("bd sd"),s("hh*4")).room(0.2)']){
      const l=lane(source),next=setBars(source,l,2);
      expect(onsets(next)).toEqual(onsets(source));
      if(source.startsWith('s('))expect(next).toBe('s("bd ~ sd ~ bd ~ sd ~").slow(2)');
      expect(setBars(next,lane(next),1)).toBe(source);
    }
  });
  it('states when a length cannot be changed, instead of guessing',()=>{
    expect(canSetBars(lane('s("bd sd").fast(2)'),2)).toMatch(/fast/);
    expect(canSetBars(lane('note("<a3 c4>").s("sine")'),2)).toMatch(/one step per bar/);
    expect(()=>setBars('s("bd sd").fast(2)',lane('s("bd sd").fast(2)'),2)).toThrow();
    expect(canSetBars(lane('stack(s("bd")).slow(2)'),1)).toMatch(/stretched/);
  });
  it('makes an explicit editable copy of alternation without changing the sound',()=>{
    for(const source of ['note("[69 72] ~ 76 ~ <74 71> ~ 72 ~").s("sine").room(0.15).gain(0.3)','note("<33 36 38 40> ~").s("triangle")','note("<[57,60,64] [55,59,62]>").s("sine").slow(2).gain(0.1)']){
      const copy=unrolledCopy(source);
      expect(copy.changed).toBe(true);expect(onsets(copy.source,32)).toEqual(onsets(source,32));
      expect(lane(copy.source).locked).toEqual([]);
    }
  });
});

describe('changing sounds and layers',()=>{
  it('changes only the synth name',()=>{
    const s='note("a3").s("triangle").gain(0.2)';expect(setVoice(s,lane(s),'supersaw')).toBe('note("a3").s("supersaw").gain(0.2)');
    expect(()=>setVoice('s("bd")',lane('s("bd")'),'sine')).toThrow(/no synth/);
  });
  it('moves a kit row to another drum',()=>{
    const s='s("hh ~ hh hh")',l=lane(s);
    expect(writeLane(s,l,l.columns,swapToken(l.events,'hh','oh'))).toBe('s("oh ~ oh oh")');
  });
  it('adds and removes layers around the existing text',()=>{
    expect(addLayer('s("bd sd")','sound',4)).toBe('stack(s("bd sd"), s("~ ~ ~ ~"))');
    const stacked=addLayer('stack(s("bd"), s("hh")).gain(0.5)','note',4);
    expect(stacked).toBe('stack(s("bd"), s("hh"), note("~ ~ ~ ~").s("triangle")).gain(0.5)');
    expect(removeLayer(stacked,lane(stacked,2))).toBe('stack(s("bd"), s("hh")).gain(0.5)');
    expect(removeLayer(stacked,lane(stacked,0))).toBe('stack(s("hh"), note("~ ~ ~ ~").s("triangle")).gain(0.5)');
    expect(()=>removeLayer('s("bd")',lane('s("bd")'))).toThrow(/at least one/);
  });
  it('lists one kit row per drum a layer plays',()=>{
    expect(kitRows(readPattern('stack(s("bd ~"),s("hh oh hh oh"))')).map(r=>r.token)).toEqual(['bd','hh','oh']);
  });
  it('names notes the way the grammar reads them',()=>{
    expect(noteName(57)).toBe('a3');expect(noteName(61)).toBe('c#4');expect(parseSource(`note("${noteName(61)}").s("sine")`)).toBeTruthy();
  });
  it('picks a grid no finer than asked for, unless the text needs it',()=>{
    expect(viewColumns(lane('s("bd sd bd sd")'),16)).toBe(16);
    expect(viewColumns(lane('s("[bd bd bd] sd")'),16)).toBe(18);
    expect(viewColumns(lane('note("<a3 c4 e4>").s("sine")'),16)).toBe(3);
  });
});

describe('the cast suits the grid',()=>{
  const view=PRESETS.map(p=>({p,v:readPattern(p.source)}));
  it('every character shows on the grid, and almost none has a locked step',()=>{
    for(const {p,v} of view)expect(v.problem,p.id).toBeNull();
    const fully=view.filter(({v})=>v.lanes.every(l=>!l.problem&&!l.locked.length));
    expect(fully.length/view.length).toBeGreaterThan(0.95);
  });
  it('every character added in catalogue version 2 is written step by step',()=>{
    for(const {p,v} of view.slice(24))for(const l of v.lanes){expect(l.locked,p.id).toEqual([]);expect(l.alternates,p.id).toBe(false);}
  });
});
