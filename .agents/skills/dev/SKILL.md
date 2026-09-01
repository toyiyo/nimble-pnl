---
name: dev
description: Use when a Nimble P&L feature or bug fix must move from an idea or approved design through planning, TDD implementation, review, verification, pull request creation, CI, and comment triage.
---

# Nimble Development Workflow

Use this workflow for every code-producing feature or bug fix in this
repository. Read [references/workflow.md](references/workflow.md) before you
start. Treat its hard gates as requirements, not guidance.

## Start Or Resume

1. Read `memory/lessons.md` and any active `progress.md`.
2. Resume only when the progress file, branch, design, and plan agree.
3. Create an isolated `codex/<topic>` worktree before new design or code work.
4. Use `$brainstorming` for the design and `$writing-plans` for the plan.
5. Get user approval for the plan before the autonomous build phases.

For an approved design without a plan, review the design first. Then create the
plan and request approval. Do not treat design approval as plan approval.

## Start The Deterministic Gates

After plan approval, initialize the state machine from the feature worktree:

```bash
node .agents/skills/dev/scripts/orchestrate.mjs init \
  --worktree "$PWD" \
  --branch "$(git branch --show-current)" \
  --design docs/superpowers/specs/<design>.md \
  --plan docs/superpowers/plans/<plan>.md
```

For each phase, run `begin`, execute the phase contract, record its evidence,
and run `complete`. The orchestrator rejects missing evidence and phase skips.

```bash
node .agents/skills/dev/scripts/orchestrate.mjs begin build
node .agents/skills/dev/scripts/orchestrate.mjs evidence build --file /tmp/dev-build.json
node .agents/skills/dev/scripts/orchestrate.mjs complete build
```

Use `status --json` after interruptions. Use `halt` for a genuine blocker. Use
`resume` only after the blocker has been resolved.

## Non-Negotiable Rules

- Execute `build`, `ui-review`, `simplify`, `review`, `verify`, `ship`, `ci`,
  `triage`, and `done` in that order.
- Use RED, GREEN, REFACTOR, and one explicit-path commit for each plan task.
- Never use `git add -A`, `git add .`, or `git commit -a`.
- Preserve unrelated user changes. Work in an isolated worktree.
- Stop with `needs_human` when implementation requires a design change.
- Run all five review dimensions and the post-snapshot review.
- Run all six local checks through the orchestrator.
- Treat green CI as incomplete until direct PR-comment triage passes.
- Do not claim completion before the `done` command marks the run ready.

The project Stop hook may continue an incomplete workflow once. If that
happens, inspect `status` and finish or halt the active phase with a reason.
