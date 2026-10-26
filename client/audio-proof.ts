import {StudioAudio} from './audio.ts';
import {parseCode} from '../shared/code.ts';
import {parseSource} from '../shared/expr.ts';
import {blankPlan,type Plan} from '../shared/performance.ts';
import {PRESETS,PACKS} from '../shared/presets.ts';
const audio=new StudioAudio();
type Level={id:string;bpm:number;peak:number;peakDb:number;rmsDb:number;clipped:number};
const global=window as unknown as {studioAudio:StudioAudio;testAudio:(epoch:number,source?:string)=>Promise<void>;presetIds:string[];renderPreset:(ids:string|string[])=>Promise<Level>};
global.studioAudio=audio;
global.presetIds=PRESETS.map(p=>p.id);
function planOf(ids:string[]):Plan{
  const plan=blankPlan();
  for(const id of ids){const p=PRESETS.find(x=>x.id===id)!;plan.catalog[id]={A:{revision:1,document:parseSource(p.source).document as never}};plan.sceneAssignments.A[id]='A';plan.mix[id]={gain:0.7,mute:false};}
  return plan;
}
// A legacy tree by default; a preset id or any expression source for version 2.
global.testAudio=async(epoch,source)=>{
  await audio.prepare();const plan=blankPlan();
  const preset=PRESETS.find(p=>p.id===source);
  const document=source?parseSource(preset?.source??source).document:parseCode('note("60 ~ 64 ~").s("triangle")');
  plan.catalog.t={A:{revision:1,document:document as never}};plan.sceneAssignments.A.t='A';audio.update([plan],epoch,120,1);audio.startAt();
};
// Two bars at the first preset's pack tempo, at full device volume and the
// default part level, through the real output chain.
global.renderPreset=async(ids)=>{
  const list=Array.isArray(ids)?ids:[ids],bpm=PACKS.find(p=>p.presets.some(x=>x.id===list[0]))!.suggestedBpm;
  const buffer=await audio.renderOffline([planOf(list)],bpm,4,1);
  let peak=0,sum=0,clipped=0,n=0;
  for(let ch=0;ch<buffer.numberOfChannels;ch++){const d=buffer.getChannelData(ch);for(let i=0;i<d.length;i++){const v=Math.abs(d[i]);if(v>peak)peak=v;if(v>=0.999)clipped++;sum+=d[i]*d[i];n++;}}
  const db=(x:number)=>Math.round(20*Math.log10(Math.max(x,1e-9))*10)/10;
  return {id:list.length>1?`${list.length} parts`:list[0],bpm,peak:Math.round(peak*1000)/1000,peakDb:db(peak),rmsDb:db(Math.sqrt(sum/n)),clipped};
};
