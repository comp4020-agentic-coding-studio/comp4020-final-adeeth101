// Play (home), Live now, public mixes, Friends and invitation landing pages.
import {request,type ApiError} from './api.ts';
import {esc,$,toast,fail,errorText,on,ago,visibilityLabel} from './ui.ts';
import {connect} from './live.ts';
import {enable} from './sound.ts';

export async function mountHome(host:HTMLElement){
  const list=$('#home-lists',host)!;
  const form=$<HTMLFormElement>('.start-form',host);
  form?.addEventListener('submit',e=>{e.preventDefault();const b=form.querySelector('button')!;b.disabled=true;void request('/api/projects',{}).then(x=>location.href=`/p/${x.id}?new=1`).catch(err=>{b.disabled=false;fail(err);});});
  try{
    const [{projects},live]=await Promise.all([request('/api/projects'),request('/api/live').catch(()=>({performances:[]}))]);
    list.innerHTML=`<section class="your-projects"><h2>Your mixes</h2>${projects.length?`<ul class="project-list">${projects.map((p:any)=>`<li><a class="project-card" href="/p/${esc(p.id)}"><strong>${esc(p.title)}</strong><span class="small muted">${p.parts} part${p.parts===1?'':'s'} · ${p.members} ${p.members===1?'person':'people'} · ${visibilityLabel[p.visibility]} · ${ago(p.updatedAt)}</span></a></li>`).join('')}</ul>`:'<p class="empty-state">No mixes yet. Start one: you get an empty stage and a tray of sounds to give your performers. Invite friends once you have something going.</p>'}</section>
      ${live.performances.length?`<section><h2>Live now</h2><p><a href="/live">${live.performances.length} performance${live.performances.length===1?'':'s'} live →</a></p></section>`:''}
      <p class="small"><a href="/discover">Browse public mixes</a> · <a href="/friends">Friends and your profile</a></p>`;
  }catch(e){list.innerHTML=`<p class="notice">${esc(errorText(e))}</p>`;}
}

export async function mountDiscover(host:HTMLElement){
  let page=0;
  async function draw(){
    const {projects}=await request(`/api/discover?page=${page}`);
    host.innerHTML=`<section class="page"><h1>Public mixes</h1><p class="lede small">Mixes their owners chose to make public. Open one to listen; members edit.</p>${projects.length?`<ul class="project-list">${projects.slice(0,24).map((p:any)=>`<li><a class="project-card" href="/p/${esc(p.id)}"><strong>${esc(p.title)}</strong><span class="small muted">${p.parts} parts · ${ago(p.updatedAt)}</span></a></li>`).join('')}</ul>`:'<p class="empty-state">No public mixes yet.</p>'}
      <div class="row">${page?'<button class="ghost" data-act="prev">Newer</button>':''}${projects.length>24?'<button class="ghost" data-act="next">Older</button>':''}</div></section>`;
  }
  on(host,'click','[data-act]',async b=>{page+=b.dataset.act==='next'?1:-1;await draw();});
  await draw();
}

export async function mountLive(host:HTMLElement){
  async function draw(){
    const {performances}=await request('/api/live');
    host.innerHTML=`<section class="page"><h1>Live now</h1><p class="lede small">Public performances happening right now. Listening starts when you press Listen.</p>
      ${performances.length?`<ul class="live-list">${performances.map((p:any)=>`<li class="live-card"><div><p class="eyebrow">● Live · ${p.audience}/${p.capacity} listening</p><h2>${esc(p.title)}</h2><p class="small">${esc(p.projectTitle)} · with ${p.performers.map(esc).join(', ')}</p></div><a class="primary" href="/live/${esc(p.id)}">Listen</a></li>`).join('')}</ul>`:'<p class="empty-state">Nobody is performing publicly right now. Start a mix and go live from its room.</p>'}</section>`;
  }
  await draw();setInterval(()=>{if(!document.hidden)void draw().catch(()=>{});},10000);
}

export async function mountFriends(host:HTMLElement){
  let view:any,code:string|null=null,keepOpen=false;
  async function load(){view=await request('/api/friends');draw();}
  function person(p:any,actions:string){return `<li><span class="dot ${p.online?'online':''}" aria-hidden="true"></span><strong>${esc(p.handle)}</strong> <span class="code-tag">#${esc(p.code)}</span>${p.online!==undefined?` <span class="small muted">${p.online?'online':'offline'}</span>`:''} <span class="row-actions">${actions}</span></li>`;}
  function noteText(n:any){
    if(n.kind==='friend.request')return `${esc(n.from.handle)} wants to be friends.`;
    if(n.kind==='friend.accepted')return `${esc(n.from.handle)} accepted your friend request.`;
    if(n.kind==='invite.accepted')return `${esc(n.from.handle)} joined ${esc(n.title)}.`;
    if(n.kind==='invite')return n.expired?`An invitation from ${esc(n.from.handle)} is no longer available.`:`${esc(n.from.handle)} invited you to ${n.inviteKind==='perform'?'perform in':'join'} <strong>${esc(n.title)}</strong>${n.inviteKind==='perform'?` (${esc(n.projectTitle)})`:''}.`;
    return esc(n.kind);
  }
  function draw(){
    const me=view.me;
    host.innerHTML=`<section class="page friends">
      <h1>Friends</h1>
      <div class="profile card"><h2>You</h2>
        <form data-form="name" class="row"><label for="my-name">Name</label><input id="my-name" maxlength="24" value="${esc(me.handle)}" required><button class="outline" type="submit">Save</button></form>
        <p>Your friend code: <strong class="code-tag big">#${esc(me.code??'—')}</strong> <span class="small muted">${me.code?'Share it so friends can add you. Names can repeat; codes don’t.':'You get a code once you’ve made or saved something.'}</span></p>
        <details class="keep" ${code||keepOpen?"open":""}><summary>Keep my profile</summary>
          <p class="small">Your profile lives in this browser. A recovery code lets you sign in as the same person on another device or after clearing your browser. <strong>Anyone with the code can use your profile</strong>, so keep it private. It is shown once; making a new one cancels the old.</p>
          ${code?`<p class="recovery" role="status"><span class="sr-only">Your recovery code: </span><code id="recovery-code">${esc(code)}</code> <button class="outline small" data-act="copy-code">Copy</button></p><p class="small">Store it somewhere safe now. It won’t be shown again.</p>`:`<button class="outline" data-act="make-code">${me.hasRecovery?'Make a new recovery code':'Make a recovery code'}</button>`}
          <form data-form="recover" class="row"><label for="recover-code">Use a code from another device</label><input id="recover-code" autocomplete="off" spellcheck="false" placeholder="XXXXX-XXXXX-…" required><button class="ghost" type="submit">Sign in</button></form>
        </details>
      </div>
      ${view.notifications.length?`<section><h2>Notifications</h2><ul class="notes">${view.notifications.map((n:any)=>`<li>${noteText(n)} <span class="small muted">${ago(n.createdAt)}</span>
        ${n.kind==='invite'&&!n.expired?`<button class="primary small" data-act="inv-accept" data-id="${esc(n.invitationId)}" data-kind="${esc(n.inviteKind)}">Accept</button><button class="ghost small" data-act="inv-decline" data-id="${esc(n.invitationId)}">Decline</button>`:''}
        ${n.kind==='friend.request'?`<button class="primary small" data-act="accept" data-id="${esc(n.from.id)}">Accept</button><button class="ghost small" data-act="decline" data-id="${esc(n.from.id)}">Decline</button>`:''}
        <button class="ghost tiny" data-act="clear" data-id="${n.id}" aria-label="Dismiss">✕</button></li>`).join('')}</ul></section>`:''}
      <section><h2>Add a friend</h2><form data-form="add" class="row"><label for="friend-code">Friend code</label><input id="friend-code" maxlength="12" autocomplete="off" spellcheck="false" placeholder="e.g. 7KQ2MX" required><button class="primary" type="submit">Send request</button></form><p class="small muted">They’ll get a request to accept. Being friends lets you see when each other is online and send invitations; it never opens a private mix.</p></section>
      <section><h2>Your friends</h2>${view.friends.length?`<ul class="people">${view.friends.map((f:any)=>person(f,`<button class="ghost small" data-act="remove" data-id="${f.id}">Remove</button><button class="ghost small" data-act="block" data-id="${f.id}">Block</button>`)).join('')}</ul>`:'<p class="empty-state">No friends yet.</p>'}</section>
      ${view.incoming.length?`<section><h2>Requests for you</h2><ul class="people">${view.incoming.map((f:any)=>person(f,`<button class="primary small" data-act="accept" data-id="${f.id}">Accept</button><button class="ghost small" data-act="decline" data-id="${f.id}">Decline</button><button class="ghost small" data-act="block" data-id="${f.id}">Block</button>`)).join('')}</ul></section>`:''}
      ${view.outgoing.length?`<section><h2>Waiting for them</h2><ul class="people">${view.outgoing.map((f:any)=>person(f,`<button class="ghost small" data-act="cancel" data-id="${f.id}">Cancel</button>`)).join('')}</ul></section>`:''}
      ${view.blocked.length?`<section><h2>Blocked</h2><ul class="people">${view.blocked.map((f:any)=>person(f,`<button class="ghost small" data-act="unblock" data-id="${f.id}">Unblock</button>`)).join('')}</ul></section>`:''}
    </section>`;
  }
  host.addEventListener('toggle',e=>{const d=e.target as HTMLElement;if(d.matches?.('details.keep'))keepOpen=(d as HTMLDetailsElement).open;},true);
  on(host,'click','[data-act]',async b=>{
    const act=b.dataset.act!,id=b.dataset.id;
    if(['accept','decline','cancel','remove','block','unblock'].includes(act)){if(act==='block'&&!confirm('Block this person? They can’t send you requests or invitations, and their chat messages are hidden from you.'))return;await request('/api/friends',{action:act,visitorId:id});await load();toast(act==='accept'?'You are now friends.':'Done.');}
    if(act==='clear'){await request(`/api/notifications/${id}/clear`,{});await load();}
    if(act==='inv-accept'){const r=await request(`/api/invitations/${id}/accept`,{});await enable().catch(()=>{});location.href=r.kind==='project'?`/p/${r.projectId}`:`/live/${r.performanceId}`;}
    if(act==='inv-decline'){await request(`/api/invitations/${id}/decline`,{});await load();}
    if(act==='make-code'){if(view.me.hasRecovery&&!confirm('Make a new code? The old one will stop working.'))return;code=(await request('/api/recovery',{})).code;await load();}
    if(act==='copy-code'&&code){await navigator.clipboard.writeText(code);toast('Recovery code copied.');}
  });
  host.addEventListener('submit',e=>{e.preventDefault();const f=e.target as HTMLFormElement;(async()=>{
    if(f.dataset.form==='add'){const r=await request('/api/friends',{action:'request',code:$<HTMLInputElement>('#friend-code',f)!.value});toast(r.status==='accepted'?'You are now friends.':'Request sent.');await load();}
    if(f.dataset.form==='name'){await request('/api/handle',{handle:$<HTMLInputElement>('#my-name',f)!.value});toast('Name saved.');await load();}
    if(f.dataset.form==='recover'){if(!confirm('Sign in as that profile on this device? You will leave the current one here.'))return;const r=await request('/api/recover',{code:$<HTMLInputElement>('#recover-code',f)!.value});code=null;toast(`Signed in as ${r.handle}.`);await load();}
  })().catch(fail);});
  await load();
  connect(()=>'/api/account/events',{change:()=>void load().catch(()=>{}),state:()=>{},poll:()=>load()});
  setInterval(()=>{if(!document.hidden)void load().catch(()=>{});},20000);
}

// Opening an invitation never uses it. The token is in the fragment (never sent
// in a request line or referrer), is exchanged by POST, then cleared from the
// address bar.
export async function mountInvite(host:HTMLElement,id:string){
  const token=new URLSearchParams(location.hash.slice(1)).get('t')??location.hash.slice(1);
  let preview:any;
  try{preview=await request(`/api/invitations/${id}/preview`,{token});}catch(e){preview={state:'invalid',message:errorText(e)};}
  if(token&&preview.state!=='invalid')sessionStorage.setItem(`invite:${id}`,token);
  const kept=token||sessionStorage.getItem(`invite:${id}`)||'';
  history.replaceState(null,'',location.pathname);
  const roleText=preview.kind==='project'?'as a <strong>member</strong>: you can add and change parts and chat with the group':'as a <strong>guest performer</strong> for this performance only: you can add your own parts while it is live. It doesn’t make you a member of the mix';
  host.innerHTML=preview.state==='open'||preview.state==='member'?`<section class="page invite card"><p class="eyebrow">Invitation</p><h1>${esc(preview.from)} invited you to ${preview.kind==='project'?'join':'perform in'} “${esc(preview.title)}”</h1>
      <p>You’d join ${roleText}.</p>${preview.kind==='perform'&&!preview.live?'<p class="notice">This performance has ended.</p>':''}
      ${preview.state==='member'?`<p>You’re already a member.</p><a class="primary" href="/p/${esc(preview.projectId)}">Open the mix</a>`:`<div class="row"><button class="primary big" data-act="accept">Join and enable sound</button><a class="ghost" href="/">Not now</a></div>`}
      <p class="small muted">Nothing happens until you choose. Your name here is the one on your profile; you can change it on the Friends page.</p></section>`
    :`<section class="page invite card"><h1>${preview.state==='invalid'?'This invitation isn’t valid':'This invitation can’t be used'}</h1><p>${esc(preview.message??'Ask the person who sent it for a new one.')}</p><p><a href="/">Go to Play</a></p></section>`;
  on(host,'click','[data-act="accept"]',async b=>{
    (b as HTMLButtonElement).disabled=true;
    const soundOk=await enable().then(()=>true).catch(()=>false);
    try{const r=await request(`/api/invitations/${id}/accept`,{token:kept});sessionStorage.removeItem(`invite:${id}`);sessionStorage.setItem('ensemble-sound','1');location.href=r.kind==='project'?`/p/${r.projectId}${soundOk?'':'?sound=off'}`:`/live/${r.performanceId}`;}
    catch(e){(b as HTMLButtonElement).disabled=false;toast(errorText(e));if((e as ApiError).status===410)setTimeout(()=>location.reload(),1500);}
  });
}
