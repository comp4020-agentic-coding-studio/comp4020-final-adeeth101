# Verification record

## 7 November 2026: characters, the step grid and the Main Stage

### Baseline

Before any change, at `4d5f380`, on production assets and an isolated database:
`pnpm check` 274 tests in 28 files passed, `pnpm test:browser` 15 of 15 passed, and
`pnpm check:evidence` passed.

### Checks

| Check | Result |
| --- | --- |
| `pnpm check` | 510 tests in 35 files passed |
| `pnpm test:browser` | 35 flows passed, at 1920×1080 and 390×844 where they matter |
| `pnpm check:evidence` | Passed |
| The 14-step journey, repeated | 5 of 5 after the fix described below |
| Migration 3 | Against a database written by the previous release over HTTP: every project, track, clip, revision, member, chat, visitor, invitation, performance and saved-sound row identical; the backup verified; a second boot changes nothing |

The 15 flows from before this work still pass. Six things in them changed, all
because wording was meant to change: `Add your first performer`, `Add a performer`,
`Close the sound tray`, `Save as new part` and the conflict text are now
`…character`, `…character`, `Close the cast`, `Save as new track` and `…this track`,
and two assertions in `spec/studio.test.ts` moved from `12 parts` and `editing this
part` to the new words. What each one asserts is the same. In `spec/expr.test.ts` the
fixed count of 24 presets became a stricter check that the first 24 match a frozen
fixture byte for byte, and `spec/migration.test.ts` expects migration 3 as the latest.

### What the journey covers

`spec/browser/journey.pw.ts` runs three separate browser contexts against a server
of its own: create a character from nothing; design it, confirming each choice
changes the drawing; write a melody on the grid; read and edit the same music as
Strudel, and see it on the grid; save, reload and reopen; share an unlisted link to a
second identity, who previews it and saves a credited copy; bring both copies into
one mix; make a stale grid draft in a second tab, have it refused and recover it;
perform to a third identity; see that identity's reactions on the host's and a
collaborator's stage; set who plays in a section and run a sequence, which reaches
the audience; export a WAV and read its header and level; stop sharing and delete the
original while the copy survives; then kill the server and find everything saved but
the music stopped.

### Faults found while building this

- **Offline renders were contaminated, and the table below was wrong.** The old
  `renderOffline` borrowed the live engine by swapping its context, and the live test
  loop kept scheduling into it, so kicks leaked into every render. An A/B against the
  old build showed peaks up to 18.9 dB too high and one preset's RMS 14 dB too high: a
  soft triangle bass reported the kick's −3.5 dBFS. Renders now have their own engine.
  The 26 October figures below are kept as written, and these replace them.
- **The densest mix touched full scale.** The twelve busiest characters reached
  +0.1 dBFS with 2 clipped samples, because the limiter's 3 ms attack lets the fastest
  peaks through. A safety curve, exactly linear below 0.85, now holds it at −0.4 dBFS.
  Everything else measured sits below the curve and is unchanged.
- **A command could read the state from before itself.** Found only on the deployed
  site: going live reopened the Go live form, although the performance had started.
  A refresh overtaken by a newer one returned early, so `await refresh()` could finish
  with nothing applied, and on a real network the stream's update is often that newer
  one. This predates this work and never showed on localhost. An overtaken refresh now
  waits for the newest, and a browser flow with slowed snapshots fails without the fix.
- **A background update could take focus from Apply.** Found by a failed CI run of the
  keyboard flow, which had passed twice before. A control with no id was not found
  again after a redraw, so focus fell to the page and Enter did nothing. Reproduced
  deterministically, then fixed for every control in an open panel.
- **A blank drum character lost its rows.** Placing the first kick removed the snare,
  hat and clap rows, because they were offered only while the kit was empty. Found by
  a browser flow.
- **`id: 0` reset reconnects.** Ephemeral broadcasts carried `id: 0`, which reset a
  browser's `Last-Event-ID`, so a reconnect replayed nothing. This predates this work.
- **Members were not told why a deleted mix went.** Streams were closed before the
  event reached them. The event now goes first.
- **Saving could open the wrong draft.** An abandoned blank character would have
  reappeared when opening a remix. Drafts are now kept per starting point.
- A parse fault in the step grid (`[a b]` read as two slots) and a false "Saved." on a
  fresh remix were found by inspection, and the phone creator's overflow, low-contrast
  credits and a clipped kit label from looking at screenshots.
- The journey failed in two of its first six runs. It was the test's own race, reading the debug
  probe before calibration finished, which `recovery.pw.ts` already allows for. The
  product was not at fault.

### Audio measurement

`pnpm test:audio`, through the real output chain at full device level, in isolated
renders. Automated measurements only: **nobody has listened to these.**

| Measure | Observed |
| --- | --- |
| The 72 characters alone | Peak −24.2 to −3.5 dBFS, RMS −51.3 to −18.6, median −29.0, no clipped samples |
| Each pack, all eight at once (9 mixes) | Peak −3.6 to −2.4 dBFS, RMS −21.0 to −14.4, no clipped samples |
| Busiest bar of a pack | 19 to 90 sounds |
| Twelve dense characters from the first three packs | −1.5 dBFS peak, −14.4 RMS, none clipped |
| The twelve busiest in the catalogue | −0.4 dBFS peak, −17.3 RMS, none clipped, 208 sounds in the busiest bar |
| Late join | Scheduled from cycle 2; 0 ms disagreement on shared onsets, on one machine |

The sparsest textures read low on RMS because they are mostly silence. `night-ticks`
is the quietest of the original 24 at −50.3, and it stays as it was, because a shipped
character is not rewritten.

Every character is also checked against Strudel's own output after a forced rewrite
of every step: onsets, notes, lengths and gains are identical over 16 bars. Drum
lengths are excluded, because a drum's length comes from its sound, not its step.

### Resource probe

The production image at `--memory=256m`, with 40 visitors saving and listing 200
characters, then `scripts/load-proof.mjs`:

| Measure | Observed |
| --- | --- |
| Image | 246 MB, unchanged |
| Memory | 34 MiB idle, 43.7 MiB peak |
| Saving and listing 200 characters | 0.6 s; library search median 2 ms, worst 4 ms |
| Streams | 48 open, 12 refused at the cap; 300 connect/drop cycles in 353 ms |
| Audience | 32 admitted, the 33rd refused |
| `/healthz` under load | 1 ms |
| Chromium at 12 × 64 onsets a bar | 384 of 384 events/s voiced, at 1× and at 4× CPU throttling; slowest pass 10 ms and 151 ms |

This shows the caps hold and the machine has room. It does not show that 32 people on
the Fly machine have a good time.

### On the deployed site

At `93e9aa6`, on the Fly machine, in real Chromium with three separate identities at
1920×1080 and 390×844, using a private mix, an unlisted performance and an unlisted
character. A person made a character on the grid, saved and reloaded it, and shared
it by link; a second identity saved a credited copy and joined by invitation; both
characters reached the same stage; going live unlisted reached a third identity, who
got 404 for the project; that identity's reactions appeared on the host's and the
collaborator's stages; Suggest a build-up and Run sequence reached the audience; a real
WAV downloaded (1,171 KB, peak 0.646); and the performance ended. No page errors.

| Measure | Observed |
| --- | --- |
| One person's change until another browser shows it | Median 1,050 ms, worst 1,522 ms, over 7 samples, including the request itself |
| Round trip to the machine from where this was run | About 470 ms, with `/healthz` doing 1 ms of work |

That latency is about two and a quarter round trips: the request, the stream's push and
the snapshot it prompts. This run reached Fly at San Jose and crossed to Sydney, so the
figure says more about that path than about the app. From Canberra the round trip
should be far shorter, but that has not been measured, and it is the number the "about
a second" requirement cares about.

An earlier run of this check is what found the overtaken-refresh fault above, and a
crash in that run left one private mix and one unlisted character on the live database
whose owner identity was not saved. Neither can be found or read by anyone.

### Design directions

See [the design record](design/README.md). Frame rate did not separate the three
directions, so the choice was a judgement. The finished interface was inspected in
real screenshots at both viewports, including a full stage of twelve. Automated axe
checks found no WCAG 2 A/AA violation on the stage, cast, sections, export, settings,
step grid, creator or Characters pages at both viewports. That is not the same as
having been tried by a person using a screen reader.

## 28 October 2026: deployed three-profile check

Release `7f66d94` passed [GitHub checks and deployment](https://github.com/comp4020-agentic-coding-studio/comp4020-final-adeeth101/actions/runs/40541854705).
Fly's machine metadata confirmed that exact commit on one 256 MB machine.
A browser smoke check against the public URL then passed with three fresh
profiles, a private project and an unlisted performance. The project was
created before rollout: both identities and the second member's exact saved
code survived deployment. The third profile listened and chatted, was refused
project access (404), then became a guest and edited its own code. Stop/Play
retained the plan, ending the performance retained the project, and no page
JavaScript errors occurred. The private rehearsal was stopped and ended;
no public performance listing was created.

Production logs independently identified host and guest actions including
`host.claim`, `transport.start`, `guest.add`, `guest.edit` and `transport.stop`.
This verifies a deployed browser journey and redeploy persistence, not human
musical taste, uncoached usability or audible alignment across devices.

## 28 October 2026: guest editing and final correction gate

Node 24.21.0, production image `f562080d8d29`, limited to 256 MB with swap
also capped at 256 MB and throwaway `/data`. Against that image:

- `CI=true APP_URL=http://localhost:8381 pnpm check`: 28 files, **273 passed,
  1 skipped** (the existing live README edit check), types and build pass.
- Production browser suite: **15 passed**, at desktop and phone viewports.
  Guest code/Shape, local preview, exact draft reload, offline/online recovery,
  stale revision recovery, ending with an open draft and identical handles
  are covered without granting project access. The new editor passes axe
  WCAG 2 A/AA checks including contrast at both sizes and retains its draft
  when resized mid-edit. Desktop and phone screenshots were visually checked.
- A delayed local-draft read cannot overwrite a different guest part opened
  meanwhile (`guest-editor-view.test.ts`). Guest source access and revision
  regressions failed before implementation; malformed guest expressions now
  return 422 instead of leaking a generic parser failure as HTTP 500.
- `pnpm check:evidence` passes its mechanical presence/citation checks.

The full run exposed another real keyboard race: startup opened/focused the
tray only after clock calibration, stealing focus from a button already in
use. Initial layer registration now precedes calibration, and necessary tray
rebuilds restore the equivalent focused control. The deterministic delayed
calibration case and original phone keyboard case passed three times each;
the final complete browser run above includes both.

Audio/load probes, with the same output engine and server implementation:
24 individual presets and a 12-part combination rendered with zero clipped
samples; loudest single peak -3.5 dBFS, combined peak -1.5 dBFS. Two local
browsers agreed on scheduled epochs (0 ms), not measured speaker alignment.
At normal desktop speed, 384/384 events per second were voiced, slowest pass
11.6 ms; at 4x CPU throttling, about 216/s were voiced and the page reported
skips. Load memory was 45.85 MiB / 256 MiB. The 32-listener cap admitted 32
and refused the next identity. These are probes, not a listening verdict or
a real 32-person performance.

## 28 October 2026: performer geometry

High-bit seed hashes produced negative shape indices and omitted torso/mouth
geometry. A regression using original high-bit seeds failed before changing
the shape indices to unsigned shifts. Local Node 24.21.0: `pnpm check` passes
268 tests and builds the client; the 11 production browser flows pass at the
configured desktop/phone viewports. These checks establish rendering and
interaction behaviour, not a human listening or usability result.

## 28 October 2026: blocked chat

Blocked authors are filtered in the SQL query before pagination in project
and audience chat. Block/unblock invalidates only the blocker's open views,
without deleting history or changing membership. Both HTTP regressions failed
before the fix. The production browser regression checks live filtering,
reload, unblocking, retained input and another listener's unchanged view.
Local `pnpm check`: 270 tests pass; production browser flows: 12 pass.

## 28 October 2026: Stop retains the sounding plan

A save call had been swallowed by a line comment in `stopTransport`, leaving
no plan after Stop. The new HTTP regression failed with an empty plan list;
Stop now saves the current plan before removing old generations, retaining
effective volume/mute settings for the next Play. Local gate: 271 tests pass.
The browser run exposed a test-only race: the reload assertion read its debug
probe before clock calibration installed it. Waiting for that probe fixed the
affected recovery flow (1 passed); the other 11 flows had passed in that run.
The complete browser suite will be rerun with the remaining guest changes.

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
| Spec against the container | `APP_URL=… CI=true pnpm check` | 23 files, 266 passed, 1 skipped (the README live-edit check, skipped in CI by design) |
| Browser flows against the container | `APP_URL=… pnpm test:browser` | 11 passed |
| Image | `docker build` | 245 MB; `node_modules` in it is Acorn only |
| Container memory | `docker stats` | 33 MB idle, 44 MB after the browser flows, 41 MB under the load probe |
| Graceful stop with six streams open | `docker stop` | exits in 0.48 s |
| Process evidence | `pnpm check:evidence` | passes (file presence and commit citations only) |

### Faults found by an independent review, and fixed

Reproduced here before fixing, each with a regression that fails first:

- **An audience received clips nothing was playing.** A plan's catalog holds
  every clip of every part, and the audience snapshot mapped all of them, so a
  draft saved into an unused clip slot of a private project reached anyone
  watching a public performance of it, while `/api/projects/:id` correctly
  answered 404. Performances now publish only the revisions they can reach
  (`publishedPlan`); see the projection rule in the contract.
- **Hosting split in two.** Passing the host role in the room moved the
  transport but not the live performance, so the project named one host and
  the performance obeyed another: the new host could not moderate, the old one
  still could, and the credits were wrong. One operation now moves both.
- **An invitation looked invalid after a reload.** The page previewed with the
  fragment token but accepted with the stored one, so once the fragment was
  cleared a reload showed "This invitation isn't valid" with a perfectly good
  token still in session storage.

### Faults found while verifying this release

- **The no-script path was refused.** The shell asked for `no-referrer`,
  which makes Chrome send `Origin: null` on a form post; the origin check
  read that as another site and answered 403, so a visitor without
  JavaScript pressed Start a mix and landed on `/api/projects` looking at
  JSON. Found by running the home page with JavaScript switched off.
- **The origin check answered 500, not 403,** for any origin that would not
  parse, because `new URL()` threw. Found while following the above.
- **Keyboard focus was dropped** when the sound tray re-rendered, so Enter
  on Add and play sometimes did nothing. It failed about one browser run in
  three before it was understood; four consecutive runs are green since.
- **A resync skipped sounds silently** (see the load probe below).
- **A stream written to after it ended** crashed the process; found by
  `spec/access.test.ts` when a removed member’s stream was closed.

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
- an invitation survives a reload and is then accepted; the used link cannot
  be used again by anyone; and the whole path works where session storage
  throws, as in a locked-down private window
- reduced motion: the performers stop moving entirely, and the stage still
  names what each part is doing in words
- a slow connection (about slow 3G: 400 kbit down, 300 ms each way): a
  newcomer still reaches the room, adds a performer and starts sound, typing
  stays local, and pressing Apply twice leaves one part at one new revision

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

> **Corrected 7 November 2026.** The offline figures in this table were inflated by a
> fault found later: the live test loop leaked into every render. See that day's
> entry above for the true figures. The table is kept as it was recorded.

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
- **Whether it sounds good.** Nobody has listened to the 72 characters, alone or
  combined, on real speakers, and that includes the six new sounds in the engine and
  whether they sound like what their names promise. Levels are measured; taste is
  not.
- **Whether the new tools make sense to anyone.** No newcomer has tried the creator,
  the step grid or Sections. Whether a person understands that Pattern and Code are one
  thing, or what Who plays does, is untested.
- **The creator on a real phone.** Checked in an emulated viewport only.
- **A screen reader in the step grid.** The labels and roving focus are tested; no
  one has used a 200-button grid by ear.
- **Moderating public characters.** There is no reporting route. A person can block
  an author for themselves; nothing removes a listing for everyone except its owner.
- **A real phone.** 4× CPU throttling is a stand-in, not a measurement.
- **Two devices on a network.** Onset disagreement and output latency between
  machines are unmeasured.
- **Real-time latency from Canberra.** See the deployed check above.
- **Idle-stop and next-day return.** The deployed journey and persistence
  across rollout are checked above; a saved mix revisited after a routine
  idle stop and the next day still need their own check.
- **Load with real people.** The caps are enforced, but 32 listeners have
  never actually listened at once.
