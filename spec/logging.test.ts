// Crit 10: the server logs who did what, so two people can be told apart from
// `flyctl logs` alone. Starts its own server on a throwaway database, because
// stdout is only readable from the process that owns it.
import {spawn,type ChildProcess} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterAll,expect,it} from 'vitest';

const PORT=8300+Math.floor(Math.random()*400),base=`http://127.0.0.1:${PORT}`;
const dir=mkdtempSync(join(tmpdir(),'spec-logging-'));
let server:ChildProcess|null=null,out='';
// Windows keeps the database locked for a moment after the process exits.
afterAll(async()=>{const s=server;if(s)await new Promise(r=>{s.on('exit',r);s.kill('SIGKILL');});for(let i=0;i<20;i++){try{rmSync(dir,{recursive:true,force:true});return;}catch{await new Promise(r=>setTimeout(r,100));}}});

async function visitor(){const r=await fetch(`${base}/api/me`);return {cookie:r.headers.getSetCookie()[0].split(';')[0],...(await r.json() as {id:string,handle:string})};}
const post=async(cookie:string,path:string,body:unknown)=>(await fetch(`${base}${path}`,{method:'POST',headers:{cookie,'content-type':'application/json'},body:JSON.stringify(body)})).json() as Promise<any>;
const act=(cookie:string,id:string,type:string,payload:unknown={},expectedRevision?:number)=>post(cookie,`/api/projects/${id}/commands`,{commandId:randomUUID(),type,payload,expectedRevision});
const lines=()=>out.split('\n').filter(l=>l.startsWith('{')).map(l=>JSON.parse(l));

it('names the visitor on every change and every refusal',async()=>{
  server=spawn(process.execPath,['src/server.ts'],{env:{...process.env,PORT:String(PORT),DB_PATH:join(dir,'app.db')},stdio:['ignore','pipe','inherit']});
  server.stdout!.on('data',d=>{out+=d;});
  for(let i=0;i<150&&!out.includes('listening');i++)await new Promise(r=>setTimeout(r,100));
  const a=await visitor(),b=await visitor();
  const {id}=await post(a.cookie,'/api/projects',{title:'Log test'});
  await post(a.cookie,`/api/projects/${id}/presence`,{});
  const part=await act(a.cookie,id,'part.add',{source:'s("bd")',name:'Drums'});
  // b is not a member: the attempt is refused, and the refusal is logged with who tried.
  await act(b.cookie,id,'part.edit',{trackId:part.entityId,source:'s("sd")'},1);
  await post(a.cookie,`/api/projects/${id}/chat`,{clientId:randomUUID(),body:'private words'});
  await new Promise(r=>setTimeout(r,200));
  const log=lines(),short=(v:{id:string})=>v.id.slice(0,8);
  expect(log).toContainEqual(expect.objectContaining({who:a.handle,visitor:short(a),kind:'project.created'}));
  expect(log).toContainEqual(expect.objectContaining({who:a.handle,visitor:short(a),kind:'presence.join'}));
  expect(log).toContainEqual(expect.objectContaining({who:a.handle,kind:'part.add',track:'Drums',owner:a.handle}));
  expect(log).toContainEqual(expect.objectContaining({visitor:short(b),level:'warn',kind:'part.edit.refused',status:404}));
  expect(log).toContainEqual(expect.objectContaining({who:a.handle,kind:'chat'}));
  // The log says who, not what they wrote.
  expect(out).not.toContain('s(\\"bd\\")');expect(out).not.toContain('s(\\"sd\\")');expect(out).not.toContain('private words');
});
