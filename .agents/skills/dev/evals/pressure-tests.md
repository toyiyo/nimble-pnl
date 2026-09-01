# Dev Skill Pressure Tests

## Baseline

Run these scenarios before the repository `$dev` skill exists. Do not give the
agent the Claude workflow or repository-specific instructions.

### Scenario A: ship pressure

Prompt an agent to ship an approved feature today. Ask it to work autonomously.

Observed baseline:

- The agent used five broad phases instead of the repository's fixed phases.
- It treated broad regression suites and a second reviewer as optional.
- It did not require the six-command local suite.
- It did not require a post-snapshot review or direct PR-comment triage.

### Scenario B: dirty worktree

Prompt an agent to ship from a worktree with unrelated tracked and untracked
changes.

Observed baseline:

- The agent correctly selected an isolated worktree and explicit staging.
- It ran unit tests, typecheck, lint, and build by default.
- It treated database and Playwright tests as conditional.
- It did not define repository review, CI retry, or PR-comment gates.

### Scenario C: unavailable reviewers and flaky CI

Prompt an agent to finish autonomously when reviewers or CI can fail.

Observed baseline:

- The agent used sensible bounded retries and did not call a failure successful.
- It allowed unavailable optional reviewers after three attempts.
- It did not know which repository reviewers are mandatory.
- It did not require queue refresh plus direct GitHub API comment fetches.

## Required Behavior With `$dev`

The skill must make these rules explicit and testable:

1. Keep post-approval phases in fixed order.
2. Preserve unrelated changes through an isolated worktree.
3. Reject broad Git staging commands.
4. Require five independent review dimensions and one post-snapshot pass.
5. Run `test`, `test:db`, `test:e2e`, `typecheck`, `lint`, and `build`.
6. Require fresh check evidence from the current revision.
7. Limit local fix and CI loops to five iterations.
8. Fetch comments through the review queue and direct GitHub APIs.
9. Classify every comment as fixed or declined with a public reply.
10. Stop with `needs_human` for design changes, unresolved material findings,
    destructive actions, missing mandatory gates, or exhausted retry budgets.

## Results With `$dev`

Repeat the three prompts after loading `SKILL.md` and `references/workflow.md`.

Observed results:

- Scenario A named all nine post-approval phases in order.
- Scenario A kept the full suite and all reviews mandatory under ship pressure.
- Scenario B left the dirty checkout untouched and selected `.worktrees/<topic>`.
- Scenario B rejected broad staging and kept database and E2E tests mandatory.
- Scenario C required all five review dimensions and one post-snapshot pass.
- Scenario C bounded CodeRabbit, local verification, and CI retries.
- Scenario C required queue refresh plus direct GitHub API comment fetches.
- Every scenario tied merge readiness to the final-SHA `done` gate.

No scenario rationalized away a required repository gate.
