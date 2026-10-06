# The contract

Everything in `src/` is split so that one concern lives in one file. That is
what lets several people work at once: the boundaries below are the agreement,
and the point of writing them down is that nobody has to read another file to
know what their own is allowed to assume.

If a change needs a new route or a new column, that is a change to this
document first.

## Modules, and who may edit what

| File | Holds | May be edited by |
| --- | --- | --- |
| `src/server.ts` | the routing table and nothing else | whoever adds a route |
| `src/db.ts` | the SQLite connection, migrations, `setting()` | whoever adds a migration |
| `src/identity.ts` | who a visitor is, and the cookie | identity work |
| `src/events.ts` | the event log and the SSE fan-out | real-time work |
| `src/markdown.ts` | markdown to HTML for `/readme/` | the README route |
| `src/feature.ts` | **the concept**: shared state and its rules | the concept |
| `src/page.ts` | server-rendered HTML | the interface |
| `public/style.css`, `public/app.js` | styling, and enhancement only | the interface |
| `spec/*.test.ts` | one file per promise being protected | whoever makes the promise |

`src/feature.ts` is the only file the concept needs. Nothing else in `src/`
knows what the app is about, which is deliberate: the idea can change without
the plumbing changing.

## Storage

One SQLite database on the volume Fly mounts at `/data` — the only storage that
outlives a restart or a redeploy. There is no database server in the course
setup. Locally the same code uses `.data/`, so no environment variable is
needed to run it.

```
visitor   id, handle, created_at, last_seen_at
trace     id, visitor_id, slot, body, created_at, updated_at
event     id, visitor_id, kind, payload, created_at      -- append only
setting   key, value                                     -- survives a redeploy
```

`trace.slot` is how a concept addresses a unit of shared state: a track name, a
position in a chain, the id of a line. `trace.body` is its payload, text or
JSON. Keeping both generic is what let the plumbing be built and deployed
before the concept was settled.

Migrations in `src/db.ts` are **append-only**. Add a new statement; never edit a
shipped one, or a redeploy meets a volume it cannot read.

Nothing updates or deletes a row in `event`. Week 10's real-time replays from
it and week 11's instruments read it, so a gap in it is a gap in both.

## HTTP

| Route | Does |
| --- | --- |
| `GET /` | the whole page, server-rendered |
| `GET /readme/` | `README.md` rendered to HTML; read per request, never cached |
| `GET /healthz` | `{ok:true}`, touching neither database nor cookie |
| `GET /static/*` | files from `public/` |
| `GET /api/me` | `{id, handle, fresh}` |
| `GET /api/state` | the `State` in `src/feature.ts` |
| `POST /api/act` | the core action: `{slot, body}` sets a track's code; `{slot, step, sound?}` sets or cycles one grid step |
| `POST /api/handle` | `{handle}`; a form post gets a 303, like `/api/act` |
| `GET /api/events` | SSE from `?since=` or `Last-Event-ID`; replays the whole backlog after it, then stays open |

**Who a visitor is.** Every response to a new browser sets a signed `visitor`
cookie, but nothing is written until that visitor first writes something
(`POST /api/act` or `/api/handle`). Before then they are real enough to be
shown a stable handle, derived from their id, and the state as everyone else
sees it, with nothing marked `mine`. A request with no cookie is simply that: a
new visitor who hasn't written anything yet. So `GET /api/state` without a
cookie answers 200 with the shared state, rather than refusing. Crawlers and
uptime checks never send the cookie back; creating a row for each of them
would fill the table with people who were never there.

Three rules hold across all of them:

- **`POST /api/act` answers a form post with a 303 to `/`, and a fetch with
  JSON.** The page works with no JavaScript at all, and `public/app.js` only
  avoids the reload. A change that breaks the plain form post breaks the app on
  a slow or hostile connection, which is the band the brief calls "use it
  wasn't designed for".
- **Looking writes nothing.** Only a write creates a visitor row or appends to
  the event log. `spec/persistence.test.ts` holds this.
- **A refused action is not an error.** `act()` returns `{ok:false, error,
  status}` and the person is shown `error`. The rule a concept enforces is
  refused here, in one place, and shown rather than swallowed.

The identity cookie is `HttpOnly`, and `Secure` behind HTTPS: the signed value
is the visitor's identity, and no script on the page needs it.

## Tracks

- **One track per visitor, owned from its first write.** The server derives a
  visitor's track from their id (`trackOf()` in `src/identity.ts`). That is the
  only track they may start; a track they already own under another name stays
  theirs. Writing to someone else's track, or starting one that isn't yours, is
  a 403 — including a track whose owner hasn't written yet.
- **The code string is the only copy.** `steps` is derived from `body` on every
  read and never stored, so the grid and the code cannot disagree.
- **The grid edits only what it can read exactly:** one `s("...")` of plain
  sound names and `~`, at most 32 steps. Anything else is hand-written code. It
  is kept as written, shown without a grid, and a grid press on it is a 409 —
  the grid never overwrites code it only half understands.
- **A trace with no slot is a note**, from before the instrument. Notes are kept
  and shown, but not counted, not called code and never played.

## Sound

Evaluated only in the listener's browser, never on the server, with
`@strudel/web` pinned and fetched only when someone presses Play. What plays:
every grid-shaped track in the room — its code can only be `s("...")` of plain
names, so it can do nothing but make sound — and your own code. Other people's
hand-written code is not played, because Strudel runs it as JavaScript in your
page. Opening that up needs a real boundary (per-revision consent, or proper
isolation), which is a design of its own.

## What is fixed by the course

From `fly.toml` and `spec/invariants.test.ts`, none of it ours to change:

- one `shared-cpu-1x` machine, 256 MB, one volume at `/data`
- the app serves HTTP on `0.0.0.0:$PORT`; Fly terminates TLS in front of it
- the machine **stops when idle and starts on the next request**, so a restart
  is routine. Nothing may live only in memory
- `/` answers 200, and `/readme/` carries every `README.md` heading, in order,
  in the HTML body — no script runs when the marker reads it

## Running it

```
pnpm dev        # with a reload, on 8080, database in .data/
pnpm start      # as the container runs it
pnpm check      # typecheck, then every spec against a running app
```

`pnpm check` expects the app at `APP_URL` (default `http://localhost:8080`).
`spec/persistence.test.ts` is the exception: it starts and kills its own server
on a spare port, because the only way to test a restart is to perform one.

To run a second copy alongside the first, give it its own `PORT`, `APP_URL`
and `DB_PATH`, so two checks never fight over a port or a database.
