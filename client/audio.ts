import { compileDocument } from '../shared/compile.ts';
import {cycleAt,planAt,resolvePlan,type Plan} from '../shared/performance.ts';
import type { AnyDocument } from '../shared/clip.ts';
import type {Pattern} from '@strudel/core';

export type AudioTrace = {cycle:number;serverMs:number;audioTime:number;sound:string;generation:number;trackId:string};
// What an offline render needs, all of it plain data taken before rendering
// starts: nothing here reads the live engine or the page.
export type RenderSpec = {plans:Plan[];bpm:number;bars:number;tailSeconds?:number;device?:number;onProgress?:(fraction:number)=>void;cancelled?:()=>boolean};
export type PreviewItem = {document:AnyDocument;gain:number};
const DRUMS=new Set(['bd','sd','hh','cp','oh','rim','lt','ht','cb','sh']);
// How long each drum rings, in seconds.
const DRUM_HOLD:Record<string,number>={bd:0.26,sd:0.16,hh:0.05,cp:0.11,oh:0.34,rim:0.04,lt:0.3,ht:0.22,cb:0.2,sh:0.07};
// Master trim, set by offline measurement (scripts/audio-proof.mjs): one preset
// at full device volume sits near -20 dBFS RMS, and twelve dense parts still
// stay under the limiter's ceiling. It is calibration, not a listening verdict.
const MASTER=1;
const WAVES=['sine','triangle','square','sawtooth','supersaw','pulse'];
const SAMPLE_RATE=44100;
// Bars scheduled at a time in an offline render: enough to keep the renderer
// busy, few enough that a long export never holds every voice in memory at once.
const RENDER_CHUNK_BARS=4;
const clamp=(x:number,lo:number,hi:number)=>Math.min(hi,Math.max(lo,x));
const numberOr=(x:unknown,fallback:number|null)=>{const n=Number(x);return x!==undefined&&x!==null&&Number.isFinite(n)?n:fallback;};
// Pattern queries use global cycles. The native WebAudio output implements
// exactly the vocabulary the expression grammar accepts: ten synthesised drums,
// six voices, gain, low- and high-pass filters, an envelope, FM, a reverb send,
// an echo send and stereo pan. Every voice passes a fixed master gain and a
// limiter, so no part or device volume can push the output past it.
export class StudioAudio {
  context:BaseAudioContext&{resume?:()=>Promise<void>;close?:()=>Promise<void>}|null=null;
  output:GainNode|null=null;
  private timer:ReturnType<typeof setInterval>|null=null;
  private voices = new Set<AudioScheduledSourceNode>();
  private noise:AudioBuffer|null=null;
  private pulseWave:PeriodicWave|null=null;
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
  private echo:GainNode|null=null;
  private echoDelay:DelayNode|null=null;
  private solo=new Set<string>();
  private exclude=new Set<string>();
  private device=0.6;
  // The preview channel: parts on this device only, on their own loop or held
  // in step with the shared mix.
  private preview:{items:{pattern:Pattern;gain:number}[];timer:ReturnType<typeof setInterval>;epoch:number;cursor:number;bpm:number}|null=null;
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
    this.context=c;
    // Headroom: twelve parts at full volume sum far above 1, so the master
    // stays low and a limiter catches the rest.
    const master=this.output=c.createGain();master.gain.value=this.device*MASTER;
    const limiter=c.createDynamicsCompressor();limiter.threshold.value=-10;limiter.knee.value=6;limiter.ratio.value=20;limiter.attack.value=0.003;limiter.release.value=0.15;
    const ceiling=c.createGain();ceiling.gain.value=0.9;
    // The limiter's attack lets the very fastest peaks of a dense mix through.
    // This curve is exactly linear below 0.85 and bends above it, so normal
    // levels pass untouched and a sample can never reach full scale.
    const safety=c.createWaveShaper(),curve=new Float32Array(8193);
    for(let i=0;i<curve.length;i++){const x=i/4096-1,a=Math.abs(x);curve[i]=a<=0.85?x:Math.sign(x)*(0.85+0.13*Math.tanh((a-0.85)/0.13));}
    safety.curve=curve;
    master.connect(limiter);limiter.connect(ceiling);ceiling.connect(safety);safety.connect(c.destination);
    this.dry=c.createGain();this.dry.connect(master);
    const convolver=c.createConvolver();const impulse=c.createBuffer(2,c.sampleRate*1.6,c.sampleRate);
    let seed=1;const r=()=>{seed=(1664525*seed+1013904223)>>>0;return seed/4294967296*2-1;};
    for(let ch=0;ch<2;ch++){const data=impulse.getChannelData(ch);for(let i=0;i<data.length;i++)data[i]=r()*(1-i/data.length)**4;}
    convolver.buffer=impulse;convolver.connect(master);this.wet=c.createGain();this.wet.gain.value=0.6;this.wet.connect(convolver);
    // Echo: a dotted eighth of the current tempo, fed back at a fixed level.
    this.echo=c.createGain();this.echoDelay=c.createDelay(2);this.echoDelay.delayTime.value=this.echoSeconds();
    const feedback=c.createGain();feedback.gain.value=0.42;
    this.echo.connect(this.echoDelay);this.echoDelay.connect(feedback);feedback.connect(this.echoDelay);this.echoDelay.connect(master);
    this.noise=c.createBuffer(1,c.sampleRate,c.sampleRate);const data=this.noise.getChannelData(0);for(let i=0;i<data.length;i++)data[i]=r();
    // A narrow pulse, from its Fourier series: a 25% duty cycle.
    const harmonics=32,real=new Float32Array(harmonics),imag=new Float32Array(harmonics);
    for(let n=1;n<harmonics;n++)imag[n]=2/(n*Math.PI)*Math.sin(n*Math.PI*0.25);
    this.pulseWave=c.createPeriodicWave(real,imag);
  }
  private echoSeconds(){return 240/this.bpm*3/16;}
  // Renders a plan on an engine of its own. The live engine, its context, its
  // scheduler and its device volume are never touched, so an export cannot stop
  // or change what this person, or anyone else, is hearing.
  static render(spec:RenderSpec){return new StudioAudio().renderIsolated(spec);}
  private async renderIsolated({plans,bpm,bars,tailSeconds=2,device=1,onProgress,cancelled}:RenderSpec):Promise<AudioBuffer|null>{
    const seconds=bars*240/bpm+tailSeconds,c=new OfflineAudioContext(2,Math.ceil(SAMPLE_RATE*seconds),SAMPLE_RATE);
    this.bpm=bpm;this.device=device;this.build(c);
    const start=0.05;
    const schedule=(from:number,to:number)=>{
      for(let cycle=from;cycle<Math.min(to,bars);cycle++){
        const p=planAt(plans,cycle);if(!p)continue;
        for(const x of resolvePlan(p,cycle)){
          const pattern=this.pattern(`offline:${x.trackId}:${x.slot}:${x.revision}`,x.document as AnyDocument);
          for(const hit of pattern.queryArc(cycle,cycle+1,{_cps:bpm/240}))if(hit.hasOnset())this.render(hit.value,Number(hit.whole.begin)*240/bpm+start,Number(hit.duration)*240/bpm,x.gain);
        }
      }
    };
    schedule(0,RENDER_CHUNK_BARS);
    let stopped=false;
    const ticks:Promise<void>[]=[];
    for(let bar=RENDER_CHUNK_BARS;bar<bars;bar+=RENDER_CHUNK_BARS){
      // Each chunk is queued shortly before the render reaches it.
      const at=Math.max(0,bar*240/bpm+start-0.2);
      ticks.push(c.suspend(at).then(()=>{
        onProgress?.(bar/bars);
        if(cancelled?.()){stopped=true;return;}
        schedule(bar,bar+RENDER_CHUNK_BARS);return c.resume();
      }));
    }
    const rendered=c.startRendering();
    // A cancelled render is simply never resumed; its context is dropped.
    const result=await Promise.race([rendered,(async()=>{await Promise.all(ticks);return stopped?null:rendered;})()]);
    if(!result)return null;
    onProgress?.(1);
    return result;
  }
  // Whole bars of a plan through the real voices and output, for measuring level
  // and clipping without a speaker.
  async renderOffline(plans:Plan[],bpm:number,bars:number,device=1){return (await StudioAudio.render({plans,bpm,bars,device}))!;}
  get ready(){return this.context?.state==='running';}
  setOffset(offset:number){this.offset=offset;}
  setSolo(ids:Iterable<string>){this.solo=new Set(ids);}
  // While previewing a part, its shared version is left out on this device so
  // the two never double up.
  setExcluded(ids:Iterable<string>){this.exclude=new Set(ids);}
  setVolume(value:number){this.device=Math.max(0,Math.min(1,value));if(this.output)this.output.gain.value=this.device*MASTER;}
  update(plans:Plan[],epoch:number,bpm:number,generation:number){
    this.plans=plans;this.bpm=bpm;if(this.echoDelay)this.echoDelay.delayTime.value=this.echoSeconds();
    if(epoch!==this.epoch||generation!==this.generation){this.stopShared();this.epoch=epoch;this.generation=generation;}
  }
  startAt(){
    if(!this.ready)throw new Error('Enable sound first.');
    this.stopShared();
    this.cursor=Math.max(0,Math.ceil(cycleAt(Date.now()+this.offset+120,this.epoch,this.bpm)));
    this.timer=setInterval(()=>this.tick(),25);this.tick();
  }
  private pattern(key:string,doc:AnyDocument){let p=this.cache.get(key);if(!p){p=compileDocument(doc);if(this.cache.size>200)this.cache.clear();this.cache.set(key,p);}return p;}
  async previewDocument(doc:AnyDocument,bpm:number,inStep=false){return this.previewItems([{document:doc,gain:1}],bpm,inStep);}
  // inStep holds the preview on the shared clock, so a change can be heard
  // against the running mix; otherwise it loops on its own from now.
  async previewItems(items:PreviewItem[],bpm:number,inStep=false){
    const run=++this.run;await this.prepare();if(run!==this.run)return;
    this.stopPreview();
    const compiled=items.map(x=>({pattern:compileDocument(x.document),gain:x.gain}));
    const now=Date.now()+this.offset,aligned=inStep&&this.running;
    const epoch=aligned?this.epoch:now+120,cursor=aligned?Math.max(0,cycleAt(now+120,epoch,bpm)):0;
    if(this.echoDelay&&!aligned){this.bpm=bpm;this.echoDelay.delayTime.value=this.echoSeconds();}
    const state={items:compiled,epoch,cursor,bpm,timer:setInterval(()=>this.previewTick(),25)};this.preview=state;this.previewTick();
  }
  // Swaps what a running preview plays without moving its clock, so editing
  // while listening never restarts the loop.
  updatePreview(items:PreviewItem[]){if(this.preview)this.preview.items=items.map(x=>({pattern:compileDocument(x.document),gain:x.gain}));}
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
        for(const {pattern,gain} of p.items)for(const hit of pattern.queryArc(begin,until,{_cps:p.bpm/240})){if(!hit.hasOnset())continue;const serverMs=p.epoch+Number(hit.whole.begin)*240000/p.bpm,t=this.context.currentTime+(serverMs-now)/1000;if(t<this.context.currentTime-0.005)continue;this.render(hit.value,Math.max(t,this.context.currentTime),Number(hit.duration)*240/p.bpm,gain);}
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
  // A noise burst through one filter, into the voice's envelope.
  private noiseInto(env:GainNode,type:BiquadFilterType,frequency:number,q:number,nodes:AudioNode[]){
    const c=this.context!,noise=c.createBufferSource();noise.buffer=this.noise;
    const band=c.createBiquadFilter();band.type=type;band.frequency.value=frequency;band.Q.value=q;
    noise.connect(band);band.connect(env);nodes.push(band);return noise;
  }
  private drum(sound:string,time:number,env:GainNode,nodes:AudioNode[],extra:AudioScheduledSourceNode[]):AudioScheduledSourceNode{
    const c=this.context!;
    const sweep=(from:number,to:number,seconds:number,wave:OscillatorType='sine')=>{const osc=c.createOscillator();osc.type=wave;osc.frequency.setValueAtTime(from,time);osc.frequency.exponentialRampToValueAtTime(to,time+seconds);osc.connect(env);return osc;};
    switch(sound){
      case 'bd':return sweep(150,42,0.14);
      case 'hh':return this.noiseInto(env,'highpass',7000,0.8,nodes);
      case 'oh':return this.noiseInto(env,'highpass',6000,0.8,nodes);
      case 'cp':return this.noiseInto(env,'bandpass',1200,1.2,nodes);
      case 'sh':return this.noiseInto(env,'bandpass',6200,0.7,nodes);
      case 'sd':{
        const body=c.createOscillator();body.type='triangle';body.frequency.setValueAtTime(190,time);body.frequency.exponentialRampToValueAtTime(140,time+0.08);
        const level=c.createGain();level.gain.setValueAtTime(0.5,time);level.gain.exponentialRampToValueAtTime(0.001,time+0.1);body.connect(level);level.connect(env);body.start(time);body.stop(time+0.12);nodes.push(body,level);
        return this.noiseInto(env,'bandpass',1800,0.8,nodes);
      }
      case 'rim':{const click=this.noiseInto(env,'bandpass',2600,3,nodes);const tone=sweep(1700,900,0.02,'triangle');extra.push(tone);return click;}
      case 'lt':return sweep(130,72,0.2);
      case 'ht':return sweep(230,140,0.16);
      case 'cb':{
        // Two detuned square partials through a narrow band.
        const band=c.createBiquadFilter();band.type='bandpass';band.frequency.value=900;band.Q.value=2.4;band.connect(env);nodes.push(band);
        const partial=(f:number)=>{const osc=c.createOscillator();osc.type='square';osc.frequency.value=f;osc.connect(band);return osc;};
        extra.push(partial(800));return partial(540);
      }
      default:return sweep(150,42,0.14);
    }
  }
  private synth(sound:string,v:Record<string,any>,time:number,env:GainNode,nodes:AudioNode[],extra:AudioScheduledSourceNode[]):AudioScheduledSourceNode{
    const c=this.context!,note=Number(v.note),frequency=440*2**(((Number.isFinite(note)?note:60)-69)/12);
    // Square, sawtooth and their relatives are bright; a gentle fixed low-pass
    // keeps them from biting.
    let into:AudioNode=env;
    if(sound!=='sine'&&sound!=='triangle'){const soft=c.createBiquadFilter();soft.type='lowpass';soft.frequency.value=5200;soft.connect(env);nodes.push(soft);into=soft;}
    const oscillator=(detune=0,wave:OscillatorType=sound==='supersaw'?'sawtooth':sound as OscillatorType)=>{
      const osc=c.createOscillator();
      if(sound==='pulse'&&this.pulseWave)osc.setPeriodicWave(this.pulseWave);else osc.type=wave;
      osc.frequency.setValueAtTime(frequency,time);if(detune)osc.detune.value=detune;return osc;
    };
    const fm=numberOr(v.fmi,null);
    const modulate=(osc:OscillatorNode)=>{
      if(!fm)return;
      const ratio=numberOr(v.fmh,1)!,mod=c.createOscillator(),depth=c.createGain();
      mod.frequency.value=frequency*ratio;depth.gain.value=fm*frequency*ratio;mod.connect(depth);depth.connect(osc.frequency);nodes.push(depth);extra.push(mod);
    };
    if(sound==='supersaw'){
      const blend=c.createGain();blend.gain.value=0.46;blend.connect(into);nodes.push(blend);
      const main=oscillator();main.connect(blend);modulate(main);
      for(const cents of [-13,13]){const side=oscillator(cents);side.connect(blend);extra.push(side);}
      return main;
    }
    const osc=oscillator();osc.connect(into);modulate(osc);return osc;
  }
  private render(v:Record<string,any>,time:number,duration:number,partGain:number){
    const c=this.context!, sound=String(v.s??'');
    const drum=DRUMS.has(sound);
    // Nothing unknown falls back to a default voice: the grammar never lets an
    // unknown sound through, and if one arrives it is skipped.
    if(!drum&&!WAVES.includes(sound))return;
    const gain=Math.min(1,Math.max(0,Number(v.gain??1)*partGain));
    if(gain<=0.0001)return;
    const env=c.createGain();
    const release=numberOr(v.release,null),attack=clamp(numberOr(v.attack,drum?0.003:0.012)!,0.001,4);
    const decay=numberOr(v.decay,null),sustain=numberOr(v.sustain,null);
    const hold=drum?(DRUM_HOLD[sound]??0.1):Math.min(4,Math.max(0.05,duration*0.9,attack+0.01));
    const tail=drum?0:release===null?0.06:clamp(release,0.01,4);
    const peak=Math.max(0.0001,gain*(drum?1:0.6));
    env.gain.setValueAtTime(0.0001,time);env.gain.exponentialRampToValueAtTime(peak,time+attack);
    if(drum)env.gain.exponentialRampToValueAtTime(0.0001,time+hold);
    else{
      // Decay falls to the sustain level inside the note, then the note holds
      // there; with neither set, the note holds at its peak as it always has.
      const level=decay!==null||sustain!==null?Math.max(0.0001,peak*(sustain??1)):peak;
      if(level!==peak)env.gain.exponentialRampToValueAtTime(level,Math.min(time+hold,time+attack+(decay??0.1)));
      env.gain.setValueAtTime(level,time+hold);env.gain.exponentialRampToValueAtTime(0.0001,time+hold+tail);
    }
    const end=time+hold+tail;
    const filter=c.createBiquadFilter();filter.type='lowpass';filter.frequency.value=Math.min(16000,Math.max(60,Number(v.cutoff??v.lpf??16000)));filter.Q.value=0.7;
    const pan=c.createStereoPanner();pan.pan.value=Number.isFinite(Number(v.pan))?Math.max(-1,Math.min(1,Number(v.pan)*2-1)):0;
    env.connect(filter);
    const nodes:AudioNode[]=[env,filter,pan];
    const high=numberOr(v.hcutoff,null);
    if(high!==null){const hp=c.createBiquadFilter();hp.type='highpass';hp.frequency.value=clamp(high,20,8000);hp.Q.value=0.7;filter.connect(hp);hp.connect(pan);nodes.push(hp);}
    else filter.connect(pan);
    pan.connect(this.dry!);
    const room=c.createGain();room.gain.value=Math.min(1,Math.max(0,Number(v.room??0)));pan.connect(room);room.connect(this.wet!);nodes.push(room);
    const echo=numberOr(v.delay,0)!;
    if(echo>0&&this.echo){const send=c.createGain();send.gain.value=Math.min(1,echo);pan.connect(send);send.connect(this.echo);nodes.push(send);}
    const extra:AudioScheduledSourceNode[]=[];
    const source=drum?this.drum(sound,time,env,nodes,extra):this.synth(sound,v,time,env,nodes,extra);
    this.voices.add(source);
    source.onended=()=>{this.voices.delete(source);for(const n of nodes)n.disconnect();source.disconnect();for(const x of extra)x.disconnect();};
    for(const x of extra){x.start(time);x.stop(end+0.03);}
    source.start(time);source.stop(end+0.03);
  }
  async dispose(){this.stop();await this.context?.close?.();}
}
