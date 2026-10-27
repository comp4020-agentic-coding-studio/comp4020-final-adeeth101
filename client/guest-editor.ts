// A guest edits only their own session parts. Drafts are keyed by identity,
// performance and part; the server checks ownership and revisions again.
import {request,type ApiError} from './api.ts';
import {esc,on,errorText,toast} from './ui.ts';
import {readCode,writeCode,deleteCode,codeKey,type CodeDraft} from './drafts.ts';
import {parseSource,shapeState,applyShape,CONTROL_RANGE,type Control} from '../shared/expr.ts';
import {presetById} from '../shared/presets.ts';
import type {GuestPart} from '../shared/studio.ts';

const LABEL:Record<Control,string>={gain:'Volume',lpf:'Brightness',room:'Space',pan:'Left–right',release:'Sustain'};
const DEFAULT:Record<Control,number>={gain:1,lpf:16000,room:0,pan:0.5,release:0.06};
type Hooks={preview:(source:string,partId:string)=>Promise<void>;stopPreview:()=>void;changed:()=>Promise<void>};

export class GuestEditor {
  private parts:GuestPart[]=[];
  private part:GuestPart|null=null;
  private draft:CodeDraft|null=null;
  private available=false;
  private reason='';
  private conflict=false;
  private saving=false;
  private error:string|null=null;
  private notice='';
  private tab:'code'|'shape'='code';
  private writes:Promise<void>=Promise.resolve();
  private pending:{commandId:string;source:string;revision:number}|null=null;
  private openRun=0;
  previewId:string|null=null;

  constructor(private dialog:HTMLDialogElement,private visitorId:string,private performanceId:string,private hooks:Hooks){
    dialog.addEventListener('close',()=>this.stopPreview());
    on(dialog,'click','[data-guest-action]',async b=>{
      const action=b.dataset.guestAction!;
      if(action==='close'){dialog.close();return;}
      if(action==='tab'){this.tab=b.dataset.tab as 'code'|'shape';this.render();return;}
      if(action==='copy'){await navigator.clipboard.writeText(this.draft?.source??'');toast('Draft code copied.');return;}
      if(action==='preview'){
        if(this.previewId){this.stopPreview();this.renderState();return;}
        if(!this.draft||!this.part||this.error)return;
        await hooks.preview(this.draft.source,this.part.id);this.previewId=this.part.id;this.renderState();return;
      }
      if(action==='load'){
        if(this.dirty()&&!confirm('Replace this local draft with the current saved part? Copy it first if you want to keep it.'))return;
        const part=this.parts.find(p=>p.id===this.part?.id);if(!part)return;
        this.part=part;this.draft=this.fromPart(part);this.conflict=false;this.pending=null;this.stopPreview();this.store();this.render();return;
      }
      if(action==='keep'){this.notice='Your draft is kept on this device. Load current or save it as a new part to resolve the conflict.';this.store();this.renderState();return;}
      if(action==='apply'){await this.apply(false);return;}
      if(action==='new'){await this.apply(true);return;}
    });
    on(dialog,'input','#guest-code',t=>{
      if(!this.draft||this.saving)return;
      this.draft.source=(t as HTMLTextAreaElement).value;this.pending=null;this.notice='';
      this.validate();this.store();this.renderState();
      if(this.previewId){if(this.error)this.stopPreview();else void hooks.preview(this.draft.source,this.previewId).catch(e=>{this.stopPreview();toast(errorText(e));});}
    });
    on(dialog,'change','[data-guest-shape]',t=>{
      if(!this.draft||!this.available||this.saving)return;
      this.draft.source=applyShape(this.draft.source,t.dataset.guestShape as Control,Number((t as HTMLInputElement).value));
      this.pending=null;this.notice='';this.validate();this.store();this.render();
      dialog.querySelector<HTMLElement>(`#${t.id}`)?.focus({preventScroll:true});
    });
  }
  private key(id=this.part!.id){return codeKey(this.visitorId,`performance:${this.performanceId}`,id,'A');}
  private fromPart(p:GuestPart):CodeDraft{return {source:p.source,baseSource:p.source,baseRevision:p.revision,savedAt:Date.now()};}
  private dirty(){return !!this.draft&&this.draft.source!==this.draft.baseSource;}
  private validate(){try{if(this.draft)parseSource(this.draft.source);this.error=null;}catch(e){this.error=errorText(e);}}
  private store(){
    if(!this.part||!this.draft)return;
    const key=this.key(),draft={...this.draft,savedAt:Date.now()};
    this.writes=this.writes.then(()=>writeCode(key,draft)).catch(()=>{this.notice='Local storage is unavailable. Keep this page open or copy your draft.';this.renderState();});
  }
  private stopPreview(){this.previewId=null;this.hooks.stopPreview();}
  suspendPreview(){this.stopPreview();this.renderState();}
  update(parts:GuestPart[],available:boolean,reason:string){
    this.parts=parts;this.available=available;this.reason=reason;
    const next=parts.find(p=>p.id===this.part?.id);
    let changed=false;
    if(next&&this.draft&&!this.saving){
      if(next.revision!==this.draft.baseRevision){
        if(this.dirty())this.conflict=true;
        else{this.draft=this.fromPart(next);this.conflict=false;changed=true;}
      }
      this.part=next;
    }
    if(this.part&&(!available||!next)&&this.previewId)this.stopPreview();
    if(this.dialog.open){if(changed)this.render();else this.renderState();}
  }
  async open(id:string){
    if(this.saving)return;
    const part=this.parts.find(p=>p.id===id);if(!part)return;
    const run=++this.openRun;
    this.stopPreview();await this.writes;
    if(run!==this.openRun)return;
    this.part=part;this.draft=this.fromPart(part);this.notice='';this.pending=null;
    let saved:CodeDraft|undefined;
    try{saved=await readCode(this.key());}catch{this.notice='Local storage is unavailable. Copy your draft before leaving.';}
    if(run!==this.openRun)return;
    if(saved&&saved.source!==saved.baseSource)this.draft=saved;
    this.conflict=this.draft.baseRevision!==part.revision&&this.dirty();this.validate();this.tab='code';this.render();
    if(!this.dialog.open)this.dialog.showModal();
  }
  private render(){
    if(!this.part||!this.draft)return;
    const source=this.draft.source;
    this.validate();
    let controls:Control[]=['gain','lpf','room','pan','release'];
    if(this.part.presetId)controls=presetById(this.part.presetId)?.macros??controls;
    const shapes=this.error?'<p class="small">Fix the code before using Shape. Your text stays in Code.</p>':controls.map(ctl=>{
      const state=shapeState(source,ctl),[min,max]=CONTROL_RANGE[ctl],value=state.value??DEFAULT[ctl];
      return `<div class="shape-row"><label for="guest-shape-${ctl}">${LABEL[ctl]}</label><div class="shape-input"><input id="guest-shape-${ctl}" type="range" data-guest-shape="${ctl}" data-available="${state.available}" min="${min}" max="${max}" step="${ctl==='lpf'?10:0.01}" value="${value}" ${state.available?'':'disabled'}><output>${value}${ctl==='lpf'?' Hz':ctl==='release'?' s':''}</output></div>${state.reason?`<p class="small muted">${esc(state.reason)}</p>`:''}</div>`;
    }).join('');
    this.dialog.innerHTML=`<header class="drawer-head"><div><h2 id="guest-editor-title">${esc(this.part.name)}</h2><p class="small muted">Your part · this performance only</p></div><button class="ghost close" data-guest-action="close" aria-label="Close guest editor">✕</button></header>
      <div class="tabs" role="tablist" aria-label="Guest part views"><button role="tab" id="guest-code-tab" data-guest-action="tab" data-tab="code" aria-controls="guest-code-panel" aria-selected="${this.tab==='code'}">Code</button><button role="tab" id="guest-shape-tab" data-guest-action="tab" data-tab="shape" aria-controls="guest-shape-panel" aria-selected="${this.tab==='shape'}">Shape</button></div>
      <div id="guest-code-panel" role="tabpanel" aria-labelledby="guest-code-tab" ${this.tab==='code'?'':'hidden'}><label for="guest-code">Strudel code</label><textarea id="guest-code" class="code-editor" spellcheck="false" autocapitalize="off" aria-describedby="guest-code-status">${esc(source)}</textarea><p class="small muted">Use s(), note().s(), stack() and supported Strudel effects. Your text is parsed, never executed as JavaScript.</p></div>
      <div id="guest-shape-panel" role="tabpanel" aria-labelledby="guest-shape-tab" ${this.tab==='shape'?'':'hidden'}>${shapes}</div>
      <p id="guest-code-status" class="code-error" role="status" aria-live="polite"></p>
      <div id="guest-conflict" class="conflict" role="alert" hidden><strong>This part changed in another tab.</strong><p>Your draft is still here.</p><div class="row"><button class="outline" data-guest-action="keep">Keep my draft</button><button class="ghost" data-guest-action="load">Load current</button><button class="ghost" data-guest-action="new">Save as new part</button></div></div>
      <div class="row code-actions"><button class="outline" data-guest-action="preview">Preview on my device</button><button class="primary" data-guest-action="apply">Apply to mix</button><button class="ghost" data-guest-action="load">Restore previous</button><button class="ghost" data-guest-action="copy">Copy draft</button></div>`;
    this.renderState();
  }
  private renderState(){
    if(!this.part||!this.draft)return;
    const present=this.parts.some(p=>p.id===this.part?.id),editable=this.available&&present&&!this.saving;
    const unavailable=!this.available?this.reason:!present?'This part was removed. Your draft is kept on this device; you can copy it.':'';
    const status=this.dialog.querySelector<HTMLElement>('#guest-code-status');
    if(status){status.textContent=unavailable||this.error||this.notice||(this.previewId?'Previewing locally · only you hear this.':this.dirty()?'Draft saved on this device · not shared yet.':`Saved revision ${this.draft.baseRevision} · everyone hears the saved part.`);status.classList.toggle('error',!!this.error);}
    const code=this.dialog.querySelector<HTMLTextAreaElement>('#guest-code');if(code)code.readOnly=!editable;
    for(const input of this.dialog.querySelectorAll<HTMLInputElement>('[data-guest-shape]'))input.disabled=!editable||input.dataset.available!=='true';
    for(const button of this.dialog.querySelectorAll<HTMLButtonElement>('[data-guest-action]')){
      const action=button.dataset.guestAction;
      if(action==='apply')button.disabled=!editable||!this.dirty()||!!this.error||this.conflict;
      if(action==='preview'){button.disabled=!editable||!!this.error;button.textContent=this.previewId?'Stop preview':'Preview on my device';button.setAttribute('aria-pressed',String(!!this.previewId));}
      if(action==='load')button.disabled=!editable;
      if(action==='new')button.disabled=!editable||!!this.error;
    }
    const conflict=this.dialog.querySelector<HTMLElement>('#guest-conflict');if(conflict)conflict.hidden=!this.conflict;
  }
  private async apply(asNew:boolean){
    if(!this.part||!this.draft||!this.available||this.error||this.saving||!this.parts.some(p=>p.id===this.part?.id))return;
    if(this.conflict&&!asNew)return;
    const part=this.part,source=this.draft.source,key=this.key();
    this.pending??={commandId:crypto.randomUUID(),source,revision:this.draft.baseRevision};
    const pending=this.pending;
    this.saving=true;this.renderState();
    try{
      const result=await request(`/api/performances/${this.performanceId}/commands`,{commandId:pending.commandId,type:asNew?'guest.add':'guest.edit',payload:asNew?{name:`${part.name} copy`.slice(0,40),source}:{trackId:part.id,source},...(asNew?{}:{expectedRevision:pending.revision})});
      this.stopPreview();this.draft={source,baseSource:source,baseRevision:result.entityRevision,savedAt:Date.now()};this.conflict=false;this.pending=null;
      await this.writes;await deleteCode(key).catch(()=>{});await this.hooks.changed();
      this.notice=`Saved · joins the shared mix at bar ${result.effectiveCycle+1}.`;
      if(asNew){this.saving=false;await this.open(result.entityId);}
    }catch(e){
      if((e as ApiError).status===409){this.conflict=true;this.pending=null;await this.hooks.changed();}
      this.notice=errorText(e);this.store();
    }finally{this.saving=false;this.renderState();}
  }
}
