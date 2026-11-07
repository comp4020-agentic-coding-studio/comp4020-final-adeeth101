// Export audio: renders the shared mix to a WAV in this browser. It takes one
// snapshot from the server first, then works only from that copy, on an engine of
// its own, so people can keep editing and playing while it runs and the file is
// never assembled from two versions. Nothing is uploaded.
import {request} from './api.ts';
import {esc,errorText} from './ui.ts';
import {compileDocument} from '../shared/compile.ts';
import {planAt,resolvePlan,SLOTS,type Plan,type Slot} from '../shared/performance.ts';
import {EXPORT_LIMITS,TAIL_SECONDS,barsOf,encodeWav,exportPlan,fileBytes,fileName,refusal,secondsOf,sequenceBars,type ExportChoice} from '../shared/export.ts';
import type {RoomSnapshot} from '../shared/studio.ts';
import type {AnyDocument} from '../shared/clip.ts';

const short=(name:string)=>name.replace(/^[A-D] · /,'');
const clock=(s:number)=>`${Math.floor(s/60)}:${String(Math.round(s%60)).padStart(2,'0')}`;
const megabytes=(n:number)=>`${(n/1048576).toFixed(1)} MB`;
// How many sounds a plan starts over these bars, before anything is rendered.
function countEvents(plan:Plan,bars:number){
  const cache=new Map<string,any>();let n=0;
  for(let cycle=0;cycle<bars;cycle++)for(const x of resolvePlan(planAt([plan],cycle)!,cycle)){
    const key=`${x.trackId}:${x.slot}:${x.revision}`;let pattern=cache.get(key);
    if(!pattern){pattern=compileDocument(x.document as AnyDocument);cache.set(key,pattern);}
    n+=pattern.queryArc(cycle,cycle+1).filter((h:any)=>h.hasOnset()).length;
  }
  return n;
}
export function openExport(state:RoomSnapshot){
  const names=state.settings.sceneNames,sequence=state.settings.arrangement;
  const d=document.createElement('dialog');d.className='confirm paper';d.setAttribute('aria-labelledby','export-title');
  const current=state.plans.at(-1)?.scene??'A';
  d.innerHTML=`<h2 id="export-title">Export audio</h2>
    <p class="small">Makes a WAV file of the shared mix, in this browser. It is rendered at full level, whatever your device volume is, and leaves out anything only you can hear, like Solo and previews. Everyone else keeps playing.</p>
    <form><fieldset class="vis"><legend class="sr-only">What to export</legend>
      <label class="radio"><input type="radio" name="what" value="section" checked> <strong>One section</strong></label>
      <div class="row" style="margin:0 0 8px 28px"><label for="export-scene" class="sr-only">Section</label><select id="export-scene">${SLOTS.map(s=>`<option value="${s}" ${s===current?'selected':''}>${esc(short(names[s]))}</option>`).join('')}</select><label for="export-bars">for</label><input id="export-bars" type="number" min="1" max="${EXPORT_LIMITS.maxBars}" value="8" style="width:90px"><span>bars</span></div>
      <label class="radio"><input type="radio" name="what" value="sequence"> <strong>The saved sequence</strong> <span class="small muted">${sequence.entries.map(e=>`${esc(short(names[e.scene]))} ${e.bars}`).join(' → ')}</span></label>
      ${sequence.loop?`<div class="row" style="margin:0 0 8px 28px"><label for="export-repeats">Play it</label><input id="export-repeats" type="number" min="1" max="16" value="1" style="width:90px"><span>time(s)</span></div>`:''}
    </fieldset>
    <p id="export-plan" class="small" role="status"></p>
    <div class="row"><button type="submit" class="primary" id="export-go">Render WAV</button><button type="button" class="ghost" data-close>Close</button></div></form>
    <div id="export-progress" hidden style="margin-top:12px"><label for="export-meter">Rendering</label><progress id="export-meter" max="1" value="0" style="width:100%"></progress><p id="export-state" class="small" role="status" aria-live="polite"></p><button type="button" class="outline small" data-cancel>Cancel</button></div>
    <div id="export-done" hidden style="margin-top:12px"></div>`;
  document.body.append(d);d.showModal();
  const form=d.querySelector('form')!,plan=d.querySelector<HTMLElement>('#export-plan')!,go=d.querySelector<HTMLButtonElement>('#export-go')!;
  let url:string|null=null,cancelled=false,busy=false;
  const choice=():ExportChoice=>{
    const what=new FormData(form).get('what');
    if(what==='sequence')return {kind:'sequence',arrangement:sequence,repeats:Math.max(1,Number(d.querySelector<HTMLInputElement>('#export-repeats')?.value??1)||1)};
    return {kind:'section',scene:d.querySelector<HTMLSelectElement>('#export-scene')!.value as Slot,bars:Math.floor(Number(d.querySelector<HTMLInputElement>('#export-bars')!.value))};
  };
  function describe(){
    const c=choice(),bars=barsOf(c),bpm=state.settings.bpm,why=refusal(bars,bpm);
    go.disabled=!!why||busy;
    plan.textContent=why??`${bars} bar${bars===1?'':'s'} at ${bpm} BPM: ${clock(secondsOf(bars,bpm))}, plus ${TAIL_SECONDS} s for the last notes to ring out. About ${megabytes(fileBytes(bars,bpm))}.${c.kind==='sequence'&&!sequence.loop?' The sequence plays once.':''}`;
  }
  form.addEventListener('input',describe);form.addEventListener('change',describe);describe();
  const done=()=>{if(url)URL.revokeObjectURL(url);d.remove();};
  d.addEventListener('close',done);
  d.addEventListener('click',e=>{
    const b=(e.target as HTMLElement).closest<HTMLElement>('button');if(!b)return;
    if(b.dataset.close!==undefined){cancelled=true;d.close();}
    if(b.dataset.cancel!==undefined){cancelled=true;d.querySelector('#export-state')!.textContent='Cancelling…';}
  });
  form.addEventListener('submit',e=>{e.preventDefault();void render();});
  async function render(){
    const c=choice(),bars=barsOf(c),progress=d.querySelector<HTMLElement>('#export-progress')!,meter=d.querySelector<HTMLProgressElement>('#export-meter')!,status=d.querySelector<HTMLElement>('#export-state')!,out=d.querySelector<HTMLElement>('#export-done')!;
    busy=true;cancelled=false;go.disabled=true;progress.hidden=false;out.hidden=true;meter.value=0;status.textContent='Taking a snapshot of the mix…';
    try{
      // One snapshot, read now: everything from here on uses this copy.
      const snapshot:RoomSnapshot=await request(`/api/projects/${state.id}`),bpm=snapshot.settings.bpm;
      const base=snapshot.plans.at(-1);if(!base)throw new Error('This mix has nothing to export yet.');
      const single=exportPlan(base,c),events=countEvents(single,bars),why=refusal(bars,bpm,events);
      if(why)throw new Error(why);
      if(!events)throw new Error('Nothing plays in this choice yet, so the file would be silent.');
      status.textContent=`Rendering ${events.toLocaleString()} sounds from mix revision ${snapshot.revision}.`;
      const {StudioAudio}=await import('./audio.ts');
      const buffer=await StudioAudio.render({plans:[single],bpm,bars,tailSeconds:TAIL_SECONDS,device:1,onProgress:f=>{meter.value=f*0.9;},cancelled:()=>cancelled});
      if(!buffer||cancelled){status.textContent='Cancelled. Nothing was saved.';return;}
      status.textContent='Writing the file…';
      const bytes=await encodeWav([buffer.getChannelData(0),buffer.getChannelData(1)],buffer.sampleRate,f=>{meter.value=0.9+f*0.1;},()=>new Promise(r=>setTimeout(r)));
      const name=fileName(snapshot.title,c.kind==='section'?short(snapshot.settings.sceneNames[c.scene]):'sequence',bpm);
      url=URL.createObjectURL(new Blob([bytes],{type:'audio/wav'}));meter.value=1;
      status.textContent=`Done. ${clock(buffer.duration)} from revision ${snapshot.revision}.`;
      out.hidden=false;out.innerHTML=`<a class="primary" id="export-link" href="${url}" download="${esc(name)}">Download ${esc(name)}</a> <span class="small">${megabytes(bytes.byteLength)}</span>`;
      d.querySelector<HTMLElement>('#export-link')!.focus();
    }catch(e){status.textContent=errorText(e);}
    finally{busy=false;describe();}
  }
  void sequenceBars;
}
