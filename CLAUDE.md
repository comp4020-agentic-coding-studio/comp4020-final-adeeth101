# Your harness

This file is yours, and it arrives empty on purpose. The rules you hold the
agent to are part of what gets marked, so they should be rules you decided on.

Nothing about the template is recorded here. What the repo ships is explained
where it lives --- `fly.toml`, the `Dockerfile`, the CI workflow and
`spec/README.md` each say what they fix --- and the course website publishes the
[final project brief](https://comp.anu.edu.au/courses/comp4020-agentic-coding-studio/assessments/final-project/).
What the agent needs to carry from any of it is your call.

## Product invariants

- Ensemble is a collaborative, editable Incredibox: sounds given to a band of characters. Keep the stage simple; reveal Pattern, Shape and Code for a selected track.
- The grid is a view of source, never a second musical pattern. Switching views or grid detail never rewrites source. Preserve untouched and locked text; refuse an inexact edit. Length controls must not strand a pattern outside the editable grid. Allow 32 columns per bar, bounded to 128 per pattern, and retain keyboard focus when changing detail.
- A character saves its appearance and music together. Using one copies its data into the track; later library edits cannot silently change an existing mix. Appearance is allowlisted data, never submitted markup.
- A published character listing is an explicit, versioned snapshot. Private work and unrelated project content must never travel with it. Unlisting or deleting an original leaves independent copies intact; enforce ownership, revisions and visibility on every route.
- Deletion names its consequence. Mix owners may delete/restore/purge; members may leave. Revocation reaches existing streams. Track removal, saved-character deletion and unpublishing are distinct operations.
- Sections use the durable shared plan and host authority. Suggestions are previews until applied. Export uses a stable permitted snapshot and a separate offline engine; it must never alter shared transport or live audio.
- Never execute submitted source text. Parse the closed grammar in `shared/expr.ts`; bound it before expanding; keep source verbatim; keep refused drafts on the device.
- Version 1 trees (`shared/music.ts`) keep playing. Never convert between versions or approximate a part to fit a control; disable the control with a reason.
- Check access in `src/access.ts` before reading anything. Visibility controls reading, roles control writing, friendship grants nothing. Private things answer like missing ones and are never cached.
- Membership, leases, revisions and capacity are enforced on the server. Hosting never grants ownership; a performance role never grants membership.
- Guest editors receive only their own exact source; guest edits require the current revision. Blocked chat is a personal view applied before pagination, without changing membership or shared history.
- Every event has a scope; a stream reads one scope. A mutation and its events commit together; broadcast only after commit.
- Shared performance follows durable plans on the project's clock; editing or going live must not reset musical phase.
- Every committed change and every refused command logs who did what via `logAction`. Never log code, chat text, tokens, recovery codes or cookies.
- Migrations are append-only, transactional and backed up. Preserve musical data, authorship and legacy source. A restart stops sound and live sessions, not saved work.
- Core controls work by keyboard and at both marking viewports; every drag has a click alternative; Escape closes and focus returns.
- Never print secret-bearing configuration, credentials, cookies or recovery material while inspecting the app or recording evidence. Read named source/document files rather than dumping local configuration.
- Run `pnpm check` and `pnpm test:browser` against production assets on an isolated database. Check evidence before shipping.
- Read `docs/ensemble-contract.md` for the product direction, `docs/contract.md` for what is built and `docs/architecture.md` for trade-offs.
