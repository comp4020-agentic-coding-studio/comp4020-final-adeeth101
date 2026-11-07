// Sections: an optional strip above the stage, built on the existing scenes and
// arrangement. A section is a named group of characters; a sequence is a list of
// sections with lengths in bars. Who plays where and what runs next all come from
// the shared plan, so everyone sees the same thing. Three states are kept apart in
// words: what is saved, what is queued for the next bar, and what is sounding.
import {esc,errorText,toast} from './ui.ts';
import {characterSvg} from './performer.ts';
import {defaultLook} from '../shared/look.ts';
import {SLOTS,cycleAt,planAt,sceneAt,type Plan,type Slot} from '../shared/performance.ts';
import type {Arrangement,RoomSnapshot,Part} from '../shared/studio.ts';

export type ArrangeHost={
  state:()=>RoomSnapshot;offset:()=>number;isHost:()=>boolean;online:()=>boolean;
  command:(type:string,payload:unknown,rev?:number)=>Promise<unknown>;
  // Starts the shared mix with the sequence, enabling sound on this device.
  run:()=>Promise<void>;
  // Local only: hears a section's characters without changing the mix.
  hear:(scene:Slot)=>Promise<boolean>;hearing:()=>Slot|null;
  rename:(scene:Slot,name:string)=>void;
};
const label=(name:string)=>name.replace(/^[A-D] · /,'');
const MAX_ENTRIES=8,MAX_BARS=16;

// Where a sequence is at a bar: which entry, how far in, and what follows.
export function position(a:NonNullable<Plan['arrangement']>,cycle:number){
  const total=a.entries.reduce((n,e)=>n+e.bars,0),raw=Math.floor(cycle-a.startCycle);
  if(raw<0)return null;
  const finished=!a.loop&&raw>=total;
  let at=finished?total-1:a.loop?raw%total:raw,index=0;
  for(;index<a.entries.length;index++){if(at<a.entries[index].bars)break;at-=a.entries[index].bars;}
  const entry=a.entries[Math.min(index,a.entries.length-1)];
  const nextIndex=index+1<a.entries.length?index+1:a.loop?0:null;
  return {index:Math.min(index,a.entries.length-1),bar:at+1,bars:entry.bars,scene:entry.scene,next:nextIndex===null?null:a.entries[nextIndex].scene,finished,barsLeft:entry.bars-at};
}

export class ArrangeStrip{
  private open:Slot|null=null;
  private key='';
  constructor(private root:HTMLElement,private host:ArrangeHost){
    root.addEventListener('click',e=>{const b=(e.target as HTMLElement).closest<HTMLElement>('[data-ar]');if(b&&root.contains(b))void this.act(b).catch(err=>toast(errorText(err)));});
    root.addEventListener('change',e=>{const s=(e.target as HTMLElement).closest<HTMLSelectElement>('#arrange-add');if(s?.value)void this.save(a=>{a.entries.push({scene:s.value as Slot,bars:4});}).catch(err=>toast(errorText(err)));});
  }
  private parts(){return this.host.state().parts.filter(p=>!p.archivedAt);}
  private plan(){return this.host.state().plans.at(-1);}
  private plays(p:Part,scene:Slot){const plan=this.plan();return !!plan&&plan.sceneAssignments[scene]?.[p.id]!==null&&plan.sceneAssignments[scene]?.[p.id]!==undefined;}
  private cycle(){const s=this.host.state();return s.transport.status==='playing'&&s.transport.epochMs?cycleAt(Date.now()+this.host.offset(),s.transport.epochMs,s.settings.bpm):0;}
  private nameOf(scene:Slot){return label(this.host.state().settings.sceneNames[scene]);}
  private async save(edit:(a:Arrangement)=>void){
    const a=structuredClone(this.host.state().settings.arrangement);edit(a);
    await this.host.command('arrangement.save',a);
  }
  // Refreshing must not take focus from a person using the strip, so it is only
  // redrawn when something it shows has changed, and focus is put back.
  render(force=false){
    if(this.root.hidden)return;
    const s=this.host.state(),plan=this.plan();
    const key=JSON.stringify([s.settings.arrangement,s.settings.sceneNames,this.parts().map(p=>[p.id,p.name,p.look]),plan?.sceneAssignments,plan?.arrangement,plan?.scene,s.transport.status,s.transport.hostId,s.you.id,this.open,this.host.hearing(),this.host.online()]);
    if(!force&&key===this.key){this.tick();return;}
    this.key=key;
    const active=document.activeElement as HTMLElement|null,focus=active&&this.root.contains(active)?(active.id?`#${CSS.escape(active.id)}`:active.dataset.ar?`[data-ar="${active.dataset.ar}"]${active.dataset.scene?`[data-scene="${active.dataset.scene}"]`:''}${active.dataset.i?`[data-i="${active.dataset.i}"]`:''}${active.dataset.id?`[data-id="${active.dataset.id}"]`:''}`:null):null;
    const host=this.host.isHost()&&this.host.online(),a=s.settings.arrangement,playing=s.transport.status==='playing',running=!!plan?.arrangement;
    const hostHint=host?'':` title="${esc(s.transport.hostHandle?`${s.transport.hostHandle} is hosting`:'Take the host role first')}"`;
    const total=a.entries.reduce((n,e)=>n+e.bars,0);
    const tiles=SLOTS.map(scene=>{
      const who=this.parts().filter(p=>this.plays(p,scene));
      return `<div class="section-tile" data-tile="${scene}"><div class="section-name"><span>${esc(this.nameOf(scene))}</span><span class="spacer"></span><button class="ghost tiny" data-ar="rename" data-scene="${scene}" ${host?'':'disabled'}${hostHint} aria-label="Rename ${esc(this.nameOf(scene))}">✎</button></div>
        <span class="section-who">${who.length?`${who.length} of ${this.parts().length} playing`:'Nobody yet'}</span>
        <div class="row"><button class="outline small" data-ar="launch" data-scene="${scene}" ${host?'':'disabled'}${hostHint} aria-label="Launch ${esc(this.nameOf(scene))}">Launch</button><button class="ghost small" data-ar="hear" data-scene="${scene}" aria-pressed="${this.host.hearing()===scene}" aria-label="${this.host.hearing()===scene?'Stop hearing':'Hear'} ${esc(this.nameOf(scene))} on my device">${this.host.hearing()===scene?'■':'▶'}</button><button class="ghost small" data-ar="who" data-scene="${scene}" aria-expanded="${this.open===scene}" aria-label="Who plays in ${esc(this.nameOf(scene))}">Who plays</button></div></div>`;
    }).join('');
    const picker=this.open?`<div class="who-picker" role="group" aria-label="Who plays in ${esc(this.nameOf(this.open))}"><strong class="small">${esc(this.nameOf(this.open))}:</strong>${this.parts().map(p=>{const on=this.plays(p,this.open!);return `<button class="who-chip" data-ar="toggle" data-id="${p.id}" aria-pressed="${on}" ${this.host.online()?'':'disabled'} aria-label="${esc(p.name)} ${on?'plays':'is silent'} in ${esc(this.nameOf(this.open!))}">${characterSvg(p.look??defaultLook(p.role,p.id))}${esc(p.name)}</button>`;}).join('')||'<span class="small muted">Add characters to the stage first.</span>'}</div>`:'';
    const timeline=a.entries.map((e,i)=>`<li data-entry="${i}"><span class="entry-name">${i+1}. ${esc(this.nameOf(e.scene))}</span><div class="entry-tools"><button class="ghost tiny" data-ar="bars" data-i="${i}" data-by="-1" ${host&&e.bars>1?'':'disabled'} aria-label="Fewer bars for step ${i+1}">−</button><span class="bars">${e.bars} bar${e.bars===1?'':'s'}</span><button class="ghost tiny" data-ar="bars" data-i="${i}" data-by="1" ${host&&e.bars<MAX_BARS?'':'disabled'} aria-label="More bars for step ${i+1}">+</button></div><div class="entry-tools"><button class="ghost tiny" data-ar="move" data-i="${i}" data-by="-1" ${host&&i>0?'':'disabled'} aria-label="Move step ${i+1} earlier">◀</button><button class="ghost tiny" data-ar="move" data-i="${i}" data-by="1" ${host&&i<a.entries.length-1?'':'disabled'} aria-label="Move step ${i+1} later">▶</button><button class="ghost tiny" data-ar="remove" data-i="${i}" ${host&&a.entries.length>1?'':'disabled'} aria-label="Remove step ${i+1}">✕</button></div></li>`).join('');
    const matches=!!plan?.arrangement&&JSON.stringify(plan.arrangement.entries)===JSON.stringify(a.entries)&&plan.arrangement.loop===a.loop;
    this.root.innerHTML=`<div class="arrange-head"><h2>Sections</h2><div class="now-next" id="now-next" role="status"></div><span class="spacer"></span>
        ${running?`<button class="primary small" data-ar="stop" ${host?'':'disabled'}${hostHint}>Stop sequence</button>`:`<button class="primary small" data-ar="run" ${host||!s.transport.hostId?'':'disabled'}${hostHint}>Run sequence</button>`}
      </div>
      <div class="section-tiles">${tiles}</div>${picker}
      <div class="row"><strong class="small">Sequence · ${total} bars</strong><label class="radio small" style="min-height:0"><input type="checkbox" id="arrange-loop" data-ar="loop" ${a.loop?'checked':''} ${host?'':'disabled'}> Loop</label>${a.entries.length<MAX_ENTRIES?`<label class="sr-only" for="arrange-add">Add a section to the sequence</label><select id="arrange-add" ${host?'':'disabled'}><option value="">Add a section…</option>${SLOTS.map(x=>`<option value="${x}">${esc(this.nameOf(x))}</option>`).join('')}</select>`:''}
        <span class="small muted">${!host?`Only the host changes the sequence. Anyone in the mix can choose who plays.`:running&&!matches?'Saved. The sequence playing now is the earlier version; run it again to use this one.':running?'Saved, and this is what is running.':playing?'Saved. Press Run sequence to start it at the next bar.':'Saved. Run sequence starts it from bar one.'}</span></div>
      <ol class="timeline" aria-label="Sequence">${timeline}</ol>`;
    if(focus)this.root.querySelector<HTMLElement>(focus)?.focus({preventScroll:true});
    this.tick();
  }
  // Only the words about now and next change with time.
  tick(){
    const el=this.root.querySelector<HTMLElement>('#now-next');if(!el||this.root.hidden)return;
    const s=this.host.state(),cycle=this.cycle(),plans=s.plans,now=planAt(plans,cycle),last=plans.at(-1);
    const words:string[]=[];let current:Slot|null=null,next:Slot|null=null;
    if(s.transport.status!=='playing'){const scene=last?.scene??'A';words.push(`Stopped · starts on <strong>${esc(this.nameOf(scene))}</strong>`);current=scene;}
    else if(now?.arrangement&&position(now.arrangement,cycle)){
      const p=position(now.arrangement,cycle)!;current=p.scene;next=p.next;
      words.push(`Sounding <strong>${esc(this.nameOf(p.scene))}</strong>${p.finished?' · sequence finished, holding here':` · bar ${p.bar} of ${p.bars}`}`);
      if(p.next)words.push(`Next <strong>${esc(this.nameOf(p.next))}</strong> in ${p.barsLeft} bar${p.barsLeft===1?'':'s'}`);
    }else{current=now?sceneAt(now,cycle):'A';words.push(`Sounding <strong>${esc(this.nameOf(current))}</strong> · manual`);}
    if(last&&last.effectiveCycle>cycle&&s.transport.status==='playing'){
      const was=now?sceneAt(now,cycle):null,will=sceneAt(last,last.effectiveCycle);
      if(!last.arrangement&&will!==was)words.push(`Queued <strong>${esc(this.nameOf(will))}</strong> at bar ${last.effectiveCycle+1}`);
      else if(last.arrangement&&!now?.arrangement)words.push(`Queued sequence at bar ${last.effectiveCycle+1}`);
    }
    if(el.dataset.words!==words.join('|')){el.dataset.words=words.join('|');el.innerHTML=words.map(w=>`<span>${w}</span>`).join('');}
    for(const tile of this.root.querySelectorAll<HTMLElement>('[data-tile]')){tile.classList.toggle('current',tile.dataset.tile===current);tile.classList.toggle('next',tile.dataset.tile===next);tile.classList.toggle('open',tile.dataset.tile===this.open);}
    const running=now?.arrangement?position(now.arrangement,cycle):null,same=now?.arrangement&&JSON.stringify(now.arrangement.entries)===JSON.stringify(s.settings.arrangement.entries);
    for(const li of this.root.querySelectorAll<HTMLElement>('[data-entry]'))li.classList.toggle('current',!!running&&!!same&&Number(li.dataset.entry)===running.index);
  }
  private async act(b:HTMLElement){
    const a=b.dataset.ar!,scene=b.dataset.scene as Slot,i=Number(b.dataset.i),by=Number(b.dataset.by);
    switch(a){
      case 'who':this.open=this.open===scene?null:scene;this.render(true);return;
      case 'toggle':{const p=this.parts().find(x=>x.id===b.dataset.id)!,on=this.plays(p,this.open!);await this.host.command('scene.assign',{trackId:p.id,scene:this.open,clipSlot:on?null:'A'});return;}
      case 'launch':await this.host.command('scene.launch',{scene});return;
      case 'hear':await this.host.hear(scene);this.render(true);return;
      case 'rename':this.host.rename(scene,this.nameOf(scene));return;
      case 'run':await this.host.run();return;
      case 'stop':await this.host.command('arrangement.stop',{});return;
      case 'loop':await this.save(x=>{x.loop=(b as HTMLInputElement).checked;});return;
      case 'bars':await this.save(x=>{x.entries[i].bars=Math.max(1,Math.min(MAX_BARS,x.entries[i].bars+by));});return;
      case 'move':await this.save(x=>{const [e]=x.entries.splice(i,1);x.entries.splice(i+by,0,e);});return;
      case 'remove':await this.save(x=>{x.entries.splice(i,1);});return;
    }
  }
}
