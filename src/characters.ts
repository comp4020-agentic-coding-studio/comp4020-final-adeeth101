// Saved characters: a look, a sound and a credit, owned by one person. A saved
// character is private until its owner lists it. Listing takes a snapshot, so
// later edits stay private until they choose to update the listing, and a list
// entry never carries the mix it came from: only the fields below are ever kept,
// so a project, its chat and its other clips have no way in.
//
// Using a character always copies it. A part or a saved copy holds its own look
// and source, so editing, unlisting or deleting the original changes nothing
// that was already taken from it.
import {randomUUID} from 'node:crypto';
import './schema.ts';
import {persist,derive,sameToken,type Visitor} from './identity.ts';
import {logAction} from './events.ts';
import {CommandError,need,hidden,text,code,one,rows,run,tx,limit} from './errors.ts';
import {hasGrant} from './access.ts';
import {parseSource} from '../shared/expr.ts';
import {validLook,defaultLook,type Look} from '../shared/look.ts';
import {presetById,roleOf,ROLES} from '../shared/presets.ts';
import type {CharacterCredit,SavedCharacter} from '../shared/studio.ts';

type Row=Record<string,any>;
export const CHARACTER_LIMITS={perVisitor:200,page:24};
const handleOf=(id:string)=>one('select handle from visitor where id=?',id)?.handle??'someone';
const short=(id:string)=>id.slice(0,8);
const creditOf=(c:Row):CharacterCredit=>({creator:c.creator_handle,remixOf:c.remix_of_name?{id:c.remix_of_id??null,name:c.remix_of_name,by:c.remix_of_by}:null});
const parsedLook=(c:Row):Look=>validLook(JSON.parse(c.look_json))??defaultLook(c.role??'custom',c.id);
const documentOf=(c:Row,body:{name:string;role:string|null;look:Look;source:string;level:number})=>({format:'ensemble-character' as const,version:1 as const,...body,role:body.role as never,credit:creditOf(c)});

function validSource(raw:unknown){
  const source=code(raw);
  try{parseSource(source);}catch(e){throw new CommandError(e instanceof Error?e.message:'That code is not valid.',422);}
  return source;
}
function fields(input:Row){
  const look=validLook(input.look);need(look,'That look is not one Ensemble can draw.');
  const level=input.level===undefined?0.7:input.level;
  need(typeof level==='number'&&Number.isFinite(level)&&level>=0&&level<=1,'Level is 0–1.');
  return {name:text(input.name,40,'the character a name'),role:(ROLES as readonly unknown[]).includes(input.role)?input.role as string:null,look:look!,source:validSource(input.source),level};
}
function mine(v:Visitor,id:unknown){const c=one('select * from character where id=? and owner_id=? and deleted_at is null',id,v.id);if(!c)throw hidden();return c;}
// A reader sees the owner's working copy only if they are the owner; anyone else
// sees the listed snapshot, and only while it is listed.
function readable(v:Visitor,id:unknown):{row:Row;own:boolean}{
  const c=one('select * from character where id=? and deleted_at is null',id);if(!c)throw hidden();
  if(c.owner_id===v.id)return {row:c,own:true};
  if(!c.published_json)throw hidden();
  if(c.visibility==='public'||(c.visibility==='unlisted'&&hasGrant(v.id,'character',c.id,c.link_version)))return {row:c,own:false};
  throw hidden();
}
function view(c:Row,own:boolean):SavedCharacter{
  const body=own?{name:c.name,role:c.role,look:parsedLook(c),source:c.source,level:c.level}:JSON.parse(c.published_json);
  return {id:c.id,...body,role:roleOf(body.role),revision:own?c.revision:c.published_revision,credit:creditOf(c),ownerHandle:handleOf(c.owner_id),mine:own,
    visibility:own?c.visibility:c.visibility,updatedAt:own?c.updated_at:c.published_at,document:documentOf(c,body),
    ...(own?{listed:!!c.published_json,publishedRevision:c.published_revision??null,publishedAt:c.published_at??null,changedSinceListing:!!c.published_json&&c.published_revision!==c.revision,
      shareToken:c.visibility==='unlisted'&&c.published_json?derive(`character:${c.id}:${c.link_version}`):null}:{})};
}
export function myCharacters(v:Visitor){return rows('select * from character where owner_id=? and deleted_at is null order by updated_at desc limit ?',v.id,CHARACTER_LIMITS.perVisitor).map(c=>view(c,true));}
export function getCharacter(v:Visitor,id:string){const {row,own}=readable(v,id);return view(row,own);}
// The public library. Anyone a visitor has blocked is left out of their view.
export function publicCharacters(v:Visitor,page:number,query:unknown,role:unknown){
  const offset=Math.max(0,Math.floor(page||0))*CHARACTER_LIMITS.page,where:string[]=[],args:unknown[]=[v.id];
  if(typeof query==='string'&&query.trim()){where.push("c.published_name like ? escape '!'");args.push(`%${query.trim().slice(0,40).replace(/[!%_]/g,x=>`!${x}`)}%`);}
  if((ROLES as readonly unknown[]).includes(role)){where.push('c.published_role=?');args.push(role);}
  const list=rows(`select c.* from character c where c.visibility='public' and c.published_json is not null and c.deleted_at is null and not exists(select 1 from block_link b where b.blocker_id=? and b.blocked_id=c.owner_id) ${where.map(x=>`and ${x}`).join(' ')} order by c.published_at desc limit ? offset ?`,...args as any[],CHARACTER_LIMITS.page+1,offset);
  return {characters:list.slice(0,CHARACTER_LIMITS.page).map(c=>view(c,c.owner_id===v.id)),more:list.length>CHARACTER_LIMITS.page};
}
function roomFor(v:Visitor){need(Number(one('select count(*) as n from character where owner_id=? and deleted_at is null',v.id)!.n)<CHARACTER_LIMITS.perVisitor,`You can keep ${CHARACTER_LIMITS.perVisitor} characters. Delete one first.`,409);}
function insert(v:Visitor,body:ReturnType<typeof fields>,remix:{id:string|null;name:string;by:string}|null){
  const id=randomUUID(),now=Date.now();
  run(`insert into character(id,owner_id,name,role,look_json,source,level,revision,creator_id,creator_handle,remix_of_id,remix_of_name,remix_of_by,visibility,created_at,updated_at) values(?,?,?,?,?,?,?,1,?,?,?,?,?,'private',?,?)`,id,v.id,body.name,body.role,JSON.stringify(body.look),body.source,body.level,v.id,handleOf(v.id),remix?.id??null,remix?.name??null,remix?.by??null,now,now);
  return id;
}
// What a new character was made from, checked here rather than taken on trust:
// a credit can only name a real character this person can actually read.
function remixSource(v:Visitor,from:Row|undefined){
  if(!from||typeof from!=='object')return null;
  if(typeof from.presetId==='string'){const p=presetById(from.presetId);return p?{id:null,name:p.name,by:'Ensemble'}:null;}
  if(typeof from.characterId==='string'){const {row,own}=readable(v,from.characterId),body=own?row:JSON.parse(row.published_json);return {id:row.id as string,name:body.name as string,by:row.creator_handle as string};}
  return null;
}
export function createCharacter(v:Visitor,input:Row){
  limit(`character:${v.id}`,20,0.5,'You are saving very quickly. Try again shortly.');
  const body=fields(input);persist(v);
  return tx(()=>{roomFor(v);const remix=remixSource(v,input.from),id=insert(v,body,remix);logAction(v,'character.created',{character:short(id),...(remix?{remix:true}:{})});return {ok:true,id,revision:1};});
}
export function updateCharacter(v:Visitor,id:string,input:Row){
  limit(`character:${v.id}`,20,0.5,'You are saving very quickly. Try again shortly.');
  const body=fields(input);
  return tx(()=>{
    const c=mine(v,id);
    need(Number.isInteger(input.expectedRevision),'Saving needs the revision you were editing.',422);
    if(c.revision!==input.expectedRevision)throw new CommandError('This character changed in another session. Your changes are still here.',409,view(c,true));
    run('update character set name=?,role=?,look_json=?,source=?,level=?,revision=revision+1,updated_at=? where id=?',body.name,body.role,JSON.stringify(body.look),body.source,body.level,Date.now(),id);
    logAction(v,'character.updated',{character:short(id),revision:c.revision+1});return {ok:true,id,revision:c.revision+1};
  });
}
// Deleting takes the listing with it. Copies and parts already made are separate
// rows and are not touched; their credit keeps the name it was given.
export function deleteCharacter(v:Visitor,id:string){
  return tx(()=>{const c=mine(v,id);run("update character set deleted_at=?,visibility='private',published_json=null,published_name=null,published_role=null where id=?",Date.now(),c.id);run("delete from capability_grant where kind='character' and resource_id=?",c.id);logAction(v,'character.deleted',{character:short(id)});return {ok:true};});
}
export function copyCharacter(v:Visitor,id:string,input:Row){
  limit(`character:${v.id}`,20,0.5,'You are saving very quickly. Try again shortly.');persist(v);
  return tx(()=>{
    roomFor(v);const {row,own}=readable(v,id),b=own?{name:row.name,role:row.role,look:parsedLook(row),source:row.source,level:row.level}:JSON.parse(row.published_json);
    const name=input?.name===undefined?`${b.name} remix`.slice(0,40):text(input.name,40,'the character a name');
    const copy=insert(v,{...b,name},{id:row.id,name:b.name,by:row.creator_handle});
    logAction(v,'character.copied',{character:short(copy),from:short(id)});return {ok:true,id:copy,revision:1};
  });
}
export function publishCharacter(v:Visitor,id:string,input:Row){
  need(input.visibility==='public'||input.visibility==='unlisted','Choose public or unlisted.');
  need(input.confirmSource===true,'Confirm that this character’s look and code will be shared.',422);
  limit(`publish:${v.id}`,10,0.2,'You are sharing very quickly. Try again shortly.');
  return tx(()=>{
    const c=mine(v,id),now=Date.now(),snapshot={name:c.name,role:c.role,look:parsedLook(c),source:c.source,level:c.level};
    // Moving away from a link retires it, as a mix's view link does.
    const rotate=c.visibility!==input.visibility?1:0;
    run('update character set visibility=?,link_version=link_version+?,published_json=?,published_name=?,published_role=?,published_revision=?,published_at=? where id=?',input.visibility,rotate,JSON.stringify(snapshot),c.name,c.role,c.revision,now,c.id);
    if(rotate)run("delete from capability_grant where kind='character' and resource_id=?",c.id);
    logAction(v,'character.published',{character:short(id),visibility:input.visibility});
    return {ok:true,character:view(one('select * from character where id=?',c.id)!,true)};
  });
}
export function unpublishCharacter(v:Visitor,id:string){
  return tx(()=>{const c=mine(v,id);run("update character set visibility='private',link_version=link_version+1,published_json=null,published_name=null,published_role=null,published_revision=null,published_at=null where id=?",c.id);run("delete from capability_grant where kind='character' and resource_id=?",c.id);logAction(v,'character.unpublished',{character:short(id)});return {ok:true};});
}
export function rotateCharacterLink(v:Visitor,id:string){
  return tx(()=>{const c=mine(v,id);need(c.visibility==='unlisted'&&c.published_json,'Only an unlisted character has a link.',409);run('update character set link_version=link_version+1 where id=?',c.id);run("delete from capability_grant where kind='character' and resource_id=?",c.id);logAction(v,'character.link',{character:short(id)});return {ok:true,character:view(one('select * from character where id=?',c.id)!,true)};});
}
export function redeemCharacterLink(v:Visitor,id:string,token:unknown){
  limit(`redeem:${v.id}`,20,0.2,'Too many attempts. Wait a minute.');
  const c=one('select id,visibility,link_version,published_json from character where id=? and deleted_at is null',id);
  if(!c||c.visibility!=='unlisted'||!c.published_json||!sameToken(token,derive(`character:${id}:${c.link_version}`)))throw hidden();
  persist(v);run('insert or replace into capability_grant values(?,?,?,?,?)',v.id,'character',id,c.link_version,Date.now());return {ok:true};
}
// What a part takes from a character when it is added to a mix: a copy of the
// exact look and sound. The part records where it came from and nothing more.
export function characterForPart(v:Visitor,id:string){
  const {row,own}=readable(v,id),b=own?{name:row.name,role:row.role,look:parsedLook(row),source:row.source,level:row.level}:JSON.parse(row.published_json);
  return {name:b.name as string,role:b.role as string|null,look:b.look as Look,source:b.source as string,level:b.level as number,characterId:row.id as string,provenance:{character:{id:row.id,name:b.name,by:row.creator_handle,revision:own?row.revision:row.published_revision}}};
}

// --- My sounds -------------------------------------------------------------------
// The older saved-sound routes, kept working. Saved sounds moved into the
// character table in migration 3 with their ids unchanged.
export function mySounds(v:Visitor){return rows('select * from character where owner_id=? and deleted_at is null order by created_at desc limit 100',v.id).map(s=>({id:s.id,name:s.name,role:roleOf(s.role),source:s.source,look:parsedLook(s),attribution:{savedBy:s.creator_handle},createdAt:s.created_at}));}
export function saveSound(v:Visitor,input:Row){
  const name=text(input.name,40,'the sound a name'),source=validSource(input.source);
  limit(`sound:${v.id}`,10,0.2);persist(v);
  need(Number(one('select count(*) as n from character where owner_id=? and deleted_at is null',v.id)!.n)<100,'You can keep 100 sounds. Delete one first.',409);
  const role=(ROLES as readonly unknown[]).includes(input.role)?input.role as string:null,seed=randomUUID();
  return {id:insert(v,{name,role,look:validLook(input.look)??defaultLook(role??'custom',seed),source,level:0.7},null)};
}
export function deleteSound(v:Visitor,soundId:unknown){
  const c=one('select id from character where id=? and owner_id=? and deleted_at is null',soundId,v.id);need(c,'That sound is not yours.',404);
  return deleteCharacter(v,c!.id as string);
}
