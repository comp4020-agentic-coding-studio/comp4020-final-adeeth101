// Reactions reach the people on stage. They are totals, not one event each; they
// write nothing; and they respect who may see the performance.
import {it,expect,inject} from 'vitest';
import {DatabaseSync} from 'node:sqlite';
import {join as joinPath} from 'node:path';
import {visitor,post,act,mix,join,openStream,wait,ownServer,type V} from './helpers.ts';
const base=inject('baseUrl');
const live=async(a:V,visibility='public')=>{
  const id=await mix(a);await act(a,id,'part.add',{presetId:'warm-pocket',play:true});
  const perf=(await post(a,`/api/projects/${id}/go-live`,{commandId:crypto.randomUUID(),title:'Show',visibility})).body.id as string;
  return {id,perf};
};
const reactions=(text:string)=>[...text.matchAll(/data: (\{"kind":"reaction".*?\})\n/g)].map(m=>JSON.parse(m[1]));
const total=(list:any[],k:string)=>list.reduce((n,x)=>n+(x.counts[k]??0),0);

it('the host and a collaborating member see reactions in the project stream; others do not',async()=>{
  const a=await visitor(base),b=await visitor(base),listener=await visitor(base),stranger=await visitor(base);
  const {id,perf}=await live(a);await join(a,b,id);
  const host=openStream(a,`/api/projects/${id}/events`),member=openStream(b,`/api/projects/${id}/events`),other=openStream(stranger,`/api/projects/${id}/events`);
  await host.ready;await member.ready;await other.ready;await wait(50);
  expect((await post(listener,`/api/performances/${perf}/react`,{reaction:'clap'})).status).toBe(200);await wait(400);
  expect(total(reactions(host.text()),'clap')).toBe(1);expect(total(reactions(member.text()),'clap')).toBe(1);expect(other.text()).toBe('');
  host.close();member.close();other.close();
});
it('a burst arrives as totals: far fewer events than reactions, and none lost below the rate limit',async()=>{
  const a=await visitor(base),{id,perf}=await live(a),people=await Promise.all(Array.from({length:12},()=>visitor(base)));
  const stage=openStream(a,`/api/projects/${id}/events`);await stage.ready;await wait(50);
  await Promise.all(people.flatMap(p=>[post(p,`/api/performances/${perf}/react`,{reaction:'clap'}),post(p,`/api/performances/${perf}/react`,{reaction:'fire'})]));
  await wait(450);const seen=reactions(stage.text());stage.close();
  expect(total(seen,'clap')).toBe(12);expect(total(seen,'fire')).toBe(12);expect(seen.length).toBeLessThan(5);
});
it('one person cannot flood it: reactions are rate limited per visitor',async()=>{
  const a=await visitor(base),{perf}=await live(a),b=await visitor(base);
  const results=[];for(let i=0;i<12;i++)results.push((await post(b,`/api/performances/${perf}/react`,{reaction:'heart'})).status);
  expect(results.filter(s=>s===200).length).toBeLessThanOrEqual(5);expect(results).toContain(429);
});
it('an unlisted performance takes reactions only from people admitted to it',async()=>{
  const a=await visitor(base),{perf}=await live(a,'unlisted'),b=await visitor(base);
  expect((await post(b,`/api/performances/${perf}/react`,{reaction:'clap'})).status).toBe(404);
});
it('an ended performance takes no more reactions, and a total still in flight is dropped',async()=>{
  const a=await visitor(base),{id,perf}=await live(a),b=await visitor(base);
  const stage=openStream(a,`/api/projects/${id}/events`);await stage.ready;await wait(50);
  await post(b,`/api/performances/${perf}/react`,{reaction:'wave'});await post(a,`/api/performances/${perf}/end`,{});await wait(400);
  expect(reactions(stage.text())).toEqual([]);stage.close();
  expect((await post(b,`/api/performances/${perf}/react`,{reaction:'wave'})).status).toBeGreaterThanOrEqual(400);
});
it('writes nothing: reacting leaves the event log exactly as it was',async()=>{
  const server=ownServer('ensemble-react-');
  try{
    await server.boot();const a=await visitor(server.base),{perf}=await live(a),b=await visitor(server.base);
    const count=()=>{const db=new DatabaseSync(joinPath(server.dir,'app.db'),{readOnly:true});try{return Number((db.prepare('select count(*) as n from event').get() as {n:number}).n);}finally{db.close();}};
    const before=count();for(let i=0;i<3;i++)await post(b,`/api/performances/${perf}/react`,{reaction:'clap'});await wait(350);
    expect(count()).toBe(before);
  }finally{await server.cleanup();}
});
it('an ephemeral broadcast does not move a reconnecting client’s cursor',async()=>{
  const a=await visitor(base),{id,perf}=await live(a),b=await visitor(base);
  const stage=openStream(a,`/api/projects/${id}/events`);await stage.ready;await wait(50);
  await post(b,`/api/performances/${perf}/react`,{reaction:'clap'});await wait(350);
  const text=stage.text();stage.close();expect(text).toContain('"kind":"reaction"');expect(text).not.toContain('id: 0');
});
