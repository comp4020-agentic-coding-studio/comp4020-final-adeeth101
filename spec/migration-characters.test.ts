// Migration 3, run against a database the previous release actually wrote: the
// fixture was produced by driving the pre-upgrade server over HTTP, with members,
// edited code, a muted track, chat, a saved sound, a public mix, a pending
// invitation and a finished performance. Everything must survive unchanged.
import {it,expect,beforeAll,afterAll} from 'vitest';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {join as joinPath} from 'node:path';
import {ownServer,visitor,get} from './helpers.ts';
import {validLook} from '../shared/look.ts';

const fixture=JSON.parse(readFileSync('spec/fixtures/ensemble-v2.json','utf8'));
const server=ownServer('ensemble-v3-','spec/fixtures/ensemble-v2.db');
const original=new DatabaseSync('spec/fixtures/ensemble-v2.db',{readOnly:true});
const rowsOf=(db:DatabaseSync,sql:string)=>db.prepare(sql).all() as Record<string,unknown>[];
let db:DatabaseSync;
beforeAll(async()=>{await server.boot();db=new DatabaseSync(joinPath(server.dir,'app.db'),{readOnly:true});});
afterAll(async()=>{db.close();original.close();await server.cleanup();});

it('records the migration once, in order',()=>{
  expect(rowsOf(db,'select version from studio_migration order by version').map(r=>r.version)).toEqual([1,2,3]);
});
it.each([
  ['project','select id,title,created_by,visibility,view_link_version,migrated_public from project order by id'],
  ['track','select id,project_id,owner_id,name,position,role,preset_id,preset_version,guest_performance_id from track order by id'],
  ['clip','select * from clip order by id'],
  ['clip_revision','select * from clip_revision order by clip_id,revision'],
  ['project_member','select * from project_member order by project_id,visitor_id'],
  ['project_chat','select * from project_chat order by id'],
  ['visitor','select id,handle,friend_code,recovery_hash from visitor order by id'],
  ['invitation','select * from invitation order by id'],
  ['performance','select * from performance order by id'],
  ['user_sound','select * from user_sound order by id'],
])('keeps every %s row exactly',(_name,sql)=>{
  expect(rowsOf(db,sql)).toEqual(rowsOf(original,sql));
});
it('gives old tracks no stored look: they keep drawing from their preset or id',()=>{
  expect(rowsOf(db,'select count(*) as n from track where look_json is not null')[0].n).toBe(0);
});
it('carries a saved sound into the library with the same id, private, and with no project detail',()=>{
  const row=rowsOf(db,`select * from character where id='${fixture.sound}'`)[0];
  expect(row).toMatchObject({owner_id:fixture.ben,name:'Ben sound',role:'bass',source:'note("a1 ~").s("sine")',visibility:'private',creator_handle:'Ben',published_json:null,revision:1});
  expect(validLook(JSON.parse(row.look_json as string))).not.toBeNull();
  expect(JSON.stringify(row)).not.toContain('Secret part name');
});
it('leaves no mix deleted',()=>{expect(rowsOf(db,'select count(*) as n from project where deleted_at is not null')[0].n).toBe(0);});
it('backs up first, and the backup holds the old data intact',()=>{
  const files=readdirSync(server.dir).filter(f=>f.includes('before-characters'));expect(files).toHaveLength(1);
  const copy=new DatabaseSync(joinPath(server.dir,files[0]),{readOnly:true});
  try{
    expect(Object.values(copy.prepare('pragma integrity_check').get() as object)[0]).toBe('ok');
    expect(rowsOf(copy,'select version from studio_migration order by version').map(r=>r.version)).toEqual([1,2]);
    const sql='select id,source_text from clip c join clip_revision r on r.clip_id=c.id order by id,revision';
    expect(rowsOf(copy,sql)).toEqual(rowsOf(original,sql));
  }finally{copy.close();}
});
it('serves old music exactly through the new server, and the public mix still reads',async()=>{
  const v=await visitor(server.base),view=await get(v,`/api/projects/${fixture.pub}`);
  expect(view.status).toBe(200);expect(view.body.parts).toHaveLength(1);expect(view.body.parts[0].look.body).toBe('ghost');
  expect((await get(v,`/api/projects/${fixture.mix}`)).status).toBe(404);
  const clips=rowsOf(db,`select t.id,r.source_text from track t join clip c on c.track_id=t.id join clip_revision r on r.clip_id=c.id and r.revision=c.current_revision where t.project_id='${fixture.mix}'`);
  for(const c of clips)expect(c.source_text).toBe(fixture.sources[c.id as string]);
  expect(clips).toHaveLength(3);
});
it('a second boot changes nothing',async()=>{
  await server.kill();await server.boot();
  const again=new DatabaseSync(joinPath(server.dir,'app.db'),{readOnly:true});
  try{expect(rowsOf(again,'select count(*) as n from character')[0].n).toBe(1);expect(readdirSync(server.dir).filter(f=>f.includes('before-characters'))).toHaveLength(1);}finally{again.close();}
});
