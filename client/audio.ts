import { compileDocument } from '../shared/compile.ts';
import {cycleAt,planAt,resolvePlan,type Plan} from '../shared/performance.ts';
import type { AnyDocument } from '../shared/clip.ts';
import type {Pattern} from '@strudel/core';

export type AudioTrace = {cycle:number;serverMs:number;audioTime:number;sound:string;generation:number;trackId:string};
const DRUMS=['bd','sd','hh','cp'];
// Master trim, set by offline measurement (scripts/audio-proof.mjs): one preset
// at full device volume sits near -20 dBFS RMS, and twelve dense parts still
// stay under the limiter's ceiling. It is calibration, not a listening verdict.
const MASTER=1;
const WAVES=['sine','triangle','square','sawtooth'];
// Pattern queries use global cycles. The native WebAudio output implements
// exactly the vocabulary the expression grammar accepts: four drums, four
// waveforms, gain, low-pass filter, reverb send, stereo pan and release.
// Every voice passes a fixed master gain and a limiter, so no part or device
// volume can push the output past it.
export class StudioAudio {
  context:BaseAudioContext&{resume?:()=>Promise<void>;close?:()=>Promise<void>}|null=null;
  output:GainNode|null=null;
  private timer:ReturnType<typeof setInterval>|null=null;
  private voices = new Set<AudioScheduledSourceNode>();
  private noise:AudioBuffer|null=null;
  private cache=new Map<string,Pattern>();
  private cursor=0;
  private epoch=0;
  private bpm=120;
  private generation=0;
  private plans:Plan[]=[];
  private offset=0;
  private run=0;
  private dry:GainNode|null=null;
  private wet:GainNode|null=null;
  private solo=new Set<string>();
  private exclude=new Set<string>();
  private device=0.6;
  // The preview channel: one part on this device only, on its own loop.
  private preview:{pattern:Pattern;timer:ReturnType<typeof setInterval>;epoch:number;cursor:number;bpm:number}|null=null;
  trace:AudioTrace[]=[];
  stats={scheduled:0,late:0,resyncs:0,slowestTickMs:0};
  onError:(message:string)=>void=()=>{};
  onLag:(skipped:number)=>void=()=>{};
  onBeat:(trackId:string,at:number)=>void=()=>{};
  private lagReported=0;private lagCount=0;
  async prepare() {
    if(!this.context)this.build(new AudioContext());
    await this.context!.resume!();
    if(this.context!.state!=='running')throw new Error('Your browser kept sound off. Press Enable sound to try again.');
  }
  // The output chain, on a live or an offline context alike.
  private build(c:BaseAudioContext){
    {
      this.context=c;
      // Headroom: twelve parts at full volume sum far above 1, so the master
      // stays low and a limiter catches the rest.
      const master=this.output=c.createGain();master.gain.value=this.device*MASTER;
      const limiter=c.createDynamicsCompressor();limiter.threshold.value=-10;limiter.knee.value=6;limiter.ratio.value=20;limiter.attack.value=0.003;limiter.release.value=0.15;
      const ceiling=c.createGain();ceiling.gain.value=0.9;
      master.connect(limiter);limiter.connect(ceiling);ceiling.connect(c.destination);
      this.dry=c.createGain();this.dry.connect(master);
      const convolver=c.createConvolver();const impulse=c.createBuffer(2,c.sampleRate*1.6,c.sampleRate);
      let seed=1;const r=()=>{seed=(1664525*seed+1013904223)>>>0;return seed/4294967296*2-1;};
      for(let ch=0;ch<2;ch++){const data=impulse.getChannelData(ch);for(let i=0;i<data.length;i++)data[i]=r()*(1-i/data.length)**4;}
      convolver.buffer=impulse;convolver.connect(master);this.wet=c.createGain();this.wet.gain.value=0.6;this.wet.connect(convolver);
      this.noise=c.createBuffer(1,c.sampleRate,c.sampleRate);const data=this.noise.getChannelData(0);for(let i=0;i<data.length;i++)data[i]=r();
    }
  }
  // Renders whole bars of a plan offline through the same voices and output,
  // for measuring level and clipping without a speaker.
  async renderOffline(plans:Plan[],bpm:number,bars:number,device=1){
    const seconds=bars*240/bpm+2,c=new OfflineAudioContext(2,Math.ceil(44100*seconds),44100);
    const saved={context:this.context,output:this.output,dry:this.dry,wet:this.wet,noise:this.noise,device:this.device};
    this.device=device;this.build(c);
    try{
      for(let cycle=0;cycle<bars;cycle++){
        const p=planAt(plans,cycle);if(!p)continue;
        for(const x of resolvePlan(p,cycle)){const pattern=this.pattern(`offline:${x.trackId}:${x.slot}:${x.revision}`,x.document as AnyDocument);
          for(const hit of pattern.queryArc(cycle,cycle+1,{_cps:bpm/240}))if(hit.hasOnset())this.render(hit.value,Number(hit.whole.begin)*240/bpm+0.05,Number(hit.duration)*240/bpm,x.gain);}
      }
      return await c.startRendering();
    }finally{Object.assign(this,saved);this.voices.clear();}
  }
  get ready(){return this.context?.state==='running';}
  setOffset(offset:number){this.offset=offset;}
  setSolo(ids:Iterable<string>){this.solo=new Set(ids);}
  // While previewing a part, its shared version is left out on this device so
  // the two never double up.
  setExcluded(ids:Iterable<string>){this.exclude=new Set(ids);}
  setVolume(value:number){this.device=Math.max(0,Math.min(1,value));if(this.output)this.output.gain.value=this.device*MASTER;}
  update(plans:Plan[],epoch:number,bpm:number,generation:number){
    this.plans=plans;this.bpm=bpm;
    if(epoch!==this.epoch||generation!==this.generation){this.stopShared();this.epoch=epoch;this.generation=generation;}
  }
  startAt(){
    if(!this.ready)throw new Error('Enable sound first.');
    this.stopShared();
    this.cursor=Math.max(0,Math.ceil(cycleAt(Date.now()+this.offset+120,this.epoch,this.bpm)));
    this.timer=setInterval(()=>this.tick(),25);this.tick();
  }
  private pattern(key:string,doc:AnyDocument){let p=this.cache.get(key);if(!p){p=compileDocument(doc);if(this.cache.size>200)this.cache.clear();this.cache.set(key,p);}return p;}
  async previewDocument(doc:AnyDocument,bpm:number){
    const run=++this.run;await this.prepare();if(run!==this.run)return;
    this.stopPreview();const pattern=compileDocument(doc),epoch=Date.now()+this.offset+120;
    const state={pattern,epoch,cursor:0,bpm,timer:setInterval(()=>this.previewTick(),25)};this.preview=state;this.previewTick();
  }
  get previewing(){return this.preview!==null;}
  stopPreview(){if(this.preview){clearInterval(this.preview.timer);this.preview=null;}}
  stopShared(){if(this.timer)clearInterval(this.timer);this.timer=null;}
  // Silence everything now: scheduled voices are cut, not left to ring.
  stop(){this.run++;this.stopShared();this.stopPreview();for(const v of this.voices){try{v.stop();}catch{}}this.voices.clear();}
  get running(){return this.timer!==null;}
  private previewTick(){
    const p=this.preview;if(!p||!this.context)return;
    try{const now=Date.now()+this.offset,end=cycleAt(now+160,p.epoch,p.bpm);
      while(p.cursor<end){const begin=p.cursor,until=Math.min(end,Math.floor(begin+1e-8)+1);
        for(const hit of p.pattern.queryArc(begin,until,{_cps:p.bpm/240})){if(!hit.hasOnset())continue;const serverMs=p.epoch+Number(hit.whole.begin)*240000/p.bpm,t=this.context.currentTime+(serverMs-now)/1000;if(t<this.context.currentTime-0.005)continue;this.render(hit.value,Math.max(t,this.context.currentTime),Number(hit.duration)*240/p.bpm,1);}
        p.cursor=until;}
    }catch(e){this.stopPreview();this.onError(e instanceof Error?e.message:'Preview failed.');}
  }
  // How many onsets the current plan holds over a span of cycles, used to say
  // what a resync skipped.
  private onsetsBetween(from:number,to:number){
    if(!(to>from))return 0;
    let n=0;
    for(let cycle=Math.floor(from);cycle<to;cycle++){
      const p=planAt(this.plans,cycle);if(!p)continue;
      for(const x of resolvePlan(p,cycle).filter(x=>!this.exclude.has(x.trackId)&&(!this.solo.size||this.solo.has(x.trackId)))){
        const pattern=this.pattern(`${x.trackId}:${x.slot}:${x.revision}`,x.document as AnyDocument);
        n+=pattern.queryArc(Math.max(cycle,from),Math.min(cycle+1,to),{_cps:this.bpm/240}).filter(h=>h.hasOnset()).length;
      }
    }
    return n;
  }
  private tick(){
    const started=performance.now();
    try{
      const c=this.context!;const now=Date.now()+this.offset;
      const end=Math.max(0,cycleAt(now+160,this.epoch,this.bpm));
      if(this.cursor>=end)return;
      // More than half a bar behind: skip to the next bar rather than play the
      // past. What is skipped is counted, so the page can say so instead of
      // reporting nothing while a bar goes missing.
      const behind=cycleAt(now-500,this.epoch,this.bpm);
      if(behind>this.cursor){
        const skipped=this.onsetsBetween(this.cursor,Math.ceil(cycleAt(now+120,this.epoch,this.bpm)));
        this.cursor=Math.ceil(cycleAt(now+120,this.epoch,this.bpm));
        this.stats.late+=skipped;this.stats.resyncs++;this.lagCount+=skipped;return;
      }
      while(this.cursor<end){
        const begin=this.cursor, until=Math.min(end,Math.floor(begin+1e-8)+1);
        const p=planAt(this.plans,begin);
        // Clip revisions are immutable, so part+slot+revision names one pattern.
        const selected=p?resolvePlan(p,begin).filter(x=>!this.exclude.has(x.trackId)&&(!this.solo.size||this.solo.has(x.trackId))).map(x=>({trackId:x.trackId,pattern:this.pattern(`${x.trackId}:${x.slot}:${x.revision}`,x.document as AnyDocument),gain:x.gain})):[];
        for(const {trackId,pattern,gain} of selected){for(const hit of pattern.queryArc(begin,until,{_cps:this.bpm/240})){if(!hit.hasOnset())continue;
          const cycle=Number(hit.whole.begin), serverMs=this.epoch+cycle*240000/this.bpm;
          const t=c.currentTime+(serverMs-now)/1000;
          if(t<c.currentTime-0.005){this.stats.late++;this.lagCount++;continue;}
          this.render(hit.value,Math.max(t,c.currentTime),Number(hit.duration)*240/this.bpm,gain);
          this.onBeat(trackId,(Math.max(t,c.currentTime)-c.currentTime)*1000);
          this.stats.scheduled++;this.trace.push({cycle,serverMs,audioTime:t,sound:String(hit.value.s),generation:this.generation,trackId});if(this.trace.length>512)this.trace.shift();
        }}
        this.cursor=until;
      }
    }catch(e){this.stopShared();this.onError(e instanceof Error?e.message:'Audio scheduling failed.');}
    finally{
      this.stats.slowestTickMs=Math.max(this.stats.slowestTickMs,performance.now()-started);
      if(this.lagCount&&performance.now()-this.lagReported>2000){this.onLag(this.lagCount);this.lagCount=0;this.lagReported=performance.now();}
    }
  }
  private render(v:Record<string,any>,time:number,duration:number,partGain:number){
    const c=this.context!, sound=String(v.s??'');
    const drum=DRUMS.includes(sound);
    // Nothing unknown falls back to a default voice: the grammar never lets an
    // unknown sound through, and if one arrives it is skipped.
    if(!drum&&!WAVES.includes(sound))return;
    const gain=Math.min(1,Math.max(0,Number(v.gain??1)*partGain));
    if(gain<=0.0001)return;
    const env=c.createGain();
    const release=Number.isFinite(Number(v.release))?Math.min(4,Math.max(0.01,Number(v.release))):null;
    const hold=drum?({bd:0.26,sd:0.16,hh:0.05,cp:0.11}[sound]??0.1):Math.min(4,Math.max(0.05,duration*0.9));
    const tail=drum?0:release??0.06;
    const peak=Math.max(0.0001,gain*(drum?1:0.6));
    env.gain.setValueAtTime(0.0001,time);env.gain.exponentialRampToValueAtTime(peak,time+(drum?0.003:0.012));
    if(drum)env.gain.exponentialRampToValueAtTime(0.0001,time+hold);
    else{env.gain.setValueAtTime(peak,time+hold);env.gain.exponentialRampToValueAtTime(0.0001,time+hold+tail);}
    const end=time+hold+tail;
    const filter=c.createBiquadFilter();filter.type='lowpass';filter.frequency.value=Math.min(16000,Math.max(60,Number(v.cutoff??v.lpf??16000)));filter.Q.value=0.7;
    const pan=c.createStereoPanner();pan.pan.value=Number.isFinite(Number(v.pan))?Math.max(-1,Math.min(1,Number(v.pan)*2-1)):0;
    env.connect(filter);filter.connect(pan);pan.connect(this.dry!);
    const room=c.createGain();room.gain.value=Math.min(1,Math.max(0,Number(v.room??0)));pan.connect(room);room.connect(this.wet!);
    const nodes:AudioNode[]=[env,filter,pan,room];
    let source:AudioScheduledSourceNode;
    if(sound==='sd'||sound==='hh'||sound==='cp'){
      const noise=c.createBufferSource();noise.buffer=this.noise;const band=c.createBiquadFilter();band.type=sound==='hh'?'highpass':'bandpass';band.frequency.value=sound==='hh'?7000:sound==='sd'?1800:1200;band.Q.value=sound==='cp'?1.2:0.8;noise.connect(band);band.connect(env);source=noise;nodes.push(band);
      if(sound==='sd'){const body=c.createOscillator();body.type='triangle';body.frequency.setValueAtTime(190,time);body.frequency.exponentialRampToValueAtTime(140,time+0.08);const bg=c.createGain();bg.gain.setValueAtTime(0.5,time);bg.gain.exponentialRampToValueAtTime(0.001,time+0.1);body.connect(bg);bg.connect(env);body.start(time);body.stop(time+0.12);nodes.push(body,bg);}
    }else{
      const osc=c.createOscillator();osc.type=sound==='bd'?'sine':sound as OscillatorType;
      const note=Number(v.note);
      osc.frequency.setValueAtTime(sound==='bd'?150:440*2**(((Number.isFinite(note)?note:60)-69)/12),time);
      if(sound==='bd')osc.frequency.exponentialRampToValueAtTime(42,time+0.14);
      // Square and sawtooth are bright; a gentle fixed low-pass keeps them from biting.
      if(sound==='square'||sound==='sawtooth'){const soft=c.createBiquadFilter();soft.type='lowpass';soft.frequency.value=5200;osc.connect(soft);soft.connect(env);nodes.push(soft);}
      else osc.connect(env);
      source=osc;
    }
    this.voices.add(source);source.onended=()=>{this.voices.delete(source);for(const n of nodes)n.disconnect();source.disconnect();};source.start(time);source.stop(end+0.03);
  }
  async dispose(){this.stop();await this.context?.close?.();}
}
