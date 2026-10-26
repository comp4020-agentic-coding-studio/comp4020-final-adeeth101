import {createHash} from 'node:crypto';
import {db} from './db.ts';
import type {Visitor} from './identity.ts';

export class CommandError extends Error {
  status:number;current?:unknown;
  constructor(message:string,status=422,current?:unknown){super(message);this.status=status;this.current=current;}
}
export function need(test:unknown,message:string,status=422):asserts test {if(!test)throw new CommandError(message,status);}
// Private resources answer the same way whether they exist or not.
export const NOT_FOUND='Not found.';
export const hidden=()=>new CommandError(NOT_FOUND,404);
export const text=(x:unknown,max:number,what='this')=>{need(typeof x==='string'&&x.trim().length>0&&x.trim().length<=max,`Give ${what} 1–${max} characters.`);return (x as string).trim().replace(/\s+/g,' ');};
// Code is kept byte for byte: no trimming or whitespace folding.
export const code=(x:unknown)=>{need(typeof x==='string'&&x.trim().length>0,'Write some code.');need(Buffer.byteLength(x as string)<=8192,'Keep code under 8 KB.');return x as string;};
export const uuid=(x:unknown,what='Command')=>{need(typeof x==='string'&&/^[0-9a-f-]{36}$/i.test(x),`${what} needs a UUID.`);return x as string;};

type Row=Record<string,any>;
export const one=(sql:string,...args:any[]):Row|undefined=>db.prepare(sql).get(...args) as Row|undefined;
export const rows=(sql:string,...args:any[]):Row[]=>db.prepare(sql).all(...args) as Row[];
export const run=(sql:string,...args:any[])=>db.prepare(sql).run(...args);

// One transaction, with work that must only happen once it has committed
// (broadcasts, logs) queued on `after`.
export function tx<T>(fn:(after:(f:()=>void)=>void)=>T):T{
  const queued:(()=>void)[]=[];
  db.exec('begin immediate');
  let result:T;
  try{result=fn(f=>queued.push(f));db.exec('commit');}
  catch(e){db.exec('rollback');throw e;}
  for(const f of queued)f();
  return result;
}

// Idempotency. The target is part of the hash, so a command ID reused on a
// different resource is refused rather than answered with another response.
export function receiptFor(v:Visitor,commandId:unknown,target:string,body:unknown){
  const cid=uuid(commandId);
  const hash=createHash('sha256').update(JSON.stringify({target,body})).digest('hex');
  const existing=one('select * from command_receipt where visitor_id=? and command_id=?',v.id,cid);
  if(existing){need(existing.request_hash===hash,'Command ID was reused with different content.',409);return {cid,hash,replay:JSON.parse(existing.response_json)};}
  return {cid,hash,replay:null};
}
export function saveReceipt(v:Visitor,cid:string,hash:string,result:unknown){
  const now=Date.now();
  run('insert into command_receipt values(?,?,?,?,?)',v.id,cid,hash,JSON.stringify(result),now);
  run('delete from command_receipt where created_at<?',now-7*86400000);
}

// Token buckets: a burst, then a steady rate. Keyed by purpose and actor.
const buckets=new Map<string,{tokens:number;at:number}>();
export function limit(key:string,burst:number,perSecond:number,message='Too many changes. Try again shortly.'){
  const now=Date.now(),b=buckets.get(key)??{tokens:burst,at:now};
  b.tokens=Math.min(burst,b.tokens+(now-b.at)/1000*perSecond);b.at=now;
  need(b.tokens>=1,message,429);b.tokens--;buckets.set(key,b);
  if(buckets.size>5000)for(const [k,x] of buckets)if(now-x.at>600000)buckets.delete(k);
}
