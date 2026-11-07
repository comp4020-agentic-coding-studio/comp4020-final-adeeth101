// Saved characters: private until listed, a listing is a snapshot, using one
// always copies it, and nothing about a mix ever travels with it.
import {describe,it,expect,inject} from 'vitest';
import {visitor,get,post,act,mix,room,join,type V} from './helpers.ts';
import {BLANK_LOOK,randomLook} from '../shared/look.ts';
const base=inject('baseUrl');
const body=(over:Record<string,unknown>={})=>({name:'Tiny Comet',role:'melody',look:{...BLANK_LOOK,body:'robot',top:'crown'},source:'note("a3 ~ c4 ~").s("triangle").gain(0.3)',level:0.6,...over});
const make=async(v:V,over:Record<string,unknown>={})=>{const r=await post(v,'/api/characters',body(over));expect(r.status).toBe(201);return r.body.id as string;};
const publish=(v:V,id:string,visibility='public')=>post(v,`/api/characters/${id}/publish`,{visibility,confirmSource:true});

describe('a saved character',()=>{
  it('is private by default and answers strangers like a missing one',async()=>{
    const a=await visitor(base),b=await visitor(base),id=await make(a);
    expect((await get(a,`/api/characters/${id}`)).body).toMatchObject({id,name:'Tiny Comet',role:'melody',mine:true,visibility:'private',revision:1,level:0.6});
    const stranger=await get(b,`/api/characters/${id}`),missing=await get(b,'/api/characters/00000000-0000-0000-0000-000000000000');
    expect(stranger.status).toBe(404);expect(stranger.body).toEqual(missing.body);
    expect((await get(b,'/api/library')).body.characters.some((c:any)=>c.id===id)).toBe(false);
    expect((await get(a,'/api/characters')).body.characters.map((c:any)=>c.id)).toContain(id);
  });
  it('carries a versioned document with look, sound and credit',async()=>{
    const a=await visitor(base),id=await make(a);
    expect((await get(a,`/api/characters/${id}`)).body.document).toMatchObject({format:'ensemble-character',version:1,name:'Tiny Comet',role:'melody',source:'note("a3 ~ c4 ~").s("triangle").gain(0.3)',level:0.6,look:{v:1,body:'robot',top:'crown'},credit:{creator:a.handle,remixOf:null}});
  });
  it.each([
    ['markup in a look',{look:{...BLANK_LOOK,body:'<script>alert(1)</script>'}}],
    ['an unknown colour',{look:{...BLANK_LOOK,skin:'#ff0000'}}],
    ['a look with no version',{look:{...BLANK_LOOK,v:2}}],
    ['no look at all',{look:null}],
    ['JavaScript as source',{source:'fetch("/api/me")'}],
    ['an unknown synth',{source:'note("a3").s("kazoo")'}],
    ['a name that is too long',{name:'x'.repeat(41)}],
    ['a level out of range',{level:2}],
  ])('refuses %s and saves nothing',async(_label,over)=>{
    const a=await visitor(base),r=await post(a,'/api/characters',body(over));
    expect(r.status).toBe(422);expect(r.body.error).toBeTruthy();
    expect((await get(a,'/api/characters')).body.characters).toEqual([]);
  });
  it('drops unknown look fields rather than storing them',async()=>{
    const a=await visitor(base),id=await make(a,{look:{...BLANK_LOOK,onload:'alert(1)'}});
    expect(JSON.stringify((await get(a,`/api/characters/${id}`)).body)).not.toContain('alert');
  });
  it('keeps source byte for byte',async()=>{
    const a=await visitor(base),source='// keep me\nstack( s("bd  ~"),   note("a3").s("sine") ) ;',id=await make(a,{source});
    expect((await get(a,`/api/characters/${id}`)).body.source).toBe(source);
  });
  it('saves against a revision: a stale save is refused, returns the current one, and changes nothing',async()=>{
    const a=await visitor(base),id=await make(a);
    expect((await post(a,`/api/characters/${id}`,body({name:'First'}))).status).toBe(422);
    expect((await post(a,`/api/characters/${id}`,body({name:'First',expectedRevision:1}))).body.revision).toBe(2);
    const stale=await post(a,`/api/characters/${id}`,body({name:'Second',expectedRevision:1}));
    expect(stale.status).toBe(409);expect(stale.body.current).toMatchObject({name:'First',revision:2});
    expect((await get(a,`/api/characters/${id}`)).body.name).toBe('First');
  });
  it('can only be changed by its owner',async()=>{
    const a=await visitor(base),b=await visitor(base),id=await make(a);await publish(a,id);
    expect((await post(b,`/api/characters/${id}`,body({expectedRevision:1}))).status).toBe(404);
    for(const action of ['delete','unpublish','rotate-link'])expect((await post(b,`/api/characters/${id}/${action}`,{})).status).toBe(404);
    expect((await publish(b,id)).status).toBe(404);
    expect((await get(a,`/api/characters/${id}`)).body.visibility).toBe('public');
  });
});

describe('sharing',()=>{
  it('needs an explicit choice and an explicit confirmation that the code is shared',async()=>{
    const a=await visitor(base),id=await make(a);
    expect((await post(a,`/api/characters/${id}/publish`,{visibility:'public'})).status).toBe(422);
    expect((await post(a,`/api/characters/${id}/publish`,{visibility:'private',confirmSource:true})).status).toBe(422);
    expect((await get(a,`/api/characters/${id}`)).body.visibility).toBe('private');
  });
  it('lists a snapshot: later edits stay private until the owner updates the listing',async()=>{
    const a=await visitor(base),b=await visitor(base),id=await make(a,{name:`Listed ${a.id.slice(0,8)}`});await publish(a,id);
    expect((await post(a,`/api/characters/${id}`,body({name:'Secret rename',source:'s("cp")',expectedRevision:1}))).status).toBe(200);
    const seen=(await get(b,`/api/characters/${id}`)).body;
    expect(seen).toMatchObject({name:`Listed ${a.id.slice(0,8)}`,mine:false,revision:1});expect(seen.source).toBe(body().source);
    const mine=(await get(a,`/api/characters/${id}`)).body;expect(mine).toMatchObject({changedSinceListing:true,publishedRevision:1});
    await publish(a,id);
    expect((await get(b,`/api/characters/${id}`)).body).toMatchObject({name:'Secret rename',source:'s("cp")',revision:2});
    expect((await get(a,`/api/characters/${id}`)).body.changedSinceListing).toBe(false);
  });
  it('an unlisted character needs its link; rotating retires it and the grants made from it',async()=>{
    const a=await visitor(base),b=await visitor(base),c=await visitor(base),id=await make(a);
    const token=(await publish(a,id,'unlisted')).body.character.shareToken;expect(token).toBeTruthy();
    expect((await get(b,`/api/characters/${id}`)).status).toBe(404);
    expect((await get(b,'/api/library')).body.characters.some((x:any)=>x.id===id)).toBe(false);
    expect((await post(b,`/api/characters/${id}/share-link`,{token:'wrong'})).status).toBe(404);
    expect((await post(b,`/api/characters/${id}/share-link`,{token})).status).toBe(200);
    expect((await get(b,`/api/characters/${id}`)).status).toBe(200);
    await post(a,`/api/characters/${id}/rotate-link`,{});
    expect((await get(b,`/api/characters/${id}`)).status).toBe(404);
    expect((await post(c,`/api/characters/${id}/share-link`,{token})).status).toBe(404);
  });
  it('never carries a project, its chat, its unused clips or its members',async()=>{
    const a=await visitor(base),id=await mix(a);
    await post(a,`/api/projects/${id}/chat`,{clientId:crypto.randomUUID(),body:'private chat marker'});
    const trackId=(await act(a,id,'part.add',{presetId:'warm-anchor'})).body.entityId;
    const cid=await make(a,{name:'Made in a mix',from:{presetId:'warm-anchor'}});await publish(a,cid);
    const b=await visitor(base),text=JSON.stringify((await get(b,`/api/characters/${cid}`)).body);
    for(const secret of [id,trackId,'private chat marker',a.id])expect(text).not.toContain(secret);
  });
  it('filters and searches the library, and hides people a visitor has blocked',async()=>{
    const a=await visitor(base),b=await visitor(base),name=`Findme${a.id.slice(0,8)}`,id=await make(a,{name,role:'bass'});await publish(a,id);
    const q=(extra:string)=>get(b,`/api/library?q=${encodeURIComponent(name)}${extra}`);
    expect((await q('')).body.characters.map((c:any)=>c.id)).toEqual([id]);
    expect((await q('&role=bass')).body.characters).toHaveLength(1);
    expect((await q('&role=beats')).body.characters).toHaveLength(0);
    expect((await get(b,'/api/library?q=%25')).body.characters.every((c:any)=>c.name.includes('%'))).toBe(true);
    await post(b,'/api/friends',{action:'block',visitorId:a.id});
    expect((await q('')).body.characters).toHaveLength(0);
  });
  it('unlisting removes it from view without touching anyone’s copy',async()=>{
    const a=await visitor(base),b=await visitor(base),id=await make(a);await publish(a,id);
    const copy=(await post(b,`/api/characters/${id}/copy`,{})).body.id;
    await post(a,`/api/characters/${id}/unpublish`,{});
    expect((await get(b,`/api/characters/${id}`)).status).toBe(404);
    expect((await get(b,`/api/characters/${copy}`)).body).toMatchObject({source:body().source,credit:{remixOf:{id,name:'Tiny Comet',by:a.handle}}});
  });
});

describe('copies and parts stand alone',()=>{
  it('a copy keeps its credit, and survives the original being edited or deleted',async()=>{
    const a=await visitor(base),b=await visitor(base),id=await make(a);await publish(a,id);
    const copy=(await post(b,`/api/characters/${id}/copy`,{})).body.id;
    expect((await get(b,`/api/characters/${copy}`)).body).toMatchObject({name:'Tiny Comet remix',mine:true,visibility:'private',credit:{creator:b.handle,remixOf:{name:'Tiny Comet',by:a.handle}}});
    await post(a,`/api/characters/${id}`,body({source:'s("cp")',expectedRevision:1}));await post(a,`/api/characters/${id}/delete`,{});
    expect((await get(a,`/api/characters/${id}`)).status).toBe(404);
    const kept=(await get(b,`/api/characters/${copy}`)).body;expect(kept.source).toBe(body().source);expect(kept.credit.remixOf.by).toBe(a.handle);
    expect((await post(b,`/api/characters/${copy}`,{...body({name:'Mine now'}),expectedRevision:1})).status).toBe(200);
  });
  it('credits a factory character when it is the starting point, and refuses to invent one',async()=>{
    const a=await visitor(base);
    expect((await get(a,`/api/characters/${await make(a,{from:{presetId:'warm-anchor'}})}`)).body.credit.remixOf).toEqual({id:null,name:'Anchor',by:'Ensemble'});
    expect((await post(a,'/api/characters',body({from:{characterId:'00000000-0000-0000-0000-000000000000'}}))).status).toBe(404);
  });
  it('adding to a mix makes a stable instance: editing or deleting the library copy changes nothing there',async()=>{
    const a=await visitor(base),id=await mix(a),look=randomLook('stable'),cid=await make(a,{look,level:0.42});
    const trackId=(await act(a,id,'part.add',{characterId:cid})).body.entityId;
    const before=await room(a,id),part=before.parts[0];
    expect(part).toMatchObject({id:trackId,name:'Tiny Comet',role:'melody',look,characterId:cid});
    expect(part.clips.A.source).toBe(body().source);expect(before.plans.at(-1).mix[trackId].gain).toBe(0.42);
    await post(a,`/api/characters/${cid}`,body({name:'Changed',look:BLANK_LOOK,source:'s("cp")',expectedRevision:1}));
    let after=(await room(a,id)).parts[0];expect(after.clips.A.source).toBe(body().source);expect(after.look).toEqual(look);expect(after.name).toBe('Tiny Comet');
    await post(a,`/api/characters/${cid}/delete`,{});
    after=(await room(a,id)).parts[0];expect(after.clips.A.source).toBe(body().source);
  });
  it('two people add a shared character to one mix as independent parts',async()=>{
    const a=await visitor(base),b=await visitor(base),m=await visitor(base),id=await mix(m);await join(m,a,id);await join(m,b,id);
    const cid=await make(a);await publish(a,cid);
    const first=(await act(a,id,'part.add',{characterId:cid})).body.entityId,second=(await act(b,id,'part.add',{characterId:cid})).body.entityId;
    await act(a,id,'part.edit',{trackId:first,source:'s("bd")',via:'code'});
    const parts=(await room(m,id)).parts;
    expect(parts.find((p:any)=>p.id===second).clips.A.source).toBe(body().source);expect(parts.find((p:any)=>p.id===first).clips.A.source).toBe('s("bd")');
    expect(parts.map((p:any)=>p.addedBy.id).sort()).toEqual([a.id,b.id].sort());
  });
  it('a private character cannot be added by anyone else, even by id',async()=>{
    const a=await visitor(base),b=await visitor(base),id=await mix(b),cid=await make(a);
    const r=await act(b,id,'part.add',{characterId:cid});expect(r.status).toBe(404);expect((await room(b,id)).parts).toEqual([]);
  });
  it('a listener or a non-member gains no project access from a shared character',async()=>{
    const a=await visitor(base),b=await visitor(base),id=await mix(a),cid=await make(a);await publish(a,cid);
    await act(a,id,'part.add',{characterId:cid});
    expect((await get(b,`/api/projects/${id}`)).status).toBe(404);
  });
  it('a track’s look is its own, and is checked when it changes',async()=>{
    const a=await visitor(base),b=await visitor(base),id=await mix(a);await join(a,b,id);
    const trackId=(await act(a,id,'part.add',{presetId:'warm-anchor'})).body.entityId,look=randomLook('own');
    expect((await act(a,id,'part.look',{trackId,look:{...look,body:'nope'}})).status).toBe(422);
    expect((await act(b,id,'part.look',{trackId,look})).status).toBe(200);
    expect((await room(a,id)).parts[0].look).toEqual(look);
    const stale=await act(a,id,'part.look',{trackId,look:BLANK_LOOK},1);expect(stale.status).toBe(409);
    const outsider=await visitor(base);expect((await act(outsider,id,'part.look',{trackId,look})).status).toBe(404);
  });
  it('a factory character brings its look; duplicating and swapping keep the drawing honest',async()=>{
    const a=await visitor(base),id=await mix(a),trackId=(await act(a,id,'part.add',{presetId:'sun-gate'})).body.entityId;
    const presets=(await get(a,'/api/presets')).body.packs.flatMap((p:any)=>p.presets);
    expect((await room(a,id)).parts[0].look).toEqual(presets.find((p:any)=>p.id==='sun-gate').look);
    const dup=(await act(a,id,'part.duplicate',{trackId})).body.entityId;
    expect((await room(a,id)).parts.find((p:any)=>p.id===dup).look.body).toBe('robot');
    await act(a,id,'part.swap',{trackId,presetId:'clay-wood'});
    expect((await room(a,id)).parts.find((p:any)=>p.id===trackId).look.body).toBe('tower');
  });
  it('the saved-sound routes still work, as characters with the same ids',async()=>{
    const a=await visitor(base),id=await mix(a),s=await post(a,'/api/sounds',{name:'Old route',source:'note("a1").s("sine")',role:'bass'});
    expect(s.status).toBe(201);expect((await get(a,'/api/sounds')).body.sounds.map((x:any)=>x.id)).toContain(s.body.id);
    expect((await get(a,`/api/characters/${s.body.id}`)).body.name).toBe('Old route');
    expect((await act(a,id,'part.add',{soundId:s.body.id})).status).toBe(200);
    expect((await post(a,`/api/sounds/${s.body.id}/delete`,{})).status).toBe(200);
    expect((await get(a,'/api/sounds')).body.sounds).toEqual([]);expect((await room(a,id)).parts).toHaveLength(1);
  });
  it('an exported mix keeps each track’s look, and a bad one in a file is dropped rather than stored',async()=>{
    const a=await visitor(base),id=await mix(a),look=randomLook('export'),cid=await make(a,{look});await act(a,id,'part.add',{characterId:cid});
    const file=(await get(a,`/api/projects/${id}/export`)).body;expect(file.parts[0].look).toEqual(look);
    const imported=(await post(a,'/api/import',file)).body.id;expect((await room(a,imported)).parts[0].look).toEqual(look);
    file.parts[0].look={v:1,body:'<svg onload=alert(1)>'};
    const bad=(await post(a,'/api/import',file)).body.id;expect((await room(a,bad)).parts[0].look).toBeNull();
  });
});
