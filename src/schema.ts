// Studio schema. Migrations are append-only: a shipped one is never edited,
// because a redeploy meets a volume that already ran it. Each runs in one
// transaction, after a verified backup of any database holding work.
import {DatabaseSync} from 'node:sqlite';
import {randomBytes} from 'node:crypto';
import {db} from './db.ts';

db.exec(`create table if not exists studio_migration (version integer primary key, applied_at integer not null)`);
const applied=(v:number)=>!!db.prepare('select version from studio_migration where version=?').get(v);
const count=(sql:string)=>Number((db.prepare(sql).get() as {n:number}).n);
const file=()=>(db.prepare('pragma database_list').get() as {file:string}).file;

// A consistent copy, even with a WAL, then reopened and checked before the
// migration may touch the original: integrity, and the same row counts.
export function verifiedBackup(label:string,tables:string[]):string|null{
  const path=file();if(!path)return null;
  const backup=`${path}.before-${label}-${Date.now()}.db`;
  db.exec(`vacuum into '${backup.replaceAll("'","''")}'`);
  const copy=new DatabaseSync(backup,{readOnly:true});
  try{
    const ok=(copy.prepare('pragma integrity_check').get() as Record<string,string>);
    if(Object.values(ok)[0]!=='ok')throw new Error(`Backup ${backup} failed its integrity check.`);
    for(const t of tables){
      const exists=copy.prepare("select name from sqlite_master where type='table' and name=?").get(t);
      if(!exists)continue;
      if(count(`select count(*) as n from ${t}`)!==Number((copy.prepare(`select count(*) as n from ${t}`).get() as {n:number}).n))throw new Error(`Backup ${backup} does not match ${t}.`);
    }
  }finally{copy.close();}
  return backup;
}

// Migration 1: the Stream studio tables.
if(!applied(1)){
  if(file()&&count('select count(*) as n from trace')>0)verifiedBackup('studio',['trace','visitor','event']);
  db.exec(`begin immediate;
  create table project (id text primary key,title text not null,created_by text not null references visitor(id),created_at integer not null,updated_at integer not null,revision integer not null);
  create table track (id text primary key,project_id text not null references project(id),owner_id text not null references visitor(id),name text not null,position integer not null,revision integer not null,archived_at integer);
  create index track_project on track(project_id,position);
  create table clip (id text primary key,track_id text not null references track(id),slot text not null,current_revision integer not null,unique(track_id,slot));
  create table clip_revision (clip_id text not null references clip(id),revision integer not null,schema_version integer not null,document_json text not null,source_text text,provenance_json text not null,created_by text not null,created_at integer not null,primary key(clip_id,revision));
  create table scene_assignment (project_id text not null references project(id),scene text not null,track_id text not null references track(id),clip_slot text,primary key(project_id,scene,track_id));
  create table project_settings (project_id text primary key references project(id),bpm integer not null,scene_names_json text not null,arrangement_json text not null,settings_revision integer not null);
  create table transport (project_id text primary key references project(id),generation integer not null,status text not null,epoch_ms integer,conductor_id text,lease_until integer not null,revision integer not null);
  create table performance_plan (project_id text not null references project(id),generation integer not null,plan_revision integer not null,effective_cycle integer not null,plan_json text not null,created_at integer not null,primary key(project_id,generation,plan_revision));
  create table command_receipt (visitor_id text not null,command_id text not null,request_hash text not null,response_json text not null,created_at integer not null,primary key(visitor_id,command_id));
  create table legacy_import (trace_id integer primary key,new_clip_id text,archived_source text not null,reason text);
  alter table event add column project_id text;
  alter table event add column command_id text;
  create index event_project on event(project_id,id);
  insert into studio_migration values(1,strftime('%s','now')*1000);
  commit;`);
}

// Migration 2: Ensemble. Visibility and membership, social graph, invitations,
// recoverable profiles, performances, chat and saved sounds. Every Stream
// piece was listed and readable by anyone, so existing pieces become Public
// (with a note the owner sees) rather than suddenly disappearing; new projects
// start Private. Creators become owners and track owners become members;
// nothing is assigned to anyone who did not already make it.
if(!applied(2)){
  if(file()&&count('select count(*) as n from project')>0)verifiedBackup('ensemble',['project','track','clip','clip_revision','scene_assignment','performance_plan','visitor','event','trace']);
  db.exec(`begin immediate;
  alter table project add column visibility text not null default 'private';
  alter table project add column view_link_version integer not null default 1;
  alter table project add column view_token_hash text;
  alter table project add column migrated_public integer not null default 0;
  update project set visibility='public',migrated_public=1;
  alter table track add column role text;
  alter table track add column preset_id text;
  alter table track add column preset_version integer;
  alter table track add column guest_performance_id text;
  alter table event add column scope text;
  create index event_scope on event(scope,id);
  alter table visitor add column friend_code text;
  alter table visitor add column recovery_hash text;
  alter table visitor add column recovery_rotated_at integer;
  create unique index visitor_friend_code on visitor(friend_code);
  create unique index visitor_recovery on visitor(recovery_hash);
  create table project_member (project_id text not null references project(id),visitor_id text not null references visitor(id),role text not null,joined_at integer not null,removed_at integer,primary key(project_id,visitor_id));
  create index member_visitor on project_member(visitor_id,removed_at);
  insert into project_member select id,created_by,'owner',created_at,null from project;
  insert or ignore into project_member select distinct t.project_id,t.owner_id,'member',p.created_at,null from track t join project p on p.id=t.project_id;
  create table friend_link (low_id text not null,high_id text not null,status text not null,requested_by text not null,created_at integer not null,updated_at integer not null,primary key(low_id,high_id));
  create table block_link (blocker_id text not null,blocked_id text not null,created_at integer not null,primary key(blocker_id,blocked_id));
  create table notification (id integer primary key autoincrement,visitor_id text not null,kind text not null,payload_json text not null,created_at integer not null,read_at integer,cleared_at integer);
  create index notification_visitor on notification(visitor_id,id);
  create table invitation (id text primary key,kind text not null,resource_id text not null,created_by text not null,recipient_id text,token_hash text unique,role text not null,max_uses integer not null,uses integer not null default 0,expires_at integer,revoked_at integer,link_version integer not null,created_at integer not null);
  create index invitation_resource on invitation(resource_id,created_at);
  create table invitation_receipt (invitation_id text not null references invitation(id),visitor_id text not null,redeemed_at integer not null,primary key(invitation_id,visitor_id));
  create table capability_grant (visitor_id text not null,kind text not null,resource_id text not null,link_version integer not null,created_at integer not null,primary key(visitor_id,kind,resource_id));
  create table project_chat (id integer primary key autoincrement,project_id text not null references project(id),visitor_id text not null,client_id text not null,body text not null,created_at integer not null,deleted_at integer,deleted_by text,unique(project_id,visitor_id,client_id));
  create table performance (id text primary key,project_id text not null references project(id),title text not null,visibility text not null,status text not null,host_id text not null,started_by text not null,listen_token_hash text,link_version integer not null default 1,started_at integer not null,ended_at integer,end_reason text);
  create unique index performance_live on performance(project_id) where status='live';
  create table performance_participant (performance_id text not null references performance(id),visitor_id text not null,role text not null,muted integer not null default 0,removed integer not null default 0,admitted_at integer not null,primary key(performance_id,visitor_id));
  create table performance_request (performance_id text not null references performance(id),visitor_id text not null,status text not null,created_at integer not null,primary key(performance_id,visitor_id));
  create table performance_chat (id integer primary key autoincrement,performance_id text not null references performance(id),visitor_id text not null,client_id text not null,body text not null,created_at integer not null,deleted_at integer,unique(performance_id,visitor_id,client_id));
  create table user_sound (id text primary key,visitor_id text not null references visitor(id),name text not null,role text,source text not null,attribution_json text not null,created_at integer not null);
  create index user_sound_owner on user_sound(visitor_id,created_at);
  insert into studio_migration values(2,strftime('%s','now')*1000);
  commit;`);
}

// Friend codes are public and short: a handle plus code tells two people with
// the same name apart. Visitors who existed before migration 2 get one when
// first seen; the code is random, not derived from the private id.
const CODE_ALPHABET='23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
export function newFriendCode(){const b=randomBytes(6);return Array.from(b,x=>CODE_ALPHABET[x%32]).join('');}
export function ensureFriendCode(visitorId:string):string{
  const row=db.prepare('select friend_code from visitor where id=?').get(visitorId) as {friend_code:string|null}|undefined;
  if(!row)return '';
  if(row.friend_code)return row.friend_code;
  for(;;){const code=newFriendCode();try{db.prepare('update visitor set friend_code=? where id=? and friend_code is null').run(code,visitorId);break;}catch{/* collision: draw again */}}
  return (db.prepare('select friend_code from visitor where id=?').get(visitorId) as {friend_code:string}).friend_code;
}
