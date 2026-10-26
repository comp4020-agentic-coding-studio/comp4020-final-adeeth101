// The server-rendered shell: three destinations (Play, Live now, Friends), a
// mount point and the client bundle. Content that depends on the visitor is
// fetched by the page through permission-checked APIs.
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {legacyArchive} from './studio.ts';
const root=fileURLToPath(new URL('..',import.meta.url));
const escape=(s:unknown)=>String(s).replace(/[&<>"']/g,x=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x]!));
export type PageView={view:'play'|'live'|'friends'|'discover'|'room'|'audience'|'invite';projectId?:string;performanceId?:string;invitationId?:string;title?:string;missing?:boolean};
async function entry(){
  try{const manifest=JSON.parse(await readFile(`${root}/dist/client/.vite/manifest.json`,'utf8'));const m=manifest['client/main.ts'];return `${(m.css??[]).map((c:string)=>`<link rel="stylesheet" href="/assets/${c}">`).join('')}<script type="module" src="/assets/${m.file}"></script>`;}catch{return '';}
}
const TITLES:Record<PageView['view'],string>={play:'Make a mix with friends',live:'Live now',friends:'Friends',discover:'Public mixes',room:'Mix',audience:'Live',invite:'Invitation'};
export async function appPage(p:PageView){
  const nav=(href:string,label:string,current:boolean)=>`<a href="${href}" ${current?'aria-current="page"':''}>${label}</a>`;
  const data=Object.entries({view:p.view,project:p.projectId,performance:p.performanceId,invitation:p.invitationId,missing:p.missing?'1':undefined}).filter(([,v])=>v!==undefined).map(([k,v])=>`data-${k}="${escape(v)}"`).join(' ');
  // The no-script home still makes a mix: a plain form post creates one.
  const body=p.view==='play'?`<section class="hero"><h1>Make a mix with friends.</h1><p class="lede">Give sounds to a band of performers, invite friends to change them with you, then play it live.</p><form method="post" action="/api/projects" class="start-form"><button class="primary big">Start a mix</button></form></section><div id="home-lists"><p class="loading">Loading your mixes…</p></div>`
    :p.missing?`<section class="notice-page"><h1>This mix isn’t available</h1><p>It may be private, or the link may be incomplete. If someone shared it with you, ask them for an invitation.</p><p><a href="/">Back to Play</a></p></section>`
    :`<p class="loading">Loading…</p>`;
  const title=`${p.title?`${escape(p.title)} · `:''}${TITLES[p.view]} · Ensemble`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="referrer" content="no-referrer"><title>${title}</title><link rel="stylesheet" href="/static/studio.css"></head><body class="view-${p.view}"><a class="skip" href="#app">Skip to content</a><header class="site-header"><a class="brand" href="/"><span class="brand-mark" aria-hidden="true"></span>Ensemble</a><nav aria-label="Main">${nav('/','Play',p.view==='play'||p.view==='room')}${nav('/live','Live now',p.view==='live'||p.view==='audience')}${nav('/friends','Friends',p.view==='friends')}<span id="notice-dot" class="notice-dot" hidden aria-live="polite"></span></nav></header><main id="app" ${data}>${body}</main><noscript><p class="notice">Ensemble needs JavaScript and browser audio to play. You can read <a href="/readme/">what it is</a>.</p></noscript><div id="toast" role="status" aria-live="polite"></div><footer class="site-footer"><a href="/readme/">About Ensemble</a><a href="/discover">Public mixes</a><a href="/legacy">Earlier sketchpad</a></footer>${await entry()}</body></html>`;
}
export function archiveHtml(){return legacyArchive().map(x=>`<article><h2>${escape(x.handle)} · sketch ${x.trace_id}</h2><pre>${escape(x.archived_source)}</pre><p>${escape(x.reason)}</p></article>`).join('');}
