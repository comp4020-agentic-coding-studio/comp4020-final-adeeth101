// One audio engine per page, loaded on the first gesture that needs it. The
// page only claims sound is on once the browser has actually resumed audio.
import type {StudioAudio} from './audio.ts';
let engine:StudioAudio|null=null;
let loading:Promise<StudioAudio>|null=null;
let volume=0.6;
try{const v=Number(localStorage.getItem('ensemble-volume'));if(Number.isFinite(v)&&v>=0&&v<=1&&localStorage.getItem('ensemble-volume')!==null)volume=v;}catch{}
export const deviceVolume=()=>volume;
export function setDeviceVolume(v:number){volume=v;engine?.setVolume(v);try{localStorage.setItem('ensemble-volume',String(v));}catch{}}
export async function audio(){
  if(engine)return engine;
  loading??=import('./audio.ts').then(m=>{engine=new m.StudioAudio();engine.setVolume(volume);return engine;});
  return loading;
}
export const current=()=>engine;
// Called from a click or key press. Throws with a readable reason if the
// browser keeps audio suspended.
export async function enable(){const a=await audio();await a.prepare();return a;}
export const soundOn=()=>!!engine?.ready;
