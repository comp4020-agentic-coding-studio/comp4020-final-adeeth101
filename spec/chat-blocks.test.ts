import {describe,it,expect,inject} from 'vitest';
import {randomUUID} from 'node:crypto';
import {visitor,get,post,mix,join,room,openStream,wait} from './helpers.ts';
const base=inject('baseUrl');

describe('personal chat filtering',()=>{
  it('filters before pagination and invalidates only the blocker, without removing membership or history',async()=>{
    const a=await visitor(base),b=await visitor(base),c=await visitor(base),id=await mix(a);
    await join(a,b,id);await join(a,c,id);
    const first=(await post(a,`/api/projects/${id}/chat`,{clientId:randomUUID(),body:'earlier visible'})).body.message;
    await post(b,`/api/projects/${id}/chat`,{clientId:randomUUID(),body:'hidden from A'});
    const last=(await post(c,`/api/projects/${id}/chat`,{clientId:randomUUID(),body:'later visible'})).body.message;
    const own=openStream(a,`/api/projects/${id}/events`),other=openStream(c,`/api/projects/${id}/events`);
    try{
      expect(await own.ready).toBe(200);expect(await other.ready).toBe(200);
      await post(a,'/api/friends',{action:'block',visitorId:b.id});
      const messages=(await get(a,`/api/projects/${id}/chat`)).body.messages;
      expect(messages.map((m:any)=>m.body)).toEqual(['earlier visible','later visible']);
      expect((await get(a,`/api/projects/${id}/chat?before=${last.id}`)).body.messages.map((m:any)=>m.id)).toEqual([first.id]);
      expect((await get(c,`/api/projects/${id}/chat`)).body.messages).toHaveLength(3);
      expect((await room(b,id)).you.role).toBe('member');
      await wait(100);expect(own.text()).toContain('chat.filter');expect(other.text()).not.toContain('chat.filter');
      await post(b,`/api/projects/${id}/chat`,{clientId:randomUUID(),body:'still a member'});
      expect((await get(a,`/api/projects/${id}/chat`)).body.messages).toHaveLength(2);
      await post(a,'/api/friends',{action:'unblock',visitorId:b.id});
      expect((await get(a,`/api/projects/${id}/chat`)).body.messages).toHaveLength(4);
    }finally{own.close();other.close();}
  });
  it('filters audience history for the blocker only, then restores it on unblock',async()=>{
    const a=await visitor(base),b=await visitor(base),c=await visitor(base),id=await mix(a);
    const perf=(await post(a,`/api/projects/${id}/go-live`,{commandId:randomUUID(),title:'Chat filtering',visibility:'public'})).body.id;
    await post(b,`/api/performances/${perf}/chat`,{clientId:randomUUID(),body:'B in the audience'});
    await post(c,`/api/performances/${perf}/chat`,{clientId:randomUUID(),body:'C in the audience'});
    await post(a,'/api/friends',{action:'block',visitorId:b.id});
    expect((await get(a,`/api/performances/${perf}/chat`)).body.messages.map((m:any)=>m.body)).toEqual(['C in the audience']);
    expect((await get(c,`/api/performances/${perf}/chat`)).body.messages).toHaveLength(2);
    await post(a,'/api/friends',{action:'unblock',visitorId:b.id});
    expect((await get(a,`/api/performances/${perf}/chat`)).body.messages).toHaveLength(2);
  });
});
