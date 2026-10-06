# A shared Strudel space

A multi-user [Strudel](https://strudel.cc/) environment that is both a visual
step sequencer and a raw live-coding text editor over one shared state.
Visitors share a space; each one gets a track. The server synchronises and
persists that shared state and never touches audio — each browser evaluates
the pattern locally with the Strudel REPL. The grid is a view over a canonical
pattern shape; code outside that shape stays text-only rather than being
rewritten by a grid that only half-understands it.

## What good means for this app

> Good means democratising algorithmic music by offering a spectrum of
> abstraction. It removes the barrier to entry by letting beginners contribute
> through a tactile UI, while letting experts live-code text in the same shared
> space.

That is the starting position. The evidence behind it — what live-coding tools
like TidalCycles, Strudel, Flok, Gibber and Estuary decide about who may edit
what, and what visual-versus-textual tools from trackers to Max/MSP to Sonic
Pi decide about the floor and ceiling of a music tool — is in
[`docs/research.md`](docs/research.md).

**TODO (student): sharpen this in your own words.** Say what "good" means
*for this specific app*, not just for the genre — what trade-off you actually
made between the grid and the text editor, what you'd point to as evidence it
worked, and where you expect it to fall short.

## Running it

```
set -a; . ./.env.stream; set +a
mise exec -- pnpm dev       # with a reload, on 8080, database in .data/
mise exec -- pnpm start     # as the container runs it
mise exec -- pnpm check     # typecheck, then every spec against a running app
```

`pnpm check` expects the app already running at `APP_URL` (default
`http://localhost:8080`).

## Architecture

Node's built-in HTTP server and SQLite, no runtime dependencies and no build
step, on one 256 MB Fly machine with a single volume at `/data`. The full
module boundaries and HTTP contract are written down in
[`docs/contract.md`](docs/contract.md); in short:

- `src/feature.ts` holds the concept — shared state and its rules — and is the
  only file in `src/` that knows what the app is about.
- `src/server.ts` is the routing table; `src/db.ts` is the SQLite connection
  and migrations; `src/identity.ts` is who a visitor is; `src/events.ts` is
  the event log and SSE fan-out; `src/page.ts` is the server-rendered HTML;
  `src/markdown.ts` renders this file at `/readme/`.
- One SQLite database on the volume Fly mounts at `/data`; locally the same
  code uses `.data/`.
- `POST /api/act` answers a form post with a 303 redirect and a fetch with
  JSON, so the page works with no JavaScript at all.
- A refused action is not an error: `act()` returns `{ok:false, error,
  status}` and the error is shown, not swallowed.

## Constraints the course fixes

From `fly.toml` and `spec/invariants.test.ts` — none of this is ours to
change:

- One `shared-cpu-1x` machine, 256 MB RAM, one volume at `/data`.
- The app serves HTTP on `0.0.0.0:$PORT`; Fly terminates TLS in front of it.
- The machine stops when idle and starts on the next request, so a restart is
  routine — nothing may live only in memory.
- `/` answers 200, and `/readme/` carries every heading from this file, in
  order, in the rendered HTML — no script runs when the marker reads it.
