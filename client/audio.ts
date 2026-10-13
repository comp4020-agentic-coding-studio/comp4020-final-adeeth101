import { compile } from '../shared/compile.ts';
import {cycleAt,planAt,resolvePlan,type Plan} from '../shared/performance.ts';
import type { MusicNode } from '../shared/music.ts';
import type {Pattern} from '@strudel/core';

export type AudioTrace = {cycle:number;serverMs:number;audioTime:number;sound:string;generation:number};
// Pattern queries use global cycles. The native WebAudio output is deliberately
// bounded to the same sounds/effects as the validated Strudel vocabulary.
export class StudioAudio {
  context:AudioContext|null=null;
  output:GainNode|null=null;
  private timer:ReturnType<typeof setInterval>|null=null;
  private voices = new Set<AudioScheduledSourceNode>();
  private noise:AudioBuffer|null=null;
  private cache=new Map<string,Pattern>();
  private cursor=0;
  private preview=false;
  private epoch=0;
  private bpm=120;
  private generation=0;
  private plans:Plan[]=[];
  private previewPattern:Pattern|null=null;
  private offset=0;
  private run=0;
  private dry:GainNode|null=null;
  private wet:GainNode|null=null;
  private solo=new Set<string>();
  trace:AudioTrace[]=[];
  onError:(message:string)=>void=()=>{};
  async prepare() {
    if(!this.context){
      const c=this.context=new AudioContext();
      const master=this.output=c.createGain();master.gain.value=0.18;
      const limiter=c.createDynamicsCompressor();limiter.threshold.value=-12;limiter.ratio.value=12;
      master.connect(limiter);limiter.connect(c.destination);
      this.dry=c.createGain();this.dry.connect(master);
      const convolver=c.createConvolver();const impulse=c.createBuffer(2,c.sampleRate*0.4,c.sampleRate);
      let seed=1;const r=()=>{seed=(1664525*seed+1013904223)>>>0;return seed/4294967296*2-1;};
      for(let ch=0;ch<2;ch++){const data=impulse.getChannelData(ch);for(let i=0;i<data.length;i++)data[i]=r()*(1-i/data.length)**3;}
      convolver.buffer=impulse;convolver.connect(master);this.wet=c.createGain();this.wet.connect(convolver);
      this.noise=c.createBuffer(1,c.sampleRate,c.sampleRate);const data=this.noise.getChannelData(0);for(let i=0;i<data.length;i++)data[i]=r();
    }
    await this.context.resume();
    if(this.context.state!=='running')throw new Error('Audio is suspended. Enable sound again.');
  }
  setOffset(offset:number){this.offset=offset;}
  // Solo is a listening aid on this device only; the shared mix is unchanged.
  setSolo(ids:Iterable<string>){this.solo=new Set(ids);}
  setVolume(value:number){if(this.output)this.output.gain.value=Math.max(0,Math.min(1,value))*0.3;}
  update(plans:Plan[],epoch:number,bpm:number,generation:number){
    this.plans=plans;this.bpm=bpm;
    if(epoch!==this.epoch||generation!==this.generation){this.stop();this.epoch=epoch;this.generation=generation;}
  }
  startAt(){
    if(!this.context||this.context.state!=='running')throw new Error('Enable sound first.');
    this.stop();this.preview=false;
    this.cursor=Math.max(0,Math.ceil(cycleAt(Date.now()+this.offset+120,this.epoch,this.bpm)));
    this.timer=setInterval(()=>this.tick(),25);this.tick();
  }
  async previewNode(node:MusicNode){
    const run=++this.run;await this.prepare();if(run!==this.run)return;
    this.stop();this.preview=true;this.epoch=Date.now()+this.offset+150;this.bpm=120;this.cursor=0;this.previewPattern=compile(node);
    this.timer=setInterval(()=>this.tick(),25);this.tick();
  }
  async audition(sound:string,note=60){await this.prepare();this.render({s:sound,note},this.context!.currentTime+0.02,0.18);}
  stop(){
    this.run++;if(this.timer)clearInterval(this.timer);this.timer=null;
    for(const v of this.voices){try{v.stop();}catch{}}this.voices.clear();this.preview=false;
  }
  get running(){return this.timer!==null;}
  private tick(){
    try{
      const c=this.context!;const now=Date.now()+this.offset;
      const end=Math.max(0,cycleAt(now+160,this.epoch,this.bpm));
      if(this.cursor>=end)return;
      if(cycleAt(now-500,this.epoch,this.bpm)>this.cursor){this.cursor=Math.ceil(cycleAt(now+120,this.epoch,this.bpm));return;}
      while(this.cursor<end){
        const begin=this.cursor, until=Math.min(end,Math.floor(begin+1e-8)+1);
        const p=planAt(this.plans,begin);
        const selected=this.preview&&this.previewPattern?[{pattern:this.previewPattern,gain:0.7}]:p?resolvePlan(p,begin).filter(x=>!this.solo.size||this.solo.has(x.trackId)).map(x=>{
          const key=JSON.stringify(x.document);let pattern=this.cache.get(key);if(!pattern){pattern=compile(x.document.root);if(this.cache.size>100)this.cache.clear();this.cache.set(key,pattern);}return {pattern,gain:x.gain};
        }):[];
        for(const {pattern,gain} of selected){for(const hit of pattern.queryArc(begin,until,{_cps:this.bpm/240}).sort((a,b)=>Number(a.whole.begin)-Number(b.whole.begin))){if(!hit.hasOnset())continue;
          const cycle=Number(hit.whole.begin), serverMs=this.epoch+cycle*240000/this.bpm;
          const t=c.currentTime+(serverMs-now)/1000;
          if(t<c.currentTime-0.005)continue;
          const value:Record<string,any>={...hit.value,gain:Number(hit.value.gain??1)*gain};
          this.render(value,Math.max(t,c.currentTime),Number(hit.duration)*240/this.bpm);
          this.trace.push({cycle,serverMs,audioTime:t,sound:String(value.s),generation:this.generation});if(this.trace.length>256)this.trace.shift();
        }}
        this.cursor=until;
      }
    }catch(e){this.stop();this.onError(e instanceof Error?e.message:'Audio scheduling failed.');}
  }
  private render(v:Record<string,any>,time:number,duration:number){
    const c=this.context!, sound=String(v.s??'triangle');
    const env=c.createGain();const gain=Math.min(1,Math.max(0,Number(v.gain??0.7)));
    const length=['bd','sd','hh','cp'].includes(sound)?({bd:0.24,sd:0.14,hh:0.05,cp:0.1}[sound]??0.1):Math.min(2,Math.max(0.06,duration*0.85));
    env.gain.setValueAtTime(0.0001,time);env.gain.exponentialRampToValueAtTime(Math.max(0.0001,gain),time+0.006);env.gain.exponentialRampToValueAtTime(0.0001,time+length);
    const filter=c.createBiquadFilter();filter.type='lowpass';filter.frequency.value=Math.min(12000,Number(v.cutoff??v.lpf??12000));env.connect(filter);filter.connect(this.dry!);
    const room=c.createGain();room.gain.value=Math.min(0.5,Number(v.room??0));filter.connect(room);room.connect(this.wet!);
    let source:AudioScheduledSourceNode;
    if(['sd','hh','cp'].includes(sound)){
      const noise=c.createBufferSource();noise.buffer=this.noise;const high=c.createBiquadFilter();high.type='highpass';high.frequency.value=sound==='hh'?6500:1400;noise.connect(high);high.connect(env);source=noise;
    }else{
      const osc=c.createOscillator();osc.type=sound==='bd'?'sine':['sine','triangle','square','sawtooth'].includes(sound)?sound as OscillatorType:'triangle';
      osc.frequency.setValueAtTime(sound==='bd'?150:440*2**((Number(v.note??60)-69)/12),time);
      if(sound==='bd')osc.frequency.exponentialRampToValueAtTime(45,time+0.12);osc.connect(env);source=osc;
    }
    this.voices.add(source);source.onended=()=>{this.voices.delete(source);source.disconnect();env.disconnect();filter.disconnect();room.disconnect();};source.start(time);source.stop(time+length+0.02);
  }
  async dispose(){this.stop();await this.context?.close();}
}
