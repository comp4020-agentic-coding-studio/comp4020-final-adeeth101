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

Everything else in `spec/` is yours to write. Any `spec/*.test.ts` runs with
`pnpm check`, against the same running app. Some lines of a spec only a person
can judge; those are left to the crit and the marker.

At a crit, a green `check` job is half the shipped mark, but it's never the
judgement of the work: your tutor checks what you deployed against the published
spec.

## `contract.test.ts`

Protects the promises in `docs/contract.md` against the running app:

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
