# Stream architecture decisions

## A validated tree for three editing views

The earlier sequencer recognised one `s(...)` shape. Stream uses a versioned
tree with sound/note sequences, parallel patterns and ordered transforms.
Blockly and instrument grids edit this tree; the code editor parses an Acorn
AST into it. Unknown calls fail closed. Playback constructs Strudel patterns
through library calls instead of evaluating submitted source.

This sacrifices arbitrary JavaScript and complex mini-notation inside the
shared studio. The benefit is that collaborators hear the same supported
contributions and the three views can preserve musical meaning. Unsupported
text remains a recoverable draft and can be exported to the full Strudel REPL.

## Shared musical time and a bounded output

Strudel 1.2.6's `Cyclist.start()` resets cycle state. Rather than depend on
mutable internal scheduler fields for late joins, `StudioAudio` queries real
Strudel patterns over global cycle arcs, with a 160 ms lookahead and native
WebAudio absolute scheduling. One cycle is four beats; BPM / 240 is cycles
per second. Plans change on a future bar and the current query clock continues.

The custom output synthesises four drum voices and four oscillator waveforms.
It implements the supported gain, filter and reverb controls plus a master
compressor. This avoids external sample downloads and gives predictable
assets, at the cost of sounding different from Strudel's default sample banks.
It supports our bounded vocabulary, not Strudel's entire audio feature set.

Clock calibration uses the lowest-RTT of five server samples. Scheduled
timestamp agreement is testable; actual output latency depends on devices.
Do not describe the ensemble as sample-accurate network audio.

## Ownership, conducting and automation

People edit their own clips and control their own track. A leased conductor
role controls ensemble transport, scenes and arrangements. Owners can switch
their track to manual control and later follow scenes again. This avoids
requiring concurrent text editing or giving the conductor ownership of clips.

Rhythm and melody bots use a versioned seeded algorithm. They suggest a draft;
acceptance and publication are separate actions. They do not autonomously
overwrite saved music. The arranger supplies automatic performance sequencing.

## Persistence and conflict recovery

SQLite stores projects, clip revisions, scene assignments and performance
plans on the existing mounted volume. Commands check identity, revisions and
capacity within a transaction. An idempotency receipt prevents duplicate
mutation when a committed command is retried. Event broadcast happens after
commit. SSE sends small invalidations; clients reload a consistent snapshot.

Drafts are separate IndexedDB records. The saved project survives a restart;
transport and conductor leases reset so that returning never unexpectedly
starts audio. Legacy source is retained and imported only when understood.

## Restart semantics

A restart cannot know the instant the old process died, so it uses the last
durable write for the piece (the newest plan or event) as a stand-in. The plan
sounding at that moment is kept, with its arrangement frozen on the scene it
had reached; anything queued for a later bar is cancelled. The alternative,
keeping the newest plan, would silently apply a scene launch or mix change
that nobody heard. A second restart finds nothing playing and records nothing.

## Conflicts are the owner's choice

Two tabs, or a tab and a returning device, can edit the same clip. Applying a
draft based on an older revision is refused by the server and blocked in the
editor, which keeps the draft and offers three explicit outcomes: keep my draft
(rebase it on the newer revision and apply deliberately), load the saved
version (asks first; Undo restores the draft) or save as another clip (move
the draft to an empty slot). Merging two trees automatically was rejected:
musical edits are not line edits, and a silent merge could produce something
neither person wrote.

## Staying honest about the connection

The live stream is the normal path. When the server refuses another stream
(two per person per piece, 64 in total), the page says live updates are busy,
polls the snapshot every second and still publishes. The server's heartbeat is
a named event every 5 s rather than an SSE comment, because browsers hide
comments; eight silent seconds mean a dead connection. While no snapshot has
answered for three seconds, Apply is disabled and the draft stays local. Two
seconds after the stream drops, ensemble sound stops unless polling is still
answering.

## A measured limit on density

`scripts/load-proof.mjs` publishes twelve tracks and drives the stage in
Chromium. Twelve clips at the original legal maximum (128 cells at 4× speed)
asked for about 3,070 events per second. Desktop Chromium voiced them, but
under 4× CPU throttling the scheduler voiced about 11% and dropped the rest
without telling anyone. Clips are now limited to 128 steps per bar (each
sequence's steps times its combined speed), which caps the worst legal piece
at 768 events/s at 120 BPM and 1,152 at 180. Throttled 4×, a browser still
manages only about 370 events/s, so the stage reports skipped sounds rather
than hiding them. A real phone has not been measured; these are bounds from a
desktop machine and an emulated slowdown.

## Build and deployment

The Node HTTP/SQLite server is retained. Vite builds browser modules, with
Blockly and audio loaded on demand. The performance page never needs Blockly.
The Docker build compiles client assets in one stage and installs production
dependencies in another, so the running image carries the bundle and Acorn
only. Blockly and Strudel are devDependencies because Vite bundles them.
jsdom stays at 29 because Blockly 13.3 declares a peer range below 30. The
original machine/volume constraints and shipped invariant tests remain in
place. CI runs the spec and the production browser flows against the same
container it deploys. Shutdown closes live streams so the process exits
promptly on Fly's stop signal.
