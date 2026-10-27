# Ensemble — PR/FAQ

A planning artefact in the Amazon working-backwards form: a press release
written as if the product had shipped, followed by the questions it has to
survive. **Nothing here is a record of what has been built or measured.** What
is built is in [the contract](contract.md); what has been checked, and how, is
in [verification](verification.md); the agreed product direction is
[the Ensemble contract](ensemble-contract.md). The ranked build list it refers
to is [the feature backlog](feature-backlog.md).

---

## Press release

### Ensemble lets a group make a mix together, change every sound, and play it live

**Ensemble is a web app for making music with friends in a shared room.** You
start a mix, give a sound to a performer on stage, and hear it in the next bar.
A friend opens your invitation link and does the same. Nobody installs
anything, nobody makes an account, and nobody has to learn a pattern language
to be audible in the first thirty seconds.

Group music tools make you choose. Toy mixers are instantly fun and then you
hit a ceiling: you can arrange the sounds you were given and nothing more. Live
coding environments go as deep as you like and ask you to learn a language
before you hear anything, and the collaborative ones usually share a single
text buffer, where anyone can overwrite anyone and nobody can tell whose line
was whose.

Ensemble refuses the choice. The same part can be picked from a tray of 24
presets, nudged with labelled controls — volume, brightness, space,
position — or opened as the exact Strudel source it has been all along. Those
are three views of one part, not three copies that drift. A newcomer and a
programmer can work on the same mix in the same minute, and each can see what
the other changed and when it will sound.

"I used a shared-buffer live coding tool in a music computing course and found
it frustrating: anyone could overwrite anything, and nobody could tell whose
line was whose," says the project's author. "Ensemble gives each part its own
lease and its own revision, so two people never collide, and every part carries
who added it and who last changed it."

Every part is yours to keep. Code is parsed into a bounded expression and never
executed, so a malformed pattern costs you an error message rather than the
room's audio. A failed edit leaves the last working version playing. Close the
tab and the mix, the members, the credits and the chat are still there; the
sound waits for you to press Play.

When the mix is ready, the host goes live. Listeners get their own page with
audio, chat and reactions and no way at all to change the music — unless the
host admits them as a guest performer, which gives them their own session parts
and still no membership of your project.

Ensemble is open source under AGPL-3.0-or-later and runs as one small process
on one small machine.

> **Make a mix with friends. Make every sound your own. Play it live.**

---

## Customer FAQ

Fifty questions from someone who wants to use Ensemble.

**1. What is Ensemble, in one sentence?**
A shared room where you give sounds to a band of performers, and the mix you
build plays for everyone in it.

**2. Do I need an account?**
No. A signed cookie gives you a persistent identity and a generated handle the
first time you arrive.

**3. Then how do I reach my mixes from another device?**
Ask for a recovery code. It is shown once, stored only as a hash, and signs you
in as the same identity elsewhere. It never appears in a URL, a log, an export
or chat.

**4. What if I lose the recovery code?**
Rotate it from a device that is still signed in. If you have lost every
signed-in device and the code, that identity is not recoverable. That is the
price of not collecting passwords or email addresses.

**5. Do I need to know how to code?**
No. Presets and the labelled Shape controls cover the whole journey. Code is
there when you want it.

**6. How long before I hear something?**
The design target is sound within thirty seconds of entering a fresh mix,
without coaching. Whether real newcomers hit it is a question for observed
sessions, not something the app asserts about itself.

**7. Why does nothing play until I click?**
Browsers require a gesture before audio. The first Add prepares audio, and the
button reads **Add and play** when your addition will start the mix.

**8. I clicked and there is still no sound.**
The page offers **Enable sound** rather than pretending silence is sound. That
usually means the browser refused the audio unlock, and the control retries it.

**9. How many sounds can one mix have?**
Twelve active parts, shared by everyone in the room. There is no per-person
quota.

**10. How many presets are there?**
Twenty-four: three packs of eight, with two each for beats, bass, melody and
texture, all in A minor.

**11. Are the presets recordings of real instruments?**
No. Everything is synthesised in your browser — four waveforms and four
symbolic drums. No external audio files.

**12. Can I change a preset?**
Yes. Your part copies the preset's source the moment you add it, so editing
makes your variation and never touches the catalogue or anyone else's mix.

**13. Can I reuse a variation I liked?**
Save it to **My sounds** with a name and attribution, and add it in another
mix.

**14. What are the Shape controls?**
Volume, brightness, space, position and supported timing, each labelled by what
it means rather than by its parameter name.

**15. Why is a Shape control sometimes disabled?**
Because it cannot keep its meaning for that part. If a value is written inside
one layer of a stack, changing it from outside would override that layer rather
than adjust it, so Shape declines, says why, and points you to Code.

**16. What language is the code?**
Strudel, restricted to a closed grammar: patterns, mini-notation, `stack`, and
the chained controls `gain`, `lpf`, `room`, `pan`, `release`, `fast`, `slow`
and `rev`.

**17. Can I use the rest of Strudel?**
Not yet. Anything outside the grammar is refused with a message and the exact
character it failed at. The restriction is what lets every pattern be bounded
before it plays.

**18. Is my code run on the server?**
Never. It is parsed into an expression tree and built with named library calls.
There is no `eval`, no dynamic import, and no server-side execution.

**19. What happens if my code is broken?**
Nothing sounds different. Typing is not publishing: your last working part
keeps playing, and your broken text stays as a local draft with an actionable
error.

**20. Will I lose a draft if I close the tab?**
No. Drafts are kept on your device, scoped to you and that part, and reload
exactly as you left them.

**21. Does saving mean playing?**
No, and the app says so. Status distinguishes **Saved**, **Joining next bar**
and **Saved · press Play**.

**22. Why does my change wait for the next bar?**
So the mix stays in time. A shared change joins the first bar that starts at
least a second ahead.

**23. Who can press Play?**
The host. If nobody is hosting, the person who presses it becomes host.

**24. What is a host, exactly?**
A leased playback role: shared Play/Stop, tempo while stopped, going live, and
audience moderation. It is not ownership.

**25. Can I take over hosting?**
You can claim an expired lease, and a host can pass it to you. A lease lasts 30
seconds and renews while a page is connected.

**26. What happens if the host closes their laptop mid-song?**
The lease lapses, the shared mix stops, and the role frees up for a member to
claim. A live performance left with nobody accountable for it ends.

**27. Can two of us edit the same part at once?**
No, and that is deliberate. A part is held under a short lease; others see who
holds it and can duplicate it or ask in chat.

**28. What if my edit is refused because someone saved first?**
You are offered **Keep my draft**, **Load current** or **Save as new part**.
Your text is never destroyed by a refusal.

**29. Can an owner take a part off me?**
An owner can force-release a lease. That releases the lock; it does not erase
your unsaved text.

**30. Is there undo?**
There is **Restore previous**, which makes a new revision rather than erasing
history. A multi-step undo across the whole room is on the backlog, not built.

**31. Who gets credit for a part?**
Whoever added it keeps creation credit permanently, and every revision records
who made it.

**32. How do I invite someone?**
From the room. The invitation page shows the mix, who invited you and the role
you are offered. Accepting is an explicit action, so opening or previewing a
link never uses it up.

**33. What if my invite link leaks?**
Project and performer links default to one use and 24 hours, and you can revoke
or rotate them. Rotating invalidates earlier link grants, while members keep
their own access.

**34. Are my mixes public?**
New mixes are private. You choose public, unlisted or private.

**35. Does a friend automatically see my private mix?**
No. Friendship grants nothing. Visibility controls reading; roles control
writing.

**36. What do people see if they guess a private mix's URL?**
The same generic 404 as a mix that does not exist.

**37. What does a public viewer see?**
The saved mix and the credits. Not chat, not drafts, not revision history, not
invitations.

**38. What are friends for, then?**
Telling people apart, seeing who is online, and inviting someone in-app instead
of pasting a link.

**39. Can strangers find me by name?**
No. There is no global name search. Names can collide; a short public friend
code is how people identify you.

**40. Can I block someone?**
Yes. Their messages stop appearing for you. It does not delete shared history
or remove anyone from the room.

**41. What is a performance?**
A presentation of a mix to an audience, on the project's own clock. Public
performances appear in **Live now**; unlisted ones are reachable only by link.

**42. Does going live interrupt the music?**
No. Starting a performance preserves musical phase.

**43. Can my audience change my mix?**
No, by construction. The audience page has Listen, local volume, chat,
reactions and a request to perform, and no project controls at all.

**44. What does a guest performer get?**
Their own session parts, which they can shape and code, plus audience chat.
Their parts leave when the session ends, and a member may **Keep in project** a
credited copy.

**45. Does performing make someone a member?**
Never. Membership needs a separate project invitation.

**46. How many people can listen?**
Thirty-two per performance is the current engineering cap, with a site-wide
stream budget behind it. That is a configured bound, not a measured capacity.

**47. Does it work on my phone?**
Yes. At phone size the tray and drawers become dismissible sheets, performers
wrap, and the main music control stays reachable.

**48. Can I use it with a keyboard only?**
Yes. Every drag has a click alternative, Escape closes overlays and returns
focus, and incoming events never steal focus or replace an open draft.

**49. What happens if the server restarts?**
Your music, members, friends, invitations, chat and revisions survive. Sound
stops, live performances end as interrupted, and nothing resumes on its own.

**50. What will it cost me?**
Nothing, and there is no account to sell. The source is AGPL-3.0-or-later.

---

## Business FAQ

Fifty questions from the people funding, building, marking or operating
Ensemble.

**51. Who is this for?**
Small groups with mixed musical and programming experience who want to make
something together in one sitting. The concrete case is a few friends or
classmates in a room or a call.

**52. What is the one-line proposition?**
Make a mix with friends. Make every sound your own. Play it live.

**53. What problem is actually unsolved?**
Shared live-coding tools make collaboration cheap and entry expensive; toy
mixers invert it. Neither lets a newcomer and a programmer contribute to the
same part of the same piece without locking one of them out.

**54. Why not just build an Incredibox clone?**
A clone inherits the ceiling: you arrange the sounds you were given. Ensemble
takes Incredibox's interaction — a sound given to a performer — and makes it
collaborative, persistent and editable.

**55. Is any Incredibox material used?**
No. The interaction is the reference. Visual assets, characters, music and code
are original; no Incredibox branding, character designs, recordings or
arrangements are used.

**56. What is the defensible idea?**
That the views and the code are the same pattern rather than copies that drift,
and that the grammar's boundary is honest: code the controls cannot represent
stays first-class code and is never silently rewritten.

**57. Why is honesty about that boundary a feature?**
Because the alternative is the failure mode that loses trust. A tool that
quietly flattens an expert's expression to fit a slider teaches them never to
touch the slider.

**58. What is the success metric?**
Whether people with different experience make a recognisably shared mix
quickly, understand each other's contributions, and move from presets to
precise edits without losing their music or their place in the group.

**59. How will that be judged?**
Observed small-group sessions including a mixed-experience pair, recording
tasks, consented observations, assistance given, failures, changes and retest
outcomes.

**60. Why not measure it automatically?**
Compilers and tests establish mechanics only. Whether a combination sounds
pleasing, or a newcomer felt lost, is a listening and observation question and
is recorded as one.

**61. What are the stated evaluation targets?**
Sound within 30 seconds for a new visitor; two newcomers audible within two
minutes of accepting an invitation; a preset user and a code user able to tell
whose part changed and when it will sound; visitors able to distinguish saving,
shared playback, local listening and going live; a returning group recovering
its project after restart; an audience member listening without gaining edit
rights; and invalid code, concurrent edits and lost connections preserving the
last working mix.

**62. Are those targets results?**
No. They are what the product is to be evaluated against, and the documentation
is explicit that they are not claims.

**63. What is the business model?**
There isn't one. It is a course prototype, open source, and the architecture is
chosen to be runnable indefinitely at near-zero cost rather than to monetise.

**64. What does it cost to run?**
One `shared-cpu-1x` machine with 256 MB and one volume. The machine stops when
idle and starts on the next request.

**65. Does that constraint hurt the product?**
It shapes it productively. No server-side audio, no media servers and no sample
library, because the browser renders sound. The marginal cost of a user is a
stream connection and some SQLite rows.

**66. Can it scale past one machine?**
Not as built. Event scopes, leases and presence are coordinated in one process
against one SQLite file. Horizontal scale is a rewrite of the hub, not a
configuration change, and is deliberately out of scope.

**67. What load has actually been shown?**
Probes, not capacity: a 12-part combination rendered with no clipped samples,
384 of 384 events per second voiced at normal desktop speed, 45.9 MiB of 256
MiB used under the load probe, and 32 listeners admitted with the next refused.
None of that is a real 32-person performance.

**68. What is the worst-case failure?**
Degraded, bounded, and loud about it. A refused page polls once a second and
says so, a stream with too much unsent data is closed, and load is meant to
fail boundedly rather than silently.

**69. What is the biggest technical risk?**
Timing. Synchronisation is best-effort across browsers with no sample-accurate
claim, and whether two devices sound aligned to a listener in a room is a
judged question automated checks cannot settle.

**70. What is the biggest product risk?**
That the grammar is too narrow to hold an experienced user — euclidean rhythms,
degradation, ranges and choice are all refused — and too wide to be learnable
from the Shape controls alone.

**71. Why restrict the grammar at all?**
So every pattern can be bounded exactly before it is built. Onsets per bar and
repeat period are computed on the tree, so a pathological expression is refused
instead of hanging a page.

**72. Why a custom mini-notation parser rather than Strudel's?**
Strudel's expands before you can bound it. Ours computes the bounds on the
tree, and is held to Strudel's own output for every supported construct over 24
cycles.

**73. What is the security posture on user code?**
Submitted text is never executed anywhere. It is parsed with Acorn against a
closed grammar, refused on anything outside it, and built only through
allowlisted calls. The server never imports Strudel at all.

**74. How is access control enforced?**
On the server, inside the transaction: membership, role, lease, revision and
capacity. Disabled buttons only explain; they never enforce.

**75. Does that apply to every surface?**
It is specified to apply to HTML, snapshots, exports, history, discovery,
invitation previews, polling, streams and replay, with a required regression
case for each. Private resources answer generically and are never publicly
cacheable.

**76. What is logged?**
Every committed change, refused command, first room presence, invitation and
moderation action: who, which resource, what kind, and for refusals the status
and reason.

**77. What is deliberately not logged?**
Code, chat text, invitation or link tokens, recovery codes and cookies.

**78. What personal data is held?**
A signed cookie identity, a handle the person chooses, a friend code, and a
hash of a recovery code. No email, no password, no third-party identity.

**79. What is the exposure around the Incredibox reference?**
The interaction idea is cited openly; the expression is not copied. Assets,
patterns and code are original and attributed as such in the catalogue itself.

**80. What about Strudel's licence?**
Strudel is a dependency, and dependency and audio notices are recorded in
`THIRD_PARTY.md`. Ensemble itself is AGPL-3.0-or-later.

**81. Why AGPL rather than MIT?**
It is a networked app. AGPL is the licence that makes a hosted modification
carry the same obligation as a distributed one.

**82. What moderation exists?**
Owner and host can tombstone messages and remove participants; a host kick
revokes performance access including link admission for that identity; and
anyone can block. Chat is plain text, capped at 500 characters, escaped, with
no attachments, voice or direct messages.

**83. Is that enough for a public launch?**
No. There is no reporting pipeline, no abuse backstop on public discovery and
no operator on call. Public listing is tolerable at prototype scale and would
need work before it is tolerable at any other.

**84. What is the migration story?**
Append-only and transactional, after a backup that is reopened,
integrity-checked and compared row for row before the migration runs.

**85. What happened to data from the earlier version?**
Preserved. Version 1 trees keep playing with no conversion in either direction,
legacy attribution and clips are kept, creators became owners, and unowned
legacy data was given no invented owner.

**86. Why carry two musical document formats indefinitely?**
Because converting between them means approximating someone's saved music. The
cost is two code paths; the alternative is silently changing what people made.

**87. What is the release gate?**
`pnpm check` and the browser suite against production assets on an isolated
database, plus the evidence check, before shipping.

**88. What has the last gate actually shown?**
On 28 October 2026, against the production image constrained to 256 MB: 273
passing and 1 skipped in `pnpm check`, and 15 passing production browser flows
at desktop and phone viewports, with axe WCAG 2 A/AA checks including contrast
on the guest editor.

**89. Has it been shown working deployed, not just locally?**
Yes. A three-profile browser check against the public URL with a private
project and an unlisted performance, in which the third profile listened and
chatted, was refused project access, then edited as a guest. Production logs
independently identified the host and guest actions.

**90. What does that check not establish?**
Human musical taste, uncoached usability, or audible alignment across devices.
The record says so explicitly.

**91. How are regressions caught?**
By failing first. Guest source access, stale revisions, the swallowed plan save
and the negative performer shape index were each written as a test that failed
before the fix.

**92. What is the accessibility commitment?**
Core controls work by keyboard and at both marking viewports, every drag has a
click alternative, controls are at least 44×44 CSS px, focus is visible and
returns, reduced motion is respected, and role is carried by shape, accessory
and text as well as by colour.

**93. What is the hardest thing to beat?**
Incredibox on first-minute delight, and a shared Strudel buffer on ceiling.
Ensemble only wins where both matter in the same room.

**94. What would make this worth continuing after the course?**
Evidence from observed sessions that mixed-experience pairs really do converge
on one mix, and a decision on whether the grammar's ceiling can rise without
losing the bounding guarantee.

**95. What is explicitly out of scope?**
Accounts, one shared text buffer, running submitted code, server-side or
sample-accurate network audio, microphones and WebRTC.

**96. What are the near-term build priorities?**
The RICE-ranked list in [the feature backlog](feature-backlog.md). The top of
it is per-part solo, starter mixes on the Play page, and a guided first minute.

**97. Why those rather than the deeper musical features?**
Because they are cheap and they serve the stated claim directly. A step-grid
editor ranks low not because it is unimportant but because it is weeks of work
against an unproven need.

**98. What would change the ranking fastest?**
Observed sessions. Reach and confidence in that table are estimates, and the
first real mixed-experience session is worth more than any of them.

**99. How is authorship accounted for?**
The process record pairs decisions with the commits they produced, and the
reflections are the student's own writing.

**100. If only one sentence survives, which is it?**
A newcomer and a programmer can change the same mix in the same minute, and
neither one's work is quietly rewritten to suit the other.
