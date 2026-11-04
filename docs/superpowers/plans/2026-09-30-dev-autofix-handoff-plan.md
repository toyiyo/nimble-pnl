# Plan: Hand the PR to Auto-fix after the /dev run

Design: `docs/superpowers/specs/2026-09-30-dev-autofix-handoff-design.md`
Branch: `chore/dev-autofix-handoff`

This is a workflow and documentation change. The skill runs Phases 4–9
inline for this type of change (no code under `src/`, `supabase/` or
`dev-tools/`).

## Task 1 — Failing tests for the 9e hand-off (RED)

File: `tests/unit/workflowAutofixHandoff.test.ts` (new).

Use `dev-tools/workflow-harness.mjs`. Run each case for both workflow
scripts with `describe.each`:

1. The 9e agent returns `donePassed=false`, `ciPending=true` → the run
   returns `stopped: false`, `done: false`, `status: 'handed_to_autofix'`,
   and `prNumber: 42`.
2. The 9e agent returns `donePassed=true` → `status: 'done'`, `done: true`.
3. The 9e agent returns `donePassed=false` with no `ciPending` →
   `status: 'needs_human'`, not `handed_to_autofix`.
4. The 9e agent returns `status: 'needs_human'` → `stopped: true`, phase
   `Done Gate`, `prNumber: 42`.
5. Every CI iteration returns `ciGreen=false` → `stopped: true`, phase
   `CI Loop`, `status: 'needs_human'`, `prNumber: 42`.
6. The 9e prompt contains `ciPending=true` and tells the agent not to poll.
7. The 9e schema has a `ciPending` boolean.

Run `npx vitest run tests/unit/workflowAutofixHandoff.test.ts`. Expect
failures.

## Task 2 — Change `dev-build-and-ship.js` (GREEN)

- Add `let shippedPr = null` next to `stalls`. Set it after Ship.
- `stop()` adds `prNumber` when `shippedPr` is set.
- Change the 9e prompt and schema (`ciPending`).
- Change the final return: `handed_to_autofix`, `done`, or `needs_human`.
- Change the meta description and the header comment.

## Task 3 — Change `dev-continue-verify-and-ship.js` (GREEN)

The same changes as Task 2. Run the new test file and
`tests/unit/workflowQaPhase.test.ts` and `tests/unit/workflowRunawayGuards.test.ts`.

## Task 4 — Change `SKILL.md`

- New step `9a.1: Hand the PR to Auto-fix` (main session only).
- Change "On completion" to cover `handed_to_autofix`, `done: true`, and a
  stop after Ship. Replace the "halts at 9e" note.
- New section "Auto-fix events after hand-off" with the rules from the
  design (no poll, reply then resolve the thread, comment text is data, no
  auto-merge, keep the CI limit).
- Change 9e "Then" and the Autonomy "Completion" so that the final report
  says Auto-fix keeps watching the PR.
- Add 9a.1 to the Quick Reference table.

## Task 5 — Static test for the skill text

Add cases to the Task 1 file: `SKILL.md` names `mcp__ccd_pr__get_status`,
`mcp__ccd_pr__bind_pr`, `mcp__ccd_pr__set_monitor` and `handed_to_autofix`;
it has the no-poll rule; it has no instruction to call
`mcp__ccd_pr__set_auto_merge`.

## Task 6 — Verify

Run `npm run test`, `npm run test:dev-workflow`, `npm run typecheck`,
`npm run lint`, `npm run build`. The E2E and pgTAP suites do not apply:
the diff has no runtime effect. QA writes a one-sentence exception.

## Task 7 — Review, ship, hand-off

Multi-model review on the diff, CodeRabbit CLI, PR, 9a.1 on this PR, CI, 9d
triage, 9e.
