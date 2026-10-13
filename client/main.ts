import {request,sendCommand} from './api.ts';
import {readDraft,writeDraft,deleteDraft,type Draft} from './drafts.ts';
import {emptyClip,leavesOf,validateDocument,SOUNDS,SYNTHS,OPS,type ClipDocument,type MusicNode,type Op} from '../shared/music.ts';
import {parseCode,printNode} from '../shared/code.ts';
import {rhythmBot,melodyBot} from '../shared/bots.ts';
import {SLOTS,cycleAt,planAt,sceneAt,resolvePlan,type Slot} from '../shared/performance.ts';
import type {Snapshot} from '../shared/studio.ts';
import type {StudioAudio} from './audio.ts';
import type {BlockEditor} from './blocks.ts';
const host=document.querySelector<HTMLElement>('#studio')!,id=host.dataset.project,perform=host.dataset.view==='perform';
const esc=(s:unknown)=>String(s).replace(/[&<>"']/g,x=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x]!));
const $=<T extends Element=HTMLElement>(s:string,r:ParentNode=document)=>r.querySelector<T>(s)!;
const all=<T extends Element=HTMLElement>(s:string,r:ParentNode=document)=>[...r.querySelectorAll<T>(s)];
function toast(s:string){$('#toast').textContent=s;$('#toast').classList.add('show');setTimeout(()=>$('#toast').classList.remove('show'),5000);}
const fail=(e:unknown)=>toast(e instanceof Error?e.message:'Please retry.');
function bind(s:string,event:string,fn:(el:HTMLElement,e:Event)=>unknown){all(s).forEach(el=>el.addEventListener(event,e=>{Promise.resolve().then(()=>fn(el,e)).catch(fail);}));}
const btn=(label:string,action:string,style='',disabled=false)=>`<button data-action="${action}" class="${style}" ${disabled?'disabled':''}>${label}</button>`;
function preserveFocus(fn:()=>void){const focused=(document.activeElement as HTMLElement)?.id;fn();if(focused)document.getElementById(focused)?.focus({preventScroll:true});}
function download(name:string,text:string){const url=URL.createObjectURL(new Blob([text],{type:'text/plain'}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
let state:Snapshot,selected='',slot:Slot='A',mode='instruments',draft:Draft,dirty=false,live=false;
let blockEditor:BlockEditor|null=null,audio:StudioAudio|null=null,enabled=false,offset=0,run=0,editorRun=0;
let leafIndex=0,page=0,octave=5,cursor=0,stepEntry=false,previewing=false;
let localTimer:ReturnType<typeof setTimeout>,lostTimer:ReturnType<typeof setTimeout>;
let proposal:ClipDocument|null=null,proposalMeta:Record<string,unknown>={};
let arrangementDraft:string|null=null;
let lastSnapshotOk=0,localPending=false,localFailed=false,soundRun=0;
const solo=new Set<string>();
let blockIssue:string|null=null;
function isKit(doc:ClipDocument){return doc.root.kind==='stack'&&doc.root.children.length===4&&doc.root.children.every((n,i)=>n.kind==='sound'&&n.steps.every(x=>x===null||x===SOUNDS[i]));}
const track=()=>state.tracks.find(t=>t.id===selected),clip=()=>track()?.clips[slot],own=()=>track()?.ownerId===state.you.id;
const conductor=()=>state.transport.conductorId===state.you.id;
// Online means the live stream is open, or (when the server refuses another
// stream) one-second polling has answered recently.
const online=()=>live||Date.now()-lastSnapshotOk<3000;
const key=()=>`${state.you.id}:${id}:${selected}:${slot}`;
const cmd=(type:string,payload:unknown={},revision?:number)=>sendCommand(id!,type,payload,revision);
if(!id)$('#create-project')?.addEventListener('submit',e=>{e.preventDefault();void request('/api/projects',{title:$<HTMLInputElement>('#piece-title').value}).then(x=>location.href=`/p/${x.id}/compose`).catch(fail);});
else void boot().catch(e=>host.innerHTML=`<p class="notice">${esc(e.message)}</p>`);
async function boot(){
  state=await request(`/api/projects/${id}`);lastSnapshotOk=Date.now();
  host.innerHTML=`<section class="project-head"><div><p class="eyebrow">${perform?'THE STAGE':'YOUR COMPOSITION'}</p><h1>${esc(state.title)}</h1></div><div class="head-actions"><span id="live-status" role="status">Connecting…</span>${btn('Share piece ↗','share')}${btn('Export','export')}<label class="import-control">Import<input id="import-piece" type="file" accept="application/json"></label></div></section>
  <section class="session-strip"><form id="name-form"><label class="sr-only" for="your-name">Your name</label><input id="your-name" maxlength="24" value="${esc(state.you.handle)}"><button>Set name</button></form><span id="presence" class="small"></span><div class="local-transport">${btn('Enable sound','sound','sound-button')}<label class="small">Device volume<input id="local-volume" type="range" min="0" max="1" step="0.05" value="0.6"></label><span id="audio-status" class="small" role="status">Sound is off on this device.</span></div></section>
  ${perform?'<section id="stage"></section>':`<div class="compose-layout"><aside class="track-rail"><div class="section-heading"><h2>Tracks</h2><span id="track-count" class="small"></span></div><div id="track-list"></div><div class="add-tracks">${btn('+ Drums','drums','outline')}${btn('+ Melody','melody','outline')}</div><details><summary>Archived tracks</summary><div id="archive-list"></div></details></aside><section class="editor-area"><div id="editor"></div></section><aside class="helpers"><p class="helper-label">A LITTLE HELP</p><h2>A partner for your next idea.</h2><p class="small muted">Generate a starting point. Keep what you like, change the rest.</p><div id="bot-panel"></div><div id="assignment-panel"></div></aside></div>`}`;
  bind('.head-actions [data-action],.session-strip [data-action],.add-tracks [data-action]','click',el=>common(el.dataset.action!));
  $('#name-form').addEventListener('submit',e=>{e.preventDefault();void request('/api/handle',{handle:$<HTMLInputElement>('#your-name').value}).then(refresh).catch(fail);});
  $('#local-volume').addEventListener('input',()=>audio?.setVolume(Number($<HTMLInputElement>('#local-volume').value)));
  bind('#import-piece','change',async()=>{const file=$<HTMLInputElement>('#import-piece').files?.[0];if(!file)return;if(file.size>512*1024)throw Error('Import limit is 512 KB.');const x=await request('/api/import',JSON.parse(await file.text()));location.href=`/p/${x.id}/compose`;});
  if(!perform){selected=state.tracks.find(t=>t.ownerId===state.you.id&&!t.archivedAt)?.id??state.tracks.find(t=>!t.archivedAt)?.id??'';await select();renderBots();}
  renderShared();connect();await calibrate();
  setInterval(()=>{if(!document.hidden)void request(`/api/projects/${id}/presence`,{route:perform?'perform':'compose'}).catch(()=>{});},10000);
  void request(`/api/projects/${id}/presence`,{route:perform?'perform':'compose'});
  setInterval(()=>{if(!document.hidden)void refresh().catch(()=>{});},5000);
  setInterval(()=>{if(!live&&!document.hidden)void refresh().catch(()=>{if(draft)status();});},1000);
  setInterval(()=>{if(perform&&conductor()&&!document.hidden)void cmd('conductor.renew',{},state.transport.revision).catch(fail);},10000);
  setInterval(()=>{if(enabled&&!document.hidden)void calibrate().catch(()=>{});},30000);
  setInterval(stageTick,100);
  document.addEventListener('visibilitychange',()=>{if(document.hidden){audio?.stop();$('#audio-status').textContent='Paused while this tab is hidden.';}else if(enabled)void refresh().then(calibrate).then(join).catch(fail);});
  window.addEventListener('beforeunload',e=>{if(!perform&&dirty&&(localPending||localFailed)){e.preventDefault();e.returnValue='';}});
  (window as any).streamDebug={snapshot:()=>state,audio:()=>audio};
}
async function getAudio(){if(!audio){const {StudioAudio}=await import('./audio.ts');audio=new StudioAudio();audio.onError=s=>{enabled=false;$('#audio-status').textContent=s;soundButton();};audio.onLag=n=>{$('#audio-status').textContent=`This device is falling behind: ${n} sound${n===1?' was':'s were'} skipped. Mute or solo tracks to lighten it.`;};audio.setOffset(offset);}return audio;}
async function calibrate(){let best=Infinity;for(let i=0;i<5;i++){const a=Date.now(),x=await request('/api/time'),b=Date.now();if(b-a<best){best=b-a;offset=x.serverNowMs-(a+b)/2;}}audio?.setOffset(offset);}
function soundButton(){$('[data-action="sound"]').textContent=enabled?'Silence this device':'Enable sound';}
async function join(){if(!enabled||!audio||!live||document.hidden||previewing)return;audio.update(state.plans,state.transport.epochMs??0,state.settings.bpm,state.transport.generation);if(state.transport.status==='playing'){if(!audio.running)audio.startAt();$('#audio-status').textContent='Listening to the ensemble · joining at the next bar';}else{audio.stop();$('#audio-status').textContent='Sound enabled · ensemble stopped';}}
async function common(action:string){
  if(action==='share'){await navigator.clipboard.writeText(`${location.origin}/p/${id}/compose`);toast('Link copied. Invite someone to play.');}
  if(action==='export')location.href=`/api/projects/${id}/export`;
  if(action==='sound'){const n=++soundRun;if(enabled){enabled=false;previewing=false;audio?.stop();$('#audio-status').textContent='Sound is off on this device.';}else{$('#audio-status').textContent='Starting sound…';await (await getAudio()).prepare();if(n!==soundRun)return;audio!.setVolume(Number($<HTMLInputElement>('#local-volume').value));audio!.setSolo(solo);enabled=true;previewing=false;await join();}soundButton();}
  if(action==='drums'||action==='melody'){const x=await cmd('track.create',{kind:action});await refresh();selected=x.entityId;slot='A';await select();renderShared();}
}
function connection(on:boolean,busy=false){live=on;$('#live-status').textContent=on?'● Live together':busy?'◐ Live updates busy · checking every second':'○ Reconnecting';clearTimeout(lostTimer);if(!on)lostTimer=setTimeout(()=>{if(online())return;audio?.stop();enabled=false;soundButton();$('#audio-status').textContent='Connection lost. Your draft is safe. Enable sound after reconnecting.';},2000);if(draft)status();}
function connect(){
  const source=new EventSource(`/api/projects/${id}/events?since=${state.eventId}`);let timer:ReturnType<typeof setTimeout>|null=null,watchdog:ReturnType<typeof setTimeout>;
  // The server beats every 5 s. Silence for 8 s means the connection died without closing.
  const alive=()=>{clearTimeout(watchdog);watchdog=setTimeout(()=>{source.close();connection(false);setTimeout(connect,1000);},8000);};
  const change=()=>{alive();if(!timer)timer=setTimeout(()=>{timer=null;void refresh().catch(fail);},80);};
  source.addEventListener('open',()=>{alive();connection(true);void refresh().catch(fail);});source.addEventListener('change',change);source.addEventListener('reset',change);source.addEventListener('beat',alive);source.addEventListener('error',()=>{if(source.readyState===EventSource.CLOSED){clearTimeout(watchdog);connection(false,true);setTimeout(connect,10000);}else connection(false);});
}
async function refresh(){const n=++run,next:Snapshot=await request(`/api/projects/${id}`);lastSnapshotOk=Date.now();if(n!==run)return;const previous=clip()?.revision;state=next;if(enabled)await join();renderShared();if(!perform&&draft&&clip()?.revision!==previous&&!dirty)await select();else if(!perform&&draft)status();}
function renderShared(){
  $('#presence').textContent=state.presence.length?`${state.presence.length} here · ${state.presence.map(x=>x.handle).join(', ')}`:'Invite someone to play alongside you.';
  if(perform){if(!all('input:focus,select:focus',$('#stage')).length)preserveFocus(renderStage);return;}
  $('#track-count').textContent=`${state.tracks.filter(t=>!t.archivedAt).length}/12`;
  $('#track-list').innerHTML=state.tracks.filter(t=>!t.archivedAt).map((t,i)=>`<button class="track-card ${t.id===selected?'selected':''}" data-track="${t.id}" id="track-${t.id}"><span class="track-number">${String(i+1).padStart(2,'0')}</span><span><strong>${esc(t.name)}</strong><small>${esc(t.handle)} ${t.ownerId===state.you.id?'· yours':''}</small></span><span class="track-dot" aria-hidden="true">●</span></button>`).join('')||'<p class="small muted">Add an instrument to start.</p>';
  bind('[data-track]','click',async el=>{selected=el.dataset.track!;slot='A';await select();renderShared();});
  $('#archive-list').innerHTML=state.tracks.filter(t=>t.archivedAt).map(t=>`<p>${esc(t.name)} ${t.ownerId===state.you.id?`<button data-restore="${t.id}">Restore</button>`:''}</p>`).join('')||'<p class="small">No archived tracks.</p>';
  bind('[data-restore]','click',async el=>{const t=state.tracks.find(t=>t.id===el.dataset.restore)!;await cmd('track.restore',{trackId:t.id},t.revision);await refresh();});
  const full=state.tracks.filter(t=>!t.archivedAt).length>=12||state.tracks.filter(t=>!t.archivedAt&&t.ownerId===state.you.id).length>=2;
  all<HTMLButtonElement>('.add-tracks button').forEach(b=>b.disabled=full);renderAssignments();
}
async function select(){
  const n=++editorRun;blockEditor?.dispose();blockEditor=null;leafIndex=0;page=0;blockIssue=null;
  if(!track()){$('#editor').innerHTML='<div class="empty-editor"><span aria-hidden="true">≋</span><h2>Your piece starts with a sound.</h2><p>Add drums or a melody from the track list.</p></div>';return;}
  const c=clip(),doc=structuredClone(c?.document??emptyClip());draft={document:doc,source:c?.source??printNode(doc.root),invalid:null,baseRevision:c?.revision??0};
  try{const saved=await readDraft(key());if(n!==editorRun)return;if(saved&&own())draft=saved;}catch{toast('Local draft recovery is unavailable. Apply work before closing this page.');}
  dirty=JSON.stringify(draft.document)!==JSON.stringify(c?.document)||!!draft.invalid||draft.baseRevision!==(c?.revision??0);renderEditor();renderAssignments();
}
function saveLocal(){clearTimeout(localTimer);localPending=true;const k=key(),value=structuredClone(draft);localTimer=setTimeout(()=>void writeDraft(k,value).then(()=>{localPending=false;localFailed=false;},()=>{localPending=false;localFailed=true;toast('Draft storage failed. Apply your work before closing.');}),300);}
function edit(fn:(doc:ClipDocument)=>void,provenance:Record<string,unknown>={}){
  if(!own())return;const previous={...structuredClone(draft),undo:undefined},doc=structuredClone(draft.document);fn(doc);
  try{draft.document=validateDocument(doc);}catch(e){fail(e);return;}
  draft.undo=[...(draft.undo??[]),previous].slice(-30);delete draft.workspace;if(!draft.invalid)draft.source=printNode(doc.root);draft.provenance=provenance;dirty=true;saveLocal();preserveFocus(renderEditor);
}
function status(){if(!$('#draft-status'))return;const conflict=draft.baseRevision!==(clip()?.revision??0);$('#draft-status').textContent=blockIssue??draft.invalid??(conflict?'Saved version changed · your draft is retained':dirty?'Draft · not yet applied':'Saved · everyone has this version');$('#draft-status').classList.toggle('error',!!draft.invalid||!!blockIssue||conflict);$<HTMLButtonElement>('#apply').disabled=!own()||!!draft.invalid||!!blockIssue||!online()||conflict;
  const panel=$('#conflict');if(!panel)return;panel.hidden=!(conflict&&own());
  if(conflict&&own()&&!panel.childElementCount){panel.innerHTML=`<p><strong>Someone saved this clip while you were editing.</strong> Your draft is still here. Choose what happens next.</p><div class="conflict-actions">${btn('Keep my draft','keep','outline')}${btn('Load saved version','revert','quiet')}${btn('Save as another clip','save-as','quiet',SLOTS.every(s=>track()?.clips[s]))}</div>`;bind('#conflict [data-action]','click',el=>editorAction(el.dataset.action!));}
  if(!conflict)panel.innerHTML='';}
function renderEditor(){
  blockEditor?.dispose();blockEditor=null;const t=track();if(!t)return;
  $('#editor').innerHTML=`<div class="editor-head"><div><p class="eyebrow">${own()?'YOUR TRACK':`${esc(t.handle)}’S TRACK`}</p><h2>${esc(t.name)}</h2></div><div class="head-tools">${own()?`<form id="rename-form" class="rename"><label class="sr-only" for="track-name">Track name</label><input id="track-name" maxlength="40" value="${esc(t.name)}"><button>Rename</button></form>${btn('Archive','archive','quiet')}`:btn('Copy into my track','copy','outline')}</div></div><div class="clip-bar"><div class="clip-tabs" role="group" aria-label="Clip slots">${SLOTS.map(s=>`<button data-slot="${s}" id="slot-${s}" aria-pressed="${s===slot}">${s}${t.clips[s]?'':' · empty'}</button>`).join('')}</div>${own()?`<label class="small">History<select id="history"><option value="">Restore revision…</option>${clip()?.history.map(h=>`<option value="${h.revision}">Revision ${h.revision}</option>`).join('')??''}</select></label>`:''}</div><div class="view-tabs" role="group" aria-label="Composition views">${['instruments','blocks','code'].map(m=>`<button data-mode="${m}" id="mode-${m}" aria-pressed="${mode===m}">${m==='instruments'?'▦ Instruments':m==='blocks'?'◇ Blocks':'⌘ Code'}</button>`).join('')}</div>
  ${draft.invalid?`<p class="notice">Your unsupported draft is retained. Visual views show the last valid pattern. ${btn('Use visual version','reset','quiet')}</p>`:''}<div id="editor-body">${mode==='code'?codeHtml():mode==='blocks'?blocksHtml():instrumentHtml()}</div><div id="conflict" class="conflict" role="alert" hidden></div><div class="draft-footer"><div><span id="draft-status" role="status"></span><p class="small">${clip()?`Revision ${clip()!.revision}`:'New clip'} · stage changes are queued by bar</p></div><div class="draft-actions">${btn('Preview','preview','outline')}${btn('Stop preview','stop-preview','quiet')}${btn('Undo','undo','quiet',!own()||!draft.undo?.length)}${btn('Load saved','revert','quiet',!own())}<button id="apply" class="primary">Apply to piece ↗</button></div></div>`;
  bind('[data-slot]','click',async el=>{if(blockEditor){draft.workspace=blockEditor.save();await writeDraft(key(),draft);}slot=el.dataset.slot as Slot;await select();});
  bind('[data-mode]','click',el=>{if(blockEditor){draft.workspace=blockEditor.save();saveLocal();}mode=el.dataset.mode!;renderEditor();});
  bind('#editor [data-action]','click',el=>editorAction(el.dataset.action!));
  $('#rename-form')?.addEventListener('submit',e=>{e.preventDefault();void cmd('track.rename',{trackId:selected,name:$<HTMLInputElement>('#track-name').value},track()!.revision).then(refresh).then(()=>{renderEditor();renderShared();toast('Track renamed.');}).catch(fail);});
  bind('#apply','click',async()=>{const x=await cmd('clip.publish',{trackId:selected,slot,document:draft.document,source:draft.source,provenance:draft.provenance},draft.baseRevision);draft.baseRevision=x.entityRevision;dirty=false;clearTimeout(localTimer);await writeDraft(key(),draft);await refresh();status();toast(state.transport.status==='playing'?`Saved · plays from bar ${x.effectiveCycle+1}`:'Applied to the piece.');});
  bind('#history','change',async()=>{const revision=Number($<HTMLSelectElement>('#history').value);if(revision){await cmd('clip.restore',{trackId:selected,slot,revision},clip()!.revision);await refresh();await editorAction('revert');}});
  if(mode==='code')bindCode();if(mode==='instruments')bindInstruments();if(mode==='blocks')void bindBlocks().catch(fail);status();
}
async function editorAction(action:string){
  if(action==='preview'){if(draft.invalid||blockIssue)throw Error(draft.invalid??blockIssue!);previewing=true;await (await getAudio()).previewNode(draft.document.root);$('#audio-status').textContent='Previewing this draft locally.';}
  if(action==='stop-preview'){previewing=false;audio?.stop();$('#audio-status').textContent='Preview stopped.';}
  if(action==='undo'&&draft.undo?.length){const prev=draft.undo.pop()!,undo=draft.undo;draft={...prev,undo};dirty=true;saveLocal();renderEditor();}
  if(action==='revert'){
    if(dirty&&!confirm('Load the saved version? Your draft is replaced, and Undo can bring it back.'))return;
    const prev={...structuredClone(draft),undo:undefined},doc=structuredClone(clip()?.document??emptyClip());
    draft={document:doc,source:clip()?.source??printNode(doc.root),invalid:null,baseRevision:clip()?.revision??0,undo:dirty?[...(draft.undo??[]),prev].slice(-30):draft.undo};dirty=false;saveLocal();renderEditor();
  }
  if(action==='keep'){draft.baseRevision=clip()?.revision??0;saveLocal();status();toast('Apply when ready: your draft becomes the next saved version.');}
  if(action==='save-as'){const free=SLOTS.find(s=>!track()?.clips[s]);if(!free)throw Error('All four clip slots are in use.');const moved={...structuredClone(draft),baseRevision:0,undo:[]};clearTimeout(localTimer);await deleteDraft(key());slot=free;draft=moved;dirty=true;saveLocal();renderEditor();toast(`Your draft is now in empty clip ${free}. Apply to save it there.`);}
  if(action==='reset'){draft.invalid=null;draft.source=printNode(draft.document.root);dirty=true;saveLocal();renderEditor();}
  if(action==='archive'){await cmd('track.archive',{trackId:selected},track()!.revision);await refresh();selected=state.tracks.find(t=>!t.archivedAt)?.id??'';await select();renderShared();}
  if(action==='copy'){
    const doc=structuredClone(draft.document),from=track()!.handle,existing=state.tracks.find(t=>t.ownerId===state.you.id&&!t.archivedAt);
    if(existing){const free=SLOTS.find(s=>!existing.clips[s]);if(!free)throw Error('Your track is full. Add a track or choose a clip to replace.');selected=existing.id;slot=free;}
    else{const x=await cmd('track.create',{kind:'drums',name:'Copied idea'});await refresh();selected=x.entityId;slot='A';}
    await select();draft.document=doc;draft.source=printNode(doc.root);draft.provenance={copiedFrom:from};dirty=true;saveLocal();renderEditor();renderShared();
  }
  if(action==='copy-code'){await navigator.clipboard.writeText(draft.source);toast('Code copied.');}
  if(action==='download-code')download('stream-clip.strudel',draft.source);
}
function noteName(n:number){return ['C','C♯','D','D♯','E','F','F♯','G','G♯','A','A♯','B'][n%12]+(Math.floor(n/12)-1);}
function instrumentHtml(){
  const leaves=leavesOf(draft.document.root);leafIndex=Math.min(leafIndex,leaves.length-1);const leaf=leaves[leafIndex],length=leaf.steps.length;
  page=Math.min(page,Math.ceil(length/8)-1);const start=page*8,end=Math.min(start+8,length),kit=isKit(draft.document);
  const grid=(kit?leaves:[leaf]).map((n,row)=>{
    const li=kit?row:leafIndex;
    if(n.kind==='sound')return `<div class="drum-row"><button class="pad" data-pad="${SOUNDS[li%4]}" aria-label="Audition ${SOUNDS[li%4]}">${['Kick','Snare','Hi-hat','Clap'][li%4]}</button><div class="step-cells">${Array.from({length:end-start},(_,j)=>j+start).map(s=>`<button class="step-cell ${n.steps[s]?'on':''}" data-step="${s}" data-leaf="${li}" id="step-${li}-${s}" aria-label="${['Kick','Snare','Hi-hat','Clap'][li%4]} step ${s+1}" aria-pressed="${!!n.steps[s]}" ${own()?'':'disabled'}><span>${s+1}</span><i aria-hidden="true"></i></button>`).join('')}</div></div>`;
    const low=Math.max(48,Math.min(72,octave*12));
    return `<div class="note-grid">${Array.from({length:12},(_,i)=>low+11-i).map(note=>`<div class="note-row"><button class="note-label ${[1,3,6,8,10].includes(note%12)?'black-key':''}" data-note-pad="${note}">${noteName(note)}</button><div class="step-cells">${Array.from({length:end-start},(_,j)=>j+start).map(s=>`<button class="note-cell ${n.steps[s]===note?'on':''}" data-note="${note}" data-step="${s}" data-leaf="${li}" id="note-${note}-${s}" aria-label="${noteName(note)} step ${s+1}" aria-pressed="${n.steps[s]===note}" ${own()?'':'disabled'}></button>`).join('')}</div></div>`).join('')}</div>`;
  }).join('');
  return `<div class="instrument-toolbar"><label>Sequence<select id="leaf-select">${leaves.map((n,i)=>`<option value="${i}" ${i===leafIndex?'selected':''}>${n.kind==='notes'?'Melody':'Drums'} ${i+1}</option>`).join('')}</select></label><label>Steps<select id="step-count" ${own()?'':'disabled'}>${[...new Set([8,16,32,length])].sort((a,b)=>a-b).map(n=>`<option ${n===length?'selected':''}>${n}</option>`).join('')}</select></label>${leaf.kind==='notes'?`<label>Sound<select id="synth" ${own()?'':'disabled'}>${SYNTHS.map(s=>`<option ${leaf.synth===s?'selected':''}>${s}</option>`).join('')}</select></label><label>Octave<select id="octave">${[4,5,6].map(n=>`<option ${octave===n?'selected':''}>${n}</option>`).join('')}</select></label>`:''}</div><div class="step-pages" role="group" aria-label="Step pages">${Array.from({length:Math.ceil(length/8)},(_,p)=>`<button data-page="${p}" aria-pressed="${page===p}">${p*8+1}–${Math.min(p*8+8,length)}</button>`).join('')}</div><div class="instrument-grid">${grid}</div><div class="instrument-help"><p class="small">Tap a cell to add a sound, tap again for a rest. Apply your draft when it is ready.</p><p class="small muted">Effects and timing stay attached when you switch views.</p></div>${leaf.kind==='notes'?`<div class="step-input"><label><input id="step-entry" type="checkbox" ${stepEntry?'checked':''} ${own()?'':'disabled'}> Step input</label><label>Cursor<input id="cursor" type="number" min="1" max="${length}" value="${cursor+1}"></label><button id="input-rest" ${own()?'':'disabled'}>Insert rest →</button><p class="small">A S D F G H J play seven notes in this octave.</p></div>`:''}`;
}
function bindInstruments(){
  bind('[data-page]','click',el=>{page=Number(el.dataset.page);renderEditor();});
  bind('[data-step][data-leaf]','click',el=>edit(doc=>{const n=leavesOf(doc.root)[Number(el.dataset.leaf)],step=Number(el.dataset.step),note=Number(el.dataset.note);if(n.kind==='sound')n.steps[step]=n.steps[step]?null:SOUNDS[Number(el.dataset.leaf)%4];else n.steps[step]=n.steps[step]===note?null:note;}));
  bind('[data-pad]','click',async el=>{await (await getAudio()).audition(el.dataset.pad!);});
  bind('[data-note-pad]','click',el=>auditionNote(Number(el.dataset.notePad)));
  bind('#leaf-select','change',()=>{leafIndex=Number($<HTMLSelectElement>('#leaf-select').value);page=0;renderEditor();});
  bind('#step-count','change',()=>{const count=Number($<HTMLSelectElement>('#step-count').value),leaves=leavesOf(draft.document.root),kit=leaves.every(n=>n.kind==='sound')&&draft.document.root.kind==='stack';if((kit?leaves:[leaves[leafIndex]]).some(n=>n.steps.slice(count).some(x=>x!==null))&&!confirm('Resize and remove occupied steps? You can Undo afterwards.')){renderEditor();return;}page=0;edit(doc=>{const leaves=leavesOf(doc.root);for(const n of kit?leaves:[leaves[leafIndex]])n.steps=Array.from({length:count},(_,i)=>n.steps[i]??null) as any;});});
  bind('#synth','change',()=>{const s=$<HTMLSelectElement>('#synth').value;edit(doc=>{const n=leavesOf(doc.root)[leafIndex];if(n.kind==='notes')n.synth=s as any;});});
  bind('#octave','change',()=>{octave=Number($<HTMLSelectElement>('#octave').value);renderEditor();});
  bind('#step-entry','change',()=>stepEntry=$<HTMLInputElement>('#step-entry').checked);
  bind('#cursor','change',()=>cursor=Math.max(0,Math.min(leavesOf(draft.document.root)[leafIndex].steps.length-1,Number($<HTMLInputElement>('#cursor').value)-1)));
  bind('#input-rest','click',()=>writeStep(null));
}
function writeStep(note:number|null){edit(doc=>{const n=leavesOf(doc.root)[leafIndex];if(n.kind==='notes')n.steps[cursor]=note;cursor=(cursor+1)%n.steps.length;});}
async function auditionNote(note:number){const n=leavesOf(draft.document.root)[leafIndex];if(n.kind==='notes'){await (await getAudio()).audition(n.synth,note);if(stepEntry&&own())writeStep(note);}}
document.addEventListener('keydown',e=>{if(!draft||perform||mode!=='instruments'||(e.target as HTMLElement).matches('input,textarea,select,[contenteditable]')||e.ctrlKey||e.metaKey||e.altKey||e.repeat)return;const i='asdfghj'.indexOf(e.key.toLowerCase());if(i>=0)void auditionNote(Math.min(83,octave*12+[0,2,4,5,7,9,11][i])).catch(fail);});
function codeHtml(){return `<label class="code-label" for="clip-code">Your clip as Strudel</label><textarea id="clip-code" class="code-editor" spellcheck="false" ${own()?'':'readonly'}>${esc(draft.source)}</textarea><div class="code-actions">${btn('Copy code','copy-code','quiet')}${btn('Download code','download-code','quiet')}</div><details class="syntax-help"><summary>Supported syntax</summary><p>One expression: s("bd ~ sd ~"), note("60 ~ 64 67").s("triangle"), or stack(…). Add .fast(2), .slow(2), .rev(), .gain(0.7), .lpf(2000), .room(0.15). Plain notes, sounds and rests only, at most 128 steps per bar (steps × speed).</p><p>Unsupported programs remain drafts. Copy them to <a href="https://strudel.cc" target="_blank" rel="noopener">the full Strudel editor</a>.</p></details>`;}
function bindCode(){bind('#clip-code','input',()=>{draft.source=$<HTMLTextAreaElement>('#clip-code').value;delete draft.workspace;try{draft.document=parseCode(draft.source);draft.invalid=null;}catch(e){draft.invalid=e instanceof Error?e.message:'Unsupported code.';}dirty=true;saveLocal();status();});}
function blocksHtml(){return `<p class="small muted">Connect one musical expression. Drag blocks from the toolbox, or use the form editor below.</p><div id="block-workspace"></div><p id="block-error" role="status" class="error"></p><details class="block-form" open><summary>Keyboard / form editor</summary>${formTree(draft.document.root,'')}</details><label class="add-effect">Effect around this clip<select id="effect-op">${OPS.map(op=>`<option>${op}</option>`).join('')}</select><button id="add-effect" ${own()?'':'disabled'}>Add block</button></label>`;}
function formTree(n:MusicNode,path:string):string{
  const child=(i:number)=>path?`${path}.${i}`:String(i);
  if(n.kind==='sound'||n.kind==='notes')return `<fieldset><legend>${n.kind==='sound'?'Drum sequence':'Note sequence'}</legend><label>Steps<input data-form-steps="${path}" value="${esc(n.steps.map(x=>x??'~').join(' '))}" ${own()?'':'readonly'}></label>${n.kind==='notes'?`<label>Instrument<select data-form-synth="${path}" ${own()?'':'disabled'}>${SYNTHS.map(s=>`<option ${s===n.synth?'selected':''}>${s}</option>`).join('')}</select></label>`:''}</fieldset>`;
  if(n.kind==='stack')return `<fieldset><legend>Together</legend>${n.children.map((c,i)=>formTree(c,child(i))).join('')}</fieldset>`;
  return `<fieldset><legend>${n.op}</legend>${n.op!=='rev'?`<label>Value<input data-form-value="${path}" type="number" step="0.01" value="${n.value}" ${own()?'':'disabled'}></label>`:''}<div class="effect-buttons"><button data-remove="${path}" ${own()?'':'disabled'}>Remove effect</button><button data-swap="${path}" ${own()&&n.child.kind==='transform'?'':'disabled'}>Move inside next effect</button></div>${formTree(n.child,child(0))}</fieldset>`;
}
function nodeAt(root:MusicNode,path:string):MusicNode{return path===''?root:path.split('.').reduce((n,i)=>n.kind==='stack'?n.children[Number(i)]:n.kind==='transform'?n.child:n,root);}
function replace(doc:ClipDocument,path:string,n:MusicNode){if(path==='')doc.root=n;else{const indices=path.split('.'),last=indices.pop()!,p=nodeAt(doc.root,indices.join('.'));if(p.kind==='stack')p.children[Number(last)]=n;else if(p.kind==='transform')p.child=n;}}
async function bindBlocks(){
  const target=$('#block-workspace'),version=editorRun,{BlockEditor}=await import('./blocks.ts');if(version!==editorRun||!target.isConnected)return;
  blockEditor=new BlockEditor(target,draft.document,(doc,error)=>{if(!own())return;draft.workspace=blockEditor!.save();blockIssue=error??null;if(doc){const previous={...structuredClone(draft),undo:undefined};draft.undo=[...(draft.undo??[]),previous].slice(-30);draft.document=doc;if(!draft.invalid)draft.source=printNode(doc.root);dirty=true;}$('#block-error').textContent=error??'';saveLocal();status();},draft.workspace);
  if(!own())target.style.pointerEvents='none';
  bind('[data-form-steps]','change',el=>edit(doc=>{const n=nodeAt(doc.root,el.dataset.formSteps!);if(n.kind==='sound'||n.kind==='notes')n.steps=(el as HTMLInputElement).value.trim().split(/\s+/).map(x=>x==='~'?null:n.kind==='notes'?Number(x):x) as any;}));
  bind('[data-form-synth]','change',el=>edit(doc=>{const n=nodeAt(doc.root,el.dataset.formSynth!);if(n.kind==='notes')n.synth=(el as HTMLSelectElement).value as any;}));
  bind('[data-form-value]','change',el=>edit(doc=>{const n=nodeAt(doc.root,el.dataset.formValue!);if(n.kind==='transform')n.value=Number((el as HTMLInputElement).value);}));
  bind('[data-remove]','click',el=>edit(doc=>{const n=nodeAt(doc.root,el.dataset.remove!);if(n.kind==='transform')replace(doc,el.dataset.remove!,n.child);}));
  bind('[data-swap]','click',el=>edit(doc=>{const n=nodeAt(doc.root,el.dataset.swap!);if(n.kind==='transform'&&n.child.kind==='transform'){const inner=n.child;replace(doc,el.dataset.swap!,{...inner,child:{...n,child:inner.child}});}}));
  bind('#add-effect','click',()=>{const op=$<HTMLSelectElement>('#effect-op').value as Op;edit(doc=>doc.root={kind:'transform',op,...(op==='rev'?{}:{value:op==='fast'||op==='slow'?2:op==='gain'?0.7:op==='lpf'?2000:0.15}),child:doc.root});});
}
function renderBots(){
  $('#bot-panel').innerHTML=`<label>Partner<select id="bot-kind"><option value="rhythm">Rhythm bot</option><option value="melody">Melody bot</option></select></label><label>Density<select id="bot-density"><option value="sparse">Sparse</option><option value="steady" selected>Steady</option><option value="busy">Busy</option></select></label><label>Seed<input id="bot-seed" type="number" min="1" value="42"></label><label>Key<select id="bot-root">${['C','C♯','D','D♯','E','F','F♯','G','G♯','A','A♯','B'].map((n,i)=>`<option value="${i}">${n}</option>`).join('')}</select></label><label>Scale<select id="bot-scale"><option value="major">Major pentatonic</option><option value="minor">Minor pentatonic</option></select></label><div class="bot-actions"><button id="generate">Generate idea</button><button id="variation">New variation</button></div><div id="proposal"></div>`;
  bind('#generate','click',makeProposal);bind('#variation','click',()=>{$<HTMLInputElement>('#bot-seed').value=String((Number($<HTMLInputElement>('#bot-seed').value)+1)>>>0||1);makeProposal();});
}
function makeProposal(){
  if(!draft){toast('Add a track first.');return;}const seed=Number($<HTMLInputElement>('#bot-seed').value)>>>0,kind=$<HTMLSelectElement>('#bot-kind').value,density=$<HTMLSelectElement>('#bot-density').value as 'sparse'|'steady'|'busy',root=Number($<HTMLSelectElement>('#bot-root').value),minor=$<HTMLSelectElement>('#bot-scale').value==='minor';
  proposal=kind==='rhythm'?rhythmBot(seed,density):melodyBot(seed,root,minor,{sparse:4,steady:8,busy:12}[density]);proposalMeta={bot:kind,version:1,seed,density,root,minor};
  $('#proposal').innerHTML=`<div class="proposal"><h3>${kind==='rhythm'?'A rhythm to build on':'A melody to make your own'}</h3><p class="small">Seed ${seed} · ${density} · ${kind==='rhythm'?'anchored kick and snare':'pentatonic steps'}. Every note is editable.</p><pre>${esc(printNode(proposal.root))}</pre><button id="proposal-preview">Preview idea</button><button id="proposal-use" ${own()?'':'disabled'}>Use in my draft</button></div>`;
  bind('#proposal-preview','click',async()=>{previewing=true;await (await getAudio()).previewNode(proposal!.root);});bind('#proposal-use','click',()=>{edit(doc=>doc.root=structuredClone(proposal!.root),proposalMeta);toast('Added to your draft. Apply when ready.');});
}
function renderAssignments(){
  if(perform||!$('#assignment-panel')||!track())return;const t=track()!,p=state.plans.at(-1)!;
  $('#assignment-panel').innerHTML=`<section class="scene-map"><p class="helper-label">THE PERFORMANCE</p><h2>This track in each scene</h2>${SLOTS.map(s=>`<label>${esc(state.settings.sceneNames[s])}<select data-assignment="${s}" ${own()?'':'disabled'}><option value="" ${!p.sceneAssignments[s][t.id]?'selected':''}>Silence</option>${SLOTS.map(c=>`<option value="${c}" ${p.sceneAssignments[s][t.id]===c?'selected':''}>Clip ${c}${t.clips[c]?'':' (empty)'}</option>`).join('')}</select></label>`).join('')}<a class="stage-link" href="/p/${id}/perform">Go to the stage ↗</a></section>`;
  bind('[data-assignment]','change',async el=>{await cmd('scene.assign',{trackId:selected,scene:el.dataset.assignment,clipSlot:(el as HTMLSelectElement).value||null},track()!.revision);await refresh();});
}
function renderStage(){
  const cycle=state.transport.epochMs?Math.max(0,cycleAt(Date.now()+offset,state.transport.epochMs,state.settings.bpm)):0,p=planAt(state.plans,cycle)??state.plans.at(-1)!,queued=state.plans.at(-1)!,scene=sceneAt(p,cycle),conduct=conductor(),resolved=resolvePlan(p,cycle);
  $('#stage').innerHTML=`<div class="stage-top"><div><p class="eyebrow">THE ENSEMBLE</p><h2>One piece. Everyone’s part.</h2><p class="small muted">${state.transport.conductorId?`${esc(state.tracks.find(t=>t.ownerId===state.transport.conductorId)?.handle??'A participant')} is conducting.`:'The podium is open. Take the lead.'}</p></div><div class="conductor-actions">${btn(conduct?'Release podium':'Take conductor role',conduct?'release':'claim','outline',!!state.transport.conductorId&&!conduct)}${btn(state.transport.status==='playing'?'Stop ensemble':'Start ensemble',state.transport.status==='playing'?'stop':'start','primary',!conduct)}</div></div>
  <div class="stage-clock"><span id="bar">BAR ${Math.floor(cycle)+1}</span><div class="beat-dots" aria-hidden="true">${[0,1,2,3].map(i=>`<i id="beat-${i}"></i>`).join('')}</div><label>Tempo<input id="tempo" type="number" min="60" max="180" value="${state.settings.bpm}" ${conduct&&state.transport.status==='stopped'?'':'disabled'}> BPM</label><span role="status">${state.transport.status==='playing'?'Ensemble playing':'Ensemble stopped'}${queued.effectiveCycle>cycle?` · queued bar ${queued.effectiveCycle+1}`:''}</span></div>
  <div class="scene-launchers" role="group" aria-label="Performance scenes">${SLOTS.map(s=>`<button data-scene="${s}" class="scene-launch ${scene===s?'active':''}" aria-pressed="${scene===s}" ${conduct?'':'disabled'}><span class="scene-letter">${s}</span><strong>${esc(state.settings.sceneNames[s])}</strong><small>${scene===s?'ACTIVE':'Launch at next bar'}</small></button>`).join('')}</div><div class="performance-grid"><section class="mixer"><div class="section-heading"><h2>Ensemble mixer</h2><span class="small">Owners control their own tracks</span></div>${state.tracks.filter(t=>!t.archivedAt).map((t,i)=>{
    const own=t.ownerId===state.you.id,mix=queued.mix[t.id]??{gain:0.7,mute:false},played=resolved.find(x=>x.trackId===t.id),manual=Object.hasOwn(queued.manual,t.id);
    return `<article class="mixer-strip"><div class="mixer-name"><span class="track-number">${String(i+1).padStart(2,'0')}</span><div><h3>${esc(t.name)}</h3><p class="small">${esc(t.handle)} ${own?'· yours':''}</p></div><span class="playing-chip">${played?`CLIP ${played.slot}`:'SILENCE'}</span></div><div class="meter" aria-hidden="true"><div style="width:${mix.mute?0:mix.gain*100}%"></div></div><label>Volume<input id="mix-${t.id}" data-mix="${t.id}" type="range" min="0" max="1" step="0.05" value="${mix.gain}" ${own?'':'disabled'}></label><div class="strip-controls"><button data-mute="${t.id}" aria-pressed="${mix.mute}" ${own?'':'disabled'}>${mix.mute?'Unmute':'Mute'}</button><label>Manual clip<select data-launch="${t.id}" ${own?'':'disabled'}><option value="follow" ${manual?'':'selected'}>Follow scenes</option><option value="" ${manual&&queued.manual[t.id]===null?'selected':''}>Silence</option>${SLOTS.map(s=>`<option value="${s}" ${queued.manual[t.id]===s?'selected':''}>${s}${t.clips[s]?'':' (empty)'}</option>`).join('')}</select></label><button data-solo="${t.id}" aria-pressed="${solo.has(t.id)}" title="Only on this device">${solo.has(t.id)?'Unsolo':'Solo here'}</button><a href="/p/${id}/compose">Edit ↗</a></div></article>`;
  }).join('')||'<p class="notice">Add tracks in Compose to give the ensemble a sound.</p>'}</section>
  <aside class="arranger"><p class="helper-label">ORCHESTRATION</p><h2>Let the scenes flow.</h2><p class="small muted">The arranger advances scenes automatically. Launch a scene manually to take over.</p><label>Scenes and bars<input id="arrangement" value="${esc(arrangementDraft??state.settings.arrangement.entries.map(x=>`${x.scene}:${x.bars}`).join(', '))}" ${conduct?'':'disabled'}></label><p class="small">Up to eight entries, 1–16 bars each. Example: A:4, B:4.</p><label class="check"><input id="arr-loop" type="checkbox" ${state.settings.arrangement.loop?'checked':''} ${conduct?'':'disabled'}> Loop arrangement</label><div class="arrangement-actions">${btn('Save arrangement','arr-save','outline',!conduct)}${btn('Start arranger','arr-start','primary',!conduct||state.transport.status!=='playing')}${btn('Manual control','arr-stop','quiet',!conduct)}</div><p id="arr-status" class="small">${p.arrangement?'Arranger active':'Manual scene control'}</p><details><summary>Name scenes</summary>${SLOTS.map(s=>`<label>Scene ${s}<input data-scene-name="${s}" value="${esc(state.settings.sceneNames[s])}" maxlength="30" ${conduct?'':'disabled'}></label>`).join('')}</details></aside></div>`;
  bind('#stage [data-action]','click',el=>stageAction(el.dataset.action!));
  bind('[data-scene]','click',async el=>{await cmd('scene.launch',{scene:el.dataset.scene},state.transport.revision);await refresh();});
  bind('[data-mix]','change',async el=>{const t=state.tracks.find(t=>t.id===el.dataset.mix)!,m=state.plans.at(-1)!.mix[t.id];await cmd('track.mix',{trackId:t.id,gain:Number((el as HTMLInputElement).value),mute:m.mute},t.revision);await refresh();});
  bind('[data-mute]','click',async el=>{const t=state.tracks.find(t=>t.id===el.dataset.mute)!,m=state.plans.at(-1)!.mix[t.id];await cmd('track.mix',{trackId:t.id,gain:m.gain,mute:!m.mute},t.revision);await refresh();});
  bind('[data-launch]','change',async el=>{const t=state.tracks.find(t=>t.id===el.dataset.launch)!,value=(el as HTMLSelectElement).value;await cmd(value==='follow'?'track.follow':'track.launch',{trackId:t.id,clipSlot:value||null},t.revision);await refresh();});
  bind('[data-solo]','click',el=>{const t=el.dataset.solo!;if(solo.has(t))solo.delete(t);else solo.add(t);audio?.setSolo(solo);preserveFocus(renderStage);toast(solo.size?'Solo applies on this device only.':'Solo cleared on this device.');});
  bind('#tempo','change',async()=>{await cmd('tempo.set',{bpm:Number($<HTMLInputElement>('#tempo').value)},state.settings.revision);await refresh();});
  bind('#arrangement','input',()=>arrangementDraft=$<HTMLInputElement>('#arrangement').value);
  bind('[data-scene-name]','change',async el=>{await cmd('scene.rename',{scene:el.dataset.sceneName,name:(el as HTMLInputElement).value},state.settings.revision);await refresh();});
}
async function stageAction(action:string){
  const types:Record<string,string>={claim:'conductor.claim',release:'conductor.release',start:'transport.start',stop:'transport.stop','arr-start':'arrangement.start','arr-stop':'arrangement.stop'};
  if(action==='arr-save'){const entries=$<HTMLInputElement>('#arrangement').value.split(',').map(x=>{const m=x.trim().match(/^([A-D]):(\d{1,2})$/i);if(!m)throw Error('Use scenes and bars like A:4, B:4.');return {scene:m[1].toUpperCase(),bars:Number(m[2])};});await cmd('arrangement.save',{entries,loop:$<HTMLInputElement>('#arr-loop').checked},state.settings.revision);arrangementDraft=null;}
  else if(types[action])await cmd(types[action],{},state.transport.revision);
  await refresh();
}
function stageTick(){
  if(!state||!perform||!$('#bar'))return;
  const c=state.transport.status==='playing'&&state.transport.epochMs?Math.max(0,cycleAt(Date.now()+offset,state.transport.epochMs,state.settings.bpm)):0;
  $('#bar').textContent=`BAR ${Math.floor(c)+1}`;for(let i=0;i<4;i++)$(`#beat-${i}`).classList.toggle('on',state.transport.status==='playing'&&Math.floor((c%1)*4)===i);
  const p=planAt(state.plans,c);if(p){const scene=sceneAt(p,c),resolved=resolvePlan(p,c);for(const el of all<HTMLButtonElement>('[data-scene]')){el.classList.toggle('active',el.dataset.scene===scene);el.setAttribute('aria-pressed',String(el.dataset.scene===scene));$('small',el).textContent=el.dataset.scene===scene?'ACTIVE':'Launch at next bar';}
    all('.mixer-strip').forEach((el,i)=>{const t=state.tracks.filter(t=>!t.archivedAt)[i],active=resolved.find(x=>x.trackId===t.id);$('.playing-chip',el).textContent=active?`CLIP ${active.slot}`:'SILENCE';});
  }
}
