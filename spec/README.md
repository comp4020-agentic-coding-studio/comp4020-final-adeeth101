# The spec

The [final project brief](https://comp.anu.edu.au/courses/comp4020-agentic-coding-studio/assessments/final-project/)
and its spec are on the course website, along with the specs for crits 8, 9 and
10, which run in this repo. The brief poses the problem; the spec is the fixed
contract.

## What ships

`invariants.test.ts` checks the two things the course relies on:

- `/` answers with a 200, which is what the deploy and the crit capture read
- `/readme/` publishes `README.md`. Markdown renderers all differ slightly, so
  it checks the README's headings rather than every word: each one has to
  appear, in order, in the HTML the server sends, since no script runs. Render
  it however you like, as long as it's there in full; the marker reads it there.

Both run against the **running** app over HTTP, so they hold whatever it's built
with. In CI that app is the image your `Dockerfile` builds, started with a
throwaway `/data`, and a red run blocks the deploy. Locally, start the app
however you run it and `pnpm check` finds it at `APP_URL` (default
`http://localhost:8080`). Keep them; don't delete them.

## Your checks

`pattern-editor-view.test.ts` reproduces the four-bar editor dead end with both
drum and note sources, source-preserving 8/16 detail changes, final-bar edits,
undo, shortening and focus. `steps.test.ts` retains the one-bar bound and checks
that an excessive length is refused before changing source.
`browser/creative.pw.ts` repeats the creator recovery journey at both marking
viewports and checks that it produces no page errors or document overflow.

`guest-editor.test.ts`, `chat-blocks.test.ts`, `transport-stop.test.ts` and
`performer.test.ts` cover the remaining review findings and durable Stop/Play.
`browser/corrections.pw.ts` exercises guest code/Shape editing, two guests with
the same name, exact draft recovery through reload and offline/online, conflicts,
ending with a draft, personal live chat filtering and real two-identity leases.
The older two-tab stale-draft flow remains and is named for what it tests.

Everything else in `spec/` is yours to write. Any `spec/*.test.ts` runs with
`pnpm check`, against the same running app. Some lines of a spec only a person
can judge; those are left to the crit and the marker.

At a crit, a green `check` job is half the shipped mark, but it's never the
judgement of the work: your tutor checks what you deployed against the published
spec.

## Ensemble's checks

Against the running app (`APP_URL`), unless noted:

| File | Protects |
| --- | --- |
| `expr.test.ts` | The expression grammar: what it accepts and refuses, exact bounds before expansion, agreement with Strudel 1.2.6's `mini()`, the whole cast, and the first 24 characters pinned byte for byte by `fixtures/catalogue-v1.json` |
| `studio.test.ts` | Rooms: presets, the twelve-part limit, any member editing any part with stable credit, stale revisions, leases, invalid code never saved, verbatim source, idempotency, host-only transport, chat, SSE, export/import |
| `access.test.ts` | The permission matrix over HTML, API, SSE, export, chat, discovery and the legacy routes; public and unlisted reading; streams revoked on removal or going private; roles; eight active editors |
| `social.test.ts` | Friends, blocks, rate limits, generic online status, invitation lifecycle, a six-way race for a one-use link |
| `performances.test.ts` | Going live on the project clock, audience snapshot, listen links, the 32-listener cap, guest performers, moderation, ending |
| `legacy-stream.test.ts` | The diagnosed leak: project events never reach the sketchpad stream |
| `durable.test.ts` | Own server: a restart keeps music, members, chat and identity and ends live sessions; recovery codes; invitation expiry; tokens never logged or stored raw |
| `migration.test.ts` | Own server on `fixtures/stream-v1.db`: every Stream record survives, roles follow authorship, a verified backup restores |
| `restart.test.ts`, `logging.test.ts` | Own server: queued changes cancelled on restart; who did what in the log |
| `music.test.ts`, `pattern.test.ts` | Version 1 trees and the earlier sketchpad's pattern grammar |
| `steps.test.ts` | The step grid: reading changes nothing, an edit touches only what it edits, locked steps survive verbatim, and every one of the 72 characters sounds identical after a forced rewrite, by Strudel's own output |
| `characters.test.ts` | Saved characters: private by default, validated looks and source, revisions, listing as a snapshot, links, copies and tracks that outlive their original, nothing about a mix travelling with one |
| `deletion.test.ts` | Removing tracks, deleting, restoring and purging mixes, leaving, and what each one takes with it |
| `reactions.test.ts` | Reactions reach members as bounded totals, write nothing, respect access, and stop when a performance ends |
| `sections.test.ts` | Who plays where, running and stopping a sequence, host authority, late joiners, and Suggest a build-up |
| `export.test.ts` | What an export renders, its limits and the WAV it writes |
| `migration-characters.test.ts` | Own server on `fixtures/ensemble-v2.db`, written by the previous release over HTTP: every row kept, sounds become characters, verified backup |
| `browser/journey.pw.ts` | The whole creative journey across three browsers and a server restart: create, draw, write music on the grid and in code, save, share, collaborate, resolve a conflict, perform, react, arrange, export real audio, unlist, restart |
| `browser/creative.pw.ts` | Grid and code as one truth, keyboard use, focus through background updates, an export that leaves playback alone, deletion and accessibility of the new surfaces at both viewports |
| `browser/reach.pw.ts` | On a phone: nothing reached by dragging the page or a strip inside it sideways, every step of a bar on screen and editable, every destination a 44×44 button, and the written pages wearing the same clothes as the stage |
| `browser/*.pw.ts` | The whole journey across three browsers at 1920×1080 and 390×844, conflicts, keyboard-only use with axe, refused audio, polling fallback, losing the server |

`helpers.ts` holds the shared HTTP helpers and is not a test.

## `contract.test.ts`

Protects the earlier sketchpad's promises against the running app:

- two cookie jars are two visitors, a visitor keeps their id across requests,
  and a tampered signature is rejected rather than honoured
- `POST /api/act`: JSON in gets JSON out, form-encoded gets a 303 to `/`, and
  an empty, a 281-character, and a non-JSON body are each refused with a 4xx
  and a readable `error` rather than a 500
- `/api/state` marks exactly the caller's own traces `mine`
- `/readme/` reflects an edit to `README.md` without a restart (heading order
  itself stays `invariants.test.ts`'s job)
- `GET /api/act` is 405 with an `Allow` header, an unknown path is 404, and
  `/static/` requests can't escape `public/`
- `/healthz` answers with no cookie required and hands none out
- `GET /api/events` opens an SSE stream and replays what a reconnecting
  `Last-Event-ID` missed
