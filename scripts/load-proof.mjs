// Load probe: twelve worst-case legal parts, live-stream churn, the audience
// cap, and the browser scheduler under the result. Run against a production
// build:  APP_URL=http://localhost:8080 node scripts/load-proof.mjs
// It prints measurements; it asserts nothing. Server memory is read separately
// (docker stats, or Fly metrics) while it runs.
import {randomUUID} from 'node:crypto';
import {chromium} from '@playwright/test';

const base=process.env.APP_URL??'http://localhost:8080';
const BPM=Number(process.env.BPM??120); // the room's own default is 100
const visitor=async()=>(await fetch(`${base}/api/me`)).headers.getSetCookie()[0].split(';')[0];
const post=async(cookie,path,body)=>{const r=await fetch(`${base}${path}`,{method:'POST',headers:{cookie,'content-type':'application/json'},body:JSON.stringify(body)});const json=await r.json();if(!r.ok)throw new Error(`${path}: ${r.status} ${json.error}`);return json;};
const act=(cookie,id,type,payload={},expectedRevision)=>post(cookie,`/api/projects/${id}/commands`,{commandId:randomUUID(),type,payload,expectedRevision});
const state=async(cookie,id)=>(await fetch(`${base}/api/projects/${id}`,{headers:{cookie}})).json();

// The densest part the grammar accepts: 64 onsets in every bar (LIMITS.onsetsPerCycle).
const WORST='stack(s("bd*16"), s("sd*16"), s("hh*16"), s("cp*16"))';
// A part a room is actually likely to hold.
const TYPICAL='stack(s("bd ~ bd ~"), s("~ sd ~ sd").gain(0.45), s("hh*8").gain(0.16))';
const typical=process.env.SCENARIO==='typical';
const source=typical?TYPICAL:WORST;
const perPart=typical?12:64; // Pocket: 2 kicks, 2 snares, 8 hats

const owner=await visitor();
const {id}=await post(owner,'/api/projects',{title:`Load probe ${new Date().toISOString().slice(11,19)}`});
// One owner plus eleven invited members: the room's twelve-part limit with no
// per-person cap, and the eight-editor limit reached along the way.
const members=[owner];
for(let i=1;i<12;i++){
  const who=await visitor();
  const inv=await post(owner,'/api/invitations',{kind:'project',resourceId:id});
  const [iid,token]=inv.path.replace('/invite/','').split('#');
  await post(who,`/api/invitations/${iid}/accept`,{token});
  members.push(who);
}
// Eight people may edit at once, so the twelve parts come from eight members
// in turn: an editing slot is held for a minute after a change, and the probe
// wants the room full, not the editor limit measured (spec/access.test.ts
// covers that).
let added=0,refusedEdits=0;
for(let i=0;added<12;i++){
  const cookie=members[i%8];
  try{await act(cookie,id,'part.add',{source,name:`Part ${added+1}`});added++;}
  catch(e){if(/editing right now/.test(e.message)){refusedEdits++;continue;}throw e;}
}
let s=await state(owner,id);
console.log(`project ${id}: ${s.parts.filter(p=>!p.archivedAt).length} parts at ${perPart} onsets/bar each, by ${members.length} members (${refusedEdits} refusals while editing slots were full), snapshot ${JSON.stringify(s).length} bytes`);
await act(owner,id,'tempo.set',{bpm:BPM});
await act(owner,id,'transport.start');

// Live-stream churn at the documented limits (3 per person per scope, 48 per
// scope, 96 in total). A private mix is invisible to non-members, so the
// crowd watches the public view stream.
await act(owner,id,'project.visibility',{visibility:'public'});
const listeners=await Promise.all(Array.from({length:30},visitor));
const held=[];
for(const cookie of listeners)for(let k=0;k<2;k++){const c=new AbortController();const r=await fetch(`${base}/api/projects/${id}/events`,{headers:{cookie},signal:c.signal});held.push({c,status:r.status});}
console.log(`view streams: ${held.filter(x=>x.status===200).length} open, ${held.filter(x=>x.status===429).length} refused at capacity, ${held.filter(x=>![200,429].includes(x.status)).length} other`);
const churners=await Promise.all(Array.from({length:10},visitor));
let refused=0,started=performance.now();
for(let i=0;i<300;i++){const c=new AbortController();const r=await fetch(`${base}/api/projects/${id}/events`,{headers:{cookie:churners[i%10]},signal:c.signal}).catch(()=>null);if(r?.status===429)refused++;c.abort();}
console.log(`churn: 300 connect/drop cycles in ${Math.round(performance.now()-started)} ms, ${refused} refused at capacity`);
for(const x of held)x.c.abort();

// The audience cap: 32 listeners on a public performance, then one more.
const perf=await post(owner,`/api/projects/${id}/go-live`,{commandId:randomUUID(),title:'Load probe live',visibility:'public'});
const audience=[];
for(let i=0;i<33;i++){const cookie=await visitor();const c=new AbortController();const r=await fetch(`${base}/api/performances/${perf.id}/events`,{headers:{cookie},signal:c.signal});audience.push({c,status:r.status});}
console.log(`audience: ${audience.filter(x=>x.status===200).length} admitted, ${audience.filter(x=>x.status===429).length} refused at the 32-listener cap`);
const t0=performance.now();await fetch(`${base}/healthz`);console.log(`healthz under load: ${Math.round(performance.now()-t0)} ms`);

// Browser scheduler, normal and with 4x CPU throttling as a rough phone stand-in.
const browser=await chromium.launch({args:['--autoplay-policy=no-user-gesture-required']});
for(const throttle of [1,4]){
  const context=await browser.newContext({viewport:{width:390,height:844}});
  const [name,value]=owner.split('=');await context.addCookies([{name,value,url:base}]);
  const page=await context.newPage();
  if(throttle>1){const cdp=await context.newCDPSession(page);await cdp.send('Emulation.setCPUThrottlingRate',{rate:throttle});}
  await page.goto(`${base}/p/${id}`);
  await page.getByRole('button',{name:/Enable sound/}).click();
  await page.waitForTimeout(3000);const a=await page.evaluate(()=>({...window.ensembleDebug.audio().stats}));
  await page.waitForTimeout(10000);const b=await page.evaluate(()=>({...window.ensembleDebug.audio().stats}));
  // What the plan actually asks for: parts x onsets per bar x bars per second.
  const expected=Math.round(added*perPart*BPM/240);
  console.log(`browser cpu x${throttle}: ${((b.scheduled-a.scheduled)/10).toFixed(0)} events/s voiced of ~${expected} expected, ${((b.late-a.late)/10).toFixed(1)} late/s dropped, slowest pass ${b.slowestTickMs.toFixed(1)} ms; page says: ${(await page.locator('#status-line').textContent()).trim()}`);
  await context.close();
}
await browser.close();
for(const x of audience)x.c.abort();
await post(owner,`/api/performances/${perf.id}/end`,{});
await act(owner,id,'transport.stop');
console.log('done; performance ended and the mix stopped');
