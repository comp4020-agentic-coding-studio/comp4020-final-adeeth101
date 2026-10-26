// Routes the server's shell to a view. Each view lives in its own module; the
// room and audience pages load their audio engine on the first gesture.
import {request} from './api.ts';
import {esc} from './ui.ts';
import {connect} from './live.ts';
import './performer.ts';

const app=document.querySelector<HTMLElement>('#app')!;
const view=app.dataset.view;

async function route(){
  // An unlisted view link (#view=…) on a mix this visitor cannot read yet: the
  // server rendered a generic page; exchange the token, then load the room.
  if(view==='room'&&app.dataset.missing){
    const token=new URLSearchParams(location.hash.slice(1)).get('view');
    if(!token)return;
    history.replaceState(null,'',location.pathname);
    try{await request(`/api/projects/${app.dataset.project}/view-link`,{token});location.reload();}
    catch{app.innerHTML=`<section class="notice-page"><h1>This view link no longer works</h1><p>The owner may have changed it or made the mix private. Ask them for a new link.</p><p><a href="/">Back to Play</a></p></section>`;}
    return;
  }
  if(view==='play'){const {mountHome}=await import('./pages.ts');return mountHome(app);}
  if(view==='live'){const {mountLive}=await import('./pages.ts');return mountLive(app);}
  if(view==='discover'){const {mountDiscover}=await import('./pages.ts');return mountDiscover(app);}
  if(view==='friends'){const {mountFriends}=await import('./pages.ts');return mountFriends(app);}
  if(view==='invite'){const {mountInvite}=await import('./pages.ts');return mountInvite(app,app.dataset.invitation!);}
  if(view==='room'){const {mountRoom}=await import('./room.ts');return mountRoom(app,app.dataset.project!);}
  if(view==='audience'){const {mountAudience}=await import('./audience.ts');return mountAudience(app,app.dataset.performance!);}
}
route().catch(e=>{app.innerHTML=`<p class="notice">${esc(e instanceof Error?e.message:'Something went wrong.')}</p>`;});

// Account notifications light a dot on Friends from any page. The stream event
// carries no content; the count comes from a permission-checked request.
async function notes(){
  try{const {notifications}=await request('/api/notifications');const n=notifications.filter((x:{read:boolean})=>!x.read).length;const dot=document.querySelector<HTMLElement>('#notice-dot');if(dot){dot.hidden=!n;dot.textContent=n?`${n} new`:'';}}catch{}
}
// A browser allows only six connections per site, and every live stream holds
// one. Rooms and audience pages already hold their own stream, so there the
// dot is polled instead, and a person can keep several mixes open at once.
if(view==='room'||view==='audience'){void notes();setInterval(()=>{if(!document.hidden)void notes();},20000);}
else if(view!=='friends'){void notes();connect(()=>'/api/account/events',{change:()=>void notes(),state:()=>{},poll:notes});}
// Online status for friends: a light heartbeat while a page is open and visible.
setInterval(()=>{if(!document.hidden)void request('/api/heartbeat',{}).catch(()=>{});},15000);
