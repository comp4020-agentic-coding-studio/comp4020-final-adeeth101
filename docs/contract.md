# The contract

What the running app promises, and where each promise lives. If a change
needs a new route, table or limit, it is a change to this document first.
Trade-offs behind these choices are in [architecture](architecture.md); what
has been checked, and how, is in [verification](verification.md).

## Modules

| Path | Holds |
| --- | --- |
| `shared/music.ts` | The musical model, its runtime validator and every musical limit |
| `shared/code.ts` | Acorn allowlist parser and the deterministic Strudel printer |
| `shared/compile.ts` | Strudel `Pattern` construction from a validated tree |
| `shared/bots.ts` | Versioned seeded rhythm and melody generators |
| `shared/performance.ts` | Plans, the scene/arrangement resolver and restart selection |
| `shared/studio.ts` | Snapshot types shared by server and browser |
| `src/server.ts` | The routing table, request limits and error statuses |
| `src/studio.ts` | Studio schema, commands, ownership, leases, plans, SSE, import/export, legacy import |
| `src/studio-page.ts` | Server-rendered landing page and studio shell |
| `src/db.ts`, `src/identity.ts` | SQLite connection and the signed visitor cookie |
| `src/events.ts`, `src/feature.ts`, `src/page.ts`, `public/app.js` | The earlier sketchpad, now served at `/legacy` |
| `client/main.ts` | Compose and Perform pages |
| `client/blocks.ts` | Blockly music blocks and tree adapters (loaded on demand) |
| `client/audio.ts` | Shared-clock scheduler and bounded WebAudio output (loaded on demand) |
| `client/drafts.ts`, `client/api.ts` | IndexedDB drafts and command requests |
| `spec/*.test.ts`, `spec/browser/*.pw.ts` | Promises checked over HTTP, and in a real browser |

## The musical model

One versioned JSON tree is the only shared musical truth. Blocks and the
instrument grids edit it; supported code is parsed into it; generated Strudel
is a view of it.

```ts
type MusicNode =
  | { kind: 'sound'; steps: ('bd'|'sd'|'hh'|'cp'|null)[] }
  | { kind: 'notes'; steps: (number|null)[]; synth: 'sine'|'triangle'|'square'|'sawtooth' }
  | { kind: 'stack'; children: MusicNode[] }
  | { kind: 'transform'; op: 'fast'|'slow'|'rev'|'gain'|'lpf'|'room'; value?: number; child: MusicNode };
type ClipDocument = { schemaVersion: 1; root: MusicNode };
```

`validateDocument()` enforces, for every source (blocks, instruments, code,
bots, imports and restored revisions):

| Limit | Value |
| --- | --- |
| Steps per sequence | 1–32 |
| Notes | integer MIDI 48–83, or rest |
| Together (`stack`) | 2–4 children |
| Sequences per clip | at most 4 |
| Transforms per clip | at most 8 |
| Tree depth | at most 8 |
| Cells per clip | at most 128 |
| Combined speed at a sequence | ¼× to 4×; `fast`/`slow` take 2 or 4 |
| Steps per bar | at most 128 (each sequence's steps × its combined speed) |
| `gain` / `lpf` / `room` | 0–1 / 100–12000 Hz / 0–0.5 |

The code editor accepts one expression in this closed grammar, parsed with
Acorn and never executed:

```text
pattern := s("tokens") | note("tokens").s("synth")
         | stack(pattern, pattern [, pattern [, pattern]])
         | pattern.rev() | pattern.fast(2|4) | pattern.slow(2|4)
         | pattern.gain(n) | pattern.lpf(n) | pattern.room(n)
```

Tokens are the four drum names, MIDI integers or `~`, separated by whitespace.
Comments, variables, functions, template strings, computed members and other
calls are rejected. Source is at most 8 KB. When a publish includes source,
the server re-parses it and refuses it unless it equals the submitted tree.

## Storage

SQLite on the Fly volume at `/data` (locally `.data/`). The studio tables are
created by migration 1 in `src/studio.ts`, recorded in `studio_migration`.
Migrations are append-only. Before migration 1 first runs against a database
that holds sketches, it writes a `VACUUM INTO` backup beside it.

```
project           id, title, created_by, created_at, updated_at, revision
track             id, project_id, owner_id, name, position, revision, archived_at
clip              id, track_id, slot A–D, current_revision         unique(track, slot)
clip_revision     clip_id, revision, schema_version, document_json, source_text,
                  provenance_json, created_by, created_at          newest 20 kept
scene_assignment  project_id, scene, track_id, clip_slot (null = silence)
project_settings  project_id, bpm, scene_names_json, arrangement_json, settings_revision
transport         project_id, generation, status, epoch_ms, conductor_id, lease_until, revision
performance_plan  project_id, generation, plan_revision, effective_cycle, plan_json
command_receipt   visitor_id, command_id, request_hash, response_json  kept 7 days
legacy_import     trace_id, new_clip_id, archived_source, reason
event             (existing log) + project_id, command_id          append only
```

The earlier `visitor`, `trace`, `event` and `setting` tables are unchanged.
Drafts never reach the server: they live in the browser's IndexedDB, keyed by
visitor, project, track and slot.

## HTTP

| Route | Does |
| --- | --- |
| `GET /` | Landing page: create a piece, recent pieces |
| `GET /p/:id/compose`, `GET /p/:id/perform` | Server-rendered shell for the two studio pages |
| `GET /readme/` | `README.md` rendered per request |
| `GET /healthz` | `{ok:true}`; no database, no cookie |
| `GET /assets/*`, `GET /static/*` | Built client bundles; stylesheets and legacy script |
| `GET /api/time` | `{serverNowMs}` for clock calibration |
| `POST /api/projects` | Create a piece; JSON gets 201 `{id}`, a form post gets 303 to Compose |
| `GET /api/projects/:id` | Consistent snapshot plus event cursor, read in one transaction |
| `POST /api/projects/:id/commands` | Every project mutation (below) |
| `GET /api/projects/:id/events` | Project SSE: replay after `Last-Event-ID`/`?since`, then live |
| `POST /api/projects/:id/presence` | Ephemeral heartbeat `{route}`; never written to the event log |
| `GET /api/projects/:id/export` | Project JSON download, without identity material |
| `POST /api/import` | Import project JSON (≤512 KB) as a new piece owned by the importer |
| `GET /api/me`, `POST /api/handle` | Visitor identity and display name |
| `GET /legacy`, `/api/state`, `/api/act`, `/api/events` | The earlier sketchpad, unchanged |
| `GET /archive` | Earlier sketches that could not be imported, kept verbatim |

A command is `{commandId: UUID, type, expectedRevision, payload}`:

| Command | Who | Revision checked |
| --- | --- | --- |
| `track.create` | anyone; 12 active per piece, 2 per person | none (capacity checked in the transaction) |
| `track.rename`, `track.archive`, `track.restore` | track owner | track |
| `clip.publish`, `clip.restore` | track owner | clip (0 for an empty slot) |
| `scene.assign`, `track.launch`, `track.follow`, `track.mix` | track owner | track |
| `conductor.claim` / `.release` | anyone when free or expired / holder | transport |
| `conductor.renew` | holder (no event written) | none |
| `transport.start`, `.stop`, `scene.launch`, `arrangement.start`, `.stop` | conductor | transport |
| `tempo.set` (stopped only), `scene.rename`, `arrangement.save` | conductor | settings |

Success is `{ok, commandId, projectRevision, entityId, entityRevision, eventId,
effectiveCycle?}`. Statuses: 400 malformed JSON, 403 not yours / not
conducting / cross-site, 404 unknown, 409 stale revision, capacity or lease
conflict (with the current entity), 413 body over 64 KB, 415 not JSON, 422
invalid value, 429 rate limited (burst 20, then 5 per second, `Retry-After`).
A retried command ID returns its first result without a second effect; the
same ID with a different body is 409.

Rules that hold across commands:

- **The server decides.** Ownership, lease and revision are checked in the
  transaction; disabled buttons only explain.
- **Commit, then announce.** A command's rows and its event commit together;
  SSE hears it only after commit, and a rollback announces nothing.
- **Conducting is not owning.** The conductor controls transport, scenes and
  the arranger, never another person's clips or mix.
- **Seeing is the link.** Anyone holding a piece's URL sees every track, clip,
  revision and who owns each. A piece is made to be played together in one
  room, so hiding a part would only stop others copying it into their own
  track; there is nothing private in it, and export carries no identity
  material.
- **Saving is not playing.** A publish is visible at once; the ensemble adopts
  it at the next bar at least one second away.

## Who did what: the server log

Every committed change, every refused command and each person's first
presence in a piece writes one JSON line to stdout, which is what
`flyctl logs` shows. A line names `who` (handle) and `visitor` (first 8 of the
id, since two handles can match), the `kind` (`track.create`, `clip.publish`,
`clip.publish.refused`, `presence.join`, …), the piece, and for a track its
name and `owner`. Refusals are `level: "warn"` with the status and reason.
Lines are written after commit, so the log never names a change that rolled
back, and never carry clip source, trace text or cookies. `spec/logging.test.ts`
holds this.

## Live updates

SSE events are small invalidations `{projectId, projectRevision, kind,
entityId, commandId}`; clients then fetch a snapshot. More than 500 missed
events produce one `reset`. A named `beat` event every 5 s lets a page notice a
dead connection within 8 s. Streams are limited to 2 per person per piece and
64 in total; a refused page polls the snapshot every second and says so. A
stream with more than 128 KB unsent is closed rather than buffered.

## Performance plans and time

One cycle is one four-beat bar; cycles per second is BPM / 240. A plan holds
the catalog (track → slot → immutable clip revision), mix, scene assignments,
manual overrides, current scene and an optional arrangement snapshot. At cycle
`c` the plan with the highest `effectiveCycle ≤ c` applies. Live changes take
effect at the first bar starting at least 1000 ms ahead, and later commands for
the same boundary accumulate. The conductor lease lasts 30 s and the Perform
page renews it every 10 s.

A restart stops the ensemble, releases the podium and records
`transport.reset`. It keeps the plan that was sounding at the last durable
write for that piece and cancels anything queued after it. Saved music, mix
and arrangement survive; sound never resumes on its own.

## Sound

Each browser renders its own audio after a local gesture. The server never
renders or streams sound. `client/audio.ts` queries Strudel patterns built
from validated trees at global cycles and schedules native WebAudio voices
about 160 ms ahead. Drums are synthesised (no sample downloads); notes use
oscillator waveforms. Solo and device volume are local. If a device falls
behind, skipped sounds are counted and reported on the page.

## What is fixed by the course

From `fly.toml` and `spec/invariants.test.ts`:

- one `shared-cpu-1x` machine, 256 MB, one volume at `/data`
- the app serves HTTP on `0.0.0.0:$PORT`; Fly terminates TLS in front of it
- the machine stops when idle and starts on the next request
- `/` answers 200, and `/readme/` carries every `README.md` heading in order
