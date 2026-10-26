# Verification record

What has been checked, how, and what was observed. Each entry names the
environment and the exact result; nothing here is an expected outcome.
What has *not* been checked is at the end, and matters just as much.

## 26 October 2026: Ensemble, production build and container

Code: the tree committed with this file. Machine: Windows 11 Pro, Node
24.21.0, pnpm 11.9.0, Playwright 1.64.0 headless Chromium, Docker 29.8.2
(Docker Desktop on WSL 2). The app under test is the image the `Dockerfile`
builds, run with `-m 256m --memory-swap 256m --tmpfs /data`, which is what CI
and Fly run.

| Check | Command | Observed |
| --- | --- | --- |
| Types | `pnpm typecheck` | no errors |
| Client build | `pnpm build` | passes; largest chunk is the audio engine at 212 KB (74 KB gzip), loaded on the first sound gesture |
| Spec against the container | `APP_URL=… CI=true pnpm check` | 21 files, 248 passed, 1 skipped (the README live-edit check, skipped in CI by design) |
| Browser flows against the container | `APP_URL=… pnpm test:browser` | 7 passed |
| Image | `docker build` | 245 MB; `node_modules` in it is Acorn only |
| Container memory | `docker stats` | 33 MB idle, 44 MB after the browser flows, 41 MB under the load probe |
| Graceful stop with six streams open | `docker stop` | exits in 0.48 s |
| Process evidence | `pnpm check:evidence` | passes (file presence and commit citations only) |

### Diagnosis before the rewrite

Run against the Stream release (`70a5a2d`) on a fresh database, with two
isolated browser identities and production assets:

- **A real leak.** A visitor replaying the sketchpad stream
  (`GET /api/events?since=0`) received every project's `project.created` and
  `track.create` events, with project and track ids, because that stream read
  the whole shared event table. Fixed in `347cb96`;
  `spec/legacy-stream.test.ts` is the regression.
- **Open by default.** Every project was listed on the home page and readable,
  exportable and streamable by anyone with the address. This was Stream's
  documented intent (seeing is the link), not a bug, but it is what the
  visibility model replaces; existing projects were migrated to Public so
  nothing silently disappeared.
- **An unattended podium.** With the conductor's page closed, the ensemble
  kept playing and the lease expired without stopping it: observed
  `{status: "playing", conductorId: null}` 31 s after the last renewal.
- **The code view could not hold the presets.** The v1 parser rejected
  `s("hh*8")`, `note("[57,60,64] ~")` and any bass below MIDI 48 — three of
  the four categories the preset catalogue needs.
- **Not reproduced:** no JavaScript error, failed request or silent playback
  failure in the create/join/publish flow. Two identities saw each other's
  changes in 34–366 ms, and both scheduled audio. The reported broken
  collaboration was not a runtime fault in that flow.

### What the browser flows cover

`spec/browser/` runs real HTTP, SSE and production assets at 1920×1080 and
390×844:

- the whole journey in three separate browser contexts: start a mix, add
  presets, invite by link, a second person joins and edits a part's code, chat,
  reopen from Your mixes, go live unlisted, a third person listens and chats,
  end the performance with the project intact
- two people editing one part: the second keeps their draft, is refused, and
  saves it as a new part
- keyboard only at phone size: start, add, open a part, change its level,
  apply, Escape returns focus to the performer; axe reports no WCAG 2 A/AA
  violations (colour contrast included) on the room, Play, Live now or Friends,
  and no sideways scroll
- a browser that refuses audio: the page says so, offers Enable sound, and the
  mix is still saved
- a refused live stream falls back to polling and still saves
- the server is killed mid-edit: the page says so, stops sound, keeps the code
  draft, reconnects, and the same person applies it
- a code draft survives a reload before it is applied

### Migration from Stream data

`spec/migration.test.ts` boots the current server on
`spec/fixtures/stream-v1.db`, a database written by the Stream release through
its own HTTP API. Observed: every row of `visitor`, `trace`, `project`,
`track`, `clip`, `clip_revision`, `scene_assignment` and `legacy_import`
survives byte for byte, including the clip revision that had no stored source
(shown as its printed tree) and the archived track; creators became owners and
track owners members, and nobody else was added; the held conductor lease was
released and the transport stopped; projects became Public with the
owner-visible note. The pre-migration backup beside the database passes
`pragma integrity_check`, holds the original row counts, and boots and
migrates cleanly on its own.

### Audio measurement

`pnpm test:audio` (`scripts/audio-proof.mjs`), two Chromium pages, the second
joining 2.2 s late: the late page scheduled from cycle 2, not cycle 0, and the
shared onsets were scheduled at identical server timestamps (0 ms
disagreement). Both pages ran on one machine with one clock, so this shows they
agree on the schedule; it says nothing about speaker latency or two devices on
a network.

The same script renders every preset offline through the real output chain
(master gain, limiter, ceiling) at full device volume, four bars at its pack
tempo:

| Measure | Observed |
| --- | --- |
| Peak, loudest single preset | −3.5 dBFS |
| RMS across the 24 presets | −35.9 to −18.6 dBFS, median −26.7 |
| Twelve dense parts together | −1.5 dBFS peak, −14.4 dBFS RMS |
| Samples at or above full scale | 0, in every case |

This is gain staging, not a listening verdict: it says nothing about whether
the presets sound good, or good together.

### Load probe

`scripts/load-proof.mjs` against the container: twelve parts at 64 onsets per
bar each (the densest the grammar accepts), 120 BPM.

| Measure | Observed |
| --- | --- |
| View streams | 48 open, 12 refused at the per-scope cap |
| Stream churn | 300 connect/drop cycles in 0.3–0.6 s, all refused once at capacity |
| Audience | 32 admitted, the 33rd refused at the cap |
| `/healthz` under load | 1–2 ms |
| Desktop Chromium | 384 of 384 events/s voiced, none late, slowest pass 19 ms |
| Chromium, 4× CPU throttling | 288 of 384 events/s voiced, about 100/s skipped, and the page said so |
| Typical density (12 Pocket-sized parts, 144 events/s) | all voiced, throttled and not |

The caps are engineering bounds that the probe confirms are *enforced*; they
are not a demonstration that 32 listeners on the Fly machine sound good.

A fault the probe found: when a device falls more than half a bar behind, the
scheduler skips to the next bar, and it used to do so without counting what it
skipped, so the page could report nothing skipped while a bar went missing. It
now counts them, which is why the throttled row above reports about 100/s.

## 14 October 2026: Stream (superseded)

The Stream release was verified in the same way: 115 tests, 6 browser flows,
a 246 MB image, 31–43 MB of memory, and the density bound that limits a clip
to 128 steps per bar (twelve clips at the earlier legal maximum asked for
about 3,070 events/s, and throttled Chromium voiced about 11% of them without
saying so). Those measurements describe code this release replaces; the bound
and the v1 limits it protects are still in force for v1 parts.

## Not yet verified

- **Anyone using it.** No uncoached person has used Ensemble. The 30-second
  first-sound and two-minute first-contribution targets are hypotheses.
- **Whether it sounds good.** Nobody has listened to the 24 presets, alone or
  combined, on real speakers. Levels are measured; taste is not.
- **A real phone.** 4× CPU throttling is a stand-in, not a measurement.
- **Two devices on a network.** Onset disagreement and output latency between
  machines are unmeasured.
- **Anything deployed.** This release has not been deployed: the Fly URL,
  restart after an idle stop, and a next-day return are unchecked.
- **Load with real people.** The caps are enforced, but 32 listeners have
  never actually listened at once.
