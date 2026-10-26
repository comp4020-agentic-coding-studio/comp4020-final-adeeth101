// HTTP helpers for the Ensemble specs: each visitor is a separate cookie jar,
// as two browsers are two people.
import {randomUUID} from 'node:crypto';
import {spawn,type ChildProcess} from 'node:child_process';
import {mkdtempSync,rmSync,copyFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join as joinPath} from 'node:path';

export type V={cookie:string;id:string;handle:string;base:string};
export async function visitor(base:string):Promise<V>{
  const r=await fetch(`${base}/api/me`);const cookie=r.headers.getSetCookie()[0].split(';')[0];const me=await r.json() as {id:string;handle:string};
  return {cookie,id:me.id,handle:me.handle,base};
}
export async function get(v:V,path:string){const r=await fetch(`${v.base}${path}`,{headers:{cookie:v.cookie,accept:'application/json'}});const text=await r.text();let body:any;try{body=JSON.parse(text);}catch{body=text;}return {status:r.status,body,headers:r.headers};}
export async function post(v:V,path:string,body:unknown={}){const r=await fetch(`${v.base}${path}`,{method:'POST',headers:{cookie:v.cookie,'content-type':'application/json'},body:JSON.stringify(body)});const text=await r.text();let json:any;try{json=JSON.parse(text);}catch{json=text;}return {status:r.status,body:json,headers:r.headers};}
export const act=(v:V,id:string,type:string,payload:unknown={},expectedRevision?:number,commandId=randomUUID())=>post(v,`/api/projects/${id}/commands`,{commandId,type,payload,expectedRevision});
export async function mix(v:V){const r=await post(v,'/api/projects',{});if(r.status!==201)throw new Error(`create failed ${r.status} ${JSON.stringify(r.body)}`);return r.body.id as string;}
export async function room(v:V,id:string){const r=await get(v,`/api/projects/${id}`);if(r.status!==200)throw new Error(`snapshot ${r.status}`);return r.body;}
// Makes `who` a member of `id` through a link invitation from its owner.
export async function join(owner:V,who:V,id:string){
  const inv=await post(owner,'/api/invitations',{kind:'project',resourceId:id});
  const [iid,token]=inv.body.path.replace('/invite/','').split('#');
  const r=await post(who,`/api/invitations/${iid}/accept`,{token});if(r.status!==200)throw new Error(`join ${r.status} ${JSON.stringify(r.body)}`);
}
// Reads an SSE stream for a while and returns what arrived.
export async function listen(v:V,path:string,ms=600,headers:Record<string,string>={}){
  const ctl=new AbortController();
  const r=await fetch(`${v.base}${path}`,{headers:{cookie:v.cookie,...headers},signal:ctl.signal});
  if(r.status!==200){await r.text();return {status:r.status,text:''};}
  const reader=r.body!.getReader();let text='';const end=Date.now()+ms;
  try{while(Date.now()<end){const chunk=await Promise.race([reader.read(),new Promise<{value?:Uint8Array;done?:boolean}>(res=>setTimeout(()=>res({}),Math.max(10,end-Date.now())))]);if(chunk.value)text+=new TextDecoder().decode(chunk.value);if(chunk.done)break;}}
  finally{ctl.abort();}
  return {status:r.status,text};
}
export function openStream(v:V,path:string){
  const ctl=new AbortController();let text='';let closed=false;
  const ready=fetch(`${v.base}${path}`,{headers:{cookie:v.cookie},signal:ctl.signal}).then(async r=>{if(r.status!==200){closed=true;return r.status;}const reader=r.body!.getReader();(async()=>{try{for(;;){const {value,done}=await reader.read();if(done){closed=true;break;}text+=new TextDecoder().decode(value);}}catch{closed=true;}})();return 200;});
  return {ready,text:()=>text,closed:()=>closed,close:()=>ctl.abort()};
}
// A server of the spec's own on a throwaway database, for restarts, logs and
// migrations. An optional seed database is copied in first.
export function ownServer(prefix:string,seed?:string){
  const port=9500+Math.floor(Math.random()*400),base=`http://127.0.0.1:${port}`,dir=mkdtempSync(joinPath(tmpdir(),prefix)),DB_PATH=joinPath(dir,'app.db');
  if(seed)copyFileSync(seed,DB_PATH);
  let server:ChildProcess|null=null,out='';
  return {base,dir,DB_PATH,out:()=>out,
    async boot(){server=spawn(process.execPath,['src/server.ts'],{env:{...process.env,PORT:String(port),DB_PATH},stdio:['ignore','pipe','pipe']});server.stdout!.on('data',d=>{out+=d;});server.stderr!.on('data',d=>{out+=d;});
      for(let i=0;i<150;i++){try{await fetch(`${base}/healthz`);return;}catch{await new Promise(r=>setTimeout(r,100));}}throw new Error(`no server on ${port}: ${out}`);},
    kill(){const s=server;server=null;if(!s)return Promise.resolve();return new Promise<void>(r=>{s.on('exit',()=>r());s.kill('SIGKILL');});},
    // Windows keeps the database file locked for a moment after the process exits.
    async cleanup(){await this.kill();for(let i=0;i<20;i++){try{rmSync(dir,{recursive:true,force:true});return;}catch{await new Promise(r=>setTimeout(r,100));}}},
  };
}
export const wait=(ms:number)=>new Promise(r=>setTimeout(r,ms));
