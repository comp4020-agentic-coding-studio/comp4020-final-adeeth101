// The step editor for one character: drum lanes and a note grid, drawn from the
// source and writing back to it through shared/steps.ts. It holds no music of its
// own. Its only state is how the grid is being looked at, so a person can move
// between this and Code freely and nothing changes until they place a step.
import {esc} from './ui.ts';
import {DRUMS,VOICES,ExprError,type Voice} from '../shared/expr.ts';
import {readPattern,writeLane,scaled,toggleHit,toggleNote,hasToken,viewColumns,kitRows,limitations,setVoice,setBars,canSetBars,addLayer,removeLayer,swapToken,unrolledCopy,noteName,MAX_PATTERN_COLUMNS,type Lane,type PatternView} from '../shared/steps.ts';

export const DRUM_LABEL:Record<string,string>={bd:'Kick',sd:'Snare',hh:'Hat',oh:'Open hat',cp:'Clap',rim:'Rim',lt:'Low tom',ht:'High tom',cb:'Cowbell',sh:'Shaker'};
export const VOICE_LABEL:Record<Voice,string>={sine:'Sine · soft',triangle:'Triangle · round',square:'Square · hollow',sawtooth:'Saw · bright',supersaw:'Supersaw · wide',pulse:'Pulse · nasal'};
const SCALE=new Set([9,11,0,2,4,5,7]);   // A minor, as pitch classes
const LOWEST=24,HIGHEST=96;
export type PatternHost={
  source:()=>string;
  change:(next:string)=>void;
  editable:()=>boolean;
  readOnlyReason?:()=>string;
  // A separate copy, only ever made because a person pressed the button.
  makeCopy?:(source:string)=>void;
  gotoCode?:()=>void;
};
type Row={lane:number;token:string;virtual:boolean};

export class PatternEditor{
  private target=16;
  private noteLane=0;
  private base:number|null=null;       // lowest note on screen; null follows the music
  private scaleOnly=true;
  private brush=1;
  private spare:string[]=[];           // drum rows offered before they have a hit
  private undo:string[]=[];
  private message='';
  private cursor={row:0,col:0,lane:'kit'};
  constructor(private root:HTMLElement,private host:PatternHost){
    root.addEventListener('click',e=>{
      const target=e.target as HTMLElement,cell=target.closest<HTMLElement>('.cell');
      if(cell&&root.contains(cell)){this.toggle(cell);return;}
      const el=target.closest<HTMLElement>('button[data-pe]');if(el&&root.contains(el))this.act(el);
    });
    root.addEventListener('change',e=>{const el=(e.target as HTMLElement).closest<HTMLSelectElement>('select[data-pe]');if(el&&root.contains(el))this.select(el);});
    root.addEventListener('keydown',e=>this.key(e));
    root.addEventListener('focusin',e=>{const c=(e.target as HTMLElement).closest<HTMLElement>('.cell');if(c)this.cursor={row:Number(c.dataset.r),col:Number(c.dataset.c),lane:c.dataset.grid!};});
  }
  // A different character: forget its undo history and how it was being viewed.
  reset(){this.undo=[];this.spare=[];this.base=null;this.noteLane=0;this.message='';this.cursor={row:0,col:0,lane:'kit'};}
  private view():PatternView|null{try{return readPattern(this.host.source());}catch{return null;}}
  private columns(l:Lane){return viewColumns(l,Math.min(MAX_PATTERN_COLUMNS,this.target*Math.max(1,l.bars)));}
  private commit(next:string,before=this.host.source()){
    if(next===before)return;
    this.undo.push(before);if(this.undo.length>60)this.undo.shift();
    this.message='';this.host.change(next);this.render();
  }
  private guard(fn:()=>void){
    if(!this.host.editable()){this.say(this.host.readOnlyReason?.()??'This character can’t be edited right now.');return;}
    try{fn();}catch(e){this.say(e instanceof ExprError||e instanceof Error?e.message:'That change could not be made.');}
  }
  private say(text:string){this.message=text;const el=this.root.querySelector('.pe-message');if(el)el.textContent=text;}
  // Rows of the kit: every drum a lane plays, then any offered but not yet placed.
  private rows(view:PatternView):Row[]{
    const real=kitRows(view).map(r=>({...r,virtual:false}));
    // An empty kit offers the usual four, and keeps offering them after the first
    // hit: placing a kick must not take the snare row away.
    if(view.lanes.some(l=>l.kind==='sound')&&!real.length)this.spare.push('bd','sd','hh','cp');
    const extra=this.spare.filter((t,i,a)=>a.indexOf(t)===i&&!real.some(r=>r.token===t));
    return [...real,...extra.map(token=>({lane:-1,token,virtual:true}))];
  }
  render(){
    const view=this.view();
    if(!view){this.root.innerHTML=`<div class="pattern"><p class="lanes-note">The grid reads this character’s code, and the code has a mistake right now, so there is nothing to show. Your text is safe. <button class="ghost small" data-pe="code">Fix it in Code</button></p></div>`;return;}
    const kit=view.lanes.filter(l=>l.kind==='sound'),notes=view.lanes.filter(l=>l.kind==='note');
    const limits=limitations(view),canEdit=this.host.editable();
    const copy=this.host.makeCopy?unrolledCopy(this.host.source()):{source:'',changed:false};
    this.root.innerHTML=`<div class="pattern">
      ${limits.length?`<div class="lanes-note"><strong>Some of this is code-only.</strong><ul>${limits.map(x=>`<li>${esc(x)}</li>`).join('')}</ul>${copy.changed?`<button class="outline small" data-pe="copy">Make an editable copy</button> <span class="small">A new track with the same sound, written as plain steps. This one stays as it is.</span>`:''}</div>`:''}
      ${canEdit?'':`<p class="lanes-note">${esc(this.host.readOnlyReason?.()??'You can look, but not change this right now.')}</p>`}
      <div class="pattern-tools"><div><label id="pe-steps">Steps per bar</label><div class="seg" role="group" aria-labelledby="pe-steps">${[8,16].map(n=>`<button type="button" data-pe="target" data-n="${n}" aria-pressed="${this.target===n}">${n}</button>`).join('')}</div></div>
      <span class="spacer"></span><button type="button" class="ghost small" data-pe="undo" ${this.undo.length&&canEdit?'':'disabled'}>Undo step</button></div>
      ${kit.length?this.kitHtml(view,kit):''}
      ${notes.length?this.notesHtml(view,notes):''}
      <div class="row"><button type="button" class="outline small" data-pe="add-sound" ${canEdit?'':'disabled'}>Add drum layer</button><button type="button" class="outline small" data-pe="add-note" ${canEdit?'':'disabled'}>Add notes layer</button></div>
      <p class="pe-message small" role="status" aria-live="polite">${esc(this.message)}</p>
    </div>`;
    this.restoreRoving();
  }
  private beatClass(col:number,cols:number,bars:number){
    const perBar=cols/Math.max(1,bars),perBeat=perBar/4;
    return (Number.isInteger(perBar)&&col%perBar===0&&col>0?' bar':'')+(Number.isInteger(perBeat)&&col%perBeat===0?' beat':'');
  }
  private lengthHtml(lanes:Lane[],kind:string){
    const bars=[...new Set(lanes.map(l=>l.bars))],current=bars.length===1?bars[0]:null;
    const options=[1,2,4].filter(b=>lanes.every(l=>l.bars===b||canSetBars(l,b)===null));
    const why=lanes.map(l=>canSetBars(l,l.bars===1?2:1)).find(Boolean);
    if(options.length<2)return why?`<span class="small muted">${esc(why)}</span>`:'';
    return `<div><label id="pe-len-${kind}">Length</label><div class="seg" role="group" aria-labelledby="pe-len-${kind}">${options.map(b=>`<button type="button" data-pe="bars" data-kind="${kind}" data-n="${b}" aria-pressed="${current===b}">${b} bar${b===1?'':'s'}</button>`).join('')}</div></div>`;
  }
  private kitHtml(view:PatternView,kit:Lane[]){
    const rows=this.rows(view),usable=kit.filter(l=>!l.problem),canEdit=this.host.editable();
    const unused=(DRUMS as readonly string[]).filter(d=>!rows.some(r=>r.token===d));
    const grids=rows.map((r,index)=>{
      const lane=r.virtual?usable[0]:view.lanes[r.lane];if(!lane)return '';
      const cols=this.columns(lane),s=scaled(lane,cols);
      const cells=Array.from({length:cols},(_,c)=>{
        const lock=s.locked.find(l=>c>=l.col&&c<l.col+l.len),on=!r.virtual&&hasToken(s.events,c,r.token);
        return `<button type="button" class="cell${this.beatClass(c,cols,lane.bars)}${lock?' locked':''}" data-grid="kit" data-r="${index}" data-c="${c}" data-lane="${r.virtual?-1:lane.index}" data-token="${r.token}" data-cols="${cols}" tabindex="-1" aria-pressed="${on}" ${lock?`aria-disabled="true" title="${esc(lock.reason)}"`:''} aria-label="${DRUM_LABEL[r.token]??r.token}, step ${c+1} of ${cols}${on?', on':''}${lock?', locked':''}"></button>`;
      }).join('');
      return `<div class="row-label"><select data-pe="row-sound" data-lane="${r.lane}" data-token="${r.token}" aria-label="Sound in row ${index+1}" ${canEdit&&!r.virtual?'':'disabled'}>${(DRUMS as readonly string[]).map(d=>`<option value="${d}" ${d===r.token?'selected':''} ${d!==r.token&&rows.some(x=>x.token===d&&x.lane===r.lane)?'disabled':''}>${DRUM_LABEL[d]}</option>`).join('')}</select></div><div class="steps" data-bars="${lane.bars}" data-cols="${cols}" style="--cols:${cols}">${cells}</div>`;
    }).join('');
    return `<section aria-label="Drums"><div class="pattern-tools">${this.lengthHtml(usable,'kit')}${unused.length?`<div><label for="pe-add-drum">Add a drum</label><select id="pe-add-drum" data-pe="add-drum" ${canEdit?'':'disabled'}><option value="">Choose…</option>${unused.map(d=>`<option value="${d}">${DRUM_LABEL[d]}</option>`).join('')}</select></div>`:''}</div>
      <div class="grid-scroll"><div class="step-grid" role="group" aria-label="Drum steps. Arrow keys move, Space toggles.">${grids}</div></div></section>`;
  }
  private noteRows(lane:Lane):number[]{
    const used=[...new Set(lane.events.flatMap(e=>e.tokens as number[]))];
    const lo=this.base??Math.max(LOWEST,used.length?Math.min(...used)-2:57-2);
    const wanted=this.scaleOnly?11:15,rows:number[]=[];
    for(let n=lo;n<=HIGHEST&&rows.length<wanted;n++)if(!this.scaleOnly||SCALE.has(n%12)||used.includes(n))rows.push(n);
    return rows.reverse();
  }
  private notesHtml(view:PatternView,notes:Lane[]){
    const lane=notes.find(l=>l.index===this.noteLane)??notes[0];this.noteLane=lane.index;
    const canEdit=this.host.editable(),many=view.lanes.length>1;
    const tabs=notes.length>1?`<div class="layer-tabs" role="group" aria-label="Note layers">${notes.map((l,i)=>`<button type="button" class="chip small" data-pe="layer" data-n="${l.index}" aria-pressed="${l===lane}">Layer ${i+1}</button>`).join('')}</div>`:'';
    if(lane.problem)return `<section aria-label="Notes">${tabs}<p class="lanes-note">${esc(lane.problem)}</p></section>`;
    const cols=this.columns(lane),s=scaled(lane,cols),rows=this.noteRows(lane),shown=new Set(rows);
    const hidden=[...new Set(lane.events.flatMap(e=>e.tokens as number[]))].filter(n=>!shown.has(n));
    const grid=rows.map((note,r)=>{
      const cells=Array.from({length:cols},(_,c)=>{
        const lock=s.locked.find(l=>c>=l.col&&c<l.col+l.len),e=s.events.find(x=>x.tokens.includes(note)&&c>=x.col&&c<x.col+x.len),head=e?.col===c;
        return `<button type="button" class="cell${this.beatClass(c,cols,lane.bars)}${e&&!head?' tail':''}${e&&head&&e.len>1?' head':''}${lock?' locked':''}" data-grid="notes" data-r="${r}" data-c="${c}" data-lane="${lane.index}" data-note="${note}" data-cols="${cols}" tabindex="-1" aria-pressed="${!!e}" ${lock?`aria-disabled="true" title="${esc(lock.reason)}"`:''} aria-label="${noteName(note).toUpperCase()}, step ${c+1} of ${cols}${e?`, on${e.len>1?`, ${e.len} steps long`:''}`:''}${lock?', locked':''}"></button>`;
      }).join('');
      return `<div class="row-label ${SCALE.has(note%12)?'scale':'off'}">${noteName(note).toUpperCase()}</div><div class="steps" data-bars="${lane.bars}" data-cols="${cols}" style="--cols:${cols}">${cells}</div>`;
    }).join('');
    return `<section aria-label="Notes">${tabs}<div class="pattern-tools">
        ${lane.voiceSpan?`<div><label for="pe-voice">Instrument</label><select id="pe-voice" data-pe="voice" ${canEdit?'':'disabled'}>${(VOICES as readonly Voice[]).map(v=>`<option value="${v}" ${v===lane.voice?'selected':''}>${VOICE_LABEL[v]}</option>`).join('')}</select></div>`:''}
        ${this.lengthHtml([lane],'notes')}
        <div><label id="pe-brush">Note length</label><div class="seg" role="group" aria-labelledby="pe-brush">${[1,2,4].map(n=>`<button type="button" data-pe="brush" data-n="${n}" aria-pressed="${this.brush===n}">${n}</button>`).join('')}</div></div>
        <div><label id="pe-range">Notes</label><div class="seg" role="group" aria-labelledby="pe-range"><button type="button" data-pe="shift" data-n="-12" aria-label="Show lower notes">▼</button><button type="button" data-pe="shift" data-n="12" aria-label="Show higher notes">▲</button><button type="button" data-pe="scale" aria-pressed="${this.scaleOnly}">In key</button></div></div>
      </div>
      ${hidden.length?`<p class="small muted">${hidden.length} note${hidden.length===1?' is':'s are'} outside this view (${hidden.map(n=>noteName(n).toUpperCase()).join(', ')}). Use ▲ ▼ to see ${hidden.length===1?'it':'them'}.</p>`:''}
      <div class="grid-scroll"><div class="step-grid piano" role="group" aria-label="Note steps. Arrow keys move, Space toggles.">${grid}</div></div>
      ${many?`<button type="button" class="ghost small" data-pe="remove-layer" data-n="${lane.index}" ${canEdit?'':'disabled'}>Remove this layer</button>`:''}
    </section>`;
  }
  private act(el:HTMLElement){
    const a=el.dataset.pe!,n=Number(el.dataset.n);
    switch(a){
      case 'target':this.target=n;this.render();this.root.querySelector<HTMLElement>(`[data-pe="target"][data-n="${n}"]`)?.focus({preventScroll:true});return;
      case 'brush':this.brush=n;this.render();return;
      case 'layer':this.noteLane=n;this.base=null;this.render();return;
      case 'scale':this.scaleOnly=!this.scaleOnly;this.render();return;
      case 'code':this.host.gotoCode?.();return;
      case 'shift':{const v=this.view(),l=v?.lanes.find(x=>x.index===this.noteLane);if(!l)return;const low=this.noteRows(l).at(-1)!;this.base=Math.min(HIGHEST-12,Math.max(LOWEST,low+n));this.render();return;}
      case 'undo':{const last=this.undo.pop();if(last!==undefined){this.message='';this.host.change(last);this.render();}return;}
      case 'copy':this.host.makeCopy?.(unrolledCopy(this.host.source()).source);return;
      case 'add-sound':return this.guard(()=>this.commit(addLayer(this.host.source(),'sound',16)));
      case 'add-note':return this.guard(()=>this.commit(addLayer(this.host.source(),'note',16)));
      case 'remove-layer':return this.guard(()=>{const l=readPattern(this.host.source()).lanes[n];this.commit(removeLayer(this.host.source(),l));this.noteLane=0;});
      case 'bars':return this.guard(()=>{
        let next=this.host.source();const before=next,view=readPattern(next),kinds=el.dataset.kind==='kit'?view.lanes.filter(l=>l.kind==='sound'&&!l.problem).map(l=>l.index):[this.noteLane];
        for(const i of kinds)next=setBars(next,readPattern(next).lanes[i],n);
        this.commit(next,before);
      });
    }
  }
  private select(el:HTMLSelectElement){
    const a=el.dataset.pe;
    if(a==='voice')return this.guard(()=>{const l=readPattern(this.host.source()).lanes[this.noteLane];this.commit(setVoice(this.host.source(),l,el.value as Voice));});
    if(a==='add-drum'&&el.value){this.spare.push(el.value);this.render();return;}
    if(a==='row-sound')return this.guard(()=>{
      const l=readPattern(this.host.source()).lanes[Number(el.dataset.lane)],cols=this.columns(l),s=scaled(l,cols);
      this.commit(writeLane(this.host.source(),l,cols,swapToken(s.events,el.dataset.token!,el.value)));
    });
  }
  private toggle(cell:HTMLElement){
    if(cell.getAttribute('aria-disabled')==='true'){this.say(`${cell.title} Change it in Code.`);return;}
    this.cursor={row:Number(cell.dataset.r),col:Number(cell.dataset.c),lane:cell.dataset.grid!};
    this.guard(()=>{
      const col=Number(cell.dataset.c);let source=this.host.source();const before=source;
      if(cell.dataset.grid==='kit'){
        const token=cell.dataset.token!;let view=readPattern(source),index=Number(cell.dataset.lane);
        if(index<0){
          // A drum with no lane yet. In a stack it gets a lane of its own; a single
          // pattern takes it as a second sound on the same steps.
          const stacked=view.lanes.length>1,sound=view.lanes.find(l=>l.kind==='sound'&&!l.problem);if(!sound)throw new ExprError('Add a drum layer first.');
          if(stacked){const cols=Number(cell.dataset.cols);source=addLayer(source,'sound',cols);view=readPattern(source);index=view.lanes.length-1;}else index=sound.index;
        }
        const lane=view.lanes[index],cols=this.columns(lane),s=scaled(lane,cols),at=Math.round(col*cols/Number(cell.dataset.cols));
        const was=hasToken(s.events,at,token),next=writeLane(source,lane,cols,toggleHit(s.events,s.locked,at,token));
        if(was&&!kitRows(readPattern(next)).some(r=>r.token===token))this.spare.push(token);
        this.commit(next,before);
      }else{
        const lane=readPattern(source).lanes[Number(cell.dataset.lane)],cols=this.columns(lane),s=scaled(lane,cols);
        this.commit(writeLane(source,lane,cols,toggleNote(s.events,s.locked,cols,col,Number(cell.dataset.note),this.brush)),before);
      }
    });
    this.focusCursor();
  }
  private cells(grid:string){return [...this.root.querySelectorAll<HTMLElement>(`.cell[data-grid="${grid}"]`)];}
  private restoreRoving(){
    for(const grid of ['kit','notes']){
      const all=this.cells(grid);if(!all.length)continue;
      const here=all.find(c=>this.cursor.lane===grid&&Number(c.dataset.r)===this.cursor.row&&Number(c.dataset.c)===this.cursor.col)??all[0];
      here.tabIndex=0;
    }
  }
  private focusCursor(){this.cells(this.cursor.lane).find(c=>Number(c.dataset.r)===this.cursor.row&&Number(c.dataset.c)===this.cursor.col)?.focus({preventScroll:false});}
  private key(e:KeyboardEvent){
    const cell=(e.target as HTMLElement).closest<HTMLElement>('.cell');if(!cell)return;
    if(e.key===' '||e.key==='Enter'){e.preventDefault();this.toggle(cell);return;}
    const move:Record<string,[number,number]>={ArrowRight:[0,1],ArrowLeft:[0,-1],ArrowDown:[1,0],ArrowUp:[-1,0]};
    const d=move[e.key];if(!d)return;
    e.preventDefault();
    const grid=cell.dataset.grid!,row=Number(cell.dataset.r)+d[0],all=this.cells(grid);
    const rowCells=all.filter(c=>Number(c.dataset.r)===row);if(!rowCells.length)return;
    // Rows can have different lengths, so a move up or down keeps the same place
    // in the bar rather than the same index.
    const from=(Number(cell.dataset.c)+.5)/Number(cell.dataset.cols);
    const col=d[0]?Math.min(rowCells.length-1,Math.floor(from*rowCells.length)):Number(cell.dataset.c)+d[1];
    const next=rowCells[col];if(!next)return;
    cell.tabIndex=-1;next.tabIndex=0;next.focus();
  }
  // Marks where the music is, from the bar position the page already knows. It
  // runs many times a second, so it reads what the grid already drew.
  mark(cycle:number|null){
    for(const old of this.root.querySelectorAll('.cell.live'))old.classList.remove('live');
    if(cycle===null)return;
    for(const steps of this.root.querySelectorAll<HTMLElement>('.steps')){
      const bars=Number(steps.dataset.bars),cols=Number(steps.dataset.cols);
      steps.children[Math.floor((((cycle/bars)%1+1)%1)*cols)]?.classList.add('live');
    }
  }
}
