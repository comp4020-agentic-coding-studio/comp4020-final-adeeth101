# Your harness

This file is yours, and it arrives empty on purpose. The rules you hold the
agent to are part of what gets marked, so they should be rules you decided on.

Nothing about the template is recorded here. What the repo ships is explained
where it lives --- `fly.toml`, the `Dockerfile`, the CI workflow and
`spec/README.md` each say what they fix --- and the course website publishes the
[final project brief](https://comp.anu.edu.au/courses/comp4020-agentic-coding-studio/assessments/final-project/).
What the agent needs to carry from any of it is your call.

## Product invariants

- Ensemble is a collaborative, editable Incredibox: sounds given to a band of performers. Not a dashboard; presets first, Shape and Code on a part.
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
- Run `pnpm check` and `pnpm test:browser` against production assets on an isolated database. Check evidence before shipping.
- Read `docs/ensemble-contract.md` for the product direction, `docs/contract.md` for what is built and `docs/architecture.md` for trade-offs.
