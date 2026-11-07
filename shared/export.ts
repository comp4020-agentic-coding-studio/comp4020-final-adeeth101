// What an audio export renders, and the file it makes. Both are plain functions
// of their input, so a file can be checked without a browser.
import type {Plan,Slot} from './performance.ts';
import type {Arrangement} from './studio.ts';

export const EXPORT_LIMITS={maxSeconds:240,maxBars:256,maxEvents:60000,sampleRate:44100,minBars:1};
export type ExportChoice={kind:'section';scene:Slot;bars:number}|{kind:'sequence';arrangement:Arrangement;repeats:number};

export const sequenceBars=(a:Arrangement)=>a.entries.reduce((n,e)=>n+e.bars,0);
export function barsOf(choice:ExportChoice){return choice.kind==='section'?choice.bars:sequenceBars(choice.arrangement)*(choice.arrangement.loop?choice.repeats:1);}
export const secondsOf=(bars:number,bpm:number)=>bars*240/bpm;
// 16-bit stereo, plus the tail that lets the last notes and echoes ring out.
export const TAIL_SECONDS=2;
export const fileBytes=(bars:number,bpm:number)=>44+Math.ceil((secondsOf(bars,bpm)+TAIL_SECONDS)*EXPORT_LIMITS.sampleRate)*4;
export function refusal(bars:number,bpm:number,events?:number):string|null{
  if(!Number.isInteger(bars)||bars<EXPORT_LIMITS.minBars)return 'Choose at least one bar.';
  if(bars>EXPORT_LIMITS.maxBars)return `An export holds at most ${EXPORT_LIMITS.maxBars} bars.`;
  if(secondsOf(bars,bpm)>EXPORT_LIMITS.maxSeconds)return `That is ${Math.ceil(secondsOf(bars,bpm))} seconds; an export holds at most ${EXPORT_LIMITS.maxSeconds}. Use fewer bars.`;
  if(events!==undefined&&events>EXPORT_LIMITS.maxEvents)return `That is ${events.toLocaleString()} sounds; an export holds at most ${EXPORT_LIMITS.maxEvents.toLocaleString()}. Use fewer bars.`;
  return null;
}
// A self-contained plan from bar zero. It copies what the mix holds now, so edits
// made while it renders cannot reach it, and a manual section choice or a running
// sequence on the stage has no effect on it.
export function exportPlan(base:Plan,choice:ExportChoice):Plan{
  const p:Plan=structuredClone(base);
  p.effectiveCycle=0;p.planRevision=0;p.manual={};
  if(choice.kind==='section'){p.scene=choice.scene;p.arrangement=null;}
  else p.arrangement={entries:choice.arrangement.entries,loop:choice.arrangement.loop,startCycle:0};
  return p;
}
const slug=(s:string)=>s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,40)||'mix';
export const fileName=(title:string,what:string,bpm:number)=>`ensemble-${slug(title)}-${slug(what)}-${bpm}bpm.wav`;
// Interleaved 16-bit PCM in a RIFF container, written a slice at a time so a long
// file never blocks the page for long.
export async function encodeWav(channels:Float32Array[],sampleRate:number,progress?:(fraction:number)=>void,breathe:()=>Promise<void>=async()=>{}){
  const frames=channels[0].length,count=channels.length,bytes=frames*count*2;
  const out=new ArrayBuffer(44+bytes),view=new DataView(out);
  const text=(at:number,s:string)=>{for(let i=0;i<s.length;i++)view.setUint8(at+i,s.charCodeAt(i));};
  text(0,'RIFF');view.setUint32(4,36+bytes,true);text(8,'WAVE');text(12,'fmt ');view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,count,true);
  view.setUint32(24,sampleRate,true);view.setUint32(28,sampleRate*count*2,true);view.setUint16(32,count*2,true);view.setUint16(34,16,true);text(36,'data');view.setUint32(40,bytes,true);
  const slice=1<<16;let at=44;
  for(let start=0;start<frames;start+=slice){
    const end=Math.min(frames,start+slice);
    for(let i=start;i<end;i++)for(let c=0;c<count;c++){const v=Math.max(-1,Math.min(1,channels[c][i]));view.setInt16(at,v<0?v*32768:v*32767,true);at+=2;}
    progress?.(end/frames);await breathe();
  }
  return out;
}
