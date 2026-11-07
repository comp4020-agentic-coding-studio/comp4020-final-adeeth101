// Removing things. A track leaves the stage, a removed track can go for good, a
// mix can be deleted, restored or purged, and a member can only leave. Each one
// is enforced on the server and takes with it exactly what depends on it.
import {describe,it,expect,inject} from 'vitest';
import {visitor,get,post,act,mix,room,join,openStream,wait,type V} from './helpers.ts';
import {BLANK_LOOK} from '../shared/look.ts';
const base=inject('baseUrl');
const titleOf=async(v:V,id:string)=>(await room(v,id)).title as string;
const del=async(v:V,id:string)=>act(v,id,'project.delete',{confirmTitle:await titleOf(v,id)});

describe('deleting a mix',()=>{
  it('is the owner’s alone, and needs the exact name',async()=>{
    const a=await visitor(base),b=await visitor(base),id=await mix(a);await join(a,b,id);const title=await titleOf(a,id);
    expect((await act(b,id,'project.delete',{confirmTitle:title})).status).toBe(403);
    expect((await act(a,id,'project.delete',{confirmTitle:'not the name'})).status).toBe(422);
    expect((await act(a,id,'project.delete',{})).status).toBe(422);
    expect((await get(a,`/api/projects/${id}`)).status).toBe(200);
    const outsider=await visitor(base);expect((await act(outsider,id,'project.delete',{confirmTitle:title})).status).toBe(404);
  });
  it('removes it from every list and answers every read like a missing mix',async()=>{
    const a=await visitor(base),b=await visitor(base),id=await mix(a);await join(a,b,id);
    await act(a,id,'project.visibility',{visibility:'public'});await act(a,id,'part.add',{presetId:'warm-pocket'});
    expect((await get(b,'/api/discover')).body.projects.some((p:any)=>p.id===id)).toBe(true);
    expect((await del(a,id)).status).toBe(200);
    for(const v of [a,b]){
      for(const path of [`/api/projects/${id}`,`/api/projects/${id}/export`,`/api/projects/${id}/chat`,`/api/projects/${id}/invitations`])expect((await get(v,path)).status,path).toBe(404);
      expect((await get(v,'/api/projects')).body.projects.some((p:any)=>p.id===id)).toBe(false);
      expect((await get(v,'/api/discover')).body.projects.some((p:any)=>p.id===id)).toBe(false);
      expect((await fetch(`${base}/p/${id}`,{headers:{cookie:v.cookie}})).status).toBe(404);
      expect((await act(v,id,'part.add',{presetId:'warm-anchor'})).status).toBe(404);
    }
    expect((await get(a,'/api/projects')).body.deleted.map((p:any)=>p.id)).toEqual([id]);
    expect((await get(b,'/api/projects')).body.deleted).toEqual([]);
  });
  it('closes open streams, ends its live performance, revokes invitations and shared links',async()=>{
    const a=await visitor(base),b=await visitor(base),c=await visitor(base),d=await visitor(base),id=await mix(a);await join(a,b,id);
    await act(a,id,'part.add',{presetId:'warm-pocket',play:true});
    const perf=(await post(a,`/api/projects/${id}/go-live`,{commandId:crypto.randomUUID(),title:'Doomed show',visibility:'public'})).body.id;
    const invitation=await post(a,'/api/invitations',{kind:'project',resourceId:id});const [iid,token]=invitation.body.path.replace('/invite/','').split('#');
    const member=openStream(b,`/api/projects/${id}/events`),audience=openStream(c,`/api/performances/${perf}/events`);await member.ready;await audience.ready;await wait(80);
    expect((await del(a,id)).status).toBe(200);await wait(150);
    expect(member.text()).toContain('project.delete');expect(member.text()).toContain('revoked');expect(member.closed()).toBe(true);
    expect(audience.text()).toContain('performance.ended');expect(audience.closed()).toBe(true);member.close();audience.close();
    expect((await get(c,`/api/performances/${perf}`)).status).toBe(404);expect((await get(a,`/api/performances/${perf}`)).status).toBe(404);
    expect((await get(c,'/api/live')).body.performances.some((p:any)=>p.id===perf)).toBe(false);
    expect((await post(d,`/api/invitations/${iid}/preview`,{token})).body.state).toBe('revoked');
    expect((await post(d,`/api/invitations/${iid}/accept`,{token})).status).toBe(410);
  });
  it('leaves other mixes and everyone’s saved characters alone',async()=>{
    const a=await visitor(base),id=await mix(a),other=await mix(a);await act(a,other,'part.add',{presetId:'warm-anchor'});
    const c=await post(a,'/api/characters',{name:'Keeper',role:'bass',look:BLANK_LOOK,source:'s("bd")'});
    await act(a,id,'part.add',{characterId:c.body.id});await del(a,id);
    expect((await room(a,other)).parts).toHaveLength(1);expect((await get(a,`/api/characters/${c.body.id}`)).status).toBe(200);
  });
  it('can be restored by the owner, private and with its music, and old links stay dead',async()=>{
    const a=await visitor(base),b=await visitor(base),c=await visitor(base),id=await mix(a);await join(a,b,id);
    await act(a,id,'project.visibility',{visibility:'public'});const trackId=(await act(a,id,'part.add',{presetId:'warm-pocket'})).body.entityId;
    const invitation=await post(a,'/api/invitations',{kind:'project',resourceId:id});const [iid,token]=invitation.body.path.replace('/invite/','').split('#');
    await del(a,id);
    expect((await post(b,`/api/projects/${id}/restore`,{})).status).toBe(404);expect((await post(c,`/api/projects/${id}/restore`,{})).status).toBe(404);
    expect((await post(a,`/api/projects/${id}/restore`,{})).status).toBe(200);
    const s=await room(a,id);expect(s.visibility).toBe('private');expect(s.parts.map((p:any)=>p.id)).toEqual([trackId]);
    expect((await get(a,'/api/projects')).body.deleted).toEqual([]);
    expect((await room(b,id)).you.role).toBe('member');expect((await get(c,`/api/projects/${id}`)).status).toBe(404);
    expect((await post(c,`/api/invitations/${iid}/accept`,{token})).status).toBe(410);
  });
  it('can be deleted for good only after deleting, by the owner, with its name, and leaves nothing behind',async()=>{
    const a=await visitor(base),b=await visitor(base),id=await mix(a);await join(a,b,id);const title=await titleOf(a,id);
    await act(a,id,'part.add',{presetId:'warm-pocket',play:true});
    await post(a,`/api/projects/${id}/chat`,{clientId:crypto.randomUUID(),body:'gone soon'});
    const perf=(await post(a,`/api/projects/${id}/go-live`,{commandId:crypto.randomUUID(),title:'Gone show',visibility:'public'})).body.id;
    await post(a,`/api/performances/${perf}/end`,{});
    expect((await post(a,`/api/projects/${id}/purge`,{confirmTitle:title})).status).toBe(404);
    await del(a,id);
    expect((await post(b,`/api/projects/${id}/purge`,{confirmTitle:title})).status).toBe(404);
    expect((await post(a,`/api/projects/${id}/purge`,{confirmTitle:'wrong'})).status).toBe(422);
    expect((await post(a,`/api/projects/${id}/purge`,{confirmTitle:title})).status).toBe(200);
    expect((await get(a,'/api/projects')).body.deleted).toEqual([]);
    expect((await post(a,`/api/projects/${id}/restore`,{})).status).toBe(404);
  });
});

describe('a member',()=>{
  it('leaves rather than deletes: it goes from their list and stays for everyone else',async()=>{
    const a=await visitor(base),b=await visitor(base),id=await mix(a);await join(a,b,id);
    const trackId=(await act(b,id,'part.add',{presetId:'warm-anchor'})).body.entityId;
    expect((await act(b,id,'member.leave')).status).toBe(200);
    expect((await get(b,'/api/projects')).body.projects.some((p:any)=>p.id===id)).toBe(false);
    expect((await get(b,`/api/projects/${id}`)).status).toBe(404);
    expect((await room(a,id)).parts.map((p:any)=>p.id)).toEqual([trackId]);
  });
  it('and an owner cannot leave their own mix',async()=>{
    const a=await visitor(base),id=await mix(a);expect((await act(a,id,'member.leave')).status).toBe(409);
  });
});

describe('a public listing',()=>{
  it('is removed by making the mix private, keeping the mix',async()=>{
    const a=await visitor(base),b=await visitor(base),id=await mix(a);await act(a,id,'project.visibility',{visibility:'public'});await act(a,id,'part.add',{presetId:'warm-pocket'});
    await act(a,id,'project.visibility',{visibility:'private'});
    expect((await get(b,'/api/discover')).body.projects.some((p:any)=>p.id===id)).toBe(false);expect((await get(b,`/api/projects/${id}`)).status).toBe(404);
    expect((await room(a,id)).parts).toHaveLength(1);
  });
});

describe('a track',()=>{
  it('can be brought back after removal, or deleted for good from the list of removed tracks',async()=>{
    const a=await visitor(base),id=await mix(a),trackId=(await act(a,id,'part.add',{presetId:'warm-pocket'})).body.entityId;
    expect((await act(a,id,'part.purge',{trackId})).status).toBe(409);
    await act(a,id,'part.remove',{trackId});expect((await room(a,id)).parts[0].archivedAt).toBeTruthy();
    await act(a,id,'part.return',{trackId});await act(a,id,'part.remove',{trackId});
    expect((await act(a,id,'part.purge',{trackId})).status).toBe(200);
    expect((await room(a,id)).parts).toEqual([]);
    expect((await act(a,id,'part.return',{trackId})).status).toBe(404);
  });
  it('goes for good only for the owner or the person who added it',async()=>{
    const a=await visitor(base),b=await visitor(base),c=await visitor(base),id=await mix(a);await join(a,b,id);await join(a,c,id);
    const trackId=(await act(b,id,'part.add',{presetId:'warm-anchor'})).body.entityId;await act(b,id,'part.remove',{trackId});
    expect((await act(c,id,'part.purge',{trackId})).status).toBe(403);
    expect((await act(b,id,'part.purge',{trackId})).status).toBe(200);
  });
  it('deleted for good leaves the rest of the plan playing',async()=>{
    const a=await visitor(base),id=await mix(a);
    const keep=(await act(a,id,'part.add',{presetId:'warm-pocket',play:true})).body.entityId,gone=(await act(a,id,'part.add',{presetId:'warm-anchor'})).body.entityId;
    await act(a,id,'part.remove',{trackId:gone});await act(a,id,'part.purge',{trackId:gone});
    const s=await room(a,id);expect(s.transport.status).toBe('playing');expect(Object.keys(s.plans.at(-1).catalog)).toEqual([keep]);
  });
});
