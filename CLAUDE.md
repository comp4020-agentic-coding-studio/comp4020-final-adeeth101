# Your harness

This file is yours, and it arrives empty on purpose. The rules you hold the
agent to are part of what gets marked, so they should be rules you decided on.

Nothing about the template is recorded here. What the repo ships is explained
where it lives --- `fly.toml`, the `Dockerfile`, the CI workflow and
`spec/README.md` each say what they fix --- and the course website publishes the
[final project brief](https://comp.anu.edu.au/courses/comp4020-agentic-coding-studio/assessments/final-project/).
What the agent needs to carry from any of it is your call.

## Product invariants

- Blocks, instruments and supported code share the validated model in `shared/music.ts`.
- Never execute submitted source text. Parse the closed grammar; preserve unsupported drafts.
- Track ownership and revision checks are enforced on the server. Conducting never grants clip ownership.
- Shared performance follows durable plans on a common clock; editing must not reset musical phase.
- A database mutation and its event commit together. Broadcast only after commit.
- Preserve musical data and legacy source during migrations. A restart stops transport, not saved composition.
- Core controls must work by keyboard and at both marking viewports; provide the form alternative to dragging blocks.
- Run `pnpm check` and `pnpm test:browser` against production assets. Check evidence before shipping.
- Read `docs/contract.md` for the product contract and `docs/architecture.md` for implementation trade-offs.
