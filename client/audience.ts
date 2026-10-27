// The audience view of a live performance: the lineup, Listen, local volume,
// chat, reactions and a request to perform. It reads only the performance's
// audience snapshot, never the project, and offers no project controls.
import {request,type ApiError} from './api.ts';
import {esc,$,toast,fail,errorText,on,ago} from './ui.ts';
import {performerSvg} from './performer.ts';
import {connect,calibrate,type LiveState} from './live.ts';
import {enable,current,deviceVolume,setDeviceVolume,soundOn} from './sound.ts';
import {PACKS,ROLE_LABEL,type Role} from '../shared/presets.ts';
import {parseSource} from '../shared/expr.ts';
import type {AudienceSnapshot} from '../shared/studio.ts';

export async function mountAudience(host:HTMLElement,id:string){
  // An unlisted listen link: #listen=<token>, exchanged by POST then cleared.
  const listen=new URLSearchParams(location.hash.slice(1)).get('listen');
  if(listen){await request(`/api/performances/${id}/listen-link`,{token:listen}).catch(()=>{});history.replaceState(null,'',location.pathname);}
  let s:AudienceSnapshot;
  try{s=await request(`/api/performances/${id}`);}
  catch(e){host.innerHTML=`<section class="notice-page"><h1>This performance isn’t available</h1><p>It may have ended, or it needs a listen link. ${(e as ApiError).status===404?'If someone shared it with you, ask them for the link again.':esc(errorText(e))}</p><p><a href="/live">See who’s live</a></p></section>`;return;}
  let listening=false,offset=0,connection:LiveState='reconnecting',messages:any[]=[],full=s.full;
  const outbox:{clientId:string;body:string;failed:boolean}[]=[];
  host.innerHTML=`<div class="audience"><header class="room-head"><div class="room-title"><p class="eyebrow" id="aud-state"></p><h1 id="aud-title"></h1></div>
    <div class="room-actions"><button class="primary" data-act="listen" id="listen"></button><label class="volume"><span class="sr-only">Volume on this device</span><input id="aud-volume" type="range" min="0" max="1" step="0.05" aria-label="Volume on this device"></label></div></header>
    <p class="status-line" id="aud-status" role="status" aria-live="polite"></p>
    <div class="room-body"><section class="stage-wrap" aria-label="Performers"><ol class="stage" id="aud-stage"></ol><div id="aud-tools"></div></section>
    <aside class="drawer chat-side" aria-label="Audience chat"><h2>Audience chat</h2><ol class="chat-log" id="aud-chat" aria-live="polite"></ol>
      <div class="reactions" role="group" aria-label="Reactions">${[['clap','👏'],['heart','❤️'],['fire','🔥'],['wave','👋']].map(([k,e])=>`<button class="ghost" data-act="react" data-r="${k}" aria-label="React ${k}">${e}</button>`).join('')}</div>
      <form id="aud-form" class="chat-form"><label for="aud-input" class="sr-only">Message</label><textarea id="aud-input" rows="2" maxlength="500" placeholder="Say something"></textarea><button class="primary" type="submit">Send</button></form></aside></div>
    <div id="burst" class="burst" aria-hidden="true"></div></div>`;
  const vol=$<HTMLInputElement>('#aud-volume',host)!;vol.value=String(deviceVolume());
  vol.addEventListener('input',()=>setDeviceVolume(Number(vol.value)));
  function render(){
    const live=s.status==='live';
    $('#aud-title',host)!.textContent=s.title;document.title=`${s.title} · Live · Ensemble`;
    $('#aud-state',host)!.textContent=live?`● Live · ${s.audience}/${s.capacity} listening · ${s.visibility==='public'?'public':'unlisted'}`:s.endReason==='interrupted'?'Ended: the server restarted':'This performance has ended';
    const b=$<HTMLButtonElement>('#listen',host)!;b.textContent=listening?'■ Stop listening':'▶ Listen';b.setAttribute('aria-pressed',String(listening));b.disabled=!live||full;
    $('#aud-status',host)!.textContent=!live?'Thanks for listening.':full?`This performance is full (${s.capacity} listeners). This page checks again every few seconds.`:connection==='busy'?'Live updates are busy, so this page checks every second instead.':connection==='reconnecting'?'Reconnecting…':listening?(s.transport.status==='playing'?'Listening. Everyone hears the same bar in their own browser.':`Waiting for ${s.hostHandle} to start the music.`):`Hosted by ${s.hostHandle}. You can listen and chat; you can’t change the mix.`;
    $('#aud-stage',host)!.innerHTML=s.parts.map(p=>`<li class="performer role-${p.role}" data-part="${p.id}"><div class="performer-btn static">${performerSvg(p.role,p.id)}<span class="nameplate"><strong>${esc(p.name)}</strong><span class="role-tag">${ROLE_LABEL[p.role as Role]??'Custom'}${p.guest?' · guest':''}</span></span></div><span class="credit">${esc(p.addedBy)}</span></li>`).join('')||'<li class="stage-note">The stage is empty for now.</li>';
    const you=s.you,host2=you.role==='host';
    $('#aud-tools',host)!.innerHTML=`<section class="credits"><h2>Performers</h2><ul class="people">${s.performers.map(p=>`<li><strong>${esc(p.handle)}</strong> <span class="small muted">${p.role}</span>${host2&&p.role==='performer'?` <button class="ghost small" data-act="mod" data-a="remove" data-id="${p.id}">Remove</button>`:''}</li>`).join('')}</ul></section>
      ${live&&you.role==='listener'?`<p>${you.request==='pending'?'<span class="pill">Request sent</span> The host will see it.':you.request==='declined'?'The host declined your request.':'<button class="outline" data-act="request">Ask to perform</button>'}</p>`:''}
      ${live&&you.role==='performer'?guestTools():''}
      ${live&&host2&&s.requests?.length?`<section><h2>Requests to perform</h2><ul class="people">${s.requests.map(r=>`<li>${esc(r.handle)} <button class="primary small" data-act="mod" data-a="accept" data-id="${r.visitorId}">Accept</button><button class="ghost small" data-act="mod" data-a="decline" data-id="${r.visitorId}">Decline</button></li>`).join('')}</ul></section>`:''}
      ${live&&(host2||you.role==='member')&&s.projectId?`<p class="small"><a href="/p/${esc(s.projectId)}">Back to the mix room</a></p>`:''}`;
    renderChat();
    $<HTMLButtonElement>('#aud-form button',host)!.disabled=!live||you.muted;
    $<HTMLTextAreaElement>('#aud-input',host)!.placeholder=you.muted?'The host muted you in this chat':live?'Say something':'Chat is closed';
  }
  function guestTools(){
    const presets=PACKS.flatMap(p=>p.presets);
    return `<section class="guest card"><h2>You’re performing</h2><p class="small">Add a part of your own. It plays only during this performance; a member can keep a copy.</p>
      <form data-form="guest" class="row"><label for="guest-sound">Sound</label><select id="guest-sound">${presets.map(p=>`<option value="${p.id}">${esc(p.name)} · ${ROLE_LABEL[p.role]}</option>`).join('')}</select><button class="primary" type="submit">Add</button></form>
      ${s.parts.filter(p=>p.guest&&p.addedBy===s.you.handle).map(p=>`<p class="small">${esc(p.name)} <button class="ghost small" data-act="guest-remove" data-id="${p.id}">Remove</button></p>`).join('')}</section>`;
  }
  function renderChat(){
    const log=$('#aud-chat',host)!;const atBottom=log.scrollHeight-log.scrollTop-log.clientHeight<40;
    log.innerHTML=messages.map(m=>`<li class="${m.authorId===s.you.id?'mine':''}"><span class="who">${esc(m.author)}</span>${m.deleted?'<em class="muted">removed</em>':`<span class="body">${esc(m.body)}</span>`}<time class="small muted">${ago(m.createdAt)}</time>${s.you.role==='host'&&m.authorId!==s.you.id&&!m.deleted?`<span class="mod"><button class="ghost tiny" data-act="mod" data-a="delete" data-msg="${m.id}" aria-label="Remove message">✕</button><button class="ghost tiny" data-act="mod" data-a="mute" data-id="${m.authorId}">Mute</button><button class="ghost tiny" data-act="mod" data-a="remove" data-id="${m.authorId}">Remove</button></span>`:''}</li>`).join('')+outbox.map(o=>`<li class="mine pending"><span class="body">${esc(o.body)}</span><span class="small ${o.failed?'error':'muted'}">${o.failed?`Not sent <button class="ghost tiny" data-act="retry" data-id="${o.clientId}">Retry</button>`:'Sending…'}</span></li>`).join('');
    if(atBottom)log.scrollTop=log.scrollHeight;
  }
  async function refresh(){try{s=await request(`/api/performances/${id}`);full=s.full;}catch(e){if((e as ApiError).status===404){current()?.stop();listening=false;s={...s,status:'ended'};toast('You no longer have access to this performance.');}}syncAudio();render();}
  async function loadChat(){try{messages=(await request(`/api/performances/${id}/chat`)).messages;renderChat();}catch{}}
  function syncAudio(){
    const a=current();if(!a||!listening)return;
    if(s.status!=='live'){a.stop();listening=false;return;}
    a.setOffset(offset);a.update(s.plans,s.transport.epochMs??0,s.bpm,s.transport.generation);
    if(document.hidden||connection!=='live'&&connection!=='busy'){a.stopShared();return;}
    if(s.transport.status==='playing'&&!a.running)a.startAt();if(s.transport.status!=='playing')a.stopShared();
  }
  on(host,'click','[data-act]',async b=>{
    const act=b.dataset.act!;
    if(act==='listen'){if(listening){current()?.stop();listening=false;render();return;}try{const a=await enable();a.onBeat=(t,d)=>setTimeout(()=>{const li=$(`[data-part="${t}"]`,host);if(li&&!matchMedia('(prefers-reduced-motion: reduce)').matches){li.classList.remove('hit');void (li as HTMLElement).offsetWidth;li.classList.add('hit');}},d);listening=true;syncAudio();}catch(e){toast(errorText(e));}render();return;}
    if(act==='react'){await request(`/api/performances/${id}/react`,{reaction:b.dataset.r});return;}
    if(act==='request'){await request(`/api/performances/${id}/moderate`,{action:'request'});await refresh();return;}
    if(act==='mod'){await request(`/api/performances/${id}/moderate`,{action:b.dataset.a,visitorId:b.dataset.id,messageId:b.dataset.msg?Number(b.dataset.msg):undefined});await refresh();await loadChat();return;}
    if(act==='guest-remove'){await request(`/api/performances/${id}/commands`,{commandId:crypto.randomUUID(),type:'guest.remove',payload:{trackId:b.dataset.id}});await refresh();return;}
    if(act==='retry'){const o=outbox.find(x=>x.clientId===b.dataset.id);if(o){o.failed=false;void deliver(o);}return;}
  });
  host.addEventListener('submit',e=>{e.preventDefault();const f=e.target as HTMLFormElement;(async()=>{
    if(f.id==='aud-form'){const input=$<HTMLTextAreaElement>('#aud-input',host)!,body=input.value.trim();if(!body)return;input.value='';const o={clientId:crypto.randomUUID(),body,failed:false};outbox.push(o);renderChat();await deliver(o);}
    if(f.dataset.form==='guest'){const pid=$<HTMLSelectElement>('#guest-sound',f)!.value;const r=await request(`/api/performances/${id}/commands`,{commandId:crypto.randomUUID(),type:'guest.add',payload:{presetId:pid}});await refresh();toast(s.transport.status==='playing'?`Added · joins bar ${r.effectiveCycle+1}`:'Added. It plays when the host starts the music.');}
  })().catch(fail);});
  on(host,'keydown','#aud-input',(t,e)=>{const k=e as KeyboardEvent;if(k.key==='Enter'&&!k.shiftKey){k.preventDefault();(t.closest('form') as HTMLFormElement).requestSubmit();}});
  async function deliver(o:{clientId:string;body:string;failed:boolean}){
    for(let i=0;i<3;i++){try{const r=await request(`/api/performances/${id}/chat`,{clientId:o.clientId,body:o.body});outbox.splice(outbox.indexOf(o),1);if(!messages.some(m=>m.id===r.message.id))messages.push(r.message);renderChat();return;}
      catch(e){const st=(e as ApiError).status;if(st&&st<500&&st!==429){toast(errorText(e));break;}await new Promise(r=>setTimeout(r,800*(i+1)));}}
    o.failed=true;renderChat();
  }
  function burst(r:string){if(matchMedia('(prefers-reduced-motion: reduce)').matches)return;const e={clap:'👏',heart:'❤️',fire:'🔥',wave:'👋'}[r];if(!e)return;const span=document.createElement('span');span.textContent=e;span.style.left=`${10+Math.random()*80}%`;$('#burst',host)!.append(span);setTimeout(()=>span.remove(),1600);}
  let pending:ReturnType<typeof setTimeout>|null=null;
  // A full audience: keep checking for a free place, then join the stream.
  while(s.full&&s.status==='live'){render();await new Promise(r=>setTimeout(r,5000));await refresh();}
  if(s.status==='live'){
    connect(()=>`/api/performances/${id}/events?since=${s.eventId}`,{
      change:(kind,data)=>{if(kind==='reaction'){burst(data.reaction);return;}if(kind==='chat'||kind==='chat.filter'||kind==='moderation.delete'){void loadChat();}if(kind==='performance.ended'){void refresh();return;}if(!pending)pending=setTimeout(()=>{pending=null;void refresh();},80);},
      state:st=>{connection=st;if(st==='revoked'){current()?.stop();listening=false;void refresh();}render();syncAudio();},
      poll:()=>refresh(),
    });
    offset=await calibrate().catch(()=>0);
  }
  await loadChat();render();void soundOn;void parseSource;
  (window as any).ensembleDebug={snapshot:()=>s,audio:()=>current()};
}
