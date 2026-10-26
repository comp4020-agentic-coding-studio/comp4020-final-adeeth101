# The contract

What the running app promises, and where each promise lives. If a change
needs a new route, table or limit, it is a change to this document first.
The product direction behind it is [the Ensemble contract](ensemble-contract.md);
trade-offs are in [architecture](architecture.md); what has been checked, and
how, is in [verification](verification.md).

## Modules

| Path | Holds |
| --- | --- |
| `shared/expr.ts` | Version 2: the Strudel expression grammar, mini-notation, exact bounds, Shape edits |
| `shared/music.ts`, `shared/code.ts` | Version 1: Stream's bounded tree and its small code grammar, kept for old parts |
| `shared/clip.ts` | Validates either version and gives a part's exact source |
| `shared/compile.ts` | Strudel `Pattern` construction from either version, through named calls |
| `shared/presets.ts` | The factory catalogue: 3 packs × 8 presets, catalogue version 1 |
| `shared/performance.ts` | Plans, the scene/arrangement resolver and restart selection |
| `shared/studio.ts` | Snapshot types: room, public view, audience |
| `src/server.ts` | The routing table, request limits and error statuses |
| `src/schema.ts` | Append-only studio migrations and verified backups |
| `src/access.ts` | Who may read a project or a performance, and in which role |
| `src/hub.ts` | Scoped events and live streams |
| `src/studio.ts` | Rooms: parts, commands, leases, host, plans, chat, saved sounds, import/export, restart |
| `src/social.ts` | Friends, blocks, notifications, invitations, recovery codes |
| `src/performances.ts` | Live performances, audience snapshot, guest parts, audience chat, moderation |
| `src/studio-page.ts` | The server-rendered shell for every page |
| `src/db.ts`, `src/identity.ts` | SQLite connection, the signed visitor cookie, derived link tokens |
| `src/events.ts`, `src/feature.ts`, `src/page.ts`, `public/app.js` | The earlier sketchpad, served at `/legacy`, and the action log |
| `client/main.ts` | Routes the shell to a view |
| `client/room.ts` | The project room: stage, tray, part drawer (Shape, Code), chat, invite, go live |
| `client/audience.ts`, `client/pages.ts` | Audience view; Play, Live now, Friends, public mixes, invitation pages |
| `client/audio.ts`, `client/sound.ts` | Shared-clock scheduler, preview channel and bounded WebAudio output |
| `client/live.ts`, `client/drafts.ts`, `client/performer.ts` | Streams and clock calibration; IndexedDB drafts; original performer drawings |
| `spec/*.test.ts`, `spec/browser/*.pw.ts` | Promises checked over HTTP, and in a real browser |

## The musical model

A part's clip is one of two versioned documents. Neither is converted into the
other.

```ts
type ClipDocument = { schemaVersion: 1; root: MusicNode };   // Stream's tree
type ExprDocument = { schemaVersion: 2; root: Expr };        // parsed from source
```

New and edited parts are version 2 and always store their source verbatim.
Version 1 clips keep playing; editing one in Code saves a version 2 revision
and leaves the earlier revisions and other clip slots as they were.

The version 2 grammar, parsed with Acorn and never executed:

```text
pattern := s("mini") | note("mini").s("sine"|"triangle"|"square"|"sawtooth")
         | stack(pattern, … up to 8)
         | pattern.gain(0–1) | .lpf(60–16000) | .room(0–1) | .pan(0–1) | .release(0.01–4)
         | pattern.fast(f) | pattern.slow(f) | pattern.rev()     f ∈ {0.25, 0.5, 1…8}
mini    := steps separated by spaces; ~ rest; [a b] subdivide; <a b> one per bar;
           a,b layers or chords; a*n, a/n (n 1–16); a!n or a! repeat; a@n weight
words   := bd sd hh cp (in s) | MIDI 24–96 or note names like a3, c#4, eb2 (in note)
```

Comments, a trailing semicolon and template strings without `${}` are
allowed. Everything else is refused with a message and the character it
failed at: variables, functions, arrow callbacks, computed or optional
members, other calls, spread, interpolation, non-literal numbers.

Bounds, checked on the tree before any pattern is built:

| Limit | Value |
| --- | --- |
| Source | 8 KiB |
| Expression nodes / nesting | 600 / 12 |
| Mini-notation steps after repetition | 1,024 |
| Steps per sequence, layers per stack or chord | 64, 8 |
| Sound onsets in any one bar | 64 (exact upper bound) |
| Bars before the pattern repeats | 64 (exact) |
| Parts per mix | 12 active, all clips play through one output |

The onset and period bounds are exact because every speed factor is a whole
number or a whole-number fraction: a bar never straddles child cycles.
`spec/expr.test.ts` checks them against Strudel 1.2.6 output.

Version 1 limits are unchanged (`shared/music.ts`): 1–32 steps, MIDI 48–83,
128 steps per bar.

## Storage

SQLite on the Fly volume at `/data` (locally `.data/`). Migration 1 (Stream)
and migration 2 (Ensemble) live in `src/schema.ts`, recorded in
`studio_migration`. Each runs in one transaction, after a `VACUUM INTO` backup
that is reopened, integrity-checked and compared row for row; it is kept
beside the database as `app.db.before-<label>-<time>.db`.

Migration 2 adds:

```
project            + visibility, view_link_version, migrated_public
track              + role, preset_id, preset_version, guest_performance_id
event              + scope
visitor            + friend_code, recovery_hash, recovery_rotated_at
project_member     project, visitor, role owner|member, joined_at, removed_at
friend_link        low_id, high_id, status pending|accepted, requested_by
block_link         blocker, blocked
notification       visitor, kind, payload_json, read/cleared
invitation         kind project|perform, resource, created_by, recipient | token_hash,
                   role, max_uses, uses, expires_at, revoked_at
invitation_receipt invitation, visitor
capability_grant   visitor, kind view|listen, resource, link_version
project_chat       project, visitor, client_id (unique), body, deleted_at
performance        project, title, visibility, status live|ended, host, link_version,
                   started_at, ended_at, end_reason          one live per project
performance_participant / _request / _chat
user_sound         visitor, name, role, source, attribution_json
```

Every Stream piece became `public` with `migrated_public = 1`; creators became
owners and track owners members. Nothing else was assigned to anyone.
Ephemeral state lives in memory and is lost on restart by design: edit leases,
room presence, friends' online status and reactions.

## HTTP

Pages:

| Route | Does |
| --- | --- |
| `GET /` | Play: Start a mix (also a plain form post), Your mixes |
| `GET /p/:id` | Project room for members, saved-mix view for permitted visitors, generic 404 otherwise |
| `GET /p/:id/compose`, `/p/:id/perform` | 301 to `/p/:id` |
| `GET /live`, `/live/:id` | Live now; audience view |
| `GET /friends`, `/discover`, `/invite/:id` | Friends and profile; public mixes; invitation landing |
| `GET /readme/`, `/healthz` | README rendered per request; `{ok:true}` with no database or cookie |
| `GET /legacy`, `/archive` | The earlier sketchpad; unimported sketches kept verbatim |

API (all JSON; every response that depends on the visitor is `private,
no-store`):

| Route | Who | Does |
| --- | --- | --- |
| `POST /api/projects` | anyone | New private mix; 201 `{id}` |
| `GET /api/projects` | visitor | Their mixes |
| `GET /api/projects/:id` | member / permitted viewer | Room snapshot, or the public view (saved mix and credits only) |
| `POST /api/projects/:id/commands` | member | Every room change (below) |
| `GET /api/projects/:id/events` | member / viewer | Member or view stream; `Last-Event-ID` or `?since` replays |
| `POST /api/projects/:id/presence` | member | Room heartbeat; renews this person's host and edit leases |
| `GET`/`POST /api/projects/:id/chat` | member | Page of 50 / send `{clientId, body}` / `{delete:id}` |
| `GET /api/projects/:id/export`, `POST /api/import` | member / anyone | Project file without identity material; import as a new private mix (Stream files too) |
| `GET /api/projects/:id/invitations` | member | Invitations for this mix |
| `POST /api/projects/:id/view-link` | anyone | Redeem an unlisted view token |
| `POST /api/projects/:id/go-live` | host | Idempotent `{commandId, title, visibility}` |
| `GET /api/performances/:id` | admitted | Audience snapshot |
| `GET /api/performances/:id/events` | admitted | Audience stream (listeners count against the cap) |
| `GET`/`POST /api/performances/:id/chat`, `…/react` | admitted | Audience chat; a reaction broadcast |
| `POST /api/performances/:id/moderate` | host (request: listener) | request, accept, decline, mute, unmute, remove, delete, pass |
| `POST /api/performances/:id/end`, `…/rotate-link`, `…/listen-link` | host / host / anyone | End; new listen link; redeem a listen token |
| `POST /api/performances/:id/commands` | guest performer | `guest.add`, `guest.edit`, `guest.remove` |
| `GET /api/live`, `/api/discover` | anyone | Public live performances; public mixes (paginated) |
| `GET /api/presets` | anyone | The factory catalogue |
| `GET`/`POST /api/sounds`, `…/:id/delete` | visitor | My sounds |
| `GET`/`POST /api/friends` | visitor | Friends view; request, accept, decline, cancel, remove, block, unblock |
| `GET /api/notifications`, `…/:id/clear`, `GET /api/account/events` | visitor | Notifications and their content-free stream |
| `POST /api/invitations`, `…/:id/preview|accept|decline|revoke` | owner or host / invitee | Invitation lifecycle |
| `POST /api/recovery`, `/api/recover` | visitor | Show a new recovery code once; sign in with one |
| `GET /api/me`, `POST /api/handle`, `POST /api/heartbeat` | visitor | Identity and name; friends' online status |
| `GET /api/time` | anyone | `{serverNowMs}` for clock calibration |
| `/api/state`, `/api/act`, `/api/events` | anyone | The earlier sketchpad; its stream carries only sketchpad events |

A room command is `{commandId: UUID, type, expectedRevision?, payload}`:

| Command | Who | Checked |
| --- | --- | --- |
| `part.add` (`presetId` / `soundId` / `source`, `play?`) | member, editor slot | 12 parts; `play` starts the mix if the caller hosts or nobody does |
| `part.edit`, `part.swap`, `part.restore` | member, not leased by another | clip revision |
| `part.mix` (gain, mute), `part.rename`, `part.slot`, `scene.assign` | member | part revision when given |
| `part.remove`, `part.return`, `part.duplicate`, `part.keep` | member | lease; capacity |
| `part.lease`, `part.release` | member (owner may force release) | — |
| `project.rename` | member | — |
| `project.visibility`, `project.rotateLink`, `project.acknowledge`, `member.remove` | owner | — |
| `member.leave` | member (not the owner) | — |
| `host.claim` / `host.pass` / `host.release` | member when free / host | — |
| `transport.start` | host, or anyone when nobody hosts (they become host) | stopped |
| `transport.stop` | host or owner | playing |
| `tempo.set`, `scene.rename`, `scene.launch`, `arrangement.*` | host | stopped for tempo |

Success is `{ok, commandId, projectRevision, entityId, entityRevision,
eventId, effectiveCycle?}`. Statuses: 400 malformed JSON, 403 not allowed in
your role or cross-site, 404 unknown or not visible to you, 409 stale
revision, lease held, capacity, already live, 410 invitation used, expired or
revoked, or performance ended, 413 body over the route's limit, 415 not JSON,
422 invalid value (including refused code, with the character), 429 rate
limited with `Retry-After`. A retried command ID returns its first result;
the same ID with other content, or on another resource, is 409.

Rules that hold across commands:

- **The server decides.** Membership, role, lease, revision and capacity are
  checked in the transaction; disabled buttons only explain.
- **Commit, then announce.** A change and its scoped events commit together;
  streams hear it only after commit.
- **Seeing is not editing.** Visibility controls reading; roles control
  writing. Friendship opens nothing.
- **Hosting is not owning.** The host controls shared playback, tempo, going
  live and the audience; ownership controls membership and visibility.
- **Credit is stable.** A part is credited to whoever added it; each revision
  records who made it; Restore makes a new revision.
- **Saving is not playing.** A saved change is visible at once and joins the
  shared mix at the first bar at least one second away.

## Who did what: the server log

Every committed change, refused command, first presence in a room, invitation
and moderation writes one JSON line to stdout (`flyctl logs`): `who`
(handle), `visitor` (first 8 of the id), `kind` and the resource. Refusals are
`level: "warn"` with status and reason. Lines are written after commit; they
never carry code, chat text, invitation or link tokens, recovery codes or
cookies. `spec/logging.test.ts` and `spec/durable.test.ts` hold this.

## Live updates

Each event row has a scope; a stream subscribes to exactly one:
`member:<project>`, `view:<project>`, `audience:<performance>` or
`account:<visitor>`. Events are small invalidations `{kind, …}`; pages fetch a
permission-checked snapshot to see content. More than 500 missed events
produce one `reset`. A named `beat` every 5 s lets a page notice a dead
connection within 8 s. A `revoked` event closes a stream whose reader lost
access.

Limits: 96 streams in total, 48 per scope, 3 per person per scope, 32
listeners per performance; a refused page polls every second and says so. A
stream with more than 128 KB unsent is closed. Room and audience pages poll
notifications instead of opening a second stream, so several mixes fit in a
browser's six-connection limit.

## Performance plans, hosting and time

One cycle is one four-beat bar; cycles per second is BPM / 240. A plan holds
the catalog (part → slot → immutable revision), mix, scene assignments,
manual overrides, scene and arrangement. At cycle `c` the plan with the
highest `effectiveCycle ≤ c` applies. Live changes take effect at the first
bar starting at least 1000 ms ahead.

### What a performance publishes

A member's plan holds every clip of every part, because that is the room's
workspace. An audience receives a **published plan** instead
(`publishedPlan` in `shared/performance.ts`): each plan reduced to the
musical revisions that performance can actually reach.

For each part, that is the slot its manual override names, or, with no
override, the slot each **reachable scene** assigns. The reachable scenes are
every scene a running arrangement lists, so a transition always has its music
ahead of time, and otherwise just the current one. A muted part publishes
nothing at all, since unmuting writes a new plan anyway. A part with nothing
selected publishes nothing, which `resolvePlan` already reads as silence.

Everything else stays with the members: a draft saved into another clip slot,
a scene nobody has launched, a part that is muted. Dropping those is safe
because any change that makes one necessary — launching its scene, unmuting
it, starting an arrangement — publishes a new plan carrying it, effective at
the bar that change takes effect. Late joins read the same published plans at
the shared phase, so they hear what everyone else hears.

Source text, revision history, provenance, drafts, members, chat and
invitations are never part of an audience response at all.

### One host

Hosting is a single role: it controls the shared transport and, while a
performance is live, that performance. `setHost` in `src/studio.ts` is the
only thing that moves it, and it moves the transport lease, the performance's
host and its participant roles together, in one transaction. Every path uses
it — passing from the room or the performance page, releasing, claiming, a
member starting a stopped mix, removing the host, and the lapsed-lease sweep.
Transferring preserves musical phase: the epoch and generation do not change.

The host lease lasts 30 s and the room page renews it with its heartbeat.
When it lapses while playing, the server stops the mix and frees the host
role. A live performance left with nobody hosting — the host released the
role, was removed, or their lease lapsed — ends, as a restart ends one,
because there is then nobody accountable for what an audience is hearing.
Ending a performance is host **or owner**: the owner keeps that power over
their own project whoever is hosting.

Edit leases last 30 s and renew every 10 s while a part is open.

A restart ends live performances as `interrupted` (guest parts leave), stops
every mix, releases hosts, keeps the plan that was sounding at the last
durable write and cancels anything queued after it. Saved music, members,
friends, invitations, chat and revisions survive; sound never resumes on its
own.

## Sound

Each browser renders its own audio after a local gesture; the server never
renders or streams sound. `client/audio.ts` queries Strudel patterns at global
cycles and schedules native WebAudio voices about 160 ms ahead. It implements
exactly the grammar's vocabulary: four synthesised drums, four oscillator
waveforms, gain, release, low-pass, stereo pan and a reverb send. Every voice
passes a fixed master gain and a limiter, and device volume only scales
before them. A sound name outside the vocabulary is skipped, never replaced.
Preview plays one part on this device on its own loop and leaves that part's
shared version out while it runs. Skipped late sounds are counted and
reported.

## What is fixed by the course

From `fly.toml` and `spec/invariants.test.ts`:

- one `shared-cpu-1x` machine, 256 MB, one volume at `/data`
- the app serves HTTP on `0.0.0.0:$PORT`; Fly terminates TLS in front of it
- the machine stops when idle and starts on the next request
- `/` answers 200, and `/readme/` carries every `README.md` heading in order
