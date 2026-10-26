# Ensemble product contract

The agreed product direction, as a technical contract. It supersedes the
14 October Stream product choices where they conflict (equal Blocks,
Instruments and Code entry points, a Compose/Perform split, no social
features, two tracks per person, and every code expression round-tripping
through a grid). What is built, and where each rule lives, is in
[contract](contract.md); trade-offs are in [architecture](architecture.md);
what has been checked is in [verification](verification.md).

## 1. Direction

The interaction reference is Incredibox: choose a sound, give it to a
performer, build a musical lineup. Ensemble makes that collaborative,
persistent and editable through Strudel. Visual assets, characters, music and
code are original; no Incredibox branding, character designs, recordings or
arrangements are used.

Proposition: **Make a mix with friends. Make every sound your own. Play it
live.**

Required parts of the outcome: presets, direct Strudel customisation,
friends, online presence, invitations, project chat, live performances and
audience chat. Projects are public, unlisted or private; performances are
public or unlisted.

The visual reference is a band of original performers. Not a dashboard, node
graph, modular synthesiser, card manager or creature-collecting game; no
points, rankings or unlock gates.

## 2. Definition of good, and evaluation targets

Claim: people with different musical and coding experience can make a
recognisably shared mix quickly, understand each other's contributions, and
move from presets to precise edits without losing their music or their place
in the group.

Targets (to be evaluated, not results):

- A new visitor adds and hears a preset within 30 seconds of entering a fresh
  project, without coaching.
- Two newcomers join through an invitation and each make an audible
  contribution within two minutes.
- A preset user and a code user can work on the same mix; both can identify
  whose part changed and when it will sound.
- Visitors can distinguish saving, shared playback, local listening and going
  live.
- A returning group recovers its named project, member identities,
  contributions and chat after restart.
- An audience member can listen and chat without acquiring edit privileges.
- Invalid code, simultaneous edits and lost connections preserve the last
  working mix and recoverable drafts.

Evidence plan: at least two observed small-group sessions including a
mixed-experience pair, recording tasks, consented observations, assistance,
failures, changes and retest outcomes. Human listening decides whether preset
combinations are pleasing; compilers and tests establish mechanics only.

## 3. Information architecture

Three destinations:

1. **Play** (`/`): Start a mix; Your projects; a restrained link to public
   projects. A first visit gets a useful empty state, no invented activity.
2. **Live now** (`/live`): actual public, active performances, with title,
   performer credits, audience count and Listen. Empty means empty. No audio
   before a gesture.
3. **Friends** (`/friends`): accepted friends, incoming requests and invites,
   online status, invite/join actions.

Project room `/p/:id`; audience page `/live/:performanceId`. Old
`/p/:id/compose` and `/p/:id/perform` links resolve to the room without
starting a performance. `/readme/`, health checks and legacy content keep
working.

Projects are durable shared compositions. A performance presents a project.
Each project has at most one active performance, on the project's own
transport and clock; going live never starts a second scheduler, and ending
it leaves the project intact. Rehearsing does not appear in Live now.

## 4. Journeys

### Make a mix

1. Start a mix: an explicit POST creates a private project with a generated,
   editable title; the creator is owner, member and initial host. No wizard,
   no automatic sound.
2. The room shows title, privacy, Invite, Play, local sound control and an
   empty stage with **Add your first performer**. The sound tray opens on a
   first creation; returning projects open with it closed.
3. Pick a preset from Beats, Bass, Melody or Texture. Preview is local. Add
   puts an original performer wearing that sound's accessory on stage.
   Tap/Add and keyboard work; dragging a sound onto a performer is extra.
4. The first Add prepares browser audio. If the mix is stopped, the host's
   first addition may start it: the button reads **Add and play**. Other
   members see Add. A failed audio unlock offers Enable sound and never claims
   silence is sound.
5. A valid addition saves automatically and joins the next shared bar while
   playing. Status distinguishes **Saved** from **Joining next bar**; when
   stopped it says **Saved · press Play**.
6. Invite from the room. The invitation page shows project, inviter and
   offered role. **Join and enable sound** accepts by explicit POST. Opening
   or previewing a link never consumes it.
7. The friend's part shows their name; their change is visibly queued before
   it sounds. Chat happens without leaving the stage.
8. Rename any time. Mix, credits and chat persist. Returning restores what was
   saved; audio still needs a gesture.

### Customise a part

Selecting a performer opens a drawer: name, contributor, Swap, Mute,
Duplicate, Remove, Shape and Code. Selection neither mutes nor starts sound.

Shape exposes only controls the part implements (volume, brightness/filter,
space/reverb, position, supported timing), each labelled by its meaning.
Finished gestures apply at a shared boundary; no command per pointer pixel.

Code shows the exact saved source, with a local recoverable draft, **Preview
on my device**, **Apply to mix**, **Restore previous** and actionable syntax
errors. Typing is not publishing. A failed edit leaves the last working part
playing.

An expression that no grid can represent stays a first-class code part, never
flattened, regenerated, approximated or discarded. A control that cannot keep
its meaning is disabled with a reason. A successful variation can be saved to
**My sounds** with a name and attribution and reused in another project.

### Perform for others

The host chooses **Go live**, names the performance and picks Public or
Unlisted; the confirmation says who can listen. Starting is an idempotent
POST that keeps musical phase.

Listeners get a separate audience view: Listen, local volume, performers,
audience chat and reactions, and a request to perform. Never project-edit
controls.

The host can invite a friend to perform, accept or decline requests, mute or
remove chat participants and end the performance. Performance invitations
grant a performance role only; membership needs a separate project invitation.

## 5. Visual and interaction direction

- Direct sound-to-performer relationship and a compact sound tray; a visible
  band, not rows of panels.
- Original abstract performers with faces, arms and role accessories (beats:
  headphones, bass: visor, melody: crest, texture: halo). Shape, accessory and
  text identify roles as well as colour.
- Inky stage `#171923`, warm foreground `#f5f2eb`, mint primary `#c4f27b`;
  lavender, apricot and sky as restrained role accents. Contrast checked in
  the built UI.
- Motion follows musical events; reduced motion respected; movement pauses
  when audio stops; queued, playing and muted are labelled too.
- Default room: title, members, privacy, Invite, Play/Stop, device sound, Go
  live and the stage. Tempo, history, code, extra clip slots and arrangement
  live in drawers.
- Stage starts empty with one add target; at most 12 active parts; no
  per-person cap; existing legacy tracks and clip slots are preserved.
- Tray: one pack at a time, category filters, 6–8 visible choices with
  Preview and Add, more scrolling inside the tray.
- Desktop: one stage, tray below, at most one side drawer. At 390×844:
  performers wrap, tray and drawer are dismissible sheets, actions wrap, the
  primary music control stays reachable, no horizontal page overflow.
- Controls at least 44×44 CSS px; visible focus; tap/click alternative to
  every drag; Escape closes overlays and focus returns to the trigger;
  incoming events never steal focus or replace an open draft.

## 6. Preset collection

24 presets: three packs of eight, two each for Beats, Bass, Melody and
Texture, in A minor:

- **Warm Circuit**: relaxed electronic groove, 100 BPM.
- **Pocket Arcade**: bright, short, rhythmic parts, 120 BPM.
- **After Hours**: spacious, slower patterns, 80 BPM.

Synthesised voices and the symbolic drums only; no external samples. A pack
choice never silently changes a running room's tempo; the host may adopt a
pack's tempo while stopped. Each preset has a stable id and version, name,
role, exact source, attribution, tempo and key, macro controls and preview
metadata. A part copies a preset's source, so a catalogue change never alters
a saved mix; editing it makes a variation.

Each preset is to be checked alone, with each role in its pack and in dense
combinations, for clipping, loudness, harshness, notes, loop boundaries, CPU
and distinctness, with human listening recorded separately from automated
checks. Default gain leaves headroom; no volume bypasses the output limiter.

## 7. Identity, friendships and invitations

- The persistent signed-cookie identity is the guest entry. Names are not
  authentication and may collide; stable ids and a short public friend code
  tell people apart. No global name search.
- **Keep my profile**: a high-entropy recovery code, shown once on request,
  stored only as a hash, rate-limited on use, rotatable. Using it on another
  device starts a new signed session for the same identity. The code is never
  in URLs, logs, exports or chat.
- Friends need request and acceptance; decline, cancel, remove and block;
  repeated requests are rate-limited. Friendship never grants access to a
  private project or unlisted performance. Inviting a friend creates an
  in-app notification with accept/decline; links remain for non-friends.
- Presence is ephemeral, expires within 30 s of the last heartbeat, and
  "online" does not mean playing. Only friends see global online status; room
  members see room presence. No private room's title, id, URL or participants
  leak through status, notifications, counts or stream payloads.
- Invitation kinds: project collaborator, performance performer, performance
  listener. Link invitations use unpredictable, hashed, expiring, revocable
  tokens with bounded use counts; project and performer links default to one
  use and 24 hours. Listener URLs are the performance's unlisted access link,
  valid until ended or rotated. Friend invitations check the recipient.
  Redemption, membership/capacity checks and use counts update atomically.
  Expired, revoked and full invitations give actionable, non-leaking states.
- Share-link tokens travel in the URL fragment, are exchanged by POST and
  cleared; raw tokens are never logged. Rotating a link invalidates earlier
  link grants; members keep their own rights.

## 8. Visibility and permissions

New projects are **Private**; new performances **Unlisted**.

| Resource | Public | Unlisted | Private |
| --- | --- | --- | --- |
| Project | Discoverable; anyone views the published mix and credits | Published mix through a valid view link; not discoverable | Owner and members only |
| Performance | Discoverable while live; anyone listens | Listen link or an existing role | Not offered |

Viewing never exposes member chat, drafts, invitations, recovery data or
private history; export is member-only; project chat is member-only under
every visibility; audience chat belongs to the live session.

| Role | Project music | Project chat | Live | Administration |
| --- | --- | --- | --- | --- |
| Owner | Edit all parts (revision/lease rules) | Read/write | Host or perform | Membership, visibility, invitations |
| Member | Add/edit parts (revision/lease rules) | Read/write | Perform; request hosting | None |
| Viewer | Read published mix where visibility allows | None | Listen if admitted separately | None |
| Guest performer | Own session parts only | None | Session parts, audience chat | None |
| Listener | None | None | Listen, chat, react, request to perform | None |

Host is a leased playback role, separate from ownership. The creator starts as
host. The host controls shared Play/Stop, tempo while stopped, going live,
performer requests and audience moderation. Members may claim an expired host
lease; a live host may pass it to a member. Leases renew with a connected page
and expire after 30 s; losing the host stops shared transport. A permanently
unattended live session does not continue.

Guest parts are session-scoped and leave playback when the guest is removed or
the session ends; they never write into the project, though a member may
**Keep in project** a credited copy. All active parts share the 12-part limit.
At most eight simultaneous editors (members editing plus guest performers);
beyond that, listen-only with a reason, enforced on the server.

Read and mutation checks apply to HTML, snapshots, exports, history,
discovery, invitation previews, polling, streams, replay and every command.
Streams are revalidated after membership or visibility changes. Private
resources answer unauthorised requests generically and are never publicly
cacheable. Legacy global routes must not carry project events.

## 9. Collaborative editing and chat

Members edit any part; creation credit is stable and every revision keeps its
author. A short renewable edit lease (30 s, renewed about every 10 s) plus
expected-revision checks prevents silent overwrites. A refused or expired
lease never destroys a draft; others see who holds a part, may duplicate it or
ask in chat. Conflicts offer Keep my draft, Load current and Save as new part.
Owner release of a lease never erases unsaved text. Undo makes a new revision.

Chat: plain text, at most 500 characters, escaped, paginated, persisted; no
HTML, attachments, voice or direct messages. Client ids make retries
idempotent; pending and failed states are shown. Owner and host can tombstone
messages and remove participants; blocking hides the blocked person's
messages locally. A host kick revokes performance access, including link
admission for that identity. Project chat survives restarts; performance chat
is session-scoped, kept for the host for seven days. Reactions are short-lived
and rate-limited, never one row per animation.

## 10. Code, sound and synchronisation

Browser audio with server-authoritative musical state; no server audio, no
microphones, no WebRTC. One Strudel cycle is one four-beat bar.
Global-phase scheduling and immutable clip revisions continue. Synchronisation
is best effort; no sample-accurate claim.

Minimum editing contract:

- `s(string)`, `note(string).s(synth)`, `stack(...)`, chained `gain`, `lpf`,
  `room`, `pan`, `release`, `fast`, `slow`, `rev`.
- Mini-notation: rests, sequences, bracketed subdivisions, alternating cycles,
  repetition/division, parallel notes and chords; MIDI numbers and note names.
- MIDI 24–96; four synth waveforms and `bd`, `sd`, `hh`, `cp`. No unknown
  sound falls back to a default voice.
- Comments, one expression with optional trailing semicolon, ordinary quoted
  strings and interpolation-free template strings. Source kept verbatim.
- Finite bounded numeric literals; source at most 8 KiB; bounded nesting and
  size; event density, polyphony and period bounded across every cycle before
  expansion, not by sampling.
- Parsed into a serialisable expression and built with allowlisted Strudel
  calls: no `eval`, `Function`, dynamic imports, callbacks, property
  traversal, DOM or network access, or server execution of submitted code.
- Client and server agree; every accepted control is implemented by the audio
  output.

Version 1 trees keep playing; version 2 expressions are added; no lossy
conversion between them. Shared changes save at once and join the first bar
at least one second ahead; the saved/queued state shows immediately. Shared
Stop and local silence are immediate. Tempo changes are host-only while
stopped. A separate local preview channel is labelled and does not double the
shared part. Late joins start at the shared phase. A stale connection silences
locally and keeps drafts.

On restart: stop transport, end live performances as interrupted, release
leases and cancel queued changes; keep music, members, friends, invitations,
chat and revisions; never auto-resume sound.

## 11. Engineering groundwork

Retained: Node 24, pnpm, Vite, TypeScript, SQLite, SSE, native WebAudio and
Strudel core, idempotent commands, revision checks, plan scheduling,
persistent identities, local drafts, one `shared-cpu-1x` 256 MB Fly machine
with one `/data` volume, and the starter invariant tests.

Durable concepts: project visibility and view-link version; membership;
friend requests, friendships and blocks; recovery hashes; invitations and
receipts; immutable presets and saved variations; performances with link
versions; guest parts and performer roles; project and performance chat;
credits and revisions. Ephemeral: online heartbeat, edit leases, reaction
animation.

Migrations are append-only and transactional, with verified backups. Creators
become owners and track owners become members. Existing projects become
Public (they were already listed and readable) with an owner-visible note; new
projects default Private. Legacy attribution, clips A–D, scenes, histories and
drafts are preserved; unowned legacy data keeps no invented owner.

Real-time scopes: account notifications, member project events, published
view events and performance audience events, filtered before replay and
fan-out. A change and its scoped event commit together. Bounded queues,
reconnect cursor/reset, backpressure, rate limits and idempotent receipts
scoped to actor and target. Limits cover chat, invitations, code, stream
connections and audience size; discovery and history are paginated. A
32-listener cap per performance and a bounded site-wide stream budget are
provisional engineering bounds, not measured supported load.

## 12. Acceptance gates

1. Diagnose the baseline and preserve data.
2. Sound and stage: lineup, empty state, preset tray, add/swap/mute/remove,
   real sound, safe version 2 code, retained version 1 playback.
3. Durable shared rooms: membership, visibility and read filters, leases,
   collaborative parts, save/reopen, credits, project chat, two-client
   propagation; permission matrix over HTTP and streams, concurrent edits,
   restart and migration.
4. Friends and invitations: requests, accept, block, presence expiry, secure
   invitation lifecycle, notifications, recoverable identity; privacy through
   every presence and notification path.
5. Live performances: public and unlisted audiences, scoped plans, host
   lifecycle, guest performers, session parts, audience chat and moderation,
   Live now; a third identity listens without project access; guests never
   gain membership; ending and restarting clean up.
6. Experience and release verification: listening, mixed-experience use,
   keyboard and touch, mobile, reduced motion, slow connections, migrations
   and resource limits; findings fixed and rechecked.

Required regression cases: non-members cannot read a private project through
HTML, API, SSE, export, history or legacy routes; public viewers cannot edit;
unlisted content never appears in discovery or friend status; expired
invitations grant nothing; concurrent redemption respects limits; revoked
members stop receiving events; audiences cannot change music; two editors
cannot silently overwrite; duplicate sends are idempotent; restart keeps work
and identity but stops sound; malformed or dense source cannot hang a page or
server; valid advanced source survives exactly; audio denial is recoverable;
load fails boundedly rather than silently.

## 13. References

Consulted 26 October 2026:

- [Incredibox](https://www.incredibox.com/): the interaction reference.
  Ensemble's collaboration, code, project and audience design is an
  extension, not a description of Incredibox.
- [Strudel REPL](https://strudel.cc/technical-manual/repl/),
  [mini-notation](https://strudel.cc/learn/mini-notation/) and
  [project start](https://strudel.cc/technical-manual/project-start/):
  pattern editing, syntax and integration/licensing.
- [Final-project brief](https://comp.anu.edu.au/courses/comp4020-agentic-coding-studio/assessments/final-project/)
  and [assessment rubric](https://comp.anu.edu.au/courses/comp4020-agentic-coding-studio/topics/assessment/#marking-rubric).

## Candidate preset catalogue

The 24 candidate patterns, with ids, roles, macros and suggested tempos, are
implemented verbatim in `shared/presets.ts` (catalogue version 1). The only
change from the candidate list is pan: it was written on a −1…1 scale, and
Strudel 1.2.6 takes pan from 0 (left) to 1 (right), so those three values are
mapped by (x + 1) / 2.
