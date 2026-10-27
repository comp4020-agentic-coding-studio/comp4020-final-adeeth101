// Live updates, split by who may hear them. Every event is written with a
// scope (account:<visitor>, member:<project>, view:<project> or
// audience:<performance>) and a stream only ever reads its own scope, so the
// filter applies to replay and to fan-out alike. Events are small
// invalidations; pages fetch a permission-checked snapshot to see content.
import type {ServerResponse} from 'node:http';
import {db} from './db.ts';
import {need,one,rows,run} from './errors.ts';

export type Scope=`account:${string}`|`member:${string}`|`view:${string}`|`audience:${string}`;
type Listener={visitorId:string;scope:Scope;res:ServerResponse;check:()=>boolean};
const listeners=new Set<Listener>();
export const STREAM_LIMITS={total:96,perVisitorScope:3,perScope:48,bufferBytes:128*1024,replay:500};

// Written inside the caller's transaction, so the event commits with the change.
export function addEvent(scope:Scope,visitorId:string|null,kind:string,payload:Record<string,unknown>={},projectId:string|null=null,commandId:string|null=null){
  return Number(run('insert into event(visitor_id,kind,payload,created_at,project_id,command_id,scope) values(?,?,?,?,?,?,?)',visitorId,kind,JSON.stringify(payload),Date.now(),projectId,commandId,scope).lastInsertRowid);
}
// A stream is forgotten the moment it is ended, not when its socket finally
// closes: a broadcast in between would otherwise write after end.
function drop(l:Listener,last?:string){listeners.delete(l);if(l.res.writableEnded)return;if(last)l.res.write(last);l.res.end();}
const send=(l:Listener,chunk:string)=>{if(l.res.writableEnded||l.res.destroyed){listeners.delete(l);return;}l.res.write(chunk);};
// Called only after commit.
export function broadcast(scope:Scope,eventId:number,kind:string,payload:Record<string,unknown>={}){
  const data=JSON.stringify({kind,...payload});
  for(const l of [...listeners]){
    if(l.scope!==scope)continue;
    if(l.res.writableLength>STREAM_LIMITS.bufferBytes){drop(l);continue;}
    send(l,`id: ${eventId}\nevent: change\ndata: ${data}\n\n`);
  }
}
// Personal view changes invalidate only this visitor's open pages. No resource
// payload or cursor is sent; reconnects read the durable preference afresh.
export function invalidateVisitor(visitorId:string,kind:string){
  for(const l of [...listeners])if(l.visitorId===visitorId){
    if(l.res.writableLength>STREAM_LIMITS.bufferBytes){drop(l);continue;}
    send(l,`event: change\ndata: ${JSON.stringify({kind})}\n\n`);
  }
}
// After membership, visibility or a kick changes, every open stream is asked
// again whether it may still listen; those that may not are closed.
export function revalidate(){for(const l of [...listeners]){let ok=false;try{ok=l.check();}catch{ok=false;}if(!ok)drop(l,'event: revoked\ndata: {}\n\n');}}

export function openStream(res:ServerResponse,visitorId:string,scope:Scope,cursor:number,check:()=>boolean){
  const mine=[...listeners].filter(l=>l.scope===scope);
  need(listeners.size<STREAM_LIMITS.total&&mine.length<STREAM_LIMITS.perScope&&mine.filter(l=>l.visitorId===visitorId).length<STREAM_LIMITS.perVisitorScope,'Live connection capacity reached. Retry shortly.',429);
  const newest=Number(one('select coalesce(max(id),0) as id from event where scope=?',scope)!.id);
  const missed=cursor>0?rows('select id,kind,payload from event where scope=? and id>? order by id limit ?',scope,cursor,STREAM_LIMITS.replay+1):[];
  res.writeHead(200,{'content-type':'text/event-stream','cache-control':'private, no-store, no-transform','x-accel-buffering':'no'});res.write(': open\n\n');
  if(missed.length>STREAM_LIMITS.replay)res.write(`id: ${newest}\nevent: reset\ndata: {}\n\n`);
  else for(const e of missed)res.write(`id: ${e.id}\nevent: change\ndata: ${JSON.stringify({kind:e.kind,...JSON.parse(e.payload)})}\n\n`);
  const l:Listener={visitorId,scope,res,check};listeners.add(l);
  // A named beat, not a comment: browsers hide comments, and the page needs a
  // pulse to notice a connection that died without closing.
  const timer=setInterval(()=>send(l,'event: beat\ndata: {}\n\n'),5000);
  res.on('close',()=>{clearInterval(timer);listeners.delete(l);});
  res.on('error',()=>{clearInterval(timer);listeners.delete(l);});
}
export const streamCount=()=>listeners.size;
export const scopeListeners=(scope:Scope)=>[...listeners].filter(l=>l.scope===scope);
export function closeAll(){for(const l of [...listeners])drop(l);}
// Event rows for the database's own housekeeping: account notifications and
// reactions are not history, so old ones are pruned.
export function pruneEvents(){run("delete from event where scope like 'account:%' and created_at<?",Date.now()-7*86400000);void db;}
