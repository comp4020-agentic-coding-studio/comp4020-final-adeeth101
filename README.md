# Stream · a shared Strudel studio

A multi-user [Strudel](https://strudel.cc/) studio. Create a piece, share its
link, and each person adds up to two tracks of drums or melody, written as
connected blocks, an instrument grid or code over one shared musical model.
Perform launches scenes, mixes and conducts.

## What good means for this app

Good here means people with very different amounts of musical and programming
experience can contribute to the same piece. Someone can start at a step
sequencer, see the code their pattern makes, and move to text when they want
more control.

My spin is a live GUI for Strudel,
where the visual views and the code are the same pattern rather than copies that
drift apart. I used Flok in Sound and Music Computing and found the shared
buffer frustrating: anyone could overwrite anything, and nobody could tell whose
line was whose. That is what I'm trying to do better.

A common ground needs boundaries. The grid understands a limited shape of
pattern, so code it can't represent stays text-only and is never silently
rewritten.

I judge the app on three questions:

- Can a newcomer make an audible contribution without learning the language?
- Is there room for an experienced user to go past the grid?
- Can everyone tell whose contribution belongs to whom?

## How good is checked

**Enforced** by `spec/` against the running app: two browsers are two people;
only a track's owner can change it, and conducting never grants ownership;
submitted code is parsed, never executed; a stale edit is refused and the draft
kept; pieces survive restarts; every change and every refusal is logged
server-side with who made it; core controls work by keyboard at phone width.

**Judged**, not tested: whether a newcomer actually gets sound in a minute,
whether the views feel like one instrument, and whether two devices sound in
time to a listener. I judged these by watching classmates use the deployed URL
at the crits. [Verification](docs/verification.md) records what was checked,
how and when.

## What I chose not to build

- **Accounts.** A signed cookie and a generated handle are enough to tell people
  apart in one room. Passwords would only slow the first minute.
- **One shared text buffer.** Each person owns their tracks instead, so
  simultaneous edits don't collide inside someone else's line.
- **Running submitted code.** Code is parsed into a bounded tree; anything
  outside it stays a local draft.
- **Server-side or sample-accurate network audio.** Browsers schedule against a
  shared clock; I don't claim more than that.

## Sources

The full notes are in [research](docs/research.md). The main influences:
[TidalCycles](https://tidalcycles.org/) and [Strudel](https://strudel.cc/) for
patterns as functions of time; [Flok](https://flok.cc/),
[Gibber](https://gibber.cc/) and [Estuary](https://estuary.mcmaster.ca/) for
how shared live coding decides who edits what; trackers, Max/MSP and
[Sonic Pi](https://sonic-pi.net/) for visual and text routes into the same
music; Resnick and Silverman's
["Some reflections on designing construction kits for kids"](https://www.researchgate.net/publication/247589124_Some_reflections_on_designing_construction_kits_for_kids)
(2005) for low floors and wide walls; and the
[IndieWeb](https://en.wikipedia.org/wiki/IndieWeb) for running it as one small
process on one small machine.

## Running it

```
mise exec -- pnpm dev           # build, then serve on 8080 with data in .data/
mise exec -- pnpm check         # typecheck and every spec against a running app
mise exec -- pnpm test:browser  # browser flows (APP_URL, default :8180)
```

Node's HTTP server and SQLite run on one 256 MB Fly machine with a volume at
`/data`. The [contract](docs/contract.md) covers routes, commands and limits;
[architecture](docs/architecture.md) covers the trade-offs.

## Source and licence

[Application source](https://github.com/comp4020-agentic-coding-studio/comp4020-final-Adeeth101)
is provided under AGPL-3.0-or-later. See [dependency and audio notices](THIRD_PARTY.md).
