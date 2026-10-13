// O1 load probe: twelve worst-case legal tracks, live-stream churn, and the
// browser scheduler under the result. Run against a production build:
//   APP_URL=http://localhost:8080 node scripts/load-proof.mjs
// It prints measurements; it asserts nothing. Server memory is read
// separately (docker stats, or Fly metrics) while it runs.
import {randomUUID} from 'node:crypto';
import {chromium} from '@playwright/test';

const base=process.env.APP_URL??'http://localhost:8080';
const BPM=Number(process.env.BPM??120);
const visitor=async()=>(await fetch(`${base}/api/me`)).headers.getSetCookie()[0].split(';')[0];
const post=async(cookie,path,body)=>{const r=await fetch(`${base}${path}`,{method:'POST',headers:{cookie,'content-type':'application/json'},body:JSON.stringify(body)});const json=await r.json();if(!r.ok)throw new Error(`${path}: ${r.status} ${json.error}`);return json;};
const act=(cookie,id,type,payload={},expectedRevision)=>post(cookie,`/api/projects/${id}/commands`,{commandId:randomUUID(),type,payload,expectedRevision});
const state=async(cookie,id)=>(await fetch(`${base}/api/projects/${id}`,{headers:{cookie}})).json();

// Effects, a stack, then four 32-step leaves.
// FAST=0 is the worst legal clip (4 x 32 steps at 1x = 128 steps per bar, the
// MAX_STEPS_PER_BAR bound). Higher values are rejected by the server.
const FAST=Number(process.env.FAST??0);
const wrap=root=>['rev',['room',0.3],['lpf',6000],['gain',0.8],...Array(FAST).fill(['fast',2])].reduceRight((child,op)=>Array.isArray(op)?{kind:'transform',op:op[0],value:op[1],child}:{kind:'transform',op,child},root);
const drums={schemaVersion:1,root:wrap({kind:'stack',children:['bd','sd','hh','cp'].map(s=>({kind:'sound',steps:Array(32).fill(s)}))})};
const melody={schemaVersion:1,root:wrap({kind:'stack',children:['sine','triangle','square','sawtooth'].map((synth,i)=>({kind:'notes',synth,steps:Array.from({length:32},(_,j)=>48+((i*7+j)%36))}))})};

// SCENARIO=typical: full 16-step kits and melodies at normal speed, no effects.
const typical=process.env.SCENARIO==='typical';
const kit16={schemaVersion:1,root:{kind:'stack',children:['bd','sd','hh','cp'].map(s=>({kind:'sound',steps:Array(16).fill(s)}))}};
const tune16={schemaVersion:1,root:{kind:'notes',synth:'triangle',steps:Array.from({length:16},(_,j)=>60+(j%12))}};
const perTrack=typical?(64+16)/2:128*2**FAST;
const people=await Promise.all(Array.from({length:6},visitor));
const {id}=await post(people[0],'/api/projects',{title:`Load probe ${new Date().toISOString().slice(11,19)}`});
for(const [i,cookie] of people.entries())for(const kind of ['drums','melody']){
  const t=await act(cookie,id,'track.create',{kind});
  await act(cookie,id,'clip.publish',{trackId:t.entityId,slot:'A',document:typical?(kind==='drums'?kit16:tune16):(kind==='drums'?drums:melody)},1);
}
let s=await state(people[0],id);console.log(`project ${id}: ${s.tracks.length} active tracks, snapshot ${JSON.stringify(s).length} bytes`);
if(BPM!==120)await act(people[0],id,'conductor.claim',{},s.transport.revision),s=await state(people[0],id),await act(people[0],id,'tempo.set',{bpm:BPM},s.settings.revision);
else await act(people[0],id,'conductor.claim',{},s.transport.revision);
s=await state(people[0],id);await act(people[0],id,'transport.start',{},s.transport.revision);

// Live-stream churn: hold 60 streams (two per visitor), then open and drop 300 more.
const listeners=await Promise.all(Array.from({length:30},visitor));
const held=[];for(const cookie of listeners)for(let k=0;k<2;k++){const c=new AbortController();const r=await fetch(`${base}/api/projects/${id}/events`,{headers:{cookie},signal:c.signal});held.push({c,status:r.status});}
console.log(`held streams: ${held.filter(x=>x.status===200).length} open, ${held.filter(x=>x.status===429).length} refused`);
const churners=await Promise.all(Array.from({length:10},visitor));
let refused=0,started=performance.now();
for(let i=0;i<300;i++){const c=new AbortController();const r=await fetch(`${base}/api/projects/${id}/events`,{headers:{cookie:churners[i%10]},signal:c.signal}).catch(()=>null);if(r?.status===429)refused++;c.abort();}
console.log(`churn: 300 connect/drop cycles in ${Math.round(performance.now()-started)} ms, ${refused} refused at capacity`);
const t0=performance.now();await fetch(`${base}/healthz`);console.log(`healthz under load: ${Math.round(performance.now()-t0)} ms`);

// Browser scheduler, normal and with 4x CPU throttling as a rough phone stand-in.
const browser=await chromium.launch();
for(const throttle of [1,4]){
  const context=await browser.newContext({viewport:{width:390,height:844}});
  const [name,value]=people[1].split('=');await context.addCookies([{name,value,url:base}]);
  const page=await context.newPage();
  if(throttle>1){const cdp=await context.newCDPSession(page);await cdp.send('Emulation.setCPUThrottlingRate',{rate:throttle});}
  await page.goto(`${base}/p/${id}/perform`);await page.getByRole('button',{name:'Enable sound',exact:true}).click();
  await page.waitForTimeout(3000);const a=await page.evaluate(()=>({...window.streamDebug.audio().stats}));
  await page.waitForTimeout(10000);const b=await page.evaluate(()=>({...window.streamDebug.audio().stats}));
  const expected=12*perTrack*BPM/240;
  console.log(`browser cpu x${throttle}: ${((b.scheduled-a.scheduled)/10).toFixed(0)} events/s voiced of ~${expected} expected, ${((b.late-a.late)/10).toFixed(1)} late/s dropped, slowest pass ${b.slowestTickMs.toFixed(1)} ms; page says: ${await page.locator('#audio-status').textContent()}`);
  await context.close();
}
await browser.close();
for(const x of held)x.c.abort();
// The probe outlives the 30 s lease it never renewed, so reclaim before stopping.
s=await state(people[0],id);await act(people[0],id,'conductor.claim',{},s.transport.revision);
s=await state(people[0],id);await act(people[0],id,'transport.stop',{},s.transport.revision);
console.log('done; ensemble stopped');
