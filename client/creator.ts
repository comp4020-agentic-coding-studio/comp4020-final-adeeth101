// The character creator: a dressing room. One large live preview, a tab for each
// part of the look, and a Music tab that edits the same Strudel source through the
// step grid and through code. A draft stays on this device until it is saved.
import {request,type ApiError} from './api.ts';
import {esc,errorText,toast,confirmDialog} from './ui.ts';
import {characterSvg} from './performer.ts';
import {enable,current} from './sound.ts';
import {PatternEditor} from './pattern-editor.ts';
import {characterKey,readCharacterDraft,writeCharacterDraft,deleteCharacterDraft} from './drafts.ts';
import {BLANK_LOOK,BODIES,EYES,MOUTHS,TOPS,WEARS,PROPS,SWATCHES,SWATCH_HEX,LOOK_LABEL,randomLook,validLook,type Look} from '../shared/look.ts';
import {ROLES,ROLE_LABEL,type Role} from '../shared/presets.ts';
import {parseSource,shapeState,applyShape,CONTROL_RANGE,type Control} from '../shared/expr.ts';
import type {SavedCharacter} from '../shared/studio.ts';

export type CreatorStart={
  id?:string;revision?:number;name:string;role:Role|null;look:Look;source:string;level:number;
  from?:{presetId?:string;characterId?:string};
  heading?:string;
};
type Tab='body'|'face'|'top'|'wear'|'prop'|'colour'|'music'|'details';
const TABS:[Tab,string][]=[['body','Body'],['face','Face'],['top','Headwear'],['wear','Clothes'],['prop','Props'],['colour','Colours'],['music','Music'],['details','Details']];
const LOOK_ONLY:Tab[]=['body','face','top','wear','prop','colour'];
const SOUND_CONTROLS:[Control,string,number][]=[['lpf','Brightness',10],['room','Space',0.01],['delay','Echo',0.01],['pan','Left–right',0.01],['release','Sustain',0.01],['attack','Fade in',0.01]];
const SOUND_DEFAULT:Partial<Record<Control,number>>={lpf:16000,room:0,delay:0,pan:0.5,release:0.06,attack:0.012};
const EMPTY_STEPS=Array.from({length:16},()=>'~').join(' ');
// Where a blank character's music starts: an empty grid for its role.
export const blankSource=(role:Role|null)=>role==='beats'||role===null?`s("${EMPTY_STEPS}")`:`note("${EMPTY_STEPS}").s("${role==='bass'?'triangle':role==='texture'?'sine':'triangle'}")`;
export const blankCharacter=(role:Role|null='beats'):CreatorStart=>({name:'New character',role,look:{...BLANK_LOOK},source:blankSource(role),level:0.7,heading:'Create a character'});

type Options={
  visitorId:string;bpm?:number;
  // Look-only editing of a track on a stage, which never touches the library.
  lookOnly?:{apply:(look:Look)=>Promise<void>};
  // Offered after saving when a mix is open.
  addToMix?:(id:string)=>Promise<void>;
  saved?:(c:{id:string;revision:number})=>void;
};

export async function openCreator(start:CreatorStart,options:Options){
  // Each starting point keeps its own draft, so an abandoned blank character never
  // turns up when someone opens a remix.
  const key=characterKey(options.visitorId,start.id??start.from?.presetId??start.from?.characterId??`new:${start.role??'none'}`);
  let name=start.name,role=start.role,look={...start.look},source=start.source,level=start.level,revision=start.revision??0,characterId=start.id??null;
  let tab:Tab=options.lookOnly?'body':'body',music:'steps'|'code'='steps',savedSnapshot=JSON.stringify({name,role,look,source,level}),previewing=false,saving=false,conflict:SavedCharacter|null=null,codeError:string|null=null;
  const original=structuredClone({name,role,look,source,level});
  if(!options.lookOnly){
    const draft=await readCharacterDraft(key).catch(()=>undefined);
    const restored=draft&&validLook(draft.look);
    if(draft&&restored&&(draft.baseRevision===revision||!start.id)&&JSON.stringify({name:draft.name,role:draft.role,look:restored,source:draft.source,level:draft.level})!==savedSnapshot){
      ({name,source,level}=draft);role=draft.role as Role|null;look=restored;toast('Your unsaved work on this character is back.');
    }
  }
  const dialog=document.createElement('dialog');dialog.className='creator';dialog.setAttribute('aria-labelledby','creator-title');
  dialog.innerHTML=`<div class="creator-layout">
    <section class="dress" aria-label="Live preview">
      <div class="dress-top"><button type="button" class="outline small" data-c="hear" id="creator-hear" ${options.lookOnly?'hidden':''}>▶ Hear it</button><span class="spacer"></span></div>
      <div class="preview" id="creator-preview"></div><div class="dress-name" id="creator-name"></div>
    </section>
    <section class="creator-tools paper">
      <div class="creator-head"><h2 id="creator-title">${esc(start.heading??(options.lookOnly?'Change this look':'Edit character'))}</h2><button type="button" class="ghost" data-c="random">Surprise me</button><button type="button" class="ghost" data-c="reset">Reset</button><button type="button" class="ghost close" data-c="close" aria-label="Close the creator">✕</button></div>
      <div class="creator-tabs" role="tablist" aria-label="Character parts" id="creator-tabs"></div>
      <div class="creator-panel" id="creator-panel" role="tabpanel"></div>
      <div class="creator-foot" id="creator-foot"></div>
    </section></div>`;
  document.body.append(dialog);
  const $=<T extends HTMLElement>(s:string)=>dialog.querySelector<T>(s)!;
  const panel=$('#creator-panel');
  const dirty=()=>JSON.stringify({name,role,look,source,level})!==savedSnapshot;
  let editor:PatternEditor|null=null;
  const valid=()=>{try{parseSource(source);return null;}catch(e){return errorText(e);}};
  let storeTimer:ReturnType<typeof setTimeout>;
  function store(){if(options.lookOnly)return;clearTimeout(storeTimer);storeTimer=setTimeout(()=>{void writeCharacterDraft(key,{name,role,look,source,level,baseRevision:revision,savedAt:Date.now()}).catch(()=>{});},250);}
  function drawPreview(){$('#creator-preview').innerHTML=characterSvg(look);$('#creator-name').textContent=name;}
  function renderTabs(){
    const tabs=options.lookOnly?TABS.filter(([t])=>LOOK_ONLY.includes(t)):TABS;
    $('#creator-tabs').innerHTML=tabs.map(([t,label])=>`<button type="button" role="tab" id="ctab-${t}" aria-selected="${tab===t}" aria-controls="creator-panel" data-c="tab" data-tab="${t}">${label}</button>`).join('');
    panel.setAttribute('aria-labelledby',`ctab-${tab}`);
  }
  const option=(group:string,id:string,label:string,preview:Look,on:boolean)=>`<button type="button" class="opt" data-c="pick" data-group="${group}" data-value="${id}" aria-pressed="${on}">${characterSvg(preview)}<span>${esc(label)}</span></button>`;
  const swatches=(field:'skin'|'cloth'|'trim',title:string)=>`<h3>${title}</h3><div class="swatches" role="group" aria-label="${title}">${SWATCHES.map(s=>`<button type="button" class="swatch" data-c="pick" data-group="${field}" data-value="${s}" style="background:${SWATCH_HEX[s]}" aria-pressed="${look[field]===s}" aria-label="${LOOK_LABEL.swatch[s]}"></button>`).join('')}</div>`;
  function renderPanel(){
    editor=null;
    switch(tab){
      case 'body':panel.innerHTML=`<div class="opts" role="group" aria-label="Body">${BODIES.map(b=>option('body',b,LOOK_LABEL.body[b],{...look,body:b},look.body===b)).join('')}</div>`;break;
      case 'face':panel.innerHTML=`<h3>Eyes</h3><div class="opts" role="group" aria-label="Eyes">${EYES.map(e=>option('eyes',e,LOOK_LABEL.eyes[e],{...look,eyes:e},look.eyes===e)).join('')}</div><h3 style="margin-top:14px">Mouth</h3><div class="opts" role="group" aria-label="Mouth">${MOUTHS.map(m=>option('mouth',m,LOOK_LABEL.mouth[m],{...look,mouth:m},look.mouth===m)).join('')}</div>`;break;
      case 'top':panel.innerHTML=`<div class="opts" role="group" aria-label="Headwear">${TOPS.map(t=>option('top',t,LOOK_LABEL.top[t],{...look,top:t},look.top===t)).join('')}</div>`;break;
      case 'wear':panel.innerHTML=`<div class="opts" role="group" aria-label="Clothes">${WEARS.map(w=>option('wear',w,LOOK_LABEL.wear[w],{...look,wear:w},look.wear===w)).join('')}</div>`;break;
      case 'prop':panel.innerHTML=`<div class="opts" role="group" aria-label="Props">${PROPS.map(p=>option('prop',p,LOOK_LABEL.prop[p],{...look,prop:p},look.prop===p)).join('')}</div>`;break;
      case 'colour':panel.innerHTML=swatches('skin','Skin')+swatches('cloth','Clothes')+swatches('trim','Trim');break;
      case 'music':renderMusic();break;
      case 'details':panel.innerHTML=`<div class="field"><label for="creator-name-input">Name</label><input id="creator-name-input" maxlength="40" value="${esc(name)}"></div>
        <div class="field"><label for="creator-role">Role in a band</label><select id="creator-role"><option value="" ${role===null?'selected':''}>No particular role</option>${ROLES.map(r=>`<option value="${r}" ${role===r?'selected':''}>${ROLE_LABEL[r]}</option>`).join('')}</select></div>
        <div class="field"><label for="creator-level">Volume when added to a mix</label><div class="shape-input"><input type="range" id="creator-level" min="0" max="1" step="0.01" value="${level}"><output id="creator-level-out">${Math.round(level*100)}%</output></div></div>
        ${start.from?.presetId||start.from?.characterId?'<p class="small muted">The original gets a credit on this character.</p>':''}`;break;
    }
  }
  function renderMusic(){
    panel.innerHTML=`<div class="seg" role="group" aria-label="How to edit the music"><button type="button" data-c="music" data-v="steps" aria-pressed="${music==='steps'}">Steps</button><button type="button" data-c="music" data-v="code" aria-pressed="${music==='code'}">Strudel code</button></div>
      <div id="creator-music" style="margin-top:10px"></div>${soundHtml()}`;
    const host=$('#creator-music');
    if(music==='steps'){
      editor=new PatternEditor(host,{source:()=>source,change:next=>{source=next;store();renderFoot();updateHeard();},editable:()=>true,gotoCode:()=>{music='code';renderMusic();}});editor.render();
    }else{
      host.innerHTML=`<label for="creator-code" class="code-label">Strudel code</label><textarea id="creator-code" class="code-editor" spellcheck="false" autocapitalize="off" autocomplete="off" aria-describedby="creator-code-status">${esc(source)}</textarea><p id="creator-code-status" class="code-error" role="status" aria-live="polite"></p>`;
      codeStatus();
    }
  }
  function soundHtml(){
    const rows=SOUND_CONTROLS.map(([ctl,label,step])=>{
      let st;try{st=shapeState(source,ctl);}catch{return '';}
      const [lo,hi]=CONTROL_RANGE[ctl],value=st.value??SOUND_DEFAULT[ctl]!;
      return `<div class="shape-row"><label for="creator-${ctl}"><strong>${label}</strong></label><div class="shape-input"><input type="range" id="creator-${ctl}" data-shape="${ctl}" min="${ctl==='lpf'?200:lo}" max="${ctl==='lpf'?12000:hi}" step="${step}" value="${value}" ${st.available?'':'disabled'}><output>${ctl==='lpf'?`${Math.round(value)} Hz`:value}</output></div>${st.reason?`<p class="small muted">${esc(st.reason)}</p>`:''}</div>`;
    }).join('');
    return rows?`<details class="history"><summary>Sound settings</summary>${rows}</details>`:'';
  }
  function codeStatus(){const el=dialog.querySelector('#creator-code-status');if(!el)return;codeError=valid();el.textContent=codeError??'This is the same pattern as the Steps view.';el.classList.toggle('error',!!codeError);}
  function renderFoot(){
    const problem=valid();
    if(options.lookOnly){$('#creator-foot').innerHTML=`<button type="button" class="primary" data-c="apply-look" ${saving?'disabled':''}>Use this look</button><span class="small muted">Changes this track only, for everyone in the mix.</span>`;return;}
    $('#creator-foot').innerHTML=conflict?`<div class="conflict" role="alert"><p><strong>This character changed in another session.</strong> Your work is still here.</p><div class="row"><button type="button" class="outline" data-c="keep">Keep mine</button><button type="button" class="ghost" data-c="load">Load theirs</button><button type="button" class="ghost" data-c="as-new">Save as a new character</button></div></div>`
      :`<button type="button" class="primary" data-c="save" ${problem||saving?'disabled':''}>${characterId?'Save changes':'Save character'}</button>${options.addToMix?`<button type="button" class="outline" data-c="save-add" ${problem||saving?'disabled':''}>Save and add to mix</button>`:''}<span class="small ${problem?'error':'muted'}" role="status">${esc(problem?'Fix the code to save. Your text is safe here.':dirty()||!characterId?'Not saved yet · kept on this device.':'Saved.')}</span>`;
  }
  function updateHeard(){if(!previewing||valid())return;current()?.updatePreview([{document:parseSource(source).document,gain:level}]);}
  function stopHearing(){if(!previewing)return;previewing=false;current()?.stopPreview();$('#creator-hear').textContent='▶ Hear it';}
  async function save(andAdd=false){
    if(saving||valid())return;saving=true;renderFoot();
    const body={name,role,look,source,level};
    try{
      if(characterId){const r=await request(`/api/characters/${characterId}`,{...body,expectedRevision:revision});revision=r.revision;}
      else{const r=await request('/api/characters',{...body,from:start.from});characterId=r.id;revision=r.revision;}
      savedSnapshot=JSON.stringify(body);await deleteCharacterDraft(key).catch(()=>{});
      options.saved?.({id:characterId!,revision});
      toast(`${name} is saved in your characters.`);
      if(andAdd&&options.addToMix){await options.addToMix(characterId!);close();return;}
    }catch(e){
      if((e as ApiError).status===409&&(e as ApiError).current){conflict=(e as ApiError).current as SavedCharacter;}
      else toast(errorText(e));
    }finally{saving=false;if(dialog.isConnected)renderFoot();}
  }
  function close(){stopHearing();clearTimeout(storeTimer);dialog.close();dialog.remove();}
  async function requestClose(){
    if(!options.lookOnly&&dirty()&&!(await confirmDialog({title:'Close the creator?',body:'Your changes are not saved to your characters. They stay on this device, and come back the next time you open it.',confirm:'Close'})))return;
    if(options.lookOnly&&dirty()&&!(await confirmDialog({title:'Discard this look?',body:'The track keeps the look it has now.',confirm:'Discard',danger:true})))return;
    close();
  }
  dialog.addEventListener('cancel',e=>{e.preventDefault();void requestClose();});
  dialog.addEventListener('click',e=>{
    const el=(e.target as HTMLElement).closest<HTMLElement>('[data-c]');if(!el)return;
    const a=el.dataset.c;
    (async()=>{
      switch(a){
        case 'tab':tab=el.dataset.tab as Tab;renderTabs();renderPanel();$<HTMLElement>(`#ctab-${tab}`).focus();return;
        case 'pick':{
          const group=el.dataset.group as keyof Look;(look as Record<string,unknown>)[group]=el.dataset.value;
          const scroll=panel.scrollTop;drawPreview();renderPanel();panel.scrollTop=scroll;store();renderFoot();
          panel.querySelector<HTMLElement>(`[data-group="${group}"][data-value="${el.dataset.value}"]`)?.focus({preventScroll:true});return;
        }
        case 'random':look=randomLook(crypto.randomUUID());drawPreview();renderPanel();store();renderFoot();return;
        case 'reset':({name,role,look,source,level}=structuredClone(original));stopHearing();drawPreview();renderPanel();store();renderFoot();return;
        case 'music':music=el.dataset.v as 'steps'|'code';renderMusic();return;
        case 'close':return requestClose();
        case 'hear':{
          if(previewing){stopHearing();return;}
          const problem=valid();if(problem){toast('Fix the code first.');return;}
          const audio=await enable().catch(err=>{toast(errorText(err));return null;});if(!audio)return;
          await audio.previewItems([{document:parseSource(source).document,gain:level}],options.bpm??100);previewing=true;el.textContent='■ Stop';return;
        }
        case 'save':return save();
        case 'save-add':return save(true);
        case 'apply-look':saving=true;renderFoot();try{await options.lookOnly!.apply(look);close();}catch(err){saving=false;renderFoot();toast(errorText(err));}return;
        case 'keep':revision=conflict!.revision;conflict=null;renderFoot();await save();return;
        case 'load':({name,look,source,level}=conflict!);role=conflict!.role==='custom'?null:conflict!.role;revision=conflict!.revision;savedSnapshot=JSON.stringify({name,role,look,source,level});conflict=null;await deleteCharacterDraft(key).catch(()=>{});drawPreview();renderPanel();renderFoot();return;
        case 'as-new':characterId=null;revision=0;conflict=null;await save();return;
      }
    })().catch(err=>toast(errorText(err)));
  });
  dialog.addEventListener('input',e=>{
    const t=e.target as HTMLInputElement;
    if(t.id==='creator-name-input'){name=t.value.slice(0,40)||'New character';$('#creator-name').textContent=name;}
    else if(t.id==='creator-level'){level=Number(t.value);$('#creator-level-out').textContent=`${Math.round(level*100)}%`;updateHeard();}
    else if(t.id==='creator-code'){source=t.value;codeStatus();updateHeard();}
    else if(t.dataset.shape){
      const ctl=t.dataset.shape as Control;
      try{source=applyShape(source,ctl,Number(t.value));const out=t.parentElement?.querySelector('output');if(out)out.textContent=ctl==='lpf'?`${Math.round(Number(t.value))} Hz`:t.value;updateHeard();}catch(err){toast(errorText(err));}
    }else return;
    store();renderFoot();
  });
  dialog.addEventListener('change',e=>{const t=e.target as HTMLSelectElement;if(t.id==='creator-role'){role=(t.value||null) as Role|null;store();renderFoot();}});
  drawPreview();renderTabs();renderPanel();renderFoot();
  dialog.showModal();
  (window as any).ensembleCreator={state:()=>({name,role,look,source,level,characterId,revision})};
  return {close};
}
