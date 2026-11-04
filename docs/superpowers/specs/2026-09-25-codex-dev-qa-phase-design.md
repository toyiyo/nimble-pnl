# Codex `$dev`: mandatory `qa` phase — design

Date: 2026-09-25. Status: approved in the task request.

## Problem

The Claude `/dev` workflow has a mandatory Phase 8.5 QA gate. The script
halts before Ship when QA does not return `qaPassed=true`
(`.claude/workflows/dev-build-and-ship.js:776`). It re-runs Verify when QA
lists commits or HEAD moves after Verify
(`.claude/workflows/dev-build-and-ship.js:786`).

The Codex `$dev` state machine has no QA phase. `PHASES` goes from `verify`
directly to `ship` (`.agents/skills/dev/scripts/orchestrate.mjs:17`). A Codex
run can push without a browser QA pass.

## Design

1. Add `qa` to `PHASES` after `verify`. Add the `qa` evidence section to
   `SECTION_PHASES` (`orchestrate.mjs:52`) and to `createInitialState`.
2. The QA evidence uses the Claude result contract (`QA_SCHEMA`,
   `.claude/workflows/dev-build-and-ship.js:114`): `qaPassed`, `reportPath`,
   `headSha`, `charterRows`, `commits`, and the optional `bugsFixed`,
   `minorFindings`, and `exception`.
3. `complete qa` requires:
   - `qaPassed === true`. A `false` value gives "QA did not pass".
   - `reportPath` that exists in the worktree.
   - `headSha` equal to the current HEAD.
   - Passing Verify checks on the current HEAD.
4. `begin ship` checks the QA evidence again. `complete ship` and
   `complete done` also check QA and Verify on the current HEAD.
5. Verify invalidation. When the recorded QA `headSha` differs from the SHA of
   any Verify check, the orchestrator clears the Verify checks. It keeps the
   E2E coverage statement. It sets `reverifyRequired` on the QA evidence.
6. The `verify` command runs during the `qa` phase too. A pass during `qa`
   clears `reverifyRequired` and updates `phases.verify.sha`. Logs go to
   `logs/verify-post-qa-<n>`. The attempt count starts at 0 again, so the
   post-QA run has its own five-attempt budget, as in the Claude script.
7. `recheck` (after a CI or triage commit) resets `qa` with the other phases
   after `verify`. QA runs again on the new revision. This keeps the rule
   "no push before QA passes".
8. The skill docs point to `.claude/skills/qa/SKILL.md` for the method, in
   fix mode.

## Rejected option

Reset the whole `verify` phase to `in_progress` when QA commits. Then
`complete verify` moves to `qa` again, and QA runs a second time for each
fix. The Claude script does not do that, and it can loop.

## Decided trade-offs

- A CI or triage commit forces a new QA pass. This costs time, but a push
  never skips QA on the pushed revision.
- A docs-only or config-only diff still needs a report file with the
  one-sentence `exception`. The orchestrator does not start the app.
