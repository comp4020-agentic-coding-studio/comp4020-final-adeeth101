// The only storage that survives a restart or a redeploy is the volume Fly
// mounts at /data (see fly.toml). There is no database server in the course
// setup, so this is SQLite --- node's own, so the app has no dependencies and
// the image stays small.
import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

// In the container the volume is at /data. On a laptop it isn't, so the same
// command works in both places without an env var to remember --- .data is
// gitignored.
const dir = process.env.DATA_DIR ?? (existsSync("/data") ? "/data" : ".data");
const file = process.env.DB_PATH ?? `${dir}/app.db`;

mkdirSync(dirname(file), { recursive: true });

export const db = new DatabaseSync(file);

// WAL survives the machine being stopped mid-write, which fly.toml's
// auto_stop_machines makes a routine event rather than a rare one.
db.exec("pragma journal_mode = wal");
db.exec("pragma foreign_keys = on");

// Migrations run forward on every boot and are append-only: add a new one,
// never edit a shipped one, or a redeploy meets a volume it can't read.
const migrations: string[] = [
  `create table if not exists visitor (
     id           text primary key,
     handle       text not null,
     created_at   integer not null,
     last_seen_at integer not null
   )`,
  // One unit of shared state, owned by one visitor. 'slot' is how a concept
  // addresses it (a track name, a position in a chain, a line id); 'body' is
  // the payload, text or JSON.
  `create table if not exists trace (
     id         integer primary key autoincrement,
     visitor_id text not null references visitor(id),
     slot       text,
     body       text not null,
     created_at integer not null,
     updated_at integer not null
   )`,
  `create index if not exists trace_slot on trace(slot)`,
  `create index if not exists trace_visitor on trace(visitor_id)`,
  // Append-only. Week 10's real-time replays from here; week 11's logging
  // reads it. Nothing updates or deletes a row in this table.
  `create table if not exists event (
     id         integer primary key autoincrement,
     visitor_id text,
     kind       text not null,
     payload    text not null default '{}',
     created_at integer not null
   )`,
  `create index if not exists event_created on event(created_at)`,
  // Small values the app must not forget across a restart or a redeploy. The
  // cookie signing secret lives here: generated per boot, every returning
  // visitor became a stranger and "their trace is still there" stopped being
  // true, even though the traces themselves were safe on the volume.
  `create table if not exists setting (
     key   text primary key,
     value text not null
   )`,
];

for (const statement of migrations) db.exec(statement);

export const now = (): number => Date.now();

const readSetting = db.prepare("select value from setting where key = ?");
const writeSetting = db.prepare("insert or ignore into setting (key, value) values (?, ?)");

// Reads a persisted value, creating it once if this is a fresh volume.
export function setting(key: string, create: () => string): string {
  const existing = readSetting.get(key) as { value: string } | undefined;
  if (existing) return existing.value;
  const made = create();
  writeSetting.run(key, made);
  // `insert or ignore` means a racing boot may have won; re-read so both
  // processes agree on one value.
  return (readSetting.get(key) as { value: string }).value;
}
