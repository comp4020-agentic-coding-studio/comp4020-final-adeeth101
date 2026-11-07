// What an export renders and the file it makes, without a browser. The browser
// flow in spec/browser/creative.pw.ts renders a real file through the real engine.
import {describe,it,expect} from 'vitest';
import {EXPORT_LIMITS,TAIL_SECONDS,barsOf,encodeWav,exportPlan,fileBytes,fileName,refusal,secondsOf,sequenceBars,type ExportChoice} from '../shared/export.ts';
import {blankPlan,planAt,resolvePlan,sceneAt} from '../shared/performance.ts';
import {parseSource} from '../shared/expr.ts';
const sequence={entries:[{scene:'A' as const,bars:4},{scene:'B' as const,bars:2}],loop:true};
function base(){
  const p=blankPlan(),document=parseSource('s("bd")').document as never;
  p.catalog={one:{A:{revision:3,document}},two:{A:{revision:1,document}}};p.mix={one:{gain:.5,mute:false},two:{gain:.7,mute:true}};
  p.sceneAssignments.A={one:'A',two:'A'};p.sceneAssignments.B={one:null,two:'A'};p.effectiveCycle=40;p.planRevision=9;p.scene='B';p.manual={one:null};
  return p;
}
describe('the plan an export renders',()=>{
  it('starts at bar zero on the chosen section, whatever the stage is doing',()=>{
    const p=exportPlan({...base(),arrangement:{...sequence,startCycle:37}},{kind:'section',scene:'A',bars:8});
    expect(p).toMatchObject({effectiveCycle:0,planRevision:0,scene:'A',arrangement:null,manual:{}});
    expect(planAt([p],0)).toBe(p);expect(resolvePlan(p,0).map(x=>x.trackId)).toEqual(['one']);
  });
  it('follows the saved sequence from its first bar',()=>{
    const p=exportPlan(base(),{kind:'sequence',arrangement:sequence,repeats:2});
    expect(p.arrangement).toEqual({...sequence,startCycle:0});
    expect([0,3,4,5,6].map(c=>sceneAt(p,c))).toEqual(['A','A','B','B','A']);
    expect(resolvePlan(p,4)).toEqual([]);
  });
  it('is its own copy: changing the plan afterwards cannot reach the export',()=>{
    const live=base(),p=exportPlan(live,{kind:'section',scene:'A',bars:1});
    live.mix.one.gain=0;live.catalog.one.A!.revision=99;
    expect(p.mix.one.gain).toBe(.5);expect(p.catalog.one.A!.revision).toBe(3);
  });
  it('keeps the mix as it is: a muted track stays muted, levels are the shared ones',()=>{
    const p=exportPlan(base(),{kind:'section',scene:'A',bars:1}),heard=resolvePlan(p,0);
    expect(heard.map(x=>[x.trackId,x.gain])).toEqual([['one',.5]]);
  });
  it('counts bars for each choice',()=>{
    const pick=(c:ExportChoice)=>barsOf(c);
    expect(sequenceBars(sequence)).toBe(6);expect(pick({kind:'section',scene:'A',bars:8})).toBe(8);
    expect(pick({kind:'sequence',arrangement:sequence,repeats:3})).toBe(18);
    expect(pick({kind:'sequence',arrangement:{...sequence,loop:false},repeats:3})).toBe(6);
  });
});
describe('limits',()=>{
  it('refuses what is too long, too dense, or nothing at all, and says why',()=>{
    expect(refusal(8,120)).toBeNull();
    expect(refusal(0,120)).toMatch(/at least one/);expect(refusal(1.5,120)).toMatch(/at least one/);
    expect(refusal(EXPORT_LIMITS.maxBars+1,180)).toMatch(/at most 256 bars/);
    expect(refusal(200,60)).toMatch(/at most 240/);
    expect(refusal(8,120,EXPORT_LIMITS.maxEvents+1)).toMatch(/sounds/);
  });
  it('has a stated size, and the largest export stays well under what a phone can hold',()=>{
    expect(secondsOf(8,120)).toBe(16);
    expect(fileBytes(8,120)).toBe(44+(16+TAIL_SECONDS)*44100*4);
    expect(fileBytes(160,160)/1048576).toBeLessThan(45);
  });
});
describe('the file',()=>{
  const read=(b:ArrayBuffer)=>new DataView(b),text=(v:DataView,at:number,n:number)=>String.fromCharCode(...Array.from({length:n},(_,i)=>v.getUint8(at+i)));
  it('is a valid 16-bit stereo WAV with its samples interleaved',async()=>{
    const left=new Float32Array([0,1,-1,.5]),right=new Float32Array([.25,-.25,0,2]),v=read(await encodeWav([left,right],44100));
    expect(text(v,0,4)).toBe('RIFF');expect(text(v,8,4)).toBe('WAVE');expect(text(v,12,4)).toBe('fmt ');expect(text(v,36,4)).toBe('data');
    expect(v.getUint32(4,true)).toBe(36+16);expect(v.getUint16(20,true)).toBe(1);expect(v.getUint16(22,true)).toBe(2);expect(v.getUint32(24,true)).toBe(44100);expect(v.getUint32(28,true)).toBe(44100*4);expect(v.getUint16(32,true)).toBe(4);expect(v.getUint16(34,true)).toBe(16);expect(v.getUint32(40,true)).toBe(16);
    const at=(i:number)=>v.getInt16(44+i*2,true);
    expect([at(0),at(1),at(2),at(3),at(4),at(5)]).toEqual([0,8191,32767,-8192,-32768,0]);
    expect(at(7)).toBe(32767);
  });
  it('reports progress and yields while it writes',async()=>{
    const seen:number[]=[];let breaths=0;
    await encodeWav([new Float32Array(200000),new Float32Array(200000)],44100,f=>seen.push(f),async()=>{breaths++;});
    expect(seen.at(-1)).toBe(1);expect(breaths).toBeGreaterThan(1);expect([...seen].sort((a,b)=>a-b)).toEqual(seen);
  });
  it('gets a useful, safe name',()=>{
    expect(fileName('Velvet Parade!','A · Intro',120)).toBe('ensemble-velvet-parade-a-intro-120bpm.wav');
    expect(fileName('../../evil','sequence',96)).toBe('ensemble-evil-sequence-96bpm.wav');
    expect(fileName('日本語','sequence',96)).toBe('ensemble-mix-sequence-96bpm.wav');
  });
});
