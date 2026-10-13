# Verification record

What has been checked, how, and what was observed. Each entry names the
environment and the exact result; nothing here is an expected outcome.

## 14 October 2026: production build and container

Code: the tree committed with this file. Machine: Windows 11 Pro, Node
24.21.0, pnpm 11.9.0, Playwright 1.64.0 headless Chromium, Docker 29.8.2
(Docker Desktop on WSL 2).

| Check | Command | Observed |
| --- | --- | --- |
| Types | `pnpm typecheck` | no errors |
| Client build | `pnpm build` | passes; Blockly chunk 748 KB (203 KB gzip), loaded only by Compose's Blocks view |
| Spec, local server on a fresh database | `APP_URL=… pnpm test` | 14 files, 115 tests passed |
| Browser flows, local | `pnpm test:browser` | 6 passed |
| Image | `docker build` | builds; 246 MB image, `node_modules` in it is Acorn only (632 KB) |
| Spec against the container, 256 MB limit | `CI=true pnpm test` | 114 passed, 1 skipped (the README live-edit spec, skipped in CI by design) |
| Browser flows against the container | `pnpm test:browser` | 6 passed |
| Container memory | `docker stats` | 31 MB idle; 43 MB after the load probe |
| Graceful stop with streams open | `docker stop` | exits in about 0.4–0.5 s |
| Process evidence | `pnpm check:evidence` | passes (file presence and commit citations only) |

The browser flows (`spec/browser/`) run real HTTP, SSE and production
assets:

- three editors on one clip, an unsupported code draft surviving reload, bots
  as drafts, and two identities at 1920×1080 and 390×844 composing, conducting
  and hearing scheduled audio events
- a stale draft resolved by Save as another clip, Keep my draft, and Load saved
  (confirmed, then undone)
- create, edit, rename, form-editor Blocks, apply, claim the podium and launch
  a scene by keyboard alone at 390×844; no sideways scroll; axe reports no
  WCAG 2 A/AA violations on Compose or Perform (colour contrast excluded from
  the automated run, Blockly's canvas excluded)
- local solo leaves the shared mix unchanged
- a third live stream is refused, the page polls and still publishes
- the server is killed mid-edit: the page says Reconnecting, disables Apply,
  keeps the draft, reconnects when the server returns, publishes, and reloads
  as the same owner

`spec/restart.test.ts` kills and restarts a server on a temporary database
mid-performance: the transport is stopped, the podium free, a queued scene
launch cancelled, saved music and source intact, and a second restart records
nothing new.

## Timing and load probes

These print measurements; they do not pass or fail.

`pnpm test:audio`: two Chromium pages, the second joining 2.2 s late. The late
page scheduled from cycle 1, not cycle 0, and both scheduled shared cycles 1,
1.5 and 2 at identical server timestamps (0 ms disagreement). Both pages ran
on one machine with one clock, so this shows they agree on the schedule; it
says nothing about speaker latency or about two devices on a network.

`scripts/load-proof.mjs` against the container: 12 tracks at the worst legal
density (128 steps per bar each), 60 held live streams and 300 connect/drop
cycles.

| Measure | Observed |
| --- | --- |
| Streams | 60 held, 300 churned in about 0.9 s, none refused |
| `/healthz` under load | 2 ms |
| Desktop Chromium, 120 BPM | 768 of 768 events/s voiced, none late, slowest pass 41 ms |
| Desktop Chromium, 180 BPM (local server) | 1,157 events/s voiced, none late |
| Chromium with 4× CPU throttling, 120 BPM | about 370–480 events/s voiced, the rest skipped; the page reported the skipped count |
| Chromium with 4× CPU throttling, typical piece (240 events/s) | all voiced |

Before the 128-steps-per-bar bound, the legal worst case asked for about
3,070 events/s and throttled Chromium voiced about 11% without saying so.

## Not yet verified

- An uncoached person using the studio; the one-minute first-sound target is
  still a hypothesis.
- Listening review of the synthesised drums and mix on real speakers.
- A real phone: CPU throttling is a stand-in, not a measurement.
- Two devices on a real network: onset disagreement and output latency.
- Anything deployed: the Fly URL, restart after idle stop, and next-day return.
