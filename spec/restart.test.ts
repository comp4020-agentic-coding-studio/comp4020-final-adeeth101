// D1: a restart keeps the composition, stops the ensemble, releases the
// podium and cancels anything still queued. Like persistence.test.ts this
// starts its own server on a throwaway database, because a restart can only be
// tested by performing one.
import {spawn,type ChildProcess} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterAll,expect,it} from 'vitest';
import {parseCode} from '../shared/code.ts';
import {blankPlan,planAtRestart,type Plan} from '../shared/performance.ts';
import type {Snapshot} from '../shared/studio.ts';

const PORT=8700+Math.floor(Math.random()*400),base=`http://127.0.0.1:${PORT}`;
const dir=mkdtempSync(join(tmpdir(),'spec-restart-')),DB_PATH=join(dir,'app.db');
let server:ChildProcess|null=null;
async function boot(){
  server=spawn(process.execPath,['src/server.ts'],{env:{...process.env,PORT:String(PORT),DB_PATH},stdio:'ignore'});
  for(let i=0;i<150;i++){try{await fetch(`${base}/healthz`);return;}catch{await new Promise(r=>setTimeout(r,100));}}
  throw new Error(`the app never came up on ${PORT}`);
}
function kill():Promise<void>{const dying=server;server=null;if(!dying)return Promise.resolve();return new Promise(r=>{dying.on('exit',()=>r());dying.kill('SIGKILL');});}
afterAll(async()=>{await kill();rmSync(dir,{recursive:true,force:true});});

async function visitor(){const r=await fetch(`${base}/api/me`);return r.headers.getSetCookie()[0].split(';')[0];}
const post=async(cookie:string,path:string,body:unknown)=>{const r=await fetch(`${base}${path}`,{method:'POST',headers:{cookie,'content-type':'application/json'},body:JSON.stringify(body)});return {status:r.status,body:await r.json() as any};};
const act=(cookie:string,id:string,type:string,payload:unknown={},expectedRevision?:number)=>post(cookie,`/api/projects/${id}/commands`,{commandId:randomUUID(),type,payload,expectedRevision});
const state=async(cookie:string,id:string):Promise<Snapshot>=>(await fetch(`${base}/api/projects/${id}`,{headers:{cookie}})).json();

it('keeps the plan sounding at the last write and drops queued ones',()=>{
  const playing:Plan={...blankPlan(),generation:1,planRevision:0,effectiveCycle:0,scene:'A'};
  const queued:Plan={...structuredClone(playing),planRevision:1,effectiveCycle:3,scene:'C'};
  // 120 BPM: one cycle is two seconds. The last write happened 1 s into bar 2.
  expect(planAtRestart([playing,queued],0,120,3000).scene).toBe('A');
  expect(planAtRestart([playing,queued],0,120,6500).scene).toBe('C');
  // A stopped transport has only cycle-zero plans; the latest is the saved selection.
  expect(planAtRestart([playing,{...queued,effectiveCycle:0}],null,120,0).scene).toBe('C');
  // An arrangement freezes on the scene that was playing.
  const arranged:Plan={...structuredClone(playing),arrangement:{entries:[{scene:'B',bars:1},{scene:'D',bars:1}],loop:true,startCycle:0}};
  expect(planAtRestart([arranged],0,120,2500).scene).toBe('D');
});

it('survives a hard restart mid-performance without resuming sound or applying a queued launch',async()=>{
  await boot();
  const cookie=await visitor(),{body:{id}}=await post(cookie,'/api/projects',{title:'Restart piece'});
  const track=(await act(cookie,id,'track.create',{kind:'drums'})).body.entityId;
  const doc=parseCode('s("bd ~ sd ~").slow(2)');
  expect((await act(cookie,id,'clip.publish',{trackId:track,slot:'A',document:doc,source:'s("bd ~ sd ~").slow(2)'},1)).status).toBe(200);
  let s=await state(cookie,id);await act(cookie,id,'conductor.claim',{},s.transport.revision);
  s=await state(cookie,id);expect((await act(cookie,id,'transport.start',{},s.transport.revision)).status).toBe(200);
  // Let bar 1 begin, then queue scene B for a later bar and die before it arrives.
  await new Promise(r=>setTimeout(r,1500));
  s=await state(cookie,id);const launch=await act(cookie,id,'scene.launch',{scene:'B'},s.transport.revision);
  expect(launch.status).toBe(200);expect(launch.body.effectiveCycle).toBeGreaterThanOrEqual(1);
  const before=await state(cookie,id);
  await kill();await boot();

  const after=await state(cookie,id);
  expect(after.transport.status).toBe('stopped');
  expect(after.transport.conductorId).toBeNull();
  expect(after.transport.generation).toBe(before.transport.generation+1);
  expect(after.plans).toHaveLength(1);
  expect(after.plans[0].scene).toBe('A');
  expect(after.plans[0].arrangement).toBeNull();
  expect(after.tracks[0].clips.A?.document).toEqual(doc);
  expect(after.tracks[0].clips.A?.source).toBe('s("bd ~ sd ~").slow(2)');
  expect(after.eventId).toBeGreaterThan(before.eventId);

  // A second restart has nothing left to reset and records nothing new.
  await kill();await boot();
  const again=await state(cookie,id);
  expect(again.eventId).toBe(after.eventId);expect(again.transport.generation).toBe(after.transport.generation);
  // Identity survives, so ownership does too.
  expect(again.you.id).toBe(before.you.id);
  expect((await act(cookie,id,'track.rename',{trackId:track,name:'Still mine'},again.tracks[0].revision)).status).toBe(200);
},30000);
