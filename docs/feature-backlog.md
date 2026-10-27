# Feature backlog — twenty candidates, RICE ranked

Twenty things Ensemble could gain next, across UI, actions, art, elements,
mechanics and user education. **None of these are built.** What is built is in
[the contract](contract.md); the direction they have to serve is
[the Ensemble contract](ensemble-contract.md); the framing is in
[the PR/FAQ](pr-faq.md).

## How the scores were made

RICE = (Reach × Impact × Confidence) ÷ Effort.

- **Reach** — out of every 100 people who enter a mix, how many meet this
  feature in their first session.
- **Impact** — per person who meets it, against the stated claim that a
  newcomer and a programmer can contribute to the same mix and see whose work
  is whose: 3 massive, 2 high, 1 medium, 0.5 low, 0.25 minimal.
- **Confidence** — 100% backed by something observed, 80% reasoned from the
  existing design, 50% a guess.
- **Effort** — person-days, including its spec tests and a browser flow.

Every number is an estimate made from the design documents and the code, not
from user data. No observed session has happened yet, so no row is above 90%
confidence and the ordering should be expected to move once one does. Effort
is lower where the server already holds the concept (scenes, reactions,
revisions) and only the interface is missing.

## Ranked

| # | Feature | Area | R | I | C | E | RICE |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Per-part Solo | Actions | 70 | 2 | 0.9 | 1 | **126.0** |
| 2 | Starter mixes on the Play page | Elements | 90 | 2 | 0.8 | 2 | **72.0** |
| 3 | Guided first minute | Education | 85 | 2 | 0.8 | 3 | **45.3** |
| 4 | "What changed" activity rail | UI | 60 | 2 | 0.8 | 3 | **32.0** |
| 5 | Grammar cheatsheet inside Code | Education | 35 | 2 | 0.85 | 2 | **29.8** |
| 6 | Performers move on their own onsets | Art | 80 | 1 | 0.8 | 3 | **21.3** |
| 7 | Shape ↔ Code live highlight | UI | 40 | 2 | 0.7 | 4 | **14.0** |
| 8 | Keyboard shortcut overlay | UI / Education | 30 | 1 | 0.85 | 2 | **12.8** |
| 9 | Adopt-this-pack's-tempo prompt | Actions | 30 | 0.5 | 0.8 | 1 | **12.0** |
| 10 | Stage backdrop per pack | Art | 60 | 0.5 | 0.75 | 2 | **11.3** |
| 11 | A fourth preset pack | Elements | 45 | 1 | 0.9 | 4 | **10.1** |
| 12 | Shareable mix card | Actions | 40 | 1 | 0.7 | 3 | **9.3** |
| 13 | Audience reactions land on the stage | Art / Mechanics | 25 | 1 | 0.7 | 2 | **8.8** |
| 14 | Scene launcher in the room | Mechanics | 30 | 2 | 0.7 | 5 | **8.4** |
| 15 | Point at a part from chat | Mechanics / Education | 25 | 1 | 0.6 | 2 | **7.5** |
| 16 | Performer wardrobe | Art | 50 | 0.5 | 0.8 | 3 | **6.7** |
| 17 | Render the mix to a file | Actions | 35 | 1.5 | 0.6 | 6 | **5.3** |
| 18 | Euclidean rhythms in the grammar | Mechanics | 25 | 1.5 | 0.6 | 5 | **4.5** |
| 19 | Step grid as a third view | UI / Mechanics | 55 | 2 | 0.5 | 15 | **3.7** |
| 20 | Part history scrubber | UI | 20 | 1 | 0.7 | 4 | **3.5** |

## The candidates

### 1 · Per-part Solo — Actions — 126.0

A Solo toggle beside Mute in the part drawer, mutually exclusive with other
solos, cleared when the drawer closes. Soloing is a personal listening state,
not a mix change, so it is a local audio decision and writes no plan.

Highest score because it is nearly free and it answers the question everyone
asks within a minute of a four-part mix: *which one is mine?* The parts, mix
levels and output chain already exist; this is a gain multiplier in
`client/audio.ts` plus a button. The risk is that "personal" versus "everyone"
needs to be unmistakable, which the room's existing saved/queued vocabulary
already has a pattern for.

**R** 70 — most people reach three or more parts in a session. **I** 2 — it
makes authorship audible, which is the claim. **C** 0.9 — mechanically certain,
only the labelling is a guess. **E** 1.

### 2 · Starter mixes on the Play page — Elements — 72.0

Three or four named ready-made mixes, one per pack, that **Start from this**
copies into a fresh private project you own. Not a template system: just the
existing import path pointed at bundled project files.

The Play page currently offers a correct but cold empty state. A visitor with
no friends present and no musical idea has nothing to react to, and the
thirty-second target is hardest exactly there. Copy-on-start keeps the rule
that a part owns its source, so a starter mix is yours to wreck.

**R** 90 — on the first page everyone sees. **I** 2 — it attacks the hardest
moment. **C** 0.8 — the import path exists; whether people take the offer is
untested. **E** 2.

### 3 · Guided first minute — Education — 45.3

Three dismissible, non-modal pointers that appear in sequence on a first-ever
visit: open the tray, add a performer, press Play. Each clears when the action
happens rather than on a timer, never steals focus, is skippable, and never
returns once the journey completes.

The product bets on no coaching, so the app has to do the coaching. The
constraint is that this must not fight the existing focus discipline — the
browser suite already caught startup stealing focus from a control in use, so
any new overlay is written against that case from the start.

**R** 85 — everyone has a first visit. **I** 2 — directly the 30-second
target. **C** 0.8 — the pattern is standard, the wording is not. **E** 3.

### 4 · "What changed" activity rail — UI — 32.0

A collapsible column listing the last twenty room events in words: who added,
edited, muted, renamed or removed what, and whether it has sounded yet. Click
an entry to select that part.

The server already writes exactly this: scoped events, stable creation credit
and per-revision authorship. The room shows the *result* of a change but not
its *history*, so when two people work at once the second one learns what
happened by hearing it. This is the cheapest way to make the "understand each
other's contributions" target legible rather than inferred.

**R** 60 — only matters with two people present. **I** 2 — it is half the
stated claim. **C** 0.8 — the data is certain; the density is a judgement.
**E** 3.

### 5 · Grammar cheatsheet inside Code — Education — 29.8

A collapsed panel in the Code drawer listing the whole grammar with a one-line
example of each construct, and an **Insert** that puts the example at the
cursor. Generated from the grammar definition rather than written by hand, so
it cannot drift out of date.

The grammar is closed, which is the honest choice, but a closed grammar you
discover by hitting refusals is a bad first hour. The errors are already
actionable and name the failing character; this is the other half — telling
people what *is* allowed before they guess.

**R** 35 — only people who open Code. **I** 2 — it is their entire on-ramp.
**C** 0.85 — generating it from the grammar is mechanical. **E** 2.

### 6 · Performers move on their own onsets — Art — 21.3

Each figure's arms animate on that part's scheduled events rather than on a
shared idle loop: a kick on every bass drum, a sway through a sustained pad.
Pauses with audio, respects reduced motion, and is never the only indicator of
state.

The direction asks for motion that follows musical events, and the scheduler
already knows every onset about 160 ms ahead. Visible per-part motion is a
second channel for the same question Solo answers by ear, which is why both
are near the top: together they make a mix readable without reading anything.

**R** 80 — anyone who presses Play. **I** 1 — delight and a weak authorship
cue, not a capability. **C** 0.8 — the timing source exists; the CPU cost of 12
animated figures on a phone is the open question. **E** 3.

### 7 · Shape ↔ Code live highlight — UI — 14.0

With both open, moving a Shape control highlights the exact span of source it
will rewrite, and putting the cursor in a controlled call highlights its
Shape control. A disabled control highlights the layer that disabled it.

This is the "same pattern, not copies that drift" claim made visible, and it
turns the most confusing moment in the app — a greyed-out control with a
sentence of explanation — into a thing you can see. It scores mid because it
only reaches people who already use both views, which is the population the
product most wants but currently has least evidence about.

**R** 40 — both views open at once. **I** 2 — it teaches the core idea. **C**
0.7 — Shape knows which span it edits; mapping a cursor back is new work. **E**
4.

### 8 · Keyboard shortcut overlay — UI / Education — 12.8

`?` opens a list of what the keyboard already does, grouped by where it works,
dismissed by Escape with focus returned.

The keyboard path is a commitment the app already meets and nobody is told
about. Cheap, and it makes an existing accessibility investment discoverable
rather than merely present.

**R** 30 — keyboard-first users and the curious. **I** 1 — speed, not
capability. **C** 0.85 — the bindings exist and the overlay pattern is settled.
**E** 2.

### 9 · Adopt-this-pack's-tempo prompt — Actions — 12.0

When a stopped mix's parts are mostly from one pack and the tempo is not that
pack's, the host sees a one-line offer to adopt it. Never while playing, never
automatic, and it disappears when declined.

The rule that a pack choice must not silently change a running room's tempo is
correct, and its cost is that the host must know pack tempos exist. This is
the smallest thing that surfaces the knowledge at the only moment it is safe
to act on.

**R** 30 — hosts of mixed-pack mixes. **I** 0.5 — musical polish. **C** 0.8 —
the data is in the catalogue. **E** 1.

### 10 · Stage backdrop per pack — Art — 11.3

A restrained background treatment behind the stage that shifts with the
dominant pack: warm, bright or spacious. Tone and texture only — never a
contrast change, never carrying meaning on its own.

The three packs are already given moods in words. Giving each one a room to
stand in makes a mix feel composed rather than assembled, for two days of work.
The risk is contrast regression at both viewports, which the existing axe
checks would catch.

**R** 60 — anyone who adds parts from one pack. **I** 0.5 — atmosphere. **C**
0.75 — looks are hard to predict. **E** 2.

### 11 · A fourth preset pack — Elements — 10.1

Eight more presets in a new mood, same structure: stable ids, version 1,
exact source, two per role, one suggested tempo, in A minor so it combines
with everything already there.

Twenty-four presets is enough to prove the model and thin for a group that
comes back. This is well-understood work — the catalogue format is settled and
the audio probes are repeatable — but it is eight patterns that each have to
survive listening alone, with their role, and in a dense combination, which is
where the four days go.

**R** 45 — returning groups mostly. **I** 1 — more to make, nothing new to do.
**C** 0.9 — the process is known. **E** 4.

### 12 · Shareable mix card — Actions — 9.3

For a public or unlisted mix, a generated image and link preview: title,
performer figures, part count, credits. Never generated for a private mix, and
it must leak nothing a public viewer could not already read.

Everything about this app is social and nothing about it travels. The scoring
is held down by the privacy surface it adds: a card generator is one more
place that can accidentally read a private project, so it needs the same
access check as every other read path and its own regression case.

**R** 40 — people who make something public. **I** 1 — reach, not quality. **C**
0.7 — the leak risk is real but checkable. **E** 3.

### 13 · Audience reactions land on the stage — Art / Mechanics — 8.8

Reactions sent by listeners appear briefly over the performers on the host's
room view, bounded in rate and count, with a number when they outrun the
animation.

Performing to a page with a chat column and no felt audience is the weakest
moment in the live journey. Reactions already exist, are rate-limited, and are
explicitly never one row per animation, so this is presentation on top of
existing plumbing. Reach is low because it needs a live audience to mean
anything.

**R** 25 — live performances only. **I** 1 — it changes how performing feels.
**C** 0.7 — the pipe exists; restraint is the hard part. **E** 2.

### 14 · Scene launcher in the room — Mechanics — 8.4

Expose the scenes and arrangements the server already stores: a strip of named
scenes, launching at the next bar, with the running arrangement shown and
stoppable.

This is the largest capability currently invisible from the room. The
persistence, the resolver, the plan selection and the published-plan rules for
reachable scenes are all written and tested; only the interface is missing. It
ranks mid rather than high because it is the one feature here aimed squarely at
people who already know what they want, and there is no evidence yet that
anyone has asked.

**R** 30 — groups past their first session. **I** 2 — it is the arrangement
story. **C** 0.7 — backend certain, interface unproven. **E** 5.

### 15 · Point at a part from chat — Mechanics / Education — 7.5

A chat message can carry a reference to a part. The sender picks it from the
drawer, readers see the part's name, and clicking selects and briefly
highlights it. Plain text on the wire, resolved on display, invalid when the
part is gone.

The design already answers "someone else holds this part" with *ask in chat*,
and then leaves people typing "the bassy one, third from the left". This makes
the fallback work. It stays small deliberately: no mentions, no notifications,
no new chat schema beyond what a reference needs.

**R** 25 — rooms with active chat. **I** 1 — smooths a known friction. **C**
0.6 — it may just not get used. **E** 2.

### 16 · Performer wardrobe — Art — 6.7

Two or three variants per role accessory, chosen by the same seed that already
varies faces and bodies, plus a way to re-roll a performer's look.

Eight parts in one role currently differ by face and torso only. More variety
makes a twelve-part stage readable as a band instead of a crowd. It scores low
honestly: it is pure identity, it changes nothing about what anyone can do, and
every new shape has to keep reading in greyscale and at phone size.

**R** 50 — anyone with several parts. **I** 0.5 — identity only. **C** 0.8 —
the seeded-variation mechanism exists. **E** 3.

### 17 · Render the mix to a file — Actions — 5.3

Render the current plan offline in the browser to a fixed number of bars and
download a WAV: same scheduler, same voices, same limiter, no live timing.

The most obvious missing verb. A group makes something good and cannot take it
anywhere. It is expensive because offline rendering is a second audio path
that must agree with the live one — a rendered file that does not match what
the room heard would be worse than no file — and it needs its own memory bound
on a 256 MB machine's clients.

**R** 35 — groups with a finished mix. **I** 1.5 — it makes the work portable.
**C** 0.6 — agreement between paths is the risk. **E** 6.

### 18 · Euclidean rhythms in the grammar — Mechanics — 4.5

Add `a(3,8)` and `a(3,8,2)`: bounded exactly like everything else, onsets
computable on the tree, checked against Strudel's output over 24 cycles the
way every existing construct is.

The most-missed refusal for anyone arriving from Tidal or Strudel, and the one
whose bounds are genuinely computable — unlike degradation or choice, a
euclidean pattern's onset count is just *k*. It scores low because the
population that notices it is small, and because every grammar addition widens
the surface the bounding guarantee has to hold across.

**R** 25 — code users with pattern background. **I** 1.5 — it raises the
ceiling for exactly the people the product fears losing. **C** 0.6 — the
equivalence work is the unknown. **E** 5.

### 19 · Step grid as a third view — UI / Mechanics — 3.7

A grid editor for parts whose source the grid can represent exactly, editing
the source in place like Shape does, and declining with a reason on anything
it cannot say.

The original ambition, and the most interesting idea in the backlog. It is last
but one because it is three weeks against an unproven need: the grid's
representable subset is narrow — the catalogue itself uses chords, alternation
and `*8`, none of which a plain step grid holds — so it would disable itself on
most real parts, and nobody has yet watched a newcomer get stuck in a way that
proves a grid is the answer rather than better Shape controls.

**R** 55 — anyone who tried it would meet it. **I** 2 — if it worked it would
be the product. **C** 0.5 — the honest number; the need is assumed. **E** 15.

### 20 · Part history scrubber — UI — 3.5

A list of a part's revisions with author and time, each previewable on your own
device before **Restore previous** makes it current again.

Every revision is already stored with its author, and Restore already exists,
so this is a reading interface over durable data. Last because it is the
feature people want after they have lost something, and the app's existing
guarantees mean they mostly have not: drafts survive, failed edits leave the
last working version playing, and refusals never destroy text.

**R** 20 — parts edited several times. **I** 1 — recovery and reassurance. **C**
0.7 — the data exists; the appetite does not. **E** 4.

## What the ranking says

The top five are all cheap, and four of the five are about making work that
already happens *legible* — who made this sound, what just changed, what am I
allowed to type. That is the shape of a product whose mechanics are further
along than its explanations, which matches where the verification record
actually is: deployed, tested, and never yet watched by a stranger.

The expensive rows are the musical ambitions — a step grid, offline rendering,
a wider grammar — and each one is held back by the same thing, which is that no
observed session has happened yet. One mixed-experience pair would move more of
these numbers than any amount of further reasoning, and should come before
anything below row five is started.
