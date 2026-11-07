// The project room: a stage of performers, a sound tray, and one drawer at a
// time (a part, chat and people, or settings). Shared state always comes from
// the server; drafts and listening choices stay on this device.
import {request,sendCommand,type ApiError} from './api.ts';
import {esc,$,$$,toast,fail,errorText,on,ago,openLayer,closeLayer,visibilityLabel,visibilityHelp,confirmDialog} from './ui.ts';
import {performerSvg,moveCharacter,type Look} from './performer.ts';
import {connect,calibrate,type LiveState} from './live.ts';
import {audio,enable,current,soundOn,deviceVolume,setDeviceVolume} from './sound.ts';
import {codeKey,readCode,writeCode,deleteCode,type CodeDraft} from './drafts.ts';
import {PatternEditor} from './pattern-editor.ts';
import {openCreator,blankCharacter,type CreatorStart} from './creator.ts';
import {ArrangeStrip} from './arrange.ts';
import {ReactionStage} from './reactions.ts';
import {suggestSections} from '../shared/sections.ts';
import {PACKS,PRESETS,ROLE_LABEL,ROLES,presetById,type Preset,type Role} from '../shared/presets.ts';
import {parseSource,shapeState,applyShape,CONTROL_RANGE,type Control} from '../shared/expr.ts';
import {cycleAt,planAt,resolvePlan,type Slot} from '../shared/performance.ts';
import {defaultLook,type Look as CharacterLook} from '../shared/look.ts';
import type {RoomSnapshot,ViewSnapshot,Part,SavedCharacter} from '../shared/studio.ts';

type Drawer=null|{kind:'part';id:string;tab:'part'|'pattern'|'shape'|'code'}|{kind:'people'}|{kind:'settings'};
const TAB_LABEL={part:'Track',pattern:'Pattern',shape:'Shape',code:'Code'} as const;
const SHAPE_LABEL:Record<Control,{label:string;help:string;step:number;fmt:(v:number)=>string}>={
  gain:{label:'Volume',help:'How loud this track plays in the mix.',step:0.01,fmt:v=>`${Math.round(v*100)}%`},
  lpf:{label:'Brightness',help:'A low-pass filter: lower is darker and softer.',step:10,fmt:v=>`${Math.round(v)} Hz`},
  room:{label:'Space',help:'How much reverb the track sends.',step:0.01,fmt:v=>`${Math.round(v*100)}%`},
  pan:{label:'Left–right',help:'Where the track sits in stereo.',step:0.01,fmt:v=>v<0.48?`${Math.round((0.5-v)*200)}% left`:v>0.52?`${Math.round((v-0.5)*200)}% right`:'centre'},
  release:{label:'Sustain',help:'How long each note rings after it ends.',step:0.01,fmt:v=>`${v.toFixed(2)} s`},
  hpf:{label:'Thinness',help:'A high-pass filter: higher removes the low end.',step:10,fmt:v=>`${Math.round(v)} Hz`},
  attack:{label:'Fade in',help:'How slowly each note swells up.',step:0.01,fmt:v=>`${v.toFixed(2)} s`},
  decay:{label:'Pluck',help:'How quickly each note falls away after it starts.',step:0.01,fmt:v=>`${v.toFixed(2)} s`},
  sustain:{label:'Hold level',help:'How loud a note stays after it falls.',step:0.01,fmt:v=>`${Math.round(v*100)}%`},
  delay:{label:'Echo',help:'How much of the track repeats in time with the mix.',step:0.01,fmt:v=>`${Math.round(v*100)}%`},
  fm:{label:'Metal',help:'Frequency modulation: more sounds harder and more bell-like.',step:0.1,fmt:v=>v.toFixed(1)},
  fmh:{label:'Metal colour',help:'The ratio of the modulator to the note.',step:0.05,fmt:v=>v.toFixed(2)},
};
const SHAPE_DEFAULT:Record<Control,number>={gain:1,lpf:16000,room:0,pan:0.5,release:0.06,hpf:20,attack:0.012,decay:0.1,sustain:1,delay:0,fm:0,fmh:1};

const FACE_COLORS=['#ff8a6b','#7cc8f5','#6fdca8','#ffcb3d','#ff8fc0','#c6e84e','#c4a8ff'];
const hashOf=(s:string)=>{let h=0;for(const c of s)h=(h*31+c.charCodeAt(0))>>>0;return h;};
export async function mountRoom(host:HTMLElement,id:string){
  let state:RoomSnapshot;
  try{state=await request(`/api/projects/${id}`);}
  catch(e){host.innerHTML=`<section class="notice-page"><h1>This mix isn’t available</h1><p>${esc(errorText(e))}</p><p><a href="/">Back to Play</a></p></section>`;return;}
  // An unlisted view link arrives as #view=<token>: exchanged by POST, then
  // removed from the address bar so it is not kept in history or shared again.
  if((state as unknown as ViewSnapshot).access==='view'){mountView(host,state as unknown as ViewSnapshot);return;}
  const fresh=new URLSearchParams(location.search).has('new');if(fresh)history.replaceState(null,'',`/p/${id}`);
  let drawer:Drawer=null,trayOpen=fresh&&state.parts.filter(p=>!p.archivedAt).length===0,pack=PACKS[0].id,filter:Role|'all'='all',traySource:'factory'|'mine'='factory',search='',soloId:string|null=null,lastStage='';
  let offset=0,connection:LiveState='reconnecting',lastOk=Date.now(),wantSound=false,refreshRun=0,status='',statusTimer:ReturnType<typeof setTimeout>;
  let previewing:string|null=null,swapFor:string|null=null,mySounds:SavedCharacter[]=[];
  const pending=new Map<string,Promise<unknown>>();
  let chat:{messages:any[];more:boolean}={messages:[],more:false},unread=0;
  const outbox:{clientId:string;body:string;failed:boolean}[]=[];
  let codeDraft:{partId:string;slot:string;draft:CodeDraft;error:string|null;conflict:boolean}|null=null;
  let shapeDraft:Partial<Record<Control,number>>={},shapeLevel:number|null=null;
  const cmd=(type:string,payload:unknown={},rev?:number)=>sendCommand(id,type,payload,rev);
  const you=()=>state.you,isHost=()=>state.transport.hostId===state.you.id,owner=()=>state.you.role==='owner';
  const active=()=>state.parts.filter(p=>!p.archivedAt);
  const partOf=(pid:string)=>state.parts.find(p=>p.id===pid);
  const mixOf=(pid:string)=>state.plans.at(-1)?.mix[pid]??{gain:0.7,mute:false};
  const online=()=>connection==='live'||Date.now()-lastOk<3000;
  const playing=()=>state.transport.status==='playing';

  host.innerHTML=`<div class="room">
    <header class="room-head">
      <div class="room-title"><h1 id="room-title" tabindex="-1"></h1><button class="ghost small" data-act="rename" aria-label="Rename this mix"><span class="rename-word">Rename</span><span class="rename-mark" aria-hidden="true">✎</span></button><span id="privacy" class="pill"></span><span id="host-line" class="host-line"></span></div>
      <div class="room-people" role="group" aria-label="People">
        <ul id="faces" class="faces" aria-label="People in this mix"></ul>
        <button data-act="invite" class="outline">Invite</button>
        <button data-act="people" class="outline people-btn" id="people-btn" aria-label="Chat and people"><span aria-hidden="true">💬</span> <span class="label">Chat</span> <span id="unread" class="badge" hidden></span></button>
        <button data-act="settings" class="ghost" aria-label="Mix settings">⋯</button>
      </div>
    </header>
    <div id="banners"></div>
    <section id="arrange" class="arrange" aria-label="Sections" hidden></section>
    <div class="room-body">
      <section class="stage-wrap" aria-label="Stage">
        <p id="status-line" class="status-line" role="status" aria-live="polite"></p>
        <p id="reaction-tally" class="reaction-tally" hidden></p>
        <ol id="stage" class="stage"></ol>
        <div id="reaction-layer" class="reaction-layer" aria-hidden="true"></div>
        <p id="reaction-voice" class="sr-only" role="status" aria-live="polite"></p>
      </section>
      <aside id="drawer" class="drawer paper" hidden></aside>
    </div>
    <section id="tray" class="tray paper" aria-label="Cast" hidden></section>
    <footer class="dock" role="group" aria-label="Mix controls">
      <button data-act="tray" id="cast-btn" class="outline" aria-expanded="false">Cast</button>
      <button data-act="arrange" id="arrange-btn" class="outline" aria-expanded="false" aria-controls="arrange">Sections</button>
      <button class="primary play" data-act="play" id="play"></button>
      <div class="device-sound"><button data-act="sound" id="sound-toggle" class="sound"></button><label class="volume"><span class="sr-only">Device volume</span><input id="device-volume" type="range" min="0" max="1" step="0.05" aria-label="Device volume"></label></div>
      <button data-act="golive" id="golive" class="outline live-btn"></button>
      <button data-act="export" id="export-btn" class="outline">Export audio</button>
    </footer>
    <div id="dialog-root"></div>
  </div>`;
  const el={title:$('#room-title',host)!,privacy:$('#privacy',host)!,stage:$('#stage',host)!,drawer:$('#drawer',host)!,tray:$('#tray',host)!,status:$('#status-line',host)!,banners:$('#banners',host)!,play:$<HTMLButtonElement>('#play',host)!,sound:$<HTMLButtonElement>('#sound-toggle',host)!,golive:$<HTMLButtonElement>('#golive',host)!,volume:$<HTMLInputElement>('#device-volume',host)!,unread:$('#unread',host)!,dialog:$('#dialog-root',host)!,faces:$('#faces',host)!,hostLine:$('#host-line',host)!,arrange:$('#arrange',host)!,cast:$('#cast-btn',host)!,arrangeBtn:$('#arrange-btn',host)!};
  const reactions=new ReactionStage($('#reaction-layer',host)!,$('#reaction-tally',host)!,$('#reaction-voice',host)!);
  // The drawer is redrawn as things change, but the step editor keeps how it was
  // being looked at, so it lives in one element that is moved in and out.
  const patternRoot=document.createElement('div');
  const patternEditor=new PatternEditor(patternRoot,{
    source:()=>draftSource(),change:setDraft,
    editable:()=>{const p=drawer?.kind==='part'?partOf(drawer.id):null;return !!p&&canEditPart(p);},
    readOnlyReason:()=>{const p=drawer?.kind==='part'?partOf(drawer.id):null;return p?.lease&&p.lease.visitorId!==you().id?`${p.lease.handle} is editing this track. You can look, and editing opens when they finish.`:p?.guest?'Only the guest who brought this track can change it.':state.editors.reason??'You can’t edit this right now.';},
    makeCopy:source=>{void makeStepCopy(source);},
    gotoCode:()=>{if(drawer?.kind==='part'){drawer.tab='code';renderDrawer();}},
  });
  const arrange=new ArrangeStrip(el.arrange,{
    state:()=>state,offset:()=>offset,isHost,online,
    command:async(type,payload,rev)=>{await cmd(type,payload,rev);await refresh();},
    run:async()=>{await turnSoundOn();if(playing())await cmd('arrangement.start');else await cmd('transport.start',{arrangement:true},state.transport.revision);await refresh();say('Sequence running.');},
    hear:hearSection,hearing:()=>previewing?.startsWith('section:')?previewing.slice(8) as Slot:null,
    suggest:()=>suggestDialog(),
    rename:(scene,name)=>{dialog('Rename section',`<label for="section-name">Name</label><input id="section-name" name="name" maxlength="30" required value="${esc(name)}" autofocus><div class="row"><button class="primary" type="submit">Rename</button></div>`,async f=>{await command2('scene.rename',{scene,name:new FormData(f).get('name')},undefined,'Renamed.');});},
  });
  el.volume.value=String(deviceVolume());

  // --- status ------------------------------------------------------------------
  function say(text:string,sticky=false){status=text;el.status.textContent=text;clearTimeout(statusTimer);if(!sticky)statusTimer=setTimeout(()=>{status='';renderStatus();},6000);}
  function renderStatus(){
    if(status){el.status.textContent=status;return;}
    const bits:string[]=[];
    if(connection==='reconnecting')bits.push('Reconnecting… your drafts stay on this device.');
    else if(connection==='busy')bits.push('Live updates are busy; checking every second.');
    else if(connection==='revoked')bits.push('You no longer have access to this mix.');
    if(previewing)bits.push('Previewing locally — only you hear this.');
    else if(playing())bits.push(soundOn()&&wantSound?'Shared mix playing.':'Shared mix playing — sound is off on this device.');
    else bits.push(state.transport.hostId?`Stopped. ${isHost()?'You are':`${state.transport.hostHandle} is`} hosting.`:'Stopped. No one is hosting — press Play to host.');
    el.status.textContent=bits.join(' ');
  }

  // --- header -----------------------------------------------------------------------
  function renderHead(){
    el.title.textContent=state.title;document.title=`${state.title} · Mix · Ensemble`;
    const present=new Set(state.presence.map(x=>x.id)),shown=state.members.slice(0,5),extra=state.members.length-shown.length;
    const faceMarkup=shown.map(m=>`<li class="${present.has(m.id)?'here':''}" style="background:${FACE_COLORS[hashOf(m.id)%FACE_COLORS.length]}" title="${esc(m.handle)}${m.role==='owner'?' · owner':''}${m.id===state.transport.hostId?' · host':''}"><span aria-hidden="true">${esc(m.handle.slice(0,2).toUpperCase())}</span><span class="sr-only">${esc(m.handle)}${m.role==='owner'?', owner':''}${m.id===state.transport.hostId?', host':''}${present.has(m.id)?', here now':''}</span></li>`).join('')+(extra>0?`<li class="more">+${extra}</li>`:'');
    if(el.faces.dataset.markup!==faceMarkup){el.faces.dataset.markup=faceMarkup;el.faces.innerHTML=faceMarkup;}
    el.hostLine.textContent=state.transport.hostId?`${isHost()?'You are':`${state.transport.hostHandle} is`} hosting`:'Nobody hosting';
    el.cast.setAttribute('aria-expanded',String(trayOpen));el.arrangeBtn.setAttribute('aria-expanded',String(!el.arrange.hidden));
    if(!state.performance)reactions.clear();
    el.privacy.textContent=visibilityLabel[state.visibility];el.privacy.dataset.vis=state.visibility;el.privacy.title=visibilityHelp[state.visibility];
    const canPlay=isHost()||!state.transport.hostId;
    el.play.textContent=playing()?'■ Stop':'▶ Play';el.play.classList.toggle('primary',canPlay||(playing()&&owner()));el.play.classList.toggle('outline',!(canPlay||(playing()&&owner())));el.play.setAttribute('aria-pressed',String(playing()));
    el.play.disabled=!online()||(!canPlay&&!(playing()&&owner()));
    el.play.title=canPlay?(playing()?'Stop the shared mix for everyone':'Start the shared mix for everyone'):`${state.transport.hostHandle} controls shared playback`;
    el.sound.textContent=soundOn()&&wantSound?'🔊 Sound on':'🔈 Enable sound';el.sound.setAttribute('aria-pressed',String(soundOn()&&wantSound));
    el.golive.textContent=state.performance?'● Live':'Go live';el.golive.classList.toggle('is-live',!!state.performance);
    el.golive.disabled=!state.performance&&!isHost();el.golive.title=state.performance?'Manage the live performance':isHost()?'Start a performance others can listen to':'Only the host can go live';
    el.unread.hidden=!unread;el.unread.textContent=String(unread);
    const b:string[]=[];
    if(state.migratedPublic)b.push(`<div class="banner"><p><strong>This mix is Public.</strong> Mixes made before Ensemble were open to anyone with the address, so it stayed public when it moved over. Choose who can see it.</p><button data-act="settings" class="outline small">Change</button><button data-act="ack-public" class="ghost small">Keep public</button></div>`);
    if(!state.editors.youCanEdit)b.push(`<div class="banner"><p>${esc(state.editors.reason)}</p></div>`);
    if(state.performance)b.push(`<div class="banner live"><p><strong>● Live now:</strong> ${esc(state.performance.title)} (${state.performance.visibility==='public'?'public — in Live now':'unlisted — people with the listen link'}).</p><a class="outline small" href="/live/${esc(state.performance.id)}">Audience view</a></div>`);
    el.banners.innerHTML=b.join('');
    renderStatus();
  }

  // --- stage ------------------------------------------------------------------------
  function stagePartState(p:Part){
    const plan=state.plans,cycle=playing()&&state.transport.epochMs?cycleAt(Date.now()+offset,state.transport.epochMs,state.settings.bpm):0;
    const now=planAt(plan,cycle),sounding=now?resolvePlan(now,cycle).some(x=>x.trackId===p.id):false,queuedPlan=plan.at(-1);
    const queued=playing()&&queuedPlan&&queuedPlan.effectiveCycle>cycle&&(JSON.stringify(queuedPlan.catalog[p.id])!==JSON.stringify(now?.catalog[p.id])||JSON.stringify(queuedPlan.mix[p.id])!==JSON.stringify(now?.mix[p.id]));
    const mute=mixOf(p.id).mute;
    return {label:mute?'Muted':queued?`Joining bar ${queuedPlan!.effectiveCycle+1}`:playing()?(sounding?'Playing':'Silent'):'Ready',cls:mute?'muted':queued?'queued':playing()&&sounding?'playing':playing()?'silent':'idle'};
  }
  // A drawing is only made once per look: the stage redraws as states change, and
  // rebuilding a dozen figures each time would restart their motion.
  const drawings=new Map<string,string>();
  const figure=(p:{id:string;role:Role|'custom';look:CharacterLook|null})=>{const key=`${p.id}:${JSON.stringify(p.look)}:${p.role}`;let svg=drawings.get(key);if(!svg){svg=performerSvg(p.role as Look,p.id,p.look);if(drawings.size>96)drawings.clear();drawings.set(key,svg);}return svg;};
  function renderStage(){
    const parts=active(),full=parts.length>=12;
    const focused=document.activeElement?.closest?.('[data-part]')?.getAttribute('data-part');
    const markup=parts.map(p=>{
      const s=stagePartState(p),c=p.clips.A,edited=c&&c.editedBy.id!==p.addedBy.id;
      const lease=p.lease&&p.lease.visitorId!==you().id?`<span class="lease">✎ ${esc(p.lease.handle)} editing</span>`:'';
      const selected=drawer?.kind==='part'&&drawer.id===p.id;
      return `<li class="performer ${s.cls} ${selected?'selected':''} role-${p.role}" data-part="${p.id}">
        <button class="performer-btn" data-act="select" data-id="${p.id}" aria-pressed="${selected}" aria-label="${esc(p.name)}, ${ROLE_LABEL[p.role as Role]??'Custom'}, added by ${esc(p.addedBy.handle)}, ${s.label}">
          <span class="figure-box">${figure(p)}</span>
          <span class="nameplate"><strong>${esc(p.name)}</strong><span class="role-tag">${ROLE_LABEL[p.role as Role]??'Custom'}${p.guest?' · guest':''}</span></span>
        </button>
        <span class="credit">${esc(p.addedBy.handle)}${edited?` · edited by ${esc(c!.editedBy.handle)}`:''}</span>
        <span class="state-tag">${s.label}</span>${lease}
      </li>`;}).join('')+
      (full?'':`<li class="performer add-slot"><button class="add-btn" data-act="tray" aria-expanded="${trayOpen}"><span class="plus" aria-hidden="true">+</span><span>${parts.length?'Add a character':'Add your first character'}</span></button></li>`)+
      (full?'<li class="stage-note">The stage is full at 12 characters. Remove one to add another.</li>':'');
    if(markup===lastStage)return;
    lastStage=markup;el.stage.innerHTML=markup;
    el.stage.className=`stage ${parts.length?parts.length<=4?'':parts.length<=7?'fit-m':'fit-s':'empty'}`;
    if(focused)$<HTMLElement>(`[data-part="${focused}"] .performer-btn`,el.stage)?.focus({preventScroll:true});
  }

  // --- sound tray ---------------------------------------------------------------------
  // Rebuilding the tray replaces its buttons: a keyboard user loses focus, and
  // a click in flight lands on an element no longer in the document, so the
  // press does nothing. The tray is only rebuilt when something it shows has
  // actually changed, which a snapshot of those inputs decides.
  let trayKey='';
  type Listing=Preset|(SavedCharacter&{mine:true});
  function listing():Listing[]{
    const q=search.trim().toLowerCase(),match=(x:Listing)=>!q||x.name.toLowerCase().includes(q)||('blurb' in x&&x.blurb.toLowerCase().includes(q));
    const roleOk=(x:Listing)=>filter==='all'||x.role===filter;
    if(traySource==='mine')return mySounds.map(x=>({...x,mine:true as const})).filter(x=>match(x)&&roleOk(x));
    // Searching looks across every pack; otherwise it is one pack at a time.
    return (q?PRESETS:PACKS.find(x=>x.id===pack)!.presets).filter(x=>match(x)&&roleOk(x));
  }
  function listHtml(){
    const list=listing(),target=swapFor?partOf(swapFor):null;
    const verb=!playing()&&(isHost()||!state.transport.hostId)&&online()?'Add and play':'Add';
    const canAdd=state.editors.youCanEdit&&online()&&(target||active().length<12);
    return list.length?list.map(x=>{const mine='source' in x&&'credit' in x?1:0;return `<li class="sound-card role-${x.role}" draggable="true" data-sound="${esc(x.id)}" data-mine="${mine}">
      <span class="sound-icon" aria-hidden="true">${figure({id:x.id,role:x.role as Role,look:x.look})}</span>
      <span class="sound-name"><strong>${esc(x.name)}</strong><small>${mine?`${ROLE_LABEL[x.role as Role]??'Custom'} · yours`:`${ROLE_LABEL[x.role as Role]} · ${esc((x as Preset).blurb)}`}</small></span>
      <span class="sound-actions"><button class="ghost small" data-act="preview" data-sound="${esc(x.id)}" data-mine="${mine}" aria-pressed="${previewing===x.id}" aria-label="${previewing===x.id?'Stop preview of':'Preview'} ${esc(x.name)}">${previewing===x.id?'■':'▶'}<span class="sr-only"> preview</span></button>
      <button class="ghost small" data-act="remix" data-sound="${esc(x.id)}" data-mine="${mine}" aria-label="Remix ${esc(x.name)}">✎</button>
      <button class="primary small" data-act="${target?'swap':'add'}" data-sound="${esc(x.id)}" data-mine="${mine}" ${canAdd?'':'disabled'} aria-label="${target?'Swap to':verb} ${esc(x.name)}">${target?'Swap':verb}</button></span>
    </li>`;}).join(''):`<li class="empty">${search?'Nobody by that name. Try another word.':traySource==='mine'?'Characters you create or save appear here.':'No characters of that type in this pack.'}</li>`;
  }
  function renderTray(force=false){
    el.tray.hidden=!trayOpen;if(!trayOpen){trayKey='';return;}
    const key=JSON.stringify([pack,filter,traySource,swapFor,previewing,mySounds.map(s=>[s.id,s.revision]),
      !playing()&&(isHost()||!state.transport.hostId)&&online(),
      state.editors.youCanEdit&&online(),active().length>=12,state.settings.bpm]);
    if(!force&&key===trayKey)return;
    const focused=el.tray.contains(document.activeElement)?document.activeElement as HTMLElement:null;
    const focusSelector=focused?.id?`#${CSS.escape(focused.id)}`:focused?.dataset.act?
      `[data-act="${CSS.escape(focused.dataset.act)}"]${focused.dataset.sound?`[data-sound="${CSS.escape(focused.dataset.sound)}"]`:''}${focused.dataset.role?`[data-role="${CSS.escape(focused.dataset.role)}"]`:''}`:null;
    trayKey=key;
    const p=PACKS.find(x=>x.id===pack)!,target=swapFor?partOf(swapFor):null;
    el.tray.innerHTML=`<div class="tray-head">
      <h2 id="tray-title">${target?`Swap ${esc(target.name)} for someone else`:'Who joins the band?'}</h2>
      <button class="primary small" data-act="create-character">Create character</button>
      <div class="tray-filters">
        <label class="pack-select">Pack <select id="pack">${PACKS.map(x=>`<option value="${x.id}" ${x.id===pack&&traySource==='factory'?'selected':''}>${esc(x.name)} · ${x.suggestedBpm} BPM</option>`).join('')}<option value="mine" ${traySource==='mine'?'selected':''}>My characters</option></select></label>
        <div class="chips" role="group" aria-label="Character type">${(['all',...ROLES] as const).map(r=>`<button class="chip" data-act="filter" data-role="${r}" aria-pressed="${filter===r}">${r==='all'?'All':ROLE_LABEL[r]}</button>`).join('')}</div>
        <div class="tray-search"><label class="sr-only" for="cast-search">Search the cast</label><input id="cast-search" type="search" placeholder="Search the cast" value="${esc(search)}"></div>
      </div>
      <button class="ghost close" data-act="close-tray" aria-label="Close the cast">✕</button>
    </div>
    ${traySource==='factory'&&!search?`<p class="tray-note">${esc(p.mood)}, in A minor like everyone else, so any pack mixes with any other.${p.suggestedBpm!==state.settings.bpm?` ${esc(p.name)} suits ${p.suggestedBpm} BPM; this mix is at ${state.settings.bpm}. ${isHost()&&!playing()?`<button class="ghost small" data-act="use-bpm" data-bpm="${p.suggestedBpm}">Use ${p.suggestedBpm} BPM</button>`:'The host can change tempo while stopped.'}`:''}</p>`:''}
    <ul class="sounds" id="sound-list">${listHtml()}</ul>`;
    if(focusSelector)$<HTMLElement>(focusSelector,el.tray)?.focus({preventScroll:true});
  }

  // --- drawers ---------------------------------------------------------------------------
  const canEditPart=(p:Part)=>{const lease=p.lease,other=!!lease&&lease.visitorId!==you().id,guestOther=p.guest&&p.addedBy.id!==you().id;return state.editors.youCanEdit&&online()&&!other&&!guestOther;};
  const draftSource=()=>{const p=drawer?.kind==='part'?partOf(drawer.id):null;return codeDraft&&codeDraft.partId===p?.id?codeDraft.draft.source:p?.clips.A?.source??'';};
  // Everything that redraws a panel goes through here, so a keyboard user keeps
  // their place when an update arrives while they are on a button or a step.
  function keepFocus(root:HTMLElement,draw:()=>void){
    const FOCUSABLE='button,input,select,textarea,a[href],[tabindex]';
    const a=document.activeElement as HTMLElement|null,inside=a&&root.contains(a)&&a!==root?a:null,scroll=root.scrollTop;
    const selector=!inside?null:inside.id?`#${CSS.escape(inside.id)}`:inside.classList.contains('cell')?`.cell[data-grid="${inside.dataset.grid}"][data-r="${inside.dataset.r}"][data-c="${inside.dataset.c}"]`:inside.dataset.act?`[data-act="${CSS.escape(inside.dataset.act)}"]${inside.dataset.id?`[data-id="${CSS.escape(inside.dataset.id)}"]`:''}`:null;
    // A control with nothing to name it is found again by its place in the panel.
    const place=inside?[...root.querySelectorAll(FOCUSABLE)].indexOf(inside):-1;
    draw();root.scrollTop=scroll;
    if(inside)((selector?$<HTMLElement>(selector,root):null)??root.querySelectorAll<HTMLElement>(FOCUSABLE)[place])?.focus({preventScroll:true});
  }
  function renderDrawer(){keepFocus(el.drawer,drawDrawer);}
  function drawDrawer(){
    el.drawer.hidden=!drawer;host.classList.toggle('drawer-open',!!drawer);el.drawer.classList.toggle('wide',drawer?.kind==='part'&&drawer.tab==='pattern');
    if(!drawer){el.drawer.innerHTML='';return;}
    if(drawer.kind==='people')return renderPeople();
    if(drawer.kind==='settings')return renderSettings();
    const p=partOf(drawer.id);if(!p||p.archivedAt){drawer=null;drawDrawer();return;}
    const c=p.clips.A!,mix=mixOf(p.id),lease=p.lease,leasedByOther=!!lease&&lease.visitorId!==you().id,guestOther=p.guest&&p.addedBy.id!==you().id;
    const canEdit=canEditPart(p);
    const tab=drawer.tab;
    el.drawer.innerHTML=`<div class="drawer-head"><div class="drawer-who">${figure(p)}<div><p class="eyebrow">${ROLE_LABEL[p.role as Role]??'Custom'}</p><h2 id="drawer-title">${esc(p.name)}</h2>
      <p class="small">Added by ${esc(p.addedBy.handle)}${c.editedBy.id!==p.addedBy.id||c.revision>1?` · last edited by ${esc(c.editedBy.handle)} ${ago(c.editedAt)}`:''}</p></div></div>
      <button class="ghost close" data-act="close-drawer" aria-label="Close">✕</button></div>
      ${leasedByOther?`<p class="banner"><span>✎ ${esc(lease!.handle)} is editing this track. You can duplicate it or ask in chat; editing opens when they finish.</span></p>`:''}
      ${guestOther?'<p class="banner">This track belongs to a guest performer. Keep it in the mix to make your own copy.</p>':''}
      <div class="tabs" role="tablist" aria-label="Track tools">${(['part','pattern','shape','code'] as const).map(t=>`<button role="tab" id="tab-${t}" aria-selected="${tab===t}" aria-controls="panel-${t}" data-act="tab" data-tab="${t}">${TAB_LABEL[t]}</button>`).join('')}</div>
      <div class="tab-panel" role="tabpanel" id="panel-${tab}" aria-labelledby="tab-${tab}">${tab==='part'?partPanel(p,mix,canEdit):tab==='pattern'?patternPanel(p,canEdit):tab==='shape'?shapePanel(p,draftSource(),canEdit):codePanel(p,canEdit)}</div>`;
    if(tab==='pattern'){$('#pattern-host',el.drawer)?.replaceWith(patternRoot);patternEditor.render();}
  }
  function partPanel(p:Part,mix:{gain:number;mute:boolean},canEdit:boolean){
    const history=p.clips.A?.history??[];
    return `<div class="part-actions">
      <button data-act="mute" data-id="${p.id}" aria-pressed="${mix.mute}" ${online()&&!(p.guest&&p.addedBy.id!==you().id)?'':'disabled'}>${mix.mute?'Unmute':'Mute'}</button>
      <button data-act="solo" data-id="${p.id}" aria-pressed="${soloId===p.id}">${soloId===p.id?'Hear everyone':'Solo for me'}</button>
      <button data-act="change-look" data-id="${p.id}" ${online()&&!(p.guest&&p.addedBy.id!==you().id)?'':'disabled'}>Change look</button>
      <button data-act="swap-open" data-id="${p.id}" ${canEdit&&!p.guest?'':'disabled'}>Swap character</button>
      <button data-act="save-character" data-id="${p.id}">Save to my characters</button>
      <button data-act="duplicate" data-id="${p.id}" ${state.editors.youCanEdit&&online()&&active().length<12&&!p.guest?'':'disabled'}>Duplicate</button>
      <button data-act="rename-part" data-id="${p.id}" ${online()&&!p.guest?'':'disabled'}>Rename</button>
      ${p.guest?`<button data-act="keep" data-id="${p.id}" ${online()&&active().length<12?'':'disabled'}>Keep in the mix</button>`:`<button data-act="remove" data-id="${p.id}" class="danger" ${canEdit?'':'disabled'}>Remove from stage</button>`}
    </div>
    <p class="small muted">Mute and edits are shared with everyone and join at the next bar. Solo changes only what you hear.</p>
    ${history.length>1?`<details class="history"><summary>History (${history.length})</summary><ol>${history.map(h=>`<li>Revision ${h.revision} · ${esc(h.by)} · ${ago(h.createdAt)} ${h.revision!==p.clips.A!.revision?`<button class="ghost small" data-act="restore" data-id="${p.id}" data-rev="${h.revision}" ${canEdit?'':'disabled'}>Restore</button>`:'<span class="pill">current</span>'}</li>`).join('')}</ol><p class="small muted">Restoring makes a new revision; nothing is overwritten.</p></details>`:''}
    ${Object.keys(p.clips).length>1?`<details class="history"><summary>Earlier clip slots</summary><p class="small">This track came from Stream with ${Object.keys(p.clips).length} clips. The stage plays clip A; the others are kept.</p><ul>${Object.values(p.clips).map(c=>`<li>Clip ${c!.slot}: <code>${esc(c!.source.slice(0,80))}${c!.source.length>80?'…':''}</code></li>`).join('')}</ul></details>`:''}`;
  }
  // Status and actions for the one draft that Pattern and Code both edit.
  function draftBar(p:Part,canEdit:boolean){
    const d=codeDraft&&codeDraft.partId===p.id?codeDraft:null,saved=p.clips.A!.source;
    const source=d?.draft.source??saved,dirty=source!==saved,conflict=!!d?.conflict;
    return `<p id="code-error" class="code-error ${d?.error?'error':''}" role="status" aria-live="polite">${d?.error?esc(d.error):dirty?'Draft saved on this device · not shared yet.':'This is the saved music everyone hears.'}</p>
      ${conflict?`<div class="conflict" role="alert"><p><strong>Someone saved this track while you were editing.</strong> Your draft is still here.</p><div class="row"><button class="outline" data-act="code-keep">Keep my draft</button><button class="ghost" data-act="code-load">Load current</button><button class="ghost" data-act="code-new">Save as new track</button></div></div>`:''}
      <div class="row code-actions">
        <button class="outline" data-act="code-preview" aria-pressed="${previewing===`code:${p.id}`}" ${d?.error?'disabled':''}>${previewing===`code:${p.id}`?'■ Stop preview':'▶ Preview on my device'}</button>
        <button class="primary" data-act="code-apply" ${canEdit&&dirty&&!d?.error&&!conflict&&online()?'':'disabled'}>Apply to mix</button>
        <button class="ghost" data-act="code-restore" ${dirty?'':'disabled'}>Restore previous</button>
      </div>`;
  }
  function patternPanel(p:Part,canEdit:boolean){return `<div id="pattern-host"></div>${draftBar(p,canEdit)}`;}
  // Volume is the part's level in the shared mix: it scales whatever the code
  // says, so it never overrides one layer's balance. The other controls edit
  // one outer call in the code, and only where that keeps the meaning.
  function shapePanel(p:Part,source:string,canEdit:boolean){
    let controls:Control[]=['lpf','room','delay','pan','release'];
    if(p.presetId){const preset=presetById(p.presetId,p.presetVersion??undefined);if(preset)controls=preset.macros.filter((m):m is Control=>m!=='gain');}
    const level=shapeLevel??mixOf(p.id).gain,levelOk=online()&&!(p.guest&&p.addedBy.id!==you().id);
    const volume=`<div class="shape-row"><label for="shape-level"><strong>Volume</strong> <span class="small muted">This track’s level in the mix. It scales it without changing its code.</span></label>
      <div class="shape-input"><input type="range" id="shape-level" data-level min="0" max="1" step="0.01" value="${level}" ${levelOk?'':'disabled'} aria-describedby="shape-level-out"><output id="shape-level-out">${Math.round(level*100)}%</output></div></div>`;
    const rows=volume+controls.map(ctl=>{
      let st;try{st=shapeState(source,ctl);}catch{st={available:false,value:null,reason:'This track’s code has a mistake. Fix it in Code.'};}
      const [lo,hi]=CONTROL_RANGE[ctl],meta=SHAPE_LABEL[ctl],value=shapeDraft[ctl]??st.value??SHAPE_DEFAULT[ctl];
      const isDrum=/^stack\(s\(|^s\(/.test(source.trim());
      const disabled=!st.available||!canEdit||(ctl==='release'&&isDrum);
      const why=!st.available?st.reason:ctl==='release'&&isDrum?'Drum hits have a fixed length, so sustain does nothing here.':'';
      return `<div class="shape-row"><label for="shape-${ctl}"><strong>${meta.label}</strong> <span class="small muted">${meta.help}</span></label>
        <div class="shape-input"><input type="range" id="shape-${ctl}" data-shape="${ctl}" min="${ctl==='lpf'?200:lo}" max="${ctl==='lpf'?12000:hi}" step="${meta.step}" value="${value}" ${disabled?'disabled':''} aria-describedby="shape-${ctl}-out"><output id="shape-${ctl}-out">${meta.fmt(value)}</output></div>
        ${why?`<p class="small muted">${esc(why)}</p>`:''}</div>`;}).join('');
    const changed=Object.keys(shapeDraft).length>0||shapeLevel!==null;
    return `<form class="shape" data-form="shape">${rows}<div class="row"><button class="primary" type="submit" ${changed&&online()?'':'disabled'}>Apply to mix</button><button class="ghost" type="button" data-act="shape-reset" ${changed?'':'disabled'}>Undo changes</button></div><p class="small muted">These change the track’s code, which you can see in Code. Changes join the shared mix at the next bar.</p></form>`;
  }
  function codePanel(p:Part,canEdit:boolean){
    return `<div class="code">
      <label for="code-editor" class="code-label">Strudel code <span class="small muted">(revision ${p.clips.A!.revision})</span></label>
      <textarea id="code-editor" class="code-editor" spellcheck="false" autocapitalize="off" autocomplete="off" ${canEdit?'':'readonly'} aria-describedby="code-error code-help">${esc(draftSource())}</textarea>
      ${draftBar(p,canEdit)}
      <details class="syntax" id="code-help"><summary>What can I write?</summary><p>One expression: <code>s("bd ~ sd ~")</code> for drums (bd, sd, hh, oh, cp, rim, lt, ht, cb, sh), <code>note("a2 c3 e3").s("triangle")</code> for notes (sine, triangle, square, sawtooth, supersaw, pulse; MIDI 24–96 or names), and <code>stack(…)</code> to layer them. Mini-notation: <code>~</code> rest, <code>[a b]</code> subdivide, <code>&lt;a b&gt;</code> one per bar, <code>a,b</code> together, <code>a*2</code>, <code>a/2</code>, <code>a!3</code>, <code>a@3</code>. Add <code>.gain(0.5)</code>, <code>.lpf(1200)</code>, <code>.hpf(300)</code>, <code>.room(0.3)</code>, <code>.delay(0.3)</code>, <code>.pan(0.25)</code> (0 left, 1 right), <code>.attack(0.2)</code>, <code>.decay(0.2)</code>, <code>.sustain(0.5)</code>, <code>.release(0.4)</code>, <code>.fm(2)</code>, <code>.fmh(3)</code>, <code>.fast(2)</code>, <code>.slow(2)</code>, <code>.rev()</code>. Up to 64 sounds per bar. Variables, functions and other Strudel features are not supported here; your text is never run as a program.</p></details>
    </div>`;
  }
  function renderPeople(){
    const here=new Set(state.presence.map(x=>x.id));
    el.drawer.innerHTML=`<div class="drawer-head"><h2 id="drawer-title">Chat and people</h2><button class="ghost close" data-act="close-drawer" aria-label="Close">✕</button></div>
      <ul class="people">${state.members.map(m=>`<li><span class="dot ${here.has(m.id)?'here':m.online?'online':''}" aria-hidden="true"></span><strong>${esc(m.handle)}</strong><span class="code-tag">#${esc(m.code)}</span> <span class="small muted">${m.role==='owner'?'owner':'member'}${m.id===state.transport.hostId?' · host':''}${here.has(m.id)?' · here':m.online?' · online':''}${m.id===you().id?' · you':''}</span>
        ${owner()&&m.role!=='owner'?`<button class="ghost small" data-act="member-remove" data-id="${m.id}">Remove</button>`:''}${isHost()&&m.id!==you().id?`<button class="ghost small" data-act="host-pass" data-id="${m.id}">Make host</button>`:''}</li>`).join('')}</ul>
      <p class="small muted">The <strong>owner</strong> decides who is in the mix and who can see it. Any <strong>member</strong> can add and edit characters. The <strong>host</strong> runs Play, tempo, sections and going live; hosting moves between members and never changes who owns the mix. A <strong>guest</strong> in a live performance can only change the characters they brought, and only while it lasts.</p>
      ${!state.transport.hostId?'<p class="small"><button class="outline small" data-act="host-claim">Become host</button> Nobody is hosting right now.</p>':''}
      ${!owner()?'<p class="small"><button class="ghost small" data-act="leave">Leave this mix</button></p>':''}
      <section class="chat" aria-label="Project chat"><h3>Chat <span class="small muted">· members only</span></h3>
      ${chat.more?'<button class="ghost small" data-act="chat-more">Earlier messages</button>':''}
      <ol id="chat-log" class="chat-log" aria-live="polite">${chat.messages.map(m=>`<li class="${m.authorId===you().id?'mine':''}"><span class="who">${esc(m.author)}</span>${m.deleted?'<em class="muted">message removed</em>':`<span class="body">${esc(m.body)}</span>`}<time class="small muted">${ago(m.createdAt)}</time>${!m.deleted&&(m.authorId===you().id||owner()||isHost())?`<button class="ghost tiny" data-act="chat-delete" data-id="${m.id}" aria-label="Remove message">✕</button>`:''}</li>`).join('')}${outbox.map(o=>`<li class="mine pending"><span class="who">${esc(you().handle)}</span><span class="body">${esc(o.body)}</span><span class="small ${o.failed?'error':'muted'}">${o.failed?`Not sent · <button class="ghost tiny" data-act="chat-retry" data-id="${o.clientId}">Retry</button>`:'Sending…'}</span></li>`).join('')}</ol>
      <form data-form="chat" class="chat-form"><label for="chat-input" class="sr-only">Message</label><textarea id="chat-input" maxlength="500" rows="2" placeholder="Say something to the group"></textarea><button class="primary" type="submit">Send</button></form></section>`;
    const log=$('#chat-log',el.drawer);if(log)log.scrollTop=log.scrollHeight;
  }
  function renderSettings(){
    const arch=state.parts.filter(p=>p.archivedAt&&!p.guest);
    el.drawer.innerHTML=`<div class="drawer-head"><h2 id="drawer-title">Mix settings</h2><button class="ghost close" data-act="close-drawer" aria-label="Close">✕</button></div>
      <section><h3>Who can see this mix</h3>${owner()?`<fieldset class="vis"><legend class="sr-only">Visibility</legend>${(['private','unlisted','public'] as const).map(v=>`<label class="radio"><input type="radio" name="vis" value="${v}" ${state.visibility===v?'checked':''}> <strong>${visibilityLabel[v]}</strong> <span class="small muted">${visibilityHelp[v]}</span></label>`).join('')}</fieldset>
        ${state.visibility==='unlisted'&&state.viewToken?`<p class="small">View link: <button class="outline small" data-act="copy-view">Copy view link</button> <button class="ghost small" data-act="rotate-view">Make a new link</button></p>`:''}<p class="small muted">Visitors can listen to the saved mix and see credits. Chat, drafts, history and invitations stay with members.</p>`:`<p>${visibilityLabel[state.visibility]} — ${visibilityHelp[state.visibility]} Only the owner can change this.</p>`}</section>
      <section><h3>Tempo</h3><form data-form="tempo" class="row"><label for="tempo">BPM</label><input id="tempo" type="number" min="60" max="180" value="${state.settings.bpm}" ${isHost()&&!playing()?'':'disabled'}><button class="outline" type="submit" ${isHost()&&!playing()?'':'disabled'}>Set</button></form><p class="small muted">${isHost()?playing()?'Stop the mix to change tempo.':'Changes the speed for everyone.':'The host sets the tempo while the mix is stopped.'}</p></section>
      <section><h3>Removed from the stage</h3>${arch.length?`<ul class="invite-list">${arch.map(p=>`<li>${esc(p.name)} <span class="small muted">by ${esc(p.addedBy.handle)}</span><span class="row-actions"><button class="ghost small" data-act="return" data-id="${p.id}" ${active().length<12?'':'disabled'}>Bring back</button>${owner()||p.addedBy.id===you().id?`<button class="danger small" data-act="purge-part" data-id="${p.id}" aria-label="Delete ${esc(p.name)} for good">Delete</button>`:''}</span></li>`).join('')}</ul>`:'<p class="small muted">None.</p>'}</section>
      <section><h3>Your profile</h3><p class="small">You are <strong>${esc(you().handle)}</strong> <span class="code-tag">#${esc(you().code)}</span>. <a href="/friends">Profile and friends</a></p></section>
      <section><h3>Files</h3><p class="small"><button class="outline small" data-act="export">Export audio</button> <a href="/api/projects/${esc(id)}/export" download>Download the mix file</a> (members only)</p></section>
      <section><h3>${owner()?'Delete this mix':'Leave this mix'}</h3>${owner()?`<p class="small muted">Ends any live performance, cancels its invitations and shared links, and removes it for everyone. You can restore it from the Play page.</p><button class="danger" data-act="delete-mix">Delete this mix</button>`:'<p class="small muted">It leaves your list and stays with the group. Your characters stay on stage.</p><button class="danger" data-act="leave">Leave this mix</button>'}</section>`;
  }

  // --- dialogs -------------------------------------------------------------------------------
  function dialog(title:string,body:string,onSubmit?:(form:HTMLFormElement)=>Promise<unknown>|unknown){
    el.dialog.innerHTML=`<div class="scrim" data-act="dialog-close"></div><div class="dialog paper" role="dialog" aria-modal="true" aria-labelledby="dialog-title"><div class="drawer-head"><h2 id="dialog-title">${title}</h2><button class="ghost close" data-act="dialog-close" aria-label="Close">✕</button></div><form data-form="dialog">${body}</form></div>`;
    const box=$<HTMLElement>('.dialog',el.dialog)!,close=()=>{el.dialog.innerHTML='';closeLayer(box);};
    openLayer(box,close);
    $<HTMLFormElement>('form',box)!.addEventListener('submit',e=>{e.preventDefault();if(!onSubmit)return close();Promise.resolve(onSubmit(e.target as HTMLFormElement)).then(r=>{if(r!==false)close();}).catch(fail);});
    return close;
  }
  async function inviteDialog(){
    if(!owner()){dialog('Invite',`<p>Only the owner, ${esc(state.members.find(m=>m.role==='owner')?.handle??'')}, can invite new members to this mix.</p><div class="row"><button class="primary" type="submit">OK</button></div>`);return;}
    const friends=await request('/api/friends').then(x=>x.friends as {id:string;handle:string;code:string;online:boolean}[]).catch(()=>[]);
    const memberIds=new Set(state.members.map(m=>m.id));
    dialog('Invite to this mix',`<p class="small">An invited person becomes a <strong>member</strong>: they can add, change and remove characters and chat with the group. Being friends alone gives no access.</p>
      <h3>Friends</h3>${friends.length?`<ul class="invite-list">${friends.map(f=>`<li><span class="dot ${f.online?'online':''}" aria-hidden="true"></span>${esc(f.handle)} <span class="code-tag">#${esc(f.code)}</span> ${memberIds.has(f.id)?'<span class="small muted">already a member</span>':`<button type="button" class="outline small" data-act="invite-friend" data-id="${f.id}">Invite</button>`}</li>`).join('')}</ul>`:'<p class="small muted">No friends yet. Add friends by code on the Friends page, or share a link.</p>'}
      <h3>Share a link</h3><p class="small">A link works once and expires in 24 hours. Anyone who opens it first can join, so send it privately.</p><div class="row"><button type="button" class="outline" data-act="invite-link">Create link</button></div><p id="invite-out" class="small" role="status"></p>
      <div class="row"><button class="ghost" type="submit">Done</button></div>`);
  }
  function goLiveDialog(){
    if(state.performance){
      dialog('Live performance',`<p><strong>● ${esc(state.performance.title)}</strong> — ${state.performance.visibility==='public'?'Public: anyone can find it in Live now and listen.':'Unlisted: anyone with the listen link can listen.'}</p>
        ${state.performance.listenToken?`<p class="row"><button type="button" class="outline" data-act="copy-listen">Copy listen link</button></p>`:''}
        <p class="row"><a class="outline" href="/live/${esc(state.performance.id)}">Open the audience view</a></p>
        <p class="small">Listeners can hear and chat, but cannot change the mix. Ending the performance keeps the project and its music.</p>
        <div class="row"><button type="button" class="danger" data-act="end-live" ${isHost()||owner()?'':'disabled'}>End performance</button><button class="ghost" type="submit">Close</button></div>`);return;
    }
    dialog('Go live',`<label for="live-title">Performance name</label><input id="live-title" name="title" maxlength="60" required value="${esc(state.title)} live">
      <fieldset class="vis"><legend>Who can listen</legend>
      <label class="radio"><input type="radio" name="visibility" value="unlisted" checked> <strong>Unlisted</strong> <span class="small muted">Only people you send the listen link to.</span></label>
      <label class="radio"><input type="radio" name="visibility" value="public"> <strong>Public</strong> <span class="small muted">Anyone, from Live now.</span></label></fieldset>
      <p class="small">Listeners hear the saved mix in their own browser and can chat and react. They cannot change anything. ${state.visibility==='private'?'Your project stays private; only the performance is shared.':''} The mix keeps its place in the music: nothing restarts.</p>
      <div class="row"><button class="primary" type="submit">Go live</button><button type="button" class="ghost" data-act="dialog-close">Cancel</button></div>`,
      async form=>{const fd=new FormData(form);const r=await request(`/api/projects/${id}/go-live`,{commandId:crypto.randomUUID(),title:fd.get('title'),visibility:fd.get('visibility')});await refresh();toast('You are live.');goLiveAfter(r.id);});
  }
  function goLiveAfter(_perf:string){setTimeout(goLiveDialog,50);}
  // Shows a suggested shape in words first; nothing changes until Use this.
  function suggestDialog(){
    const s=suggestSections(active()),names=state.settings.sceneNames,short=(x:Slot)=>names[x].replace(/^[A-D] · /,'');
    dialog('Suggest a build-up',`<p class="small">A shape worked out from who is on stage: quieter characters open, the bass arrives, the beat lands, then it thins out. It uses only what is already in this mix, and you can change anything afterwards.</p>
      <ul class="invite-list">${(['A','B','C','D'] as const).map(x=>`<li><strong>${esc(short(x))}</strong> <span class="small">${esc(s.who[x].join(', '))}</span></li>`).join('')}</ul>
      <p class="small"><strong>Sequence:</strong> ${s.arrangement.entries.map(e=>`${esc(short(e.scene))} ${e.bars}`).join(' → ')} bars, then it rests on the last section. This replaces the sections and sequence you have now.</p>
      <div class="row"><button class="primary" type="submit">Use this</button><button type="button" class="ghost" data-act="dialog-close">Cancel</button></div>`,
      async()=>{await command2('sections.apply',{assignments:s.assignments,arrangement:s.arrangement},undefined,'Sections and sequence updated. Press Run sequence to hear them.');});
  }

  // Saving needs the server. When the connection drops or returns, the open
  // drawer's save buttons follow in place, so drafts and focus are untouched.
  function drawerControls(){
    if(drawer?.kind!=='part')return;
    const p=partOf(drawer.id);if(!p?.clips.A)return;
    const apply=$<HTMLButtonElement>('[data-act="code-apply"]',el.drawer);
    if(apply){const d=codeDraft&&codeDraft.partId===p.id?codeDraft:null,dirty=(d?.draft.source??p.clips.A.source)!==p.clips.A.source;apply.disabled=!online()||!dirty||!!d?.error||!!d?.conflict||!state.editors.youCanEdit;}
    const shape=$<HTMLButtonElement>('form[data-form="shape"] button[type=submit]',el.drawer);
    if(shape)shape.disabled=!online()||(Object.keys(shapeDraft).length===0&&shapeLevel===null);
    for(const b of $$<HTMLButtonElement>('.part-actions button',el.drawer))if(!online())b.disabled=true;
  }

  // --- rendering all ---------------------------------------------------------------------
  function render(){renderHead();renderStage();renderTray();arrange.render();if(!editingSomething())renderDrawer();}
  // Incoming updates never replace an open draft or steal focus: while you are
  // typing in the drawer it is left alone, and its status line is updated.
  function editingSomething(){const a=document.activeElement as HTMLElement|null;return !!a&&el.drawer.contains(a)&&a.matches('textarea,select,input[type=text],input:not([type]),input[type=number],input[type=range]');}

  // --- data -----------------------------------------------------------------------------
  // Whoever awaits a refresh goes on to read the state, so a refresh overtaken by a
  // newer one waits for that one. On a real network the stream's own update usually
  // arrives while a command's refresh is still in flight; returning early there left
  // callers reading the state from before their own change.
  let latestRefresh:Promise<void>=Promise.resolve();
  function refresh():Promise<void>{const run=loadState();latestRefresh=run;return run;}
  async function loadState():Promise<void>{
    const n=++refreshRun,next=await request(`/api/projects/${id}`);lastOk=Date.now();if(n!==refreshRun)return latestRefresh;
    if(next.access!=='member'){location.reload();return;}
    const prevSource=codeDraft?partOf(codeDraft.partId)?.clips.A?.source:null;
    state=next;
    if(codeDraft){const p=partOf(codeDraft.partId);if(p&&p.clips.A&&p.clips.A.revision!==codeDraft.draft.baseRevision&&codeDraft.draft.source!==codeDraft.draft.baseSource)codeDraft.conflict=true;
      else if(p&&p.clips.A&&p.clips.A.source!==prevSource&&codeDraft.draft.source===codeDraft.draft.baseSource){codeDraft.draft={...codeDraft.draft,source:p.clips.A.source,baseSource:p.clips.A.source,baseRevision:p.clips.A.revision};}}
    syncAudio();render();
    if(editingSomething()){const err=$('#code-error',el.drawer);if(err&&codeDraft?.conflict)renderDrawer();}
  }
  async function loadChat(){chat=await request(`/api/projects/${id}/chat`);if(drawer?.kind==='people'&&!editingSomething())renderPeople();else if(drawer?.kind==='people'){const log=$('#chat-log',el.drawer);if(log){renderPeopleLogOnly();}}}
  function renderPeopleLogOnly(){const input=$<HTMLTextAreaElement>('#chat-input',el.drawer),val=input?.value??'',sel=[input?.selectionStart,input?.selectionEnd];renderPeople();const again=$<HTMLTextAreaElement>('#chat-input',el.drawer);if(again){again.value=val;again.focus({preventScroll:true});again.setSelectionRange(sel[0]??val.length,sel[1]??val.length);}}

  // --- audio --------------------------------------------------------------------------
  function syncAudio(){
    const a=current();if(!a||!wantSound||!a.ready)return;
    a.setOffset(offset);a.update(state.plans,state.transport.epochMs??0,state.settings.bpm,state.transport.generation);
    a.setExcluded(previewing?.startsWith('code:')?[previewing.slice(5)]:[]);a.setSolo(soloId?[soloId]:[]);
    if(document.hidden||!online()){a.stopShared();return;}
    if(playing()&&!a.running&&!previewing)a.startAt();
    if(!playing())a.stopShared();
  }
  async function turnSoundOn(){
    try{const a=await enable();wantSound=true;a.setOffset(offset);a.onBeat=(trackId,delay)=>setTimeout(()=>pulse(trackId),delay);a.onError=m=>{say(m);renderHead();};a.onLag=n=>say(`This device is falling behind: ${n} sound${n===1?' was':'s were'} skipped. Mute some parts to lighten it.`);syncAudio();renderHead();return true;}
    catch(e){wantSound=false;say(`${errorText(e)}`,true);renderHead();return false;}
  }
  const reduced=matchMedia('(prefers-reduced-motion: reduce)');
  // Each character moves on its own scheduled sounds, in a way that suits its role.
  // A fast part is thinned out, so a dozen figures never queue up work.
  const lastPulse=new Map<string,number>();
  function pulse(trackId:string){
    if(reduced.matches||document.hidden)return;
    const now=performance.now();if(now-(lastPulse.get(trackId)??0)<110)return;lastPulse.set(trackId,now);
    const li=$(`[data-part="${trackId}"]`,el.stage);if(li)moveCharacter(li,partOf(trackId)?.role??'custom');
  }

  // --- actions ----------------------------------------------------------------------------
  async function soundFor(btn:HTMLElement){
    const sid=btn.dataset.sound!,mine=btn.dataset.mine==='1';
    if(mine){const s=mySounds.find(x=>x.id===sid);if(!s)throw new Error('That character is gone.');return {payload:{characterId:sid},source:s.source,name:s.name};}
    const preset=presetById(sid);if(!preset)throw new Error('Unknown sound.');return {payload:{presetId:preset.id,presetVersion:preset.version},source:preset.source,name:preset.name};
  }
  async function addSound(btn:HTMLElement){
    const key=`add:${btn.dataset.sound}`;if(pending.has(key))return;
    const {payload,name}=await soundFor(btn);
    const host=isHost()||!state.transport.hostId,play=!playing()&&host;
    // The click is the gesture that unlocks audio on this device.
    const soundOk=await turnSoundOn();
    stopPreview();
    const job=cmd('part.add',{...payload,play}).then(async r=>{
      await refresh();
      const joined=playing()&&r.effectiveCycle!==undefined&&r.effectiveCycle>0;
      say(play?(soundOk?`${name} added · playing`:`${name} added · saved. Sound is off on this device — press Enable sound.`):playing()?(joined?`${name} saved · joining bar ${r.effectiveCycle+1}`:`${name} saved · joining next bar`):`${name} saved · press Play`);
      if(active().length>=12||swapFor)trayOpen=false;render();
      const li=$<HTMLElement>(`[data-part="${r.entityId}"] .performer-btn`,el.stage);li?.classList.add('arrived');
    }).finally(()=>pending.delete(key));
    pending.set(key,job);await job;
  }
  async function preview(btn:HTMLElement){
    const sid=btn.dataset.sound!;
    if(previewing===sid){stopPreview();renderTray();renderStatus();return;}
    const {source}=await soundFor(btn);const a=await enable().catch(e=>{say(errorText(e),true);throw e;});
    // While the mix plays, a preview runs in step with it, so it can be judged in
    // context; otherwise it loops on its own.
    await a.previewItems([{document:parseSource(source).document,gain:0.7}],state.settings.bpm,playing()&&a.running);previewing=sid;renderTray();renderStatus();
  }
  function stopPreview(){const a=current();if(previewing){a?.stopPreview();previewing=null;a?.setExcluded([]);syncAudio();}}
  async function hearSection(scene:Slot){
    if(previewing===`section:${scene}`){stopPreview();renderStatus();return false;}
    const plan=state.plans.at(-1);if(!plan)return false;
    const items=active().flatMap(p=>{const slot=plan.sceneAssignments[scene]?.[p.id],clip=slot?plan.catalog[p.id]?.[slot]:undefined,m=mixOf(p.id);return clip&&!m.mute?[{document:clip.document as never,gain:m.gain}]:[];});
    if(!items.length){say('Nobody plays in that section yet.');return false;}
    const a=await enable().catch(e=>{say(errorText(e),true);throw e;});
    await a.previewItems(items,state.settings.bpm);a.stopShared();previewing=`section:${scene}`;wantSound=true;renderStatus();return true;
  }
  function select(pid:string){
    if(drawer?.kind==='part'&&drawer.id===pid){closeDrawer();return;}
    drawer={kind:'part',id:pid,tab:'part'};shapeDraft={};shapeLevel=null;swapFor=null;patternEditor.reset();
    renderStage();renderDrawer();openLayer(el.drawer,closeDrawer);
    void loadCodeDraft(pid);
  }
  function closeDrawer(){
    const part=drawer?.kind==='part'?drawer.id:null;
    if(part)void releaseLease(part);
    if(previewing?.startsWith('code:'))stopPreview();
    drawer=null;codeDraft=null;shapeDraft={};shapeLevel=null;drawDrawer();renderStage();closeLayer(el.drawer);
    // The stage was redrawn, so the button that opened the drawer is new.
    if(part)$<HTMLElement>(`[data-part="${part}"] .performer-btn`,el.stage)?.focus({preventScroll:true});
  }
  let leaseHeld:string|null=null,leaseTimer:ReturnType<typeof setInterval>|null=null;
  async function takeLease(pid:string){
    if(leaseHeld===pid)return true;
    try{await cmd('part.lease',{trackId:pid});leaseHeld=pid;leaseTimer??=setInterval(()=>{if(leaseHeld)void cmd('part.lease',{trackId:leaseHeld}).catch(()=>{});},10000);return true;}
    catch(e){toast(errorText(e));await refresh();return false;}
  }
  async function releaseLease(pid:string){if(leaseHeld!==pid)return;leaseHeld=null;if(leaseTimer){clearInterval(leaseTimer);leaseTimer=null;}await cmd('part.release',{trackId:pid}).catch(()=>{});}
  async function loadCodeDraft(pid:string){
    const p=partOf(pid);if(!p?.clips.A)return;const key=codeKey(you().id,id,pid,'A');
    let saved:CodeDraft|undefined;try{saved=await readCode(key);}catch{toast('Drafts can’t be saved on this device. Apply your work before closing.');}
    const base={source:p.clips.A.source,baseRevision:p.clips.A.revision,baseSource:p.clips.A.source,savedAt:Date.now()};
    const draft=saved&&saved.source!==p.clips.A.source?saved:base;
    codeDraft={partId:pid,slot:'A',draft,error:validate(draft.source),conflict:!!saved&&saved.baseRevision!==p.clips.A.revision&&saved.source!==p.clips.A.source};
    if(drawer?.kind==='part'&&drawer.id===pid&&!editingSomething())renderDrawer();
  }
  const validate=(source:string)=>{try{parseSource(source);return null;}catch(e){return errorText(e);}};
  // Pattern and Code edit one draft. Whichever made the change, this is what
  // happens next: it is checked, kept on this device, heard if a preview is
  // running, and shared only when someone presses Apply.
  function setDraft(next:string){
    if(!codeDraft)return;
    codeDraft.draft={...codeDraft.draft,source:next};codeDraft.error=validate(next);
    const p=partOf(codeDraft.partId)!,dirty=next!==p.clips.A!.source,status=$('#code-error',el.drawer);
    if(status){status.textContent=codeDraft.error??(dirty?'Draft saved on this device · not shared yet.':'This is the saved music everyone hears.');status.classList.toggle('error',!!codeDraft.error);}
    const apply=$<HTMLButtonElement>('[data-act="code-apply"]',el.drawer);if(apply)apply.disabled=!dirty||!!codeDraft.error||codeDraft.conflict||!online()||!canEditPart(p);
    const prev=$<HTMLButtonElement>('[data-act="code-preview"]',el.drawer);if(prev)prev.disabled=!!codeDraft.error;
    const restore=$<HTMLButtonElement>('[data-act="code-restore"]',el.drawer);if(restore)restore.disabled=!dirty;
    if(!codeDraft.error&&previewing===`code:${p.id}`)current()?.updatePreview([{document:parseSource(next).document,gain:mixOf(p.id).gain}]);
    saveDraftSoon();void takeLease(p.id);
  }
  async function makeStepCopy(source:string){
    if(drawer?.kind!=='part')return;const p=partOf(drawer.id)!;
    const r=await cmd('part.add',{source,name:`${p.name} steps`.slice(0,40),role:p.role==='custom'?null:p.role,look:p.look});
    await refresh();say('A plain-steps copy is on stage. The original is unchanged.');select(r.entityId);
  }
  const startFrom=(p:Part):CreatorStart=>({name:p.name,role:p.role==='custom'?null:p.role as Role,look:p.look??defaultLook(p.role,p.id),source:p.clips.A!.source,level:mixOf(p.id).gain,heading:`Change ${p.name}’s look`});
  async function loadCharacters(){mySounds=(await request('/api/characters')).characters;renderTray();}
  const creatorOptions=()=>({visitorId:you().id,bpm:state.settings.bpm,saved:()=>void loadCharacters().catch(()=>{}),addToMix:async(characterId:string)=>{const play=!playing()&&(isHost()||!state.transport.hostId);await turnSoundOn();await cmd('part.add',{characterId,play});await refresh();trayOpen=false;render();}});
  let draftTimer:ReturnType<typeof setTimeout>;
  function saveDraftSoon(){clearTimeout(draftTimer);const d=codeDraft;if(!d)return;draftTimer=setTimeout(()=>{void writeCode(codeKey(you().id,id,d.partId,d.slot),{...d.draft,savedAt:Date.now()}).catch(()=>toast('Draft storage failed. Apply your work before closing.'));},250);}

  async function command2(type:string,payload:any,rev?:number,okText?:string){
    const r=await cmd(type,payload,rev);await refresh();
    if(okText)say(okText.replace('{bar}',playing()&&r.effectiveCycle!==undefined?`joins bar ${r.effectiveCycle+1}`:'saved · press Play'));
    return r;
  }

  on(host,'click','[data-act]',async(btn,e)=>{
    const act=btn.dataset.act!,pid=btn.dataset.id;
    switch(act){
      case 'play':{
        if(playing()){await command2('transport.stop',{},state.transport.revision,'Stopped for everyone.');return;}
        const soundOk=await turnSoundOn();await command2('transport.start',{},state.transport.revision);
        say(soundOk?'Playing for everyone.':'Playing for everyone — sound is off on this device.');return;
      }
      case 'sound':{if(soundOn()&&wantSound){wantSound=false;current()?.stop();previewing=null;say('Sound off on this device. The shared mix keeps playing for others.');renderHead();renderTray();}else{await turnSoundOn();}return;}
      case 'tray':trayOpen=!trayOpen;swapFor=null;if(trayOpen&&!mySounds.length)void loadCharacters().catch(()=>{});renderTray(true);renderStage();renderHead();if(trayOpen){openLayer(el.tray,()=>{trayOpen=false;swapFor=null;renderTray();renderStage();renderHead();closeLayer(el.tray);});}else closeLayer(el.tray);return;
      case 'close-tray':trayOpen=false;swapFor=null;stopPreview();renderTray();renderStage();renderHead();closeLayer(el.tray);return;
      case 'create-character':{
        dialog('Create a character',`<p class="small">Start from nothing: choose what it does in the band, then build its look and its music. To start from someone else, press ✎ on them in the cast.</p><div class="row">${ROLES.map(r=>`<button type="button" class="outline" data-act="create-blank" data-role="${r}">${ROLE_LABEL[r]}</button>`).join('')}</div><div class="row"><button class="ghost" type="submit">Cancel</button></div>`);return;
      }
      case 'create-blank':{const box=$<HTMLElement>('.dialog',el.dialog);el.dialog.innerHTML='';if(box)closeLayer(box);await openCreator(blankCharacter(btn.dataset.role as Role),creatorOptions());return;}
      case 'remix':{
        const sid=btn.dataset.sound!,mine=btn.dataset.mine==='1';
        if(mine){const c=mySounds.find(x=>x.id===sid)!;await openCreator({id:c.id,revision:c.revision,name:c.name,role:c.role==='custom'?null:c.role,look:c.look,source:c.source,level:c.level,heading:`Edit ${c.name}`},creatorOptions());return;}
        const p=presetById(sid)!;await openCreator({name:`${p.name} remix`.slice(0,40),role:p.role,look:p.look,source:p.source,level:0.7,from:{presetId:p.id},heading:`Remix ${p.name}`},creatorOptions());return;
      }
      case 'change-look':{const p=partOf(pid!)!;await openCreator(startFrom(p),{visitorId:you().id,lookOnly:{apply:async look=>{await command2('part.look',{trackId:p.id,look},partOf(p.id)!.revision,`${p.name} has a new look.`);}}});return;}
      case 'save-character':{
        const p=partOf(pid!)!,source=codeDraft&&codeDraft.partId===p.id&&!codeDraft.error?codeDraft.draft.source:p.clips.A!.source;
        await request('/api/characters',{name:p.name,role:p.role==='custom'?null:p.role,look:p.look??defaultLook(p.role,p.id),source,level:mixOf(p.id).gain,from:p.presetId?{presetId:p.presetId}:undefined});
        await loadCharacters();toast(`${p.name} is saved in your characters. Find it in any mix’s cast.`);return;
      }
      case 'solo':{soloId=soloId===pid?null:pid!;current()?.setSolo(soloId?[soloId]:[]);say(soloId?`Only you hear ${partOf(pid!)!.name} alone. The mix is unchanged for everyone else.`:'Hearing everyone again.');renderDrawer();return;}
      case 'arrange':{el.arrange.hidden=!el.arrange.hidden;arrange.render(true);renderHead();return;}
      case 'export':{const {openExport}=await import('./export.ts');openExport(state);return;}
      case 'purge-part':{const p=partOf(pid!)!;if(!(await confirmDialog({title:`Delete ${p.name} for good?`,body:'Its music and history leave this mix and can’t be brought back. Saved characters and other mixes aren’t affected.',confirm:'Delete track',danger:true})))return;await command2('part.purge',{trackId:p.id},undefined,`${p.name} deleted.`);renderDrawer();return;}
      case 'delete-mix':{if(!(await confirmDialog({title:`Delete ${state.title}?`,body:`It disappears for everyone in it${state.performance?', and the live performance ends now':''}. Invitations and shared links stop working. You can restore it from the Play page.`,confirm:'Delete mix',danger:true,typed:state.title})))return;await cmd('project.delete',{confirmTitle:state.title});location.href='/';return;}
      case 'filter':filter=btn.dataset.role as Role|'all';renderTray();$<HTMLElement>(`[data-act="filter"][data-role="${filter}"]`,el.tray)?.focus();return;
      case 'preview':return preview(btn);
      case 'add':return addSound(btn);
      case 'swap':{const target=swapFor;if(!target)return;const {payload,name}=await soundFor(btn);await turnSoundOn();await command2('part.swap',{trackId:target,...payload},undefined,`Swapped to ${name} · {bar}`);swapFor=null;trayOpen=false;closeLayer(el.tray);render();return;}
      case 'use-bpm':await command2('tempo.set',{bpm:Number(btn.dataset.bpm)},undefined,`Tempo set to ${btn.dataset.bpm} BPM.`);return;
      case 'select':return select(pid!);
      case 'close-drawer':return closeDrawer();
      case 'tab':{if(drawer?.kind!=='part')return;drawer.tab=btn.dataset.tab as 'part';if(drawer.tab!=='part')await takeLease(drawer.id);renderDrawer();$<HTMLElement>(`#tab-${drawer.tab}`,el.drawer)?.focus();return;}
      case 'mute':{const m=mixOf(pid!);const p=partOf(pid!)!;await command2('part.mix',{trackId:pid,mute:!m.mute},p.revision,`${p.name} ${m.mute?'unmuted':'muted'} · {bar}`);return;}
      case 'swap-open':{if(!(await takeLease(pid!)))return;swapFor=pid!;trayOpen=true;filter=partOf(pid!)!.role==='custom'?'all':partOf(pid!)!.role as Role;renderTray(true);renderHead();el.tray.scrollIntoView({block:'nearest'});$<HTMLElement>('#pack',el.tray)?.focus();return;}
      case 'duplicate':{const r=await command2('part.duplicate',{trackId:pid},undefined,'Duplicated · {bar}');select(r.entityId);return;}
      case 'keep':await command2('part.keep',{trackId:pid},undefined,'Kept in the mix as a new track.');return;
      case 'remove':{const p=partOf(pid!)!;if(!(await takeLease(pid!)))return;await command2('part.remove',{trackId:pid},p.revision,`${p.name} left the stage. Bring them back from ⋯.`);leaseHeld=null;closeDrawer();return;}
      case 'return':await command2('part.return',{trackId:pid},undefined,'Back on stage.');return;
      case 'rename-part':{const p=partOf(pid!)!;dialog('Rename track',`<label for="part-name">Name</label><input id="part-name" name="name" maxlength="40" required value="${esc(p.name)}" autofocus><div class="row"><button class="primary" type="submit">Rename</button></div>`,async f=>{await command2('part.rename',{trackId:pid,name:new FormData(f).get('name')},partOf(pid!)!.revision,'Renamed.');});return;}
      case 'restore':await command2('part.restore',{trackId:pid,revision:Number(btn.dataset.rev)},partOf(pid!)!.clips.A!.revision,'Restored as a new revision · {bar}');return;
      case 'shape-reset':shapeDraft={};shapeLevel=null;renderDrawer();return;
      case 'code-preview':{
        if(drawer?.kind!=='part'||!codeDraft)return;const key=`code:${drawer.id}`;
        if(previewing===key){stopPreview();renderDrawer();renderStatus();return;}
        const a=await enable().catch(e=>{say(errorText(e),true);throw e;});
        // In step with the mix while it plays, so the change is heard in context.
        await a.previewItems([{document:parseSource(codeDraft.draft.source).document,gain:mixOf(drawer.id).gain}],state.settings.bpm,playing()&&a.running);previewing=key;wantSound=true;a.setExcluded([drawer.id]);if(!playing())a.stopShared();
        renderDrawer();renderStatus();return;
      }
      case 'code-apply':{
        if(drawer?.kind!=='part'||!codeDraft)return;const d=codeDraft,p=partOf(d.partId)!;
        if(!(await takeLease(p.id)))return;
        if(previewing===`code:${p.id}`)stopPreview();
        try{const r=await cmd('part.edit',{trackId:p.id,source:d.draft.source,via:'code'},d.draft.baseRevision);
          await deleteCode(codeKey(you().id,id,p.id,'A')).catch(()=>{});codeDraft=null;await refresh();await loadCodeDraft(p.id);
          say(playing()?`Code applied · joins bar ${r.effectiveCycle+1}`:'Code applied · saved. Press Play to hear it with the group.');}
        catch(err){if((err as ApiError).status===409&&/saved this track/.test(errorText(err))){d.conflict=true;await refresh();renderDrawer();}else{d.error=errorText(err);renderDrawer();}}
        return;
      }
      case 'code-restore':{if(!codeDraft)return;const p=partOf(codeDraft.partId)!;codeDraft.draft={source:p.clips.A!.source,baseSource:p.clips.A!.source,baseRevision:p.clips.A!.revision,savedAt:Date.now()};codeDraft.error=null;codeDraft.conflict=false;await deleteCode(codeKey(you().id,id,p.id,'A')).catch(()=>{});renderDrawer();return;}
      case 'code-keep':{if(!codeDraft)return;const p=partOf(codeDraft.partId)!;codeDraft.draft.baseRevision=p.clips.A!.revision;codeDraft.draft.baseSource=p.clips.A!.source;codeDraft.conflict=false;saveDraftSoon();renderDrawer();toast('Your draft stays. Apply when ready: it becomes the next revision.');return;}
      case 'code-load':{if(!codeDraft)return;const keep=codeDraft.draft.source;try{await navigator.clipboard.writeText(keep);}catch{}const p=partOf(codeDraft.partId)!;codeDraft.draft={source:p.clips.A!.source,baseSource:p.clips.A!.source,baseRevision:p.clips.A!.revision,savedAt:Date.now()};codeDraft.conflict=false;codeDraft.error=null;saveDraftSoon();renderDrawer();toast('Loaded the current version. Your draft was copied to the clipboard.');return;}
      case 'code-new':{if(!codeDraft)return;const d=codeDraft,p=partOf(d.partId)!;const r=await cmd('part.add',{source:d.draft.source,name:`${p.name} (mine)`.slice(0,40),role:p.role,look:p.look});await deleteCode(codeKey(you().id,id,p.id,'A')).catch(()=>{});codeDraft=null;await refresh();say('Your draft is now its own track.');select(r.entityId);return;}
      case 'people':{if(drawer?.kind==='people'){closeDrawer();return;}if(drawer?.kind==='part')await releaseLease(drawer.id);drawer={kind:'people'};unread=0;renderHead();await loadChat();renderDrawer();openLayer(el.drawer,closeDrawer);return;}
      case 'settings':{if(drawer?.kind==='settings'){closeDrawer();return;}if(drawer?.kind==='part')await releaseLease(drawer.id);drawer={kind:'settings'};renderDrawer();openLayer(el.drawer,closeDrawer);return;}
      case 'ack-public':await command2('project.acknowledge',{},undefined,'It stays public.');return;
      case 'copy-view':await navigator.clipboard.writeText(`${location.origin}/p/${id}#view=${state.viewToken}`);toast('View link copied. Anyone with it can listen to the saved mix.');return;
      case 'rotate-view':await command2('project.rotateLink',{},undefined,'New view link made. The old one no longer works.');return;
      case 'invite':return inviteDialog();
      case 'invite-friend':{await request('/api/invitations',{kind:'project',resourceId:id,friendId:pid});btn.replaceWith(Object.assign(document.createElement('span'),{className:'small muted',textContent:'Invitation sent'}));return;}
      case 'invite-link':{const r=await request('/api/invitations',{kind:'project',resourceId:id});const url=`${location.origin}${r.path}`;let copied=false;try{await navigator.clipboard.writeText(url);copied=true;}catch{}const out=$('#invite-out',el.dialog)!;out.innerHTML=`${copied?'Copied: ':''}<input class="link-out" readonly value="${esc(url)}" aria-label="Invitation link"> <span class="muted">Works once, for 24 hours.</span>`;return;}
      case 'golive':return goLiveDialog();
      case 'copy-listen':await navigator.clipboard.writeText(`${location.origin}/live/${state.performance!.id}#listen=${state.performance!.listenToken}`);toast('Listen link copied. Anyone with it can listen.');return;
      case 'end-live':await request(`/api/performances/${state.performance!.id}/end`,{});el.dialog.innerHTML='';await refresh();say('Performance ended. The mix is still here.');return;
      case 'dialog-close':{const box=$<HTMLElement>('.dialog',el.dialog);el.dialog.innerHTML='';if(box)closeLayer(box);return;}
      case 'rename':dialog('Rename mix',`<label for="mix-name">Name</label><input id="mix-name" name="title" maxlength="60" required value="${esc(state.title)}" autofocus><div class="row"><button class="primary" type="submit">Rename</button></div>`,async f=>{await command2('project.rename',{title:new FormData(f).get('title')},undefined,'Renamed.');});return;
      case 'member-remove':if(!confirmText(`Remove ${state.members.find(m=>m.id===pid)?.handle} from this mix? Their characters stay.`))return;await command2('member.remove',{visitorId:pid},undefined,'Removed.');return;
      case 'host-pass':await command2('host.pass',{visitorId:pid},undefined,'Hosting passed.');return;
      case 'host-claim':await command2('host.claim',{},undefined,'You are hosting.');return;
      case 'leave':if(!(await confirmDialog({title:`Leave ${state.title}?`,body:'It leaves your list. The mix and everything you added stay with the group, and you’ll need a new invitation to come back.',confirm:'Leave mix'})))return;await cmd('member.leave');location.href='/';return;
      case 'chat-more':{const first=chat.messages[0]?.id;const older=await request(`/api/projects/${id}/chat?before=${first}`);chat={messages:[...older.messages,...chat.messages],more:older.more};renderPeople();return;}
      case 'chat-delete':await request(`/api/projects/${id}/chat`,{delete:Number(pid)});await loadChat();return;
      case 'chat-retry':{const o=outbox.find(x=>x.clientId===pid);if(o){o.failed=false;renderPeopleLogOnly();void deliver(o);}return;}
    }
    void e;
  });
  const confirmText=(t:string)=>window.confirm(t);
  on(host,'change','#pack',sel=>{const v=(sel as HTMLSelectElement).value;if(v==='mine'){traySource='mine';void loadCharacters();}else{traySource='factory';pack=v;}renderTray();$<HTMLElement>('#pack',el.tray)?.focus();});
  on(host,'input','#cast-search',t=>{search=(t as HTMLInputElement).value;const list=$('#sound-list',el.tray);if(list)list.innerHTML=listHtml();});
  on(host,'change','input[name="vis"]',async r=>{const v=(r as HTMLInputElement).value;await command2('project.visibility',{visibility:v},undefined,`This mix is now ${visibilityLabel[v]}.`);renderDrawer();});
  on(host,'input','#device-volume',r=>setDeviceVolume(Number((r as HTMLInputElement).value)));
  on(host,'input','[data-level]',r=>{shapeLevel=Number((r as HTMLInputElement).value);const out=$('#shape-level-out',el.drawer);if(out)out.textContent=`${Math.round(shapeLevel*100)}%`;const submit=$<HTMLButtonElement>('form[data-form="shape"] button[type=submit]',el.drawer);if(submit)submit.disabled=false;});
  on(host,'input','[data-shape]',r=>{const ctl=(r as HTMLInputElement).dataset.shape as Control,v=Number((r as HTMLInputElement).value);shapeDraft[ctl]=v;const out=$(`#shape-${ctl}-out`,el.drawer);if(out)out.textContent=SHAPE_LABEL[ctl].fmt(v);const submit=$<HTMLButtonElement>('form[data-form="shape"] button[type=submit]',el.drawer);if(submit)submit.disabled=false;});
  on(host,'input','#code-editor',t=>setDraft((t as HTMLTextAreaElement).value));
  host.addEventListener('submit',e=>{
    const form=e.target as HTMLFormElement,kind=form.dataset.form;if(!kind||kind==='dialog')return;e.preventDefault();
    (async()=>{
      if(kind==='shape'&&drawer?.kind==='part'){
        const p=partOf(drawer.id)!;let source=p.clips.A!.source,r:any={};
        if(shapeLevel!==null)r=await cmd('part.mix',{trackId:p.id,gain:shapeLevel},p.revision);
        if(Object.keys(shapeDraft).length){
          for(const [ctl,v] of Object.entries(shapeDraft) as [Control,number][])source=applyShape(source,ctl,v);
          if(!(await takeLease(p.id)))return;
          r=await cmd('part.edit',{trackId:p.id,source,via:'shape'},p.clips.A!.revision);
        }
        shapeDraft={};shapeLevel=null;await refresh();
        say(playing()?`Shape applied · joins bar ${r.effectiveCycle+1}`:'Shape applied · saved. Press Play to hear it.');renderDrawer();
      }
      if(kind==='tempo'){await command2('tempo.set',{bpm:Number($<HTMLInputElement>('#tempo',form)!.value)},undefined,'Tempo changed.');}
      if(kind==='chat'){const input=$<HTMLTextAreaElement>('#chat-input',form)!,body=input.value.trim();if(!body)return;if(body.length>500){toast('Messages are at most 500 characters.');return;}input.value='';const o={clientId:crypto.randomUUID(),body,failed:false};outbox.push(o);renderPeopleLogOnly();void deliver(o);}
    })().catch(fail);
  });
  on(host,'keydown','#chat-input',(t,e)=>{const k=e as KeyboardEvent;if(k.key==='Enter'&&!k.shiftKey){k.preventDefault();(t.closest('form') as HTMLFormElement).requestSubmit();}});
  async function deliver(o:{clientId:string;body:string;failed:boolean}){
    for(let attempt=0;attempt<3;attempt++){
      try{const r=await request(`/api/projects/${id}/chat`,{clientId:o.clientId,body:o.body});outbox.splice(outbox.indexOf(o),1);if(!chat.messages.some(m=>m.id===r.message.id))chat.messages.push(r.message);if(drawer?.kind==='people')renderPeopleLogOnly();return;}
      catch(e){if((e as ApiError).status&&(e as ApiError).status!<500&&(e as ApiError).status!==429){o.failed=true;toast(errorText(e));break;}await new Promise(r=>setTimeout(r,800*(attempt+1)));}
    }
    o.failed=true;if(drawer?.kind==='people')renderPeopleLogOnly();
  }
  // Dragging a sound onto the stage is a shortcut for Add; dropping onto a
  // performer swaps that performer's sound.
  host.addEventListener('dragstart',e=>{const card=(e.target as HTMLElement).closest?.('[data-sound]') as HTMLElement|null;if(card&&e.dataTransfer){e.dataTransfer.setData('text/x-ensemble-sound',JSON.stringify({sound:card.dataset.sound,mine:card.dataset.mine}));e.dataTransfer.effectAllowed='copy';}});
  el.stage.addEventListener('dragover',e=>{if(e.dataTransfer?.types.includes('text/x-ensemble-sound')){e.preventDefault();(e.target as HTMLElement).closest('.performer')?.classList.add('drop');}});
  el.stage.addEventListener('dragleave',e=>(e.target as HTMLElement).closest?.('.performer')?.classList.remove('drop'));
  el.stage.addEventListener('drop',e=>{e.preventDefault();$$('.drop',el.stage).forEach(x=>x.classList.remove('drop'));const raw=e.dataTransfer?.getData('text/x-ensemble-sound');if(!raw)return;const d=JSON.parse(raw),btn=document.createElement('button');btn.dataset.sound=d.sound;btn.dataset.mine=d.mine;
    const target=(e.target as HTMLElement).closest('[data-part]')?.getAttribute('data-part');
    if(target){swapFor=target;void takeLease(target).then(ok=>ok&&soundFor(btn).then(({payload,name})=>command2('part.swap',{trackId:target,...payload},undefined,`Swapped to ${name} · {bar}`))).catch(fail).finally(()=>{swapFor=null;renderTray();});}
    else void addSound(btn).catch(fail);});

  // Register the initial tray before the async connection/calibration starts.
  // Finishing calibration must never take focus from a person already playing.
  render();if(trayOpen){openLayer(el.tray,()=>{trayOpen=false;renderTray();renderStage();closeLayer(el.tray);});}
  // --- live connection, presence, clocks ----------------------------------------------------
  const live=connect(()=>`/api/projects/${id}/events?since=${state.eventId}`,{
    change:(kind,data)=>{
      if(kind==='reaction'){if(state.performance)reactions.add(data.counts??{});return;}
      if(kind==='chat.filter'){void loadChat();return;}
      if(kind==='chat'||kind==='chat.deleted'){if(drawer?.kind==='people')void loadChat();else if(kind==='chat'){unread++;renderHead();}return;}
      if(kind==='presence'||kind==='lease'){void refresh().catch(()=>{});return;}
      scheduleRefresh();
    },
    state:s=>{connection=s;if(s==='revoked'){reactions.clear();toast('You no longer have access to this mix.');setTimeout(()=>location.href='/',2500);}renderHead();renderTray();if(s==='live'&&!editingSomething())renderDrawer();else drawerControls();if(s!=='live'&&!online())current()?.stopShared();syncAudio();},
    poll:async()=>{await refresh();if(drawer?.kind==='people')await loadChat();},
  });
  let refreshTimer:ReturnType<typeof setTimeout>|null=null;
  function scheduleRefresh(){if(!refreshTimer)refreshTimer=setTimeout(()=>{refreshTimer=null;void refresh().catch(()=>{});},60);}
  const beat=()=>{if(!document.hidden)void request(`/api/projects/${id}/presence`,{}).then(()=>{lastOk=Date.now();}).catch(()=>{});};
  beat();setInterval(beat,10000);
  setInterval(()=>{if(!document.hidden)void refresh().catch(()=>{});},15000);
  // Losing the server for long enough silences this device rather than
  // playing on from a stale plan; drafts stay put.
  setInterval(()=>{if(!online()&&current()?.running){current()!.stopShared();say('Connection lost. Sound paused on this device; your drafts are safe.',true);}renderStage();drawerControls();arrange.tick();},1000);
  // Marks the step that is sounding, from the same clock the audio uses.
  setInterval(()=>{
    if(drawer?.kind!=='part'||drawer.tab!=='pattern'||reduced.matches||document.hidden)return;
    patternEditor.mark(playing()&&state.transport.epochMs?cycleAt(Date.now()+offset,state.transport.epochMs,state.settings.bpm):null);
  },60);
  document.addEventListener('visibilitychange',()=>{if(document.hidden){current()?.stopShared();}else{beat();void refresh().then(()=>calibrate()).then(o=>{offset=o;syncAudio();}).catch(()=>{});}});
  window.addEventListener('beforeunload',()=>{if(leaseHeld)navigator.sendBeacon?.(`/api/projects/${id}/commands`,new Blob([JSON.stringify({commandId:crypto.randomUUID(),type:'part.release',payload:{trackId:leaseHeld}})],{type:'application/json'}));});
  offset=await calibrate().catch(()=>0);
  syncAudio();
  (window as any).ensembleDebug={snapshot:()=>state,audio:()=>current(),live,offset:()=>offset};
  void audio;
}

// A non-member viewing a public or unlisted mix: the saved parts and credits,
// a local preview, and nothing else.
function mountView(host:HTMLElement,view:ViewSnapshot){
  let playingLocal=false;
  host.innerHTML=`<div class="room view-only"><header class="room-head"><div class="room-title"><h1>${esc(view.title)}</h1><span class="pill" data-vis="${view.visibility}">${visibilityLabel[view.visibility]}</span></div>
    <div class="room-actions"><button class="primary" id="view-play" data-act="listen">▶ Listen on my device</button></div></header>
    <p class="status-line" style="position:static;background:none;margin:0 16px 6px;padding:0" role="status" id="view-status">You are visiting. Listening plays the saved mix on your device only; you can’t change it.</p>
    ${view.performance?`<p class="banner live"><strong>● Live now:</strong> ${esc(view.performance.title)} <a class="outline small" href="/live/${esc(view.performance.id)}">Listen live</a></p>`:''}
    <div class="room-body"><section class="stage-wrap" aria-label="Stage"><ol class="stage ${view.parts.length<=4?'':view.parts.length<=7?'fit-m':'fit-s'}">${view.parts.map(p=>`<li class="performer role-${p.role} ${p.mute?'muted':''}" data-part="${p.id}"><div class="performer-btn static"><span class="figure-box">${performerSvg(p.role as Look,p.id,p.look)}</span><span class="nameplate"><strong>${esc(p.name)}</strong><span class="role-tag">${ROLE_LABEL[p.role as Role]??'Custom'}</span></span></div><span class="credit">${esc(p.addedBy)}</span>${p.mute?'<span class="state-tag">Muted</span>':''}</li>`).join('')||'<li class="stage-note">Nobody on stage yet.</li>'}</ol></section></div>
    <p class="small" style="padding:8px 16px">Want to join in? Ask a member for an invitation.</p></div>`;
  host.addEventListener('click',e=>{const b=(e.target as HTMLElement).closest('[data-act="listen"]');if(!b)return;(async()=>{
    const a=await enable();
    if(playingLocal){a.stop();playingLocal=false;b.textContent='▶ Listen on my device';return;}
    const {blankPlan}=await import('../shared/performance.ts');const plan=blankPlan();
    for(const p of view.parts){plan.catalog[p.id]={A:{revision:1,document:p.document as never}};plan.sceneAssignments.A[p.id]='A';plan.mix[p.id]={gain:p.gain,mute:p.mute};}
    a.update([plan],Date.now()+300,view.bpm,Math.floor(Math.random()*1e9));a.startAt();playingLocal=true;b.textContent='■ Stop listening';
  })().catch(fail);});
}
