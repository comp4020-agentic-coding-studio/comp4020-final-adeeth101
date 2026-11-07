// The Characters page: what a person has saved, what others have shared, and the
// factory cast. Also the page a shared link opens. Everything shown here comes
// from permission-checked requests; a character someone else owns is only ever
// its listed snapshot.
import {request,type ApiError} from './api.ts';
import {esc,$,toast,errorText,on,ago,confirmDialog} from './ui.ts';
import {characterSvg} from './performer.ts';
import {enable,current} from './sound.ts';
import {openCreator,blankCharacter,type CreatorStart} from './creator.ts';
import {PACKS,PRESETS,ROLES,ROLE_LABEL,presetById,type Preset,type Role} from '../shared/presets.ts';
import {parseSource} from '../shared/expr.ts';
import type {SavedCharacter} from '../shared/studio.ts';

const roleLabel=(r:string)=>ROLE_LABEL[r as Role]??'Custom';
const creditLine=(c:SavedCharacter)=>c.credit.remixOf?`by ${esc(c.credit.creator)} · remix of ${esc(c.credit.remixOf.name)} by ${esc(c.credit.remixOf.by)}`:`by ${esc(c.credit.creator)}`;
const shareLabel=(c:SavedCharacter)=>c.visibility==='public'?'Public':c.visibility==='unlisted'?'Unlisted':'Private';
const fromSaved=(c:SavedCharacter):CreatorStart=>({id:c.id,revision:c.revision,name:c.name,role:c.role==='custom'?null:c.role,look:c.look,source:c.source,level:c.level,heading:`Edit ${c.name}`});
const fromPreset=(p:Preset):CreatorStart=>({name:`${p.name} remix`.slice(0,40),role:p.role,look:p.look,source:p.source,level:0.7,from:{presetId:p.id},heading:`Remix ${p.name}`});
const canon=(c:SavedCharacter)=>c.role==='custom'?null:c.role;

let hearing:string|null=null;
async function hear(key:string,source:string,bpm=100){
  if(hearing===key){current()?.stopPreview();hearing=null;return false;}
  const a=await enable();await a.previewItems([{document:parseSource(source).document,gain:0.7}],bpm);hearing=key;return true;
}
export function stopHearing(){current()?.stopPreview();hearing=null;}

// Choosing a mix to add a character to.
async function addToMixDialog(characterId:string,name:string){
  const {projects}=await request('/api/projects');
  if(!projects.length){toast('Start a mix first, then add your character from its cast.');return;}
  const d=document.createElement('dialog');d.className='confirm paper';d.setAttribute('aria-labelledby','pick-mix');
  d.innerHTML=`<h2 id="pick-mix">Add ${esc(name)} to a mix</h2><p class="small">The mix gets its own copy. Later changes to this character won’t touch it.</p><ul class="invite-list">${projects.map((p:any)=>`<li><strong>${esc(p.title)}</strong><span class="row-actions"><button type="button" class="outline small" data-mix="${esc(p.id)}">Add</button></span></li>`).join('')}</ul><div class="row" style="margin-top:12px"><button type="button" class="ghost" data-cancel>Cancel</button></div>`;
  document.body.append(d);d.showModal();
  d.addEventListener('close',()=>d.remove());
  d.addEventListener('click',e=>{
    const b=(e.target as HTMLElement).closest<HTMLElement>('button');if(!b)return;
    if(b.dataset.cancel!==undefined){d.close();return;}
    const mix=b.dataset.mix;if(!mix)return;
    void request(`/api/projects/${mix}/commands`,{commandId:crypto.randomUUID(),type:'part.add',payload:{characterId}}).then(()=>{d.close();toast(`${name} joined the mix.`);location.href=`/p/${mix}`;}).catch(err=>toast(errorText(err)));
  });
}

function shareDialog(c:SavedCharacter,changed:()=>Promise<void>){
  const d=document.createElement('dialog');d.className='confirm paper';d.setAttribute('aria-labelledby','share-title');
  const link=c.shareToken?`${location.origin}/c/${c.id}#share=${c.shareToken}`:'';
  d.innerHTML=`<h2 id="share-title">Share ${esc(c.name)}</h2>
    <p class="small"><strong>What is shared:</strong> this character’s name, look, Strudel code and credit, exactly as they are now. Anyone who can see it can read the code and save their own copy.</p>
    <p class="small"><strong>What is not:</strong> any mix it was used in, chat, other tracks, or your later edits until you update the listing.</p>
    <form><fieldset class="vis"><legend class="sr-only">Who can see it</legend>
      <label class="radio"><input type="radio" name="vis" value="unlisted" ${c.visibility!=='public'?'checked':''}> <strong>Unlisted</strong> <span class="small muted">People with the link.</span></label>
      <label class="radio"><input type="radio" name="vis" value="public" ${c.visibility==='public'?'checked':''}> <strong>Public</strong> <span class="small muted">Anyone, from the Characters page.</span></label></fieldset>
      <label class="radio"><input type="checkbox" name="confirm" required> <span>I’m happy to share this character’s code.</span></label>
      <div class="row" style="margin-top:12px"><button class="primary" type="submit">${c.listed?'Update listing':'Share'}</button>${c.listed?'<button type="button" class="danger" data-stop>Stop sharing</button>':''}<button type="button" class="ghost" data-close>Close</button></div></form>
    <div data-out style="margin-top:10px">${link?`<label for="share-link">Share link</label><input id="share-link" class="link-out" readonly value="${esc(link)}"><div class="row"><button type="button" class="outline small" data-copy>Copy link</button><button type="button" class="ghost small" data-rotate>Make a new link</button></div>`:''}</div>`;
  document.body.append(d);d.showModal();d.addEventListener('close',()=>{d.remove();void changed();});
  d.querySelector('form')!.addEventListener('submit',e=>{e.preventDefault();const f=new FormData(e.target as HTMLFormElement);
    void request(`/api/characters/${c.id}/publish`,{visibility:f.get('vis'),confirmSource:f.get('confirm')==='on'}).then(r=>{const n=r.character as SavedCharacter;toast(n.visibility==='public'?`${c.name} is on the Characters page.`:'Share link ready.');const out=d.querySelector<HTMLElement>('[data-out]')!;out.innerHTML=n.shareToken?`<label for="share-link">Share link</label><input id="share-link" class="link-out" readonly value="${esc(`${location.origin}/c/${c.id}#share=${n.shareToken}`)}"><div class="row"><button type="button" class="outline small" data-copy>Copy link</button></div>`:'<p class="small">Listed. Anyone can find it on the Characters page.</p>';}).catch(err=>toast(errorText(err)));});
  d.addEventListener('click',e=>{
    const b=(e.target as HTMLElement).closest<HTMLElement>('button');if(!b)return;
    if(b.dataset.close!==undefined)d.close();
    if(b.dataset.copy!==undefined){void navigator.clipboard.writeText(d.querySelector<HTMLInputElement>('#share-link')!.value).then(()=>toast('Link copied.')).catch(()=>{});}
    if(b.dataset.rotate!==undefined)void request(`/api/characters/${c.id}/rotate-link`,{}).then(r=>{d.querySelector<HTMLInputElement>('#share-link')!.value=`${location.origin}/c/${c.id}#share=${r.character.shareToken}`;toast('New link made. The old one no longer works.');}).catch(err=>toast(errorText(err)));
    if(b.dataset.stop!==undefined)void request(`/api/characters/${c.id}/unpublish`,{}).then(()=>{toast('No longer shared. Copies people already saved are theirs to keep.');d.close();}).catch(err=>toast(errorText(err)));
  });
}

export async function mountLibrary(host:HTMLElement){
  let tab:'mine'|'public'|'factory'='mine',mine:SavedCharacter[]=[],listed:SavedCharacter[]=[],more=false,page=0,search='',role:Role|'all'='all',pack=PACKS[3].id;
  const me=await request('/api/me');
  host.innerHTML=`<section class="page wide"><div class="lib-head"><h1>Characters</h1><button class="primary big" data-act="create">Create character</button></div>
    <div class="tabs" role="tablist" aria-label="Character collections"><button role="tab" id="lib-mine" data-act="tab" data-tab="mine" aria-controls="lib-panel">Yours</button><button role="tab" id="lib-public" data-act="tab" data-tab="public" aria-controls="lib-panel">Shared by others</button><button role="tab" id="lib-factory" data-act="tab" data-tab="factory" aria-controls="lib-panel">Factory cast</button></div>
    <div id="lib-filters" class="row"></div><div id="lib-panel" role="tabpanel" style="margin-top:12px"></div></section>`;
  const panel=$('#lib-panel',host)!,filters=$('#lib-filters',host)!;
  async function loadMine(){mine=(await request('/api/characters')).characters;}
  async function loadListed(){const r=await request(`/api/library?page=${page}&q=${encodeURIComponent(search)}${role==='all'?'':`&role=${role}`}`);listed=r.characters;more=r.more;}
  const card=(fig:string,name:string,meta:string,actions:string,role2:string,extra='')=>`<li class="char-card role-${role2}"><div class="fig">${fig}</div><strong>${esc(name)}</strong><span class="meta">${meta}</span>${extra}<div class="char-actions">${actions}</div></li>`;
  function drawFilters(){
    filters.innerHTML=tab==='mine'?'':`${tab==='factory'?`<label class="pack-select">Pack <select id="lib-pack">${PACKS.map(p=>`<option value="${p.id}" ${p.id===pack?'selected':''}>${esc(p.name)}</option>`).join('')}</select></label>`:`<div class="tray-search"><label class="sr-only" for="lib-search">Search shared characters</label><input id="lib-search" type="search" placeholder="Search by name" value="${esc(search)}"></div>`}<div class="chips" role="group" aria-label="Role">${(['all',...ROLES] as const).map(r=>`<button class="chip" data-act="role" data-role="${r}" aria-pressed="${role===r}">${r==='all'?'All':ROLE_LABEL[r]}</button>`).join('')}</div>`;
  }
  function draw(){
    for(const t of ['mine','public','factory'])$(`#lib-${t}`,host)!.setAttribute('aria-selected',String(tab===t));
    panel.setAttribute('aria-labelledby',`lib-${tab}`);
    if(tab==='mine'){panel.innerHTML=mine.length?`<ul class="char-grid">${mine.map(c=>card(characterSvg(c.look),c.name,`${roleLabel(c.role)} · ${creditLine(c)}<br><span class="pill" ${c.visibility!=='private'?`data-vis="${c.visibility}"`:''}>${shareLabel(c)}</span>${c.changedSinceListing?' <span class="small">Edited since sharing</span>':''}`,
        `<button class="primary small" data-act="edit" data-id="${c.id}" aria-label="Edit ${esc(c.name)}">Edit</button><button class="outline small" data-act="hear" data-id="${c.id}" aria-label="Hear ${esc(c.name)}">▶</button><button class="outline small" data-act="add" data-id="${c.id}" aria-label="Add ${esc(c.name)} to a mix">Add to mix</button><button class="outline small" data-act="copy" data-id="${c.id}" aria-label="Duplicate ${esc(c.name)}">Duplicate</button><button class="outline small" data-act="share" data-id="${c.id}" aria-label="Share ${esc(c.name)}">Share</button><button class="danger small" data-act="delete" data-id="${c.id}" aria-label="Delete ${esc(c.name)}">Delete</button>`,c.role)).join('')}</ul>`:`<p class="empty-state">No saved characters yet. Create one, or remix anyone from the Factory cast.</p>`;}
    if(tab==='public'){panel.innerHTML=listed.length?`<ul class="char-grid">${listed.map(c=>card(characterSvg(c.look),c.name,`${roleLabel(c.role)} · ${creditLine(c)}`,`<button class="primary small" data-act="preview" data-id="${c.id}" aria-label="Preview ${esc(c.name)}">Preview</button>${c.mine?'<span class="small muted">Yours</span>':`<button class="outline small" data-act="copy" data-id="${c.id}" aria-label="Save a copy of ${esc(c.name)}">Save a copy</button>`}`,c.role)).join('')}</ul>${page||more?`<div class="row" style="margin-top:12px">${page?'<button class="ghost" data-act="page" data-by="-1">Newer</button>':''}${more?'<button class="ghost" data-act="page" data-by="1">Older</button>':''}</div>`:''}`:`<p class="empty-state">${search||role!=='all'?'Nothing matches that yet.':'Nobody has shared a character publicly yet. Yours could be the first.'}</p>`;}
    if(tab==='factory'){const list=PACKS.find(p=>p.id===pack)!.presets.filter(p=>role==='all'||p.role===role);panel.innerHTML=`<ul class="char-grid">${list.map(p=>card(characterSvg(p.look),p.name,`${ROLE_LABEL[p.role]} · ${esc(p.blurb)}`,`<button class="outline small" data-act="hear-preset" data-id="${p.id}" aria-label="Hear ${esc(p.name)}">▶</button><button class="primary small" data-act="remix" data-id="${p.id}" aria-label="Remix ${esc(p.name)}">Remix</button>`,p.role)).join('')}</ul>`;}
  }
  const refreshMine=async()=>{await loadMine();draw();};
  const find=(id:string)=>[...mine,...listed].find(c=>c.id===id)!;
  on(host,'click','[data-act]',async b=>{
    const act=b.dataset.act!,id=b.dataset.id!;
    if(act==='tab'){tab=b.dataset.tab as typeof tab;role='all';stopHearing();if(tab==='public')await loadListed();drawFilters();draw();$(`#lib-${tab}`,host)!.focus();return;}
    if(act==='role'){role=b.dataset.role as Role|'all';if(tab==='public'){page=0;await loadListed();}drawFilters();draw();$<HTMLElement>(`[data-act="role"][data-role="${role}"]`,host)?.focus();return;}
    if(act==='page'){page+=Number(b.dataset.by);await loadListed();draw();return;}
    if(act==='create'){await chooseStart();return;}
    if(act==='edit'){await openCreator(fromSaved(find(id)),{visitorId:me.id,saved:()=>void refreshMine()});return;}
    if(act==='remix'){await openCreator(fromPreset(presetById(id)!),{visitorId:me.id,saved:()=>{tab='mine';void refreshMine().then(()=>{drawFilters();draw();});}});return;}
    if(act==='hear'){const c=find(id);const on2=await hear(c.id,c.source);b.textContent=on2?'■':'▶';return;}
    if(act==='hear-preset'){const p=presetById(id)!;const on2=await hear(p.id,p.source,p.bpm);b.textContent=on2?'■':'▶';return;}
    if(act==='add'){const c=find(id);await addToMixDialog(c.id,c.name);return;}
    if(act==='preview'){location.href=`/c/${id}`;return;}
    if(act==='copy'){const r=await request(`/api/characters/${id}/copy`,{});toast('Saved a copy to your characters. It’s yours to change.');await loadMine();tab='mine';drawFilters();draw();$<HTMLElement>(`[data-act="edit"][data-id="${r.id}"]`,host)?.focus();return;}
    if(act==='share'){shareDialog(find(id),refreshMine);return;}
    if(act==='delete'){const c=find(id);if(!(await confirmDialog({title:`Delete ${c.name}?`,body:`It leaves your characters${c.listed?' and stops being shared':''}. Mixes that already use it keep their own copy, and so does anyone who saved one.`,confirm:'Delete character',danger:true})))return;await request(`/api/characters/${id}/delete`,{});toast(`${c.name} deleted.`);await refreshMine();return;}
  });
  host.addEventListener('change',e=>{const t=e.target as HTMLElement;if(t.id==='lib-pack'){pack=(t as HTMLSelectElement).value;draw();}});
  let searchTimer:ReturnType<typeof setTimeout>;
  host.addEventListener('input',e=>{const t=e.target as HTMLInputElement;if(t.id!=='lib-search')return;search=t.value;clearTimeout(searchTimer);searchTimer=setTimeout(()=>{page=0;void loadListed().then(draw);},250);});
  async function chooseStart(){
    const d=document.createElement('dialog');d.className='confirm paper';d.setAttribute('aria-labelledby','start-title');
    d.innerHTML=`<h2 id="start-title">Create a character</h2><p class="small">Start empty and build everything, or begin from someone in the Factory cast.</p><h3>Start blank</h3><div class="row">${ROLES.map(r=>`<button type="button" class="outline" data-blank="${r}">${ROLE_LABEL[r]}</button>`).join('')}</div><h3 style="margin-top:12px">Remix someone</h3><p class="small muted">Open the Factory cast and press Remix on anyone.</p><div class="row"><button type="button" class="outline" data-remix>Open the Factory cast</button><button type="button" class="ghost" data-cancel>Cancel</button></div>`;
    document.body.append(d);d.showModal();d.addEventListener('close',()=>d.remove());
    d.addEventListener('click',e=>{
      const b=(e.target as HTMLElement).closest<HTMLElement>('button');if(!b)return;
      if(b.dataset.cancel!==undefined){d.close();return;}
      if(b.dataset.remix!==undefined){d.close();tab='factory';drawFilters();draw();return;}
      if(b.dataset.blank){d.close();void openCreator(blankCharacter(b.dataset.blank as Role),{visitorId:me.id,saved:()=>{tab='mine';void refreshMine().then(()=>{drawFilters();draw();});}});}
    });
  }
  await loadMine();drawFilters();draw();
  if(new URLSearchParams(location.search).has('new')){history.replaceState(null,'',location.pathname);await chooseStart();}
}

// The page a shared link opens: a preview, then an explicit choice to keep a copy.
export async function mountCharacter(host:HTMLElement,id:string){
  const token=new URLSearchParams(location.hash.slice(1)).get('share');
  if(token){await request(`/api/characters/${id}/share-link`,{token}).catch(()=>{});history.replaceState(null,'',location.pathname);}
  let c:SavedCharacter;
  try{c=await request(`/api/characters/${id}`);}
  catch(e){host.innerHTML=`<section class="notice-page"><h1>This character isn’t available</h1><p>It may be private, its link may have changed, or its owner may have stopped sharing it. ${(e as ApiError).status===404?'Ask them for a new link.':esc(errorText(e))}</p><p><a class="outline" href="/characters">See shared characters</a></p></section>`;return;}
  document.title=`${c.name} · Character · Ensemble`;
  host.innerHTML=`<section class="page card paper"><div class="char-sheet"><div>${characterSvg(c.look)}</div><div><p class="eyebrow">${esc(roleLabel(c.role))} · ${esc(shareLabel(c))}</p><h1>${esc(c.name)}</h1><p>${creditLine(c)} · ${esc(ago(c.updatedAt))}</p>
    <div class="row"><button class="outline" data-act="hear" id="char-hear">▶ Hear it</button>${c.mine?`<a class="primary" href="/characters">It’s yours: open Characters</a>`:'<button class="primary" data-act="copy">Save a copy</button>'}<button class="outline" data-act="add">Add to a mix</button></div>
    <h2 style="margin-top:16px">Strudel code</h2><pre class="source">${esc(c.source)}</pre><p class="small muted">Saving a copy gives you your own version, credited to ${esc(c.credit.creator)}. It stays yours even if this listing is removed.</p></div></div></section>`;
  on(host,'click','[data-act]',async b=>{
    const act=b.dataset.act;
    if(act==='hear'){const on2=await hear(c.id,c.source);b.textContent=on2?'■ Stop':'▶ Hear it';}
    if(act==='copy'){await request(`/api/characters/${id}/copy`,{});toast('Saved to your characters.');setTimeout(()=>{location.href='/characters';},700);}
    if(act==='add')await addToMixDialog(c.id,c.name);
  });
  void canon;void PRESETS;
}
