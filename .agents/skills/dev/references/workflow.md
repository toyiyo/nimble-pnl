# Workflow Contract

## Scope

This skill replaces the Claude `/dev` runtime with a Codex skill and a Node
state machine. The design and planning phases stay interactive. The ten
post-approval phases run autonomously in this order: `build`, `ui-review`,
`simplify`, `review`, `verify`, `qa`, `ship`, `ci`, `triage`, and `done`.

The state machine stores run data in the worktree's Git administrative path.
It writes `progress.md` as a human-readable recovery file. Neither file belongs
in a commit.

## Interactive Phases

### Phase 0: Consult Lessons And Recover

Read `memory/lessons.md`. Check `progress.md`, the current branch, and recent
commits. Resume only when all references describe the same active task.

### Phase 1: Isolate

Create a `codex/<topic>` branch in `.worktrees/<topic>`. Do not disturb a dirty
root checkout. Bootstrap the worktree before design or code work:

```bash
npm install --no-audit --no-fund
cp <root>/.env.local .env.local
test -x node_modules/.bin/vite
node .agents/skills/dev/scripts/orchestrate.mjs check-ready
```

Stop if the readiness check fails. Never run E2E against production Supabase.

### Phase 2: Design

Inspect the existing implementation and clarify requirements one question at a
time. Compare viable approaches, recommend one with explicit tradeoffs, and
cite `file:line` for each claim about existing code. Commit the approved design
on the feature branch.

Run applicable Supabase and frontend design reviews. Both reviews must check
the design's existing-code claims. Fix or document every material concern.

### Phase 3: Plan

Write small TDD tasks with exact files and commands. Each task must specify its
RED test, minimal GREEN implementation, focused verification, and explicit-path
commit. Commit the plan. Request explicit plan approval.

## Autonomous Phases

Initialize `.agents/skills/dev/scripts/orchestrate.mjs` after plan approval.
For every phase, call `begin`, perform the work, record JSON evidence with
`evidence`, and call `complete`.

### Build

Execute plan tasks sequentially unless their write sets are independent.
Every task must show:

1. RED: a new test fails for the expected reason.
2. GREEN: the smallest implementation passes the test.
3. REFACTOR: relevant tests remain green.
4. COMMIT: explicit paths only.

Build evidence format:

```json
{
  "taskCount": 1,
  "tasks": [
    { "id": "task-1", "status": "completed", "commit": "abc123", "redEvidence": "...", "greenEvidence": "..." }
  ]
}
```

Stop with `needs_human` when a task requires an approved-design change.

### UI Review

Review changed UI at desktop and mobile widths. Check loading, empty, error,
and populated states. Check keyboard access, focus, contrast, text fit, and
interaction behavior. Use browser screenshots for user-facing changes.

Record `{ "status": "reviewed", "artifact": "..." }`. For a non-UI change,
record `{ "status": "skipped", "reason": "No UI files changed" }`.

### Simplify

Review the changed code for unnecessary complexity, duplication, unclear names,
and deviations from existing repository patterns. Preserve behavior. Run
affected tests and commit explicit paths. Record `{ "status": "completed", ... }`.

### Review

Capture the review snapshot SHA. Run these independent dimensions in parallel:

- `security`: authorization, RLS, secrets, unsafe input, data exposure.
- `performance`: queries, rendering, bundle cost, repeated work, scaling.
- `maintainability`: clarity, duplication, conventions, test quality.
- `logic`: requirements, edge cases, state transitions, financial accuracy.
- `rules`: deterministic repository rules and approved-design compliance.

Use read-only reviewers. Give each reviewer the design, plan, branch diff, and
commit log. Every finding needs severity, file, line, and rationale.

Fold all findings. Fix critical and major findings. Fix safe minor findings.
Record every other finding with a reason. Never discard a finding silently.

Review the post-snapshot diff exactly once after fixes. Run CodeRabbit up to
three times when available. An unavailable CodeRabbit CLI is allowed only with
an explicit reason because the five review dimensions remain mandatory.

Review evidence format:

```json
{
  "snapshotSha": "abc123",
  "reviewers": {
    "security": { "status": "clean", "artifact": "/tmp/security.json" },
    "performance": { "status": "clean", "artifact": "/tmp/performance.json" },
    "maintainability": { "status": "clean", "artifact": "/tmp/maintainability.json" },
    "logic": { "status": "clean", "artifact": "/tmp/logic.json" },
    "rules": { "status": "clean", "artifact": "/tmp/rules.json" }
  },
  "fold": { "status": "completed", "deferred": [] },
  "postSnapshot": { "status": "completed", "artifact": "/tmp/post-snapshot.json" },
  "codeRabbit": { "status": "unavailable", "reason": "CLI is unavailable" }
}
```

### Verify

Record E2E coverage before the suite:

```bash
node .agents/skills/dev/scripts/orchestrate.mjs e2e \
  --status covered \
  --detail "tests/e2e/example.spec.ts covers the primary flow"
```

Use `--status exception` only for a non-behavioral change. Explain the largest
runnable slice. "Hard to seed" is not an exception.

Run the deterministic full suite:

```bash
node .agents/skills/dev/scripts/orchestrate.mjs verify
```

Immediately before the suite, the orchestrator revalidates `.env.local` and
forces its local URL into both `VITE_SUPABASE_URL` and `SUPABASE_URL` for the
E2E child process. This overrides inherited or mode-specific production URLs.

It runs, in order:

1. `npm run test`
2. `npm run test:db`
3. `npm run test:e2e`
4. `npm run typecheck`
5. `npm run lint`
6. `npm run build`

Fix failures and rerun. Stop after five failed local iterations.

### QA

QA is mandatory. It is the Codex form of the Claude `/dev` Phase 8.5. Follow
the method in `.claude/skills/qa/SKILL.md` in **fix mode**. Do not copy the
method here. That skill is the one source.

In short, the method does these steps:

1. Check that `.env.local` points at local Supabase. QA never runs against
   production. If the check fails, halt with `needs_human`.
2. Build a charter from the design and plan: one row for each user-facing
   behavior, plus one adjacent flow.
3. Drive the running app in Chromium. Apply each QA lens that fits a row.
   Mark the other lenses `n/a` with a reason.
4. Write the report to `dev-tools/qa/qa-report-<branch-slug>.md`. The
   directory is gitignored.
5. For each `critical` or `major` bug, write a failing regression test, fix
   the code, and commit explicit paths: `fix(qa): <what> — QA bug <ID>`.
   Stop after three rounds and halt with `needs_human`.

A diff that changes only docs, `.claude/`, `.github/`, or config with no
runtime effect does not start the app. Write the report with a one-sentence
`exception`, set `charterRows` to 0, and set `qaPassed` to `true`. A change
under `src/` or `supabase/` is never an exception.

Record the QA result. It uses the same contract as `QA_SCHEMA` in
`.claude/workflows/dev-build-and-ship.js`:

```json
{
  "status": "completed",
  "qaPassed": true,
  "reportPath": "dev-tools/qa/qa-report-codex-example.md",
  "headSha": "<current HEAD, after QA fix commits>",
  "charterRows": 6,
  "bugsFixed": 1,
  "commits": ["<QA fix SHA>"],
  "minorFindings": [{ "title": "...", "severity": "minor", "evidence": "..." }]
}
```

The orchestrator applies these rules:

- `evidence qa` fails when `headSha` is not the current HEAD, or when the
  `reportPath` file does not exist.
- When `headSha` differs from the Verify checks, the orchestrator clears the
  Verify checks and sets `reverifyRequired`. This occurs after a QA fix commit.
- Then run `verify` again during the `qa` phase. The post-QA run has its own
  five-attempt budget. Its logs go to `verify-post-qa-<n>`.
- `complete qa` fails when `qaPassed` is not `true`, when the report is
  missing, or when Verify did not pass on the current HEAD.
- `begin ship` fails without a passed QA result. Green tests are not a QA pass.

When QA returns `qaPassed=false`, halt with `needs_human` and name the open
bug IDs from the report.

### Ship

Push the feature branch. Create or update the pull request. Include Summary,
Test Plan, the design link, and deferred review findings. Add a `## QA`
section with the verdict, the charter row count or the exception, the bugs
fixed, the report path, and each open minor QA finding.

Record ship evidence on the current SHA:

```json
{ "prNumber": 123, "sha": "<current HEAD>" }
```

### CI

Watch required checks. Fix failures locally, commit, push, and repeat. Record
the final passing SHA and iteration. Stop after five failed CI iterations.

When a CI fix creates a commit, restart the revision-scoped gates before
rerunning CI:

```bash
node .agents/skills/dev/scripts/orchestrate.mjs recheck
```

```json
{ "status": "passed", "sha": "<current HEAD>" }
```

The orchestrator counts each recorded CI result. Call `halt` after five failed
records. Do not provide or reset the iteration counter in evidence.

### Triage

Green CI is not completion. Always run both sources:

1. `dev-tools/refresh-queue.sh --pr <number> --skip-tests`
2. Direct `gh api` fetches for issue comments, review comments, and reviews.

Print the complete list. Classify every comment. Fix it with a commit, or reply
on the PR with the reason for declining it. Rerun affected checks after fixes.

```json
{
  "queueFetched": true,
  "directApiFetched": true,
  "total": 3,
  "fixed": 2,
  "declinedWithReply": 1,
  "artifact": "/tmp/triage.json",
  "sha": "<current HEAD>"
}
```

If triage creates a commit, run `recheck`, repeat verification, QA, and
shipping, return to CI, then perform triage again on the new SHA.

`recheck` resets `qa` with the other phases after `verify`. QA runs again on
each new revision, so no push skips QA.

### Done

Start `done` only after triage. Confirm the current SHA has green CI, a passed
QA result, all comments have dispositions, the worktree is clean, and every prior phase is
complete. Run `complete done`. Only then report the PR ready for review.

## Halt And Resume

Use a structured halt instead of improvising:

```bash
node .agents/skills/dev/scripts/orchestrate.mjs halt \
  --status needs_human \
  --reason "The implementation requires a design decision about ..."
```

Halt for design changes, destructive actions, unresolved material findings,
missing mandatory infrastructure, or exhausted retry budgets. After the user
resolves the blocker, run `resume` and continue the same phase.
