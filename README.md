# A shared Strudel space

A multi-user [Strudel](https://strudel.cc/) environment that is both a visual
step sequencer and a raw live-coding text editor over one shared state.
Visitors share a space; each one gets a track. The server synchronises and
persists that shared state and never touches audio — each browser evaluates
the pattern locally with the Strudel REPL. The grid is a view over a canonical
pattern shape; code outside that shape stays text-only rather than being
rewritten by a grid that only half-understands it.

## What good means for this app

A great deal of my effort has been spent making sure that people with differing degrees of musical and programming experience have the ability to contribute to the development of the same piece. Some users will begin at a step sequencer level, see the code represented by their pattern, and then progress to text editing once they desire more creative control over their piece.

I know that a collaborative music sequencer is not a new idea (and I bet at least a few students are doing something similar), but I think it is something students will want to use. My spin on it is to make a live GUI for Strudel, where people can interact visually with the same patterns they can edit as code. This is something I have wanted to build since taking Sound and Music Computing. I remember using Flok in that course and finding the experience terrible and I just knew we could do better. That experience is part of my motivation to make collaborative live coding more approachable.

There is a common ground here (the grid and the editor) where the grid and the editor are operating on one and the same underlying pattern, instead of having each of these maintain their own separate versions of the pattern that may be out of sync. To ensure that there is a common ground here, there must be boundaries — specifically, the grid only understands a limited shape for patterns. As such, more complex code will need to be maintained as text-only and not reduced or silently modified.

To evaluate if this product is "good", I will consider three things:

- Can a newcomer create an audible contribution to the piece without having to learn the language?
- Is there sufficient room for an experienced user to expand beyond the limits of the grid?
- Do all users (newcomers and experienced users) clearly know whose contribution belongs to whom?

These are objectives to test with people, not end-states defined by the current validation processes.

Version One: Establishing Visitor Identity, Contributions, and Grid/Code Mapping
Version One provides visitors with persistent identity and contributions as well as a mapping between the grid and code. Currently, the visible interface allows for text contributions, but other interfaces (sequencer controls and Strudel playback) are still being developed. Version One illustrates the foundation for persistent data and states the intent for establishing that the musical experience aligns with this definition of good.

Research leading up to this design considered existing live coding environments and the relationship between accessible entryways and opportunities for more expressive use. My objective is to combine those attributes in a shared space without requiring all users to interact through the same interface.

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
