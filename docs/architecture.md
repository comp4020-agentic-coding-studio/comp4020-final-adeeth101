# Ensemble architecture decisions

## From Stream to Ensemble

Stream offered three equal ways in (blocks, an instrument grid, code), split
composing from performing, and gave each person their own tracks. Ensemble
starts from Incredibox's move instead: give a sound to a performer. Presets
are the way in; Shape and Code open on a part for precision. One room holds
composing and playing; performing for others is a separate, deliberate step.

What was kept: Node's HTTP server and SQLite on one small machine, SSE,
idempotent commands with revision checks, durable performance plans on a
shared clock, browser-side audio, local drafts, the signed visitor cookie and
the starter invariants. What was removed: the Compose/Perform split, the
two-tracks-per-person cap, track ownership as the edit rule, the conductor
podium as a separate claim, and the Blockly editor.

## A source-first expression model beside the old tree

Stream required every code expression to round-trip through its grid tree, so
the code view could hold almost nothing the grid could not. The candidate
presets need chords, `<>` alternation, `*8`, bass below MIDI 48, pan and
release; the grid can represent none of them.

Ensemble adds a version 2 document whose truth is the source text. Acorn
parses it; a closed grammar turns the AST into a small expression tree; the
mini-notation strings are parsed by our own parser into the same tree. The
browser builds Strudel patterns from that tree with named library calls
(`s`, `note`, `stack`, `sequence`, `timeCat`, `pure`, `silence` and the
listed controls). Submitted text is never evaluated and the server never
imports Strudel: a direct Node import of the installed Strudel failed on a
`@kabelsalat/web` export, and the server has no need of patterns, only of the
grammar and its bounds.

Our mini-notation parser was preferred to Strudel's own (`krill`) because it
lets every construct be bounded before expansion: onsets per bar and the
repeat period are computed exactly on the tree, so `s("bd*16").fast(8)` or a
seven-by-nine-by-eleven alternation is refused without building anything.
`spec/expr.test.ts` holds the parser to Strudel's: for each supported
construct the events match `mini()` over 24 cycles. The cost is coverage.
Euclidean rhythms, `?` and degradation, ranges, `|` choice, `.` grouping,
variables, functions and the rest of Strudel are refused with a message.

Version 1 trees keep playing unchanged. There is no conversion in either
direction, so nothing is ever approximated to fit a view.

## Shape that keeps the meaning

Shape edits code, so it can only offer what it can say exactly. A control on
the outermost chain applies to the whole part, so its number is replaced in
place and the rest of the text, comments included, is untouched. A control
absent everywhere is appended. A control written inside one layer of a stack
cannot be changed from outside without overriding that layer, because in
Strudel an outer `.gain()` sets the value rather than scaling it, so Shape
declines and points to Code.

Volume is therefore not a code edit: it is the part's level in the shared mix
(`part.mix`), which multiplies whatever the code says. That keeps a preset's
internal balance (a kick at full, hats at 0.16) when someone turns it down.

## The grid is a lens, not a second pattern

The backlog rated a step grid low because a grid that models patterns has to
disable itself on most real parts, and two models drift. So the grid models
nothing. `shared/steps.ts` reads the source and writes edits back into its text,
replacing only the pieces that changed. There is nothing to keep in sync, because
there is only one thing.

That choice decided the rest. Representing a step and rewriting it are separate
questions, so what cannot be represented is locked in place and everything around
it stays editable, rather than the whole part being disabled. Reading is free of
side effects, so switching tabs cannot rewrite anything. Viewing finer than the
text needs costs nothing until a step is placed. Each write is read back and must
match, which turns a bug in the lens into a refused edit, not corrupted music, and
every character is checked against Strudel's own output after a forced rewrite of
every step.

The cost is that an edit can leave a pattern less compact than a person would write
it: `33*4 40*4` becomes `33*4 [40 ~ 40 40]`. That is only the piece they touched,
and it sounds exactly as drawn.

## Characters are copied, listings are snapshots

A shared character could have been referenced by mixes that use it. Then editing or
deleting it would change other people's music, which is the one thing a mix must
never suffer. So use always copies: a track holds its own look and source, a saved
copy is a new row, and a credit is a stored string that outlives its subject.

A listing is a snapshot for the same reason in the other direction: a person
experimenting with their own character should not be publishing every step of it.
The character table has no column that could hold a project, a chat or an unused
clip, so a leak would take a schema change, not just a mistake in a query. Saved
sounds carried a part name in their attribution, and that is deliberately not
carried forward.

Looks are ids rather than SVG. Accepting drawn markup from people would make every
shared character a stored-script risk, and validating SVG is much harder than
checking a value against a list.

## Deleting

A mix is deleted in two steps. The first is a soft delete, because mixes are shared
and an owner's mistake lands on everyone: the rows stay, and one check in
`src/access.ts` makes every read answer like a missing mix, so no route needs its
own rule. Everything that depends on the mix ends in the same transaction. Restoring
brings it back private, with its invitations still revoked, because links that were
out in the world when it was deleted should not silently start working again.

The second step removes the rows, for people who really mean it. Members never see
either: leaving is what they can do, and the mix stays with the group.

## Visibility, roles and scoped events

Every read starts in `src/access.ts`. A project is read either as a member
(the room snapshot) or as a permitted viewer (the saved mix and public
credits, nothing else); a performance as host, member, guest performer or
listener. Anything else is the same 404 a missing id gets.

Events carry a scope, and a stream subscribes to one scope, so replay and
fan-out share the filter instead of each re-deciding what a reader may see.
A member event says only that something changed; pages fetch a snapshot that
is checked again. When membership, visibility or a performance role changes,
every open stream re-runs its access check and closed ones get `revoked`. A
stream is removed from the hub when it is ended, not when its socket closes,
because a broadcast in between once wrote after end and crashed the process
(found by `spec/access.test.ts`).

The sketchpad's old global stream read the whole event table, which became a
leak once project events shared it (diagnosed against the Stream release; see
[verification](verification.md)). It now reads only its own kinds.

## Editing together without a shared buffer

Any member may edit any part. Three things keep that safe. Credit is
structural: the part records who added it and each immutable revision who
made it. A 30 s edit lease, renewed while a part is open, tells others who is
working on it; it is enforced on the server, belongs to the person (so their
tabs share it), and lapses on its own. Every edit carries the revision it was
based on, so a stale save is refused and the editor keeps the draft with
three choices: keep my draft, load current, save as a new part. Merging two
edits automatically was rejected for the same reason as in Stream: musical
edits are not line edits.

## Hosting rather than conducting

Stream's conductor had to be claimed on a separate page. Ensemble makes the
creator host at once, so a first mix needs no podium, and the host lease is
renewed by the room's heartbeat. If the host leaves while the mix plays, the
server stops it rather than leaving a room playing to nobody, and any member
can take over. Hosting is a playback role; ownership (membership,
visibility) stays separate.

That role lives in two places — the transport, and a live performance — and
for a while two code paths moved them, which let them drift: the room could
say one member was hosting while the performance still obeyed another, so the
new host could not moderate and the old one still could. `setHost` is now
the only way it moves, and it moves both in one transaction. The useful
consequence is that there is one question to answer anywhere in the code,
who is hosting, rather than two that can disagree.

Releasing the role while live raised a question the earlier code never had to
answer: who is accountable for a performance with nobody hosting? Leaving the
previous host named would have kept handing them powers they had just given
up. The performance ends instead, which is what already happens when a host's
connection dies, so there is one rule rather than two.

## What an audience is allowed to receive

A member's plan carries the whole room's workspace, because that is what a
member edits. Sending it to an audience was a leak: a draft saved into another
clip slot, or a scene nobody had launched, travelled to anyone watching a
public performance of an otherwise private project. The project's own access
check was right; a different response simply carried more than it needed.

The projection is deliberately narrow and computed from the plan rather than
filtered after the fact: a part publishes only the clip its override names, or
the clips its reachable scenes assign, and a muted part publishes nothing. It
is safe to send less because the plan is already the unit of change. Anything
that makes a clip necessary writes a new plan at a future bar, so the music
arrives with the decision that needs it rather than ahead of it, and a late
joiner reads exactly what everyone else is playing.

The alternative — sending the catalog and trusting the audience page not to
play the rest — would have put a privacy boundary in client code, where it is
one bug or one opened developer console away from meaning nothing.

## Performances on the project's own clock

A performance is a row pointing at a project, not a second transport: the
audience schedules the same plans against the same epoch, so going live,
guests joining and members' edits never reset phase. The audience snapshot is
built separately from the plan and credits; it never returns the project
snapshot. Guest parts are ordinary parts marked with their performance, so
they share the twelve-part limit and leave the plan at the next boundary when
the session ends; Keep in project makes a credited copy.

## Identity: guest first, recoverable

The signed cookie remains the fast way in. Keep my profile adds a 125-bit
recovery code, shown once, stored as a SHA-256 hash and guess-limited per
device and per address. Using it issues a new signed cookie for the same
visitor id. No email or OAuth: the code is the account, and the page says so.

Friend codes are random six-character codes, not derived from the private id.
Friendship shows a generic online status and allows direct invitations; it
never grants access.

## Invitations and bearer links

Invitation tokens are 192-bit, stored only as hashes, carried in the URL
fragment (which browsers do not send to servers or in referrers), exchanged by
POST and then cleared from the address bar. The use count is incremented
with a conditional update in the same transaction as the membership change,
so two people racing for a one-use link cannot both get in
(`spec/social.test.ts` races six).

Unlisted view and listen links are derived from the server secret, the
resource and its link version, so the owner can copy them again without the
raw token being stored, and bumping the version revokes every earlier link and
the grants made from them.

## Restart semantics

A restart cannot know the instant the old process died, so it uses the last
durable write for the project as a stand-in: the plan sounding then is kept,
anything queued later is cancelled. Live performances end as `interrupted`
and their guest parts leave. Edit leases, presence and online status are in
memory and simply vanish. Nothing auto-resumes.

## Reactions as totals

Each reaction used to be its own broadcast, to the audience only. Sending them to
the stage as well would multiply that by every open performer page, so they are
now counted and sent as a small total a few times a second. A burst costs a handful
of events whatever the audience's size, the stage can show `👏 ×12` instead of
twelve animations, and there is nothing to store.

## An engine of its own for rendering

Offline rendering used to borrow the live engine by swapping its context, restoring
it afterwards. Comparing the old build with the new one showed this had always been
wrong: the live loop kept ticking during a render and scheduled into the offline
context, so a soft triangle bass reported the kick's peak. A render now constructs
its own `StudioAudio`. This is what lets an export run while the mix plays, and it
also corrected the earlier level measurements.

## Sound and headroom

The output implements exactly the grammar's controls. A fixed master gain
feeds a limiter and a ceiling; device volume scales before them, so no
setting can bypass the limiter. The master trim was set by offline
measurement of every preset and a twelve-part mix (see
[verification](verification.md)); it is a calibration, not a listening
verdict. An unknown sound name is skipped rather than played as a default
voice.

## Browser connection limits

Browsers allow six HTTP/1.1 connections per site and each live stream holds
one. Room and audience pages therefore poll notifications rather than opening
a second stream; one open mix costs one connection. Fly's proxy speaks
HTTP/2, which multiplexes streams, so this matters most locally.

## Sections on the scenes that were already there

The server already had scenes, arrangements, published plans and restart handling,
tested and with no interface. Building sections on them meant shared phase, late
joiners, audience reach and host transfer were already solved. The cost is the
model's limits: four sections and eight sequence entries. For one mix that has
proved enough to say something, and raising them would be a change to those limits
rather than a new system.

AI transitions were left out. A transition would need a model call, a key and a
result that differs between runs, in a product whose shared playback depends on
everyone following one durable plan. What people actually lack at that moment is a
starting shape, and a few rules about roles give one.

## Build and deployment

Vite builds the browser modules; each view, the audio engine and the preset
catalogue load on demand. The Docker build compiles client assets in one
stage and installs production dependencies in another, so the image carries
the bundle and Acorn only. The machine and volume constraints and the shipped
invariant tests are unchanged. CI runs the spec and the production browser
flows against the same container it deploys. Shutdown closes live streams so
the process exits promptly on Fly's stop signal.
