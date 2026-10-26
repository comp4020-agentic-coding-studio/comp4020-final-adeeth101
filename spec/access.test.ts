// Who may read and change a project, checked over every path a browser or a
// curious visitor could use: HTML, snapshot, SSE, export, chat, invitation
// lists, discovery and the legacy sketchpad routes.
import {expect,it,inject,describe} from 'vitest';
import {randomUUID} from 'node:crypto';
import {visitor,get,post,act,mix,room,join,listen,openStream,wait} from './helpers.ts';
const base=inject('baseUrl');

describe('a private mix',()=>{
  it('is invisible to a non-member on every read path, with the same answer as a missing one',async()=>{
    const a=await visitor(base),c=await visitor(base),id=await mix(a);
    await act(a,id,'part.add',{presetId:'warm-pocket'});await post(a,`/api/projects/${id}/chat`,{clientId:randomUUID(),body:'secret plan'});
    const missing=randomUUID();
    for(const path of [`/api/projects/${id}`,`/api/projects/${id}/export`,`/api/projects/${id}/chat`,`/api/projects/${id}/invitations`]){
      const r=await get(c,path),m=await get(c,path.replace(id,missing));
      expect(r.status,path).toBe(404);expect(r.body,path).toEqual(m.body);
    }
    const page=await fetch(`${base}/p/${id}`,{headers:{cookie:c.cookie}}),text=await page.text();
    expect(page.status).toBe(404);expect(text).not.toContain((await room(a,id)).title);
    expect((await listen(c,`/api/projects/${id}/events?since=0`,200)).status).toBe(404);
    expect((await get(c,'/api/discover')).body.projects.some((p:any)=>p.id===id)).toBe(false);
    expect((await get(c,'/api/projects')).body.projects).toEqual([]);
    // The legacy sketchpad's state, stream, archive and home show none of it.
    const legacy=[await get(c,'/api/state'),await get(c,'/legacy'),await get(c,'/archive')].map(r=>JSON.stringify(r.body)).join('');
    expect(legacy).not.toContain(id);expect(legacy).not.toContain('secret plan');
    const stream=await listen(c,'/api/events?since=0',300);expect(stream.text).not.toContain(id);expect(stream.text).not.toMatch(/part\.add|project\.created|chat/);
  });
  it('refuses every command from a non-member without revealing the mix',async()=>{
    const a=await visitor(base),c=await visitor(base),id=await mix(a);const pid=(await act(a,id,'part.add',{presetId:'warm-glow'})).body.entityId;
    for(const [type,payload] of [['part.add',{presetId:'warm-glow'}],['part.edit',{trackId:pid,source:'s("bd")'}],['part.mix',{trackId:pid,mute:true}],['part.remove',{trackId:pid}],['transport.start',{}],['project.visibility',{visibility:'public'}],['host.claim',{}]] as const)
      expect((await act(c,id,type,payload)).status,type).toBe(404);
    expect((await post(c,`/api/projects/${id}/go-live`,{commandId:randomUUID(),title:'x'})).status).toBe(404);
    expect((await post(c,'/api/invitations',{kind:'project',resourceId:id})).status).toBe(404);
    expect((await room(a,id)).parts[0].clips.A.revision).toBe(1);
  });
  it('is never stored in a shared cache',async()=>{
    const a=await visitor(base),id=await mix(a);
    for(const path of [`/api/projects/${id}`,`/p/${id}`,`/api/projects/${id}/export`,'/api/friends','/api/me'])expect((await get(a,path)).headers.get('cache-control'),path).toMatch(/private, no-store/);
  });
});

describe('a public mix',()=>{
  it('shows visitors the saved mix and credits only, and refuses their edits',async()=>{
    const a=await visitor(base),b=await visitor(base),c=await visitor(base),id=await mix(a);
    await act(a,id,'part.add',{presetId:'warm-pocket'});await join(a,b,id);await post(a,`/api/projects/${id}/chat`,{clientId:randomUUID(),body:'members only'});
    expect((await act(b,id,'project.visibility',{visibility:'public'})).status).toBe(403);
    expect((await act(a,id,'project.visibility',{visibility:'public'})).status).toBe(200);
    const v=await get(c,`/api/projects/${id}`);expect(v.status).toBe(200);expect(v.body.access).toBe('view');
    expect(Object.keys(v.body).sort()).toEqual(['access','bpm','id','parts','performance','title','visibility']);
    expect(JSON.stringify(v.body)).not.toMatch(/members only|history|lease|members|invit|viewToken/);
    expect(v.body.parts[0]).toMatchObject({name:'Pocket',addedBy:a.handle});
    expect((await act(c,id,'part.add',{presetId:'warm-glow'})).status).toBe(403);
    expect((await get(c,`/api/projects/${id}/chat`)).status).toBe(404);expect((await get(c,`/api/projects/${id}/export`)).status).toBe(404);
    expect((await get(c,'/api/discover')).body.projects.some((p:any)=>p.id===id)).toBe(true);
    // A view stream exists, and carries no member events such as chat.
    const view=listen(c,`/api/projects/${id}/events?since=0`,700);await wait(150);
    await post(a,`/api/projects/${id}/chat`,{clientId:randomUUID(),body:'still members only'});await act(a,id,'part.add',{presetId:'warm-glow'});
    const got=await view;expect(got.status).toBe(200);expect(got.text).toContain('part.add');expect(got.text).not.toContain('chat');
  });
});

describe('an unlisted mix',()=>{
  it('opens only through its view link, stays out of discovery, and a new link revokes the old',async()=>{
    const a=await visitor(base),c=await visitor(base),d=await visitor(base),id=await mix(a);
    await act(a,id,'project.visibility',{visibility:'unlisted'});
    expect((await get(c,'/api/discover')).body.projects.some((p:any)=>p.id===id)).toBe(false);
    expect((await get(c,`/api/projects/${id}`)).status).toBe(404);
    const token=(await room(a,id)).viewToken;expect(token).toBeTruthy();
    expect((await post(c,`/api/projects/${id}/view-link`,{token:'x'.repeat(token.length)})).status).toBe(404);
    expect((await post(c,`/api/projects/${id}/view-link`,{token})).status).toBe(200);
    expect((await get(c,`/api/projects/${id}`)).body.access).toBe('view');
    await act(a,id,'project.rotateLink');
    expect((await get(c,`/api/projects/${id}`)).status).toBe(404);
    expect((await post(d,`/api/projects/${id}/view-link`,{token})).status).toBe(404);
  });
});

describe('membership changes take effect at once',()=>{
  it('a removed member stops receiving events and can no longer read or write',async()=>{
    const a=await visitor(base),b=await visitor(base),id=await mix(a);await join(a,b,id);
    const s=await room(b,id),stream=openStream(b,`/api/projects/${id}/events?since=${s.eventId}`);expect(await stream.ready).toBe(200);
    await wait(100);await act(a,id,'member.remove',{visitorId:b.id});await wait(200);
    expect(stream.text()).toContain('event: revoked');
    await act(a,id,'part.add',{presetId:'warm-glow'});await wait(150);
    expect(stream.text()).not.toContain('"kind":"part.add"');stream.close();
    expect((await get(b,`/api/projects/${id}`)).status).toBe(404);expect((await act(b,id,'part.add',{presetId:'warm-glow'})).status).toBe(404);
  });
  it('going private closes a visitor’s view stream',async()=>{
    const a=await visitor(base),c=await visitor(base),id=await mix(a);await act(a,id,'project.visibility',{visibility:'public'});
    const stream=openStream(c,`/api/projects/${id}/events`);expect(await stream.ready).toBe(200);await wait(100);
    await act(a,id,'project.visibility',{visibility:'private'});await wait(200);
    expect(stream.text()).toContain('event: revoked');stream.close();
  });
});

describe('roles',()=>{
  it('members edit music and chat; only the owner administers visibility, membership and invitations',async()=>{
    const a=await visitor(base),b=await visitor(base),c=await visitor(base),id=await mix(a);await join(a,b,id);
    expect((await act(b,id,'part.add',{presetId:'warm-anchor'})).status).toBe(200);
    expect((await act(b,id,'project.rename',{title:'Ours'})).status).toBe(200);
    expect((await act(b,id,'member.remove',{visitorId:a.id})).status).toBe(403);
    expect((await post(b,'/api/invitations',{kind:'project',resourceId:id})).status).toBe(403);
    await join(a,c,id);expect((await act(b,id,'member.remove',{visitorId:c.id})).status).toBe(403);
    expect((await act(c,id,'member.leave')).status).toBe(200);
    expect((await act(a,id,'member.leave')).status).toBe(409);
  });
  it('at most eight people edit at once; a ninth may listen and chat with a reason',async()=>{
    const owner=await visitor(base),id=await mix(owner);const others=[];
    for(let i=0;i<8;i++){const v=await visitor(base);await join(owner,v,id);others.push(v);}
    await act(owner,id,'part.add',{presetId:'warm-glow'});
    for(const v of others.slice(0,7))expect((await act(v,id,'part.add',{presetId:'warm-spark'})).status).toBe(200);
    const ninth=others[7],refused=await act(ninth,id,'part.add',{presetId:'warm-spark'});
    expect(refused.status).toBe(409);expect(refused.body.error).toMatch(/8 people are editing/);
    const s=await room(ninth,id);expect(s.editors).toMatchObject({youCanEdit:false,count:8,limit:8});
    expect((await post(ninth,`/api/projects/${id}/chat`,{clientId:randomUUID(),body:'waiting my turn'})).status).toBe(200);
    expect(s.members).toHaveLength(9);
  });
});

describe('the origin check',()=>{
  it('refuses an opaque or foreign origin without failing, and lets an ordinary form post through',async()=>{
    const v=await visitor(base);
    const send=(origin?:string)=>fetch(`${base}/api/projects`,{method:'POST',redirect:'manual',
      headers:{cookie:v.cookie,'content-type':'application/x-www-form-urlencoded',accept:'text/html',...(origin===undefined?{}:{origin})},body:''});
    // "Origin: null" comes from sandboxed and file:// pages; it is not a URL.
    for(const origin of ['null','https://foreign.example','not a url'])
      expect((await send(origin)).status,origin).toBe(403);
    // A no-script browser posting the home page form: same site, so it works.
    const host=new URL(base).origin;
    const ok=await send(host);
    expect(ok.status).toBe(303);expect(ok.headers.get('location')).toMatch(/^\/p\/[0-9a-f-]+/);
    // And with no Origin header at all, as some browsers send for a top-level form post.
    const bare=await send();
    expect(bare.status).toBe(303);
  });
});

describe('without JavaScript',()=>{
  it('a plain form post still starts a mix and lands in its room',async()=>{
    const v=await visitor(base);
    const res=await fetch(`${base}/api/projects`,{method:'POST',redirect:'manual',headers:{
      cookie:v.cookie,'content-type':'application/x-www-form-urlencoded',
      accept:'text/html,application/xhtml+xml',origin:new URL(base).origin,'sec-fetch-site':'same-origin'},body:''});
    expect(res.status).toBe(303);
    const room=res.headers.get('location')!;
    expect(room).toMatch(/^\/p\/[0-9a-f-]+/);
    // The room's own HTML names the mix, so a no-script browser sees something.
    const page=await fetch(`${base}${room}`,{headers:{cookie:v.cookie}});
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('<noscript>');
  });
});
