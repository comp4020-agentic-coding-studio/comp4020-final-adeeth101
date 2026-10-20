# Process overview

Stream is a shared Strudel studio. A piece lives at a link; each person who opens
it owns up to two tracks and writes them as connected blocks, an instrument grid
or code, all over one validated musical model. Perform runs the ensemble on a
shared clock under a leased conductor role. This document explains how I got
from the brief to that, why I chose this stack and this way of working with an
agent, and where the agent's mistakes ended up in the harness.

## From the brief to the app

The brief asked for something multi-user, real-time and good. My answer to
"good" came from using Flok in Sound and Music Computing: a shared text buffer
where anyone could overwrite anything and nobody could tell whose line was
whose. So the two questions I kept returning to were "who may change what" and
"can a newcomer make a sound without learning the language".

The first version (crit 8) stored code as the source of truth and derived a grid
only from patterns the grid understood, with a restart test proving a returning
visitor kept their contribution
([ce24434](https://github.com/comp4020-agentic-coding-studio/comp4020-final-adeeth101/commit/ce24434),
[4e4a6c3](https://github.com/comp4020-agentic-coding-studio/comp4020-final-adeeth101/commit/4e4a6c3)).
For crit 9 I replaced that with "one model, three views": blocks, instruments and
code all edit the same versioned tree, and code is parsed into it rather than
run ([341df24](https://github.com/comp4020-agentic-coding-studio/comp4020-final-adeeth101/commit/341df24),
[27fb6cd](https://github.com/comp4020-agentic-coding-studio/comp4020-final-adeeth101/commit/27fb6cd)).
I also split composing from performing. Saving a clip doesn't put it on stage,
and conducting controls transport and scenes but never grants ownership of
anyone's clips
([578ba1e](https://github.com/comp4020-agentic-coding-studio/comp4020-final-adeeth101/commit/578ba1e)).

For crit 10 the question was whether I could tell people apart from the server
alone. Ownership was already checked on the server, but stdout only said
"listening", so I couldn't narrate a session from `flyctl logs`. Every committed
change, refused command and first arrival in a piece now logs the person's
handle, short id, the action and, for a track, its name and owner
([cf626ea](https://github.com/comp4020-agentic-coding-studio/comp4020-final-adeeth101/commit/cf626ea)).
The decision about who may see and change what is written in `docs/contract.md`
with its reasons.

## Why this stack

The app is Node's built-in HTTP server, Node's built-in SQLite on the Fly
volume, server-sent events for live updates, and Vite bundling Blockly, Strudel
and the client. There is no web framework and no database server.

- **One machine, 256 MB, one volume.** SQLite in-process fits that exactly: no
  second service to run, and a transaction is the unit that keeps a change and
  its announcing event together. The cost is a single writer and no horizontal
  scaling, which a room of twelve people doesn't need. Load measurements kept
  the server under 40 MB with sixty live streams
  ([9d5f553](https://github.com/comp4020-agentic-coding-studio/comp4020-final-adeeth101/commit/9d5f553)).
- **SSE over WebSockets.** Changes go up as ordinary POST commands with
  ownership and revision checks, and come down as small invalidations that tell
  the page to refetch. SSE replays from `Last-Event-ID` after a reconnect, gets
  through Fly's proxy without configuration, and doesn't need a second protocol
  for writes. The cost is a refetch per change, which is cheap at this scale.
- **No framework.** The routing table is one file and each handler lives in its
  own module, so parallel agent branches rarely touched the same file. The cost
  is hand-written HTML strings, where every interpolated value has to be
  escaped by hand.
- **Parse, don't evaluate.** Strudel normally runs code as JavaScript. Running
  someone else's code in my browser, on a page that can act for me, is not
  acceptable, so Acorn parses submitted code into a closed grammar on both
  client and server. The cost is a smaller musical vocabulary, and anything
  outside it stays a local draft.

The rejected options: a hosted real-time backend would have hidden the
ownership rules in someone else's permission language; Postgres would have
been a second machine for no benefit.

## How I worked with the agent

I used Claude Code throughout, with `CLAUDE.md` as the standing rules and
`docs/contract.md` and `docs/architecture.md` as the references it must read.
Larger features ran on separate branches in parallel (live updates, audio,
drafts) and were merged back once their tests passed
([4a406d8](https://github.com/comp4020-agentic-coding-studio/comp4020-final-adeeth101/commit/4a406d8),
[03c5e2f](https://github.com/comp4020-agentic-coding-studio/comp4020-final-adeeth101/commit/03c5e2f)).
After each feature I ran a review pass and treated its findings as bugs to
reproduce first, not suggestions. I asked for measurement before limits: the
128-steps-per-bar bound exists because a load probe showed a throttled browser
silently dropping 89% of events, not because it seemed a reasonable number.

The trade-off is volume. Forty-nine commits landed in one day before crit 9, and
reviewing that much agent output carefully is the real cost of this workflow.
The spec is what made it survivable: 116 checks run against the running app on
every push, and CI deploys only the container those checks passed against
([e02edea](https://github.com/comp4020-agentic-coding-studio/comp4020-final-adeeth101/commit/e02edea)).

## Corrections that landed in the harness

- The agent wrote a change and its event as two statements, so a failure
  between them could leave a change nobody's page heard about
  ([2be50bc](https://github.com/comp4020-agentic-coding-studio/comp4020-final-adeeth101/commit/2be50bc)).
  This became the `CLAUDE.md` rule "a database mutation and its event commit
  together; broadcast only after commit"
  ([e2fbe48](https://github.com/comp4020-agentic-coding-studio/comp4020-final-adeeth101/commit/e2fbe48)),
  and the contract tests check that a refused edit leaves no event.
- An "also play other people's code" checkbox trusted every later edit to a
  track forever
  ([6058634](https://github.com/comp4020-agentic-coding-studio/comp4020-final-adeeth101/commit/6058634)).
  It became "never execute submitted source text", and a spec test sends
  `fetch(...)` as code and expects a refusal.
- The transport claimed "Playing" while nothing played, because Strudel
  resolves `evaluate()` even on error
  ([2611e3b](https://github.com/comp4020-agentic-coding-studio/comp4020-final-adeeth101/commit/2611e3b)).
  The fix was checked against the real library, not a stub.
- Ownership was checked only once a track existed, so one visitor could claim
  another's reserved track
  ([f5c1a34](https://github.com/comp4020-agentic-coding-studio/comp4020-final-adeeth101/commit/f5c1a34)).
  Track ownership and revision checks on the server became an invariant.
- Logging who did what is now a `CLAUDE.md` rule, and `spec/logging.test.ts`
  boots a server and fails if a change or refusal doesn't name the visitor.

## What is still open

A phone-size keyboard browser test fails intermittently when run after the
conflict test; I narrowed the race but haven't closed it
([fc494fb](https://github.com/comp4020-agentic-coding-studio/comp4020-final-adeeth101/commit/fc494fb)).
The "audible in a minute" claim is still judged by watching people, not
tested, and two devices sounding in time is measured as scheduled timestamps,
not by ear.
