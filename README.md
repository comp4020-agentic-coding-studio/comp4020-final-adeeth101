# Ensemble · make a mix with friends

A collaborative, editable take on [Incredibox](https://www.incredibox.com/)
built on [Strudel](https://strudel.cc/). Start a mix, give sounds to a band of
performers, invite friends to change them with you, and go live.

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
only members can change a mix, each part keeps who added and who edited it,
and a private mix is invisible to anyone else; code is parsed, never executed;
a stale edit is refused and the draft kept; mixes survive restarts; an audience
listens but never edits; every change and refusal is logged with who made it;
controls work by keyboard at phone size.

**Judged**, not tested: whether a newcomer actually gets sound in a minute,
whether the views feel like one instrument, and whether two devices sound in
time to a listener. I judged these by watching classmates use the deployed URL
at the crits. [Verification](docs/verification.md) records what was checked,
how and when.

## What I chose not to build

- **Accounts.** A signed cookie and a generated handle are enough to tell people
  apart in one room. Passwords would only slow the first minute.
- **One shared text buffer.** Anyone may change any part, but each is edited
  on its own under a lease and a revision check, so two people never collide.
- **Running submitted code.** Code is parsed into a bounded expression; the
  rest stays a draft.
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
