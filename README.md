# Stream · a shared Strudel studio

A multi-user [Strudel](https://strudel.cc/) studio with connected musical
blocks, instrument grids and editable code over one shared musical model.
Create a piece, add drums or melody, and share its link. Each participant
owns up to two tracks. Apply a draft to publish it; switch to Perform to
launch scenes, mix tracks and conduct an arrangement. Each browser makes
its own sound after the listener enables audio.

## What good means for this app

A great deal of my effort has been spent making sure that people with differing degrees of musical and programming experience have the ability to contribute to the development of the same piece. Some users will begin at a step sequencer level, see the code represented by their pattern, and then progress to text editing once they desire more creative control over their piece.

I know that a collaborative music sequencer is not a new idea (and I bet at least a few students are doing something similar), but I think it is something students will want to use. My spin on it is to make a live GUI for Strudel, where people can interact visually with the same patterns they can edit as code. This is something I have wanted to build since taking Sound and Music Computing. I remember using Flok in that course and finding the experience terrible and I just knew we could do better. That experience is part of my motivation to make collaborative live coding more approachable.

There is a common ground here (the grid and the editor) where the grid and the editor are operating on one and the same underlying pattern, instead of having each of these maintain their own separate versions of the pattern that may be out of sync. To ensure that there is a common ground here, there must be boundaries — specifically, the grid only understands a limited shape for patterns. As such, more complex code will need to be maintained as text-only and not reduced or silently modified.

To evaluate if this product is "good", I will consider three things:

- Can a newcomer create an audible contribution to the piece without having to learn the language?
- Is there sufficient room for an experienced user to expand beyond the limits of the grid?
- Do all users (newcomers and experienced users) clearly know whose contribution belongs to whom?

These are objectives to test with people, not end-states defined by the current validation processes.

Research leading up to this design considered existing live coding environments and the relationship between accessible entryways and opportunities for more expressive use. My objective is to combine those attributes in a shared space without requiring all users to interact through the same interface.

The implementation uses [Blockly's connected blocks](https://docs.blockly.com/guides/get-started/what-is-blockly/)
and [Strudel's pattern model](https://strudel.cc/technical-manual/repl/).
Further comparisons are collected in [research](docs/research.md).

## Current state

Built: persistent pieces shared by link, up to two owned tracks per person and
twelve per piece, four clips per track, and three views of each clip (Blocks
with a keyboard form editor, Instruments, Code). Rhythm and melody helpers
propose reproducible drafts that stay manual. The Perform page has a leased
conductor role, four scenes, a mixer with manual overrides and local solo, and
an eight-entry arranger. Conflicting edits, lost connections and restarts keep
drafts and say what happened.

Checked by automated tests in a production build and container: see
[verification](docs/verification.md). Not yet done: an uncoached evaluation
with people, listening review on real devices, a phone-hardware measurement,
and anything on a deployed URL. The objectives above remain to be tested.

## Supported musical scope

Shared clips support plain sound/note sequences, parallel patterns, speed,
reverse, gain, filter and reverb, up to 128 steps per bar per clip (a limit
set by measuring the browser scheduler). Code is parsed into a bounded tree,
never executed as JavaScript. Unsupported source stays a local draft with a clear
error and copy/export options. See [the contract](docs/contract.md) for limits.
Drums are synthesised locally; exported Strudel can sound different with
another sample bank. Sound stops on a disconnected device or server restart.

## Running it

```
mise exec -- pnpm dev       # with a reload, on 8080, database in .data/
mise exec -- pnpm build     # bundle the browser editors and audio
mise exec -- pnpm start     # as the container runs it
mise exec -- pnpm check     # typecheck, then every spec against a running app
mise exec -- pnpm test:browser # production browser flows; install Chromium first
```

`pnpm check` expects the app already running at `APP_URL` (default
`http://localhost:8080`). To check the image CI deploys:

```
docker build -t stream .
docker run --rm -d --init -p 8080:8080 --tmpfs /data -m 256m stream
CI=true pnpm check && pnpm test:browser
```

`CI=true` skips the one spec that edits `README.md` on disk, which a container
cannot see. `pnpm test:audio` runs the two-browser timing probe and
`node scripts/load-proof.mjs` the twelve-track load probe; both print
measurements rather than pass or fail.

## Architecture

Node's HTTP server and SQLite run on one 256 MB Fly machine with a volume at
`/data`. Vite bundles the browser UI; Acorn validates supported code on both
client and server. [The contract](docs/contract.md) describes the architecture:

- `shared/` holds the musical model, code mapping, generators and scene resolver.
- `src/studio.ts` owns projects, revisions, commands and live events.
- `client/` provides editing views and the shared-clock WebAudio output.
- [Architecture decisions](docs/architecture.md) records the trade-offs and
  [verification](docs/verification.md) what was checked, how and when.
- `src/server.ts` is the routing table; `src/db.ts` is the SQLite connection
  and migrations; `src/identity.ts` is who a visitor is; `src/events.ts` is
  the event log and SSE fan-out; `src/page.ts` is the server-rendered HTML;
  `src/markdown.ts` renders this file at `/readme/`.
- One SQLite database on the volume Fly mounts at `/data`; locally the same
  code uses `.data/`.
- Earlier sketches remain at `/legacy`; the interactive studio needs JavaScript.
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

## Source and licence

[Application source](https://github.com/comp4020-agentic-coding-studio/comp4020-final-Adeeth101)
is provided under AGPL-3.0-or-later. See [dependency and audio notices](THIRD_PARTY.md).
