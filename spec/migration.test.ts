// A database written by the Stream release (spec/fixtures/stream-v1.db, built
// through that server's own HTTP API; ids in stream-v1.json) is opened by the
// current server. Every musical record must survive, owners and members must
// follow from what people actually made, and a verified backup must exist and
// restore.
import {afterAll,expect,it} from 'vitest';
import {readFileSync,readdirSync,copyFileSync} from 'node:fs';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createHmac} from 'node:crypto';
import {get,act,ownServer,type V} from './helpers.ts';

const fixture=JSON.parse(readFileSync('spec/fixtures/stream-v1.json','utf8'));
const srv=ownServer('spec-migration-','spec/fixtures/stream-v1.db');
afterAll(()=>srv.cleanup());
const count=(db:DatabaseSync,sql:string)=>(db.prepare(sql).get() as {n:number}).n;
// The fixture carries no signing secret, so the migrated server makes one; a
// cookie for an existing visitor is signed with it, exactly as identity.ts does.
function as(visitorId:string):V{
  const db=new DatabaseSync(srv.DB_PATH,{readOnly:true});const secret=(db.prepare("select value from setting where key='visitor_secret'").get() as {value:string}).value;db.close();
  const mac=createHmac('sha256',secret).update(visitorId).digest('base64url');
  return {cookie:`visitor=${encodeURIComponent(`${visitorId}.${mac}`)}`,id:visitorId,handle:'',base:srv.base};
}

it('migrates Stream data forward without losing or reassigning any of it',async()=>{
  const before=new DatabaseSync('spec/fixtures/stream-v1.db',{readOnly:true});
  const tables=['visitor','trace','project','track','clip','clip_revision','scene_assignment','legacy_import'];
  const counts=Object.fromEntries(tables.map(t=>[t,count(before,`select count(*) as n from ${t}`)]));
  const revisions=before.prepare('select clip_id,revision,document_json,source_text,created_by from clip_revision order by clip_id,revision').all();
  const tracks=before.prepare('select id,project_id,owner_id,name,archived_at from track order by id').all();
  before.close();
  await srv.boot();
  const after=new DatabaseSync(srv.DB_PATH,{readOnly:true});
  for(const t of tables)expect(count(after,`select count(*) as n from ${t}`),t).toBe(counts[t]);
  expect(after.prepare('select clip_id,revision,document_json,source_text,created_by from clip_revision order by clip_id,revision').all()).toEqual(revisions);
  expect(after.prepare('select id,project_id,owner_id,name,archived_at from track order by id').all()).toEqual(tracks);
  // Creators own, track owners are members, nobody else is added.
  const members=after.prepare('select project_id,visitor_id,role from project_member order by project_id,role').all() as {project_id:string;visitor_id:string;role:string}[];
  expect(members.filter(m=>m.project_id===fixture.projects.shared)).toEqual([{project_id:fixture.projects.shared,visitor_id:fixture.visitors.bo,role:'member'},{project_id:fixture.projects.shared,visitor_id:fixture.visitors.ada,role:'owner'}]);
  expect(members.filter(m=>m.project_id===fixture.projects.solo)).toEqual([{project_id:fixture.projects.solo,visitor_id:fixture.visitors.bo,role:'owner'}]);
  // Everything was listed and readable before, so it stays public, flagged for the owner.
  expect(after.prepare('select distinct visibility,migrated_public from project').all()).toEqual([{visibility:'public',migrated_public:1}]);
  // The held conductor lease was released and the transport stopped.
  expect(after.prepare('select status,conductor_id from transport where project_id=?').get(fixture.projects.shared)).toEqual({status:'stopped',conductor_id:null});
  // A verified backup sits beside the database and opens with the old data.
  const backups=readdirSync(srv.dir).filter(f=>f.includes('.before-ensemble-'));expect(backups).toHaveLength(1);
  const backup=new DatabaseSync(join(srv.dir,backups[0]),{readOnly:true});
  expect(Object.values(backup.prepare('pragma integrity_check').get() as object)[0]).toBe('ok');
  expect(count(backup,'select count(*) as n from clip_revision')).toBe(counts.clip_revision);
  expect(backup.prepare("select name from sqlite_master where name='project_member'").get()).toBeUndefined();
  backup.close();after.close();
},30000);

it('shows the owner the migrated mix with legacy parts, clips A–D, scenes and attribution intact',async()=>{
  const ada=as(fixture.visitors.ada),bo=as(fixture.visitors.bo);
  const s=(await get(ada,`/api/projects/${fixture.projects.shared}`)).body;
  expect(s.access).toBe('member');expect(s.you.role).toBe('owner');expect(s.migratedPublic).toBe(true);
  const kit=s.parts.find((p:any)=>p.id===fixture.tracks.adaKit);
  expect(kit).toMatchObject({name:'Ada kit',role:'custom',addedBy:{id:fixture.visitors.ada}});
  expect(Object.keys(kit.clips).sort()).toEqual(['A','B']);
  expect(kit.clips.A.schemaVersion).toBe(1);expect(kit.clips.A.history).toHaveLength(3);
  expect(kit.clips.B.source).toBe('s("hh hh hh hh").fast(2)');
  // The newest revision of clip A had no stored source; it is shown as its printed tree.
  expect(kit.clips.A.source).toBe('s("bd sd bd sd")');
  const melody=s.parts.find((p:any)=>p.id===fixture.tracks.boMelody);
  expect(melody.clips.A.source).toBe(fixture.sources.melody);expect(melody.addedBy.id).toBe(fixture.visitors.bo);
  expect(s.parts.find((p:any)=>p.id===fixture.tracks.boArchived).archivedAt).not.toBeNull();
  const plan=s.plans.at(-1);expect(plan.sceneAssignments.C[fixture.tracks.adaKit]).toBe('B');expect(plan.mix[fixture.tracks.boMelody].gain).toBe(0.45);
  expect(s.settings.bpm).toBe(96);expect(s.settings.arrangement.entries).toEqual([{scene:'A',bars:2},{scene:'C',bars:2}]);
  // Bo is a member and can now edit Ada's part; credit stays with Ada.
  expect((await act(bo,fixture.projects.shared,'part.edit',{trackId:fixture.tracks.adaKit,source:'s("bd*2 sd")'},3)).status).toBe(200);
  const edited=(await get(ada,`/api/projects/${fixture.projects.shared}`)).body.parts.find((p:any)=>p.id===fixture.tracks.adaKit);
  expect(edited.addedBy.id).toBe(fixture.visitors.ada);expect(edited.clips.A.editedBy.id).toBe(fixture.visitors.bo);expect(edited.clips.A.schemaVersion).toBe(2);expect(edited.clips.B.schemaVersion).toBe(1);
  // The earlier sketch that could not be imported is still archived verbatim.
  const archive=await (await fetch(`${srv.base}/archive`)).text();expect(archive).toContain('s(&quot;hh*4&quot;)');
  // The legacy sketchpad still serves its traces.
  expect((await get(ada,'/api/state')).status).toBe(200);
  // Acknowledging the note keeps it public and clears the flag.
  expect((await act(ada,fixture.projects.shared,'project.acknowledge')).status).toBe(200);
  expect((await get(ada,`/api/projects/${fixture.projects.shared}`)).body).toMatchObject({visibility:'public',migratedPublic:false});
});

it('restores from the backup: the backup boots as the Stream data and migrates again cleanly',async()=>{
  const backup=readdirSync(srv.dir).find(f=>f.includes('.before-ensemble-'))!;
  const restored=ownServer('spec-restore-');copyFileSync(join(srv.dir,backup),restored.DB_PATH);
  try{
    await restored.boot();
    const db=new DatabaseSync(restored.DB_PATH,{readOnly:true});
    expect(db.prepare('select max(version) as v from studio_migration').get()).toEqual({v:2});
    expect(count(db,'select count(*) as n from clip_revision')).toBe(9);expect(count(db,'select count(*) as n from project_member')).toBe(4);
    db.close();
  }finally{await restored.cleanup();}
},30000);
