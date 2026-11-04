# Plan: Delete the dead page EmployeeShiftMarketplace

Date: 2026-08-14
Design: docs/superpowers/specs/2026-08-14-delete-dead-employee-shift-marketplace-design.md
Branch: claude/gifted-joliot-f8335d

## Execution mode

Run all phases inline. The lesson from 2026-08-09 (PR #731) says: run a
small, low-risk change inline from the start. This change deletes one
file.

## Tasks

### Task 1: Delete the file

1. Run `grep -rn "EmployeeShiftMarketplace" src/` one final time.
2. Confirm the grep matches only `src/pages/EmployeeShiftMarketplace.tsx`.
3. Delete `src/pages/EmployeeShiftMarketplace.tsx` with `git rm`.
4. Commit: `chore: delete dead page EmployeeShiftMarketplace`.

TDD note: a deletion adds no behavior, so it adds no new test. The
existing suite is the regression net.

### Task 2: Review gates (Phase 7)

1. Run the five Phase 7a reviewers against the branch diff.
2. Run `dev-tools/codex-adversarial-review.sh main` (best-effort).
3. Fold findings per Phase 7b rules.
4. Run `coderabbit review --agent --committed --base origin/main`
   (best-effort; skip if the CLI is absent).

### Task 3: Verify (Phase 8)

1. Run `npm run typecheck`.
2. Run `npm run test`.
3. Run `npm run lint`.
4. Run `npm run build`.
5. E2E and pgTAP: justified exceptions per the design doc.

### Task 4: Ship (Phase 9)

1. Push the branch.
2. Open a chore PR with `gh pr create`.
3. Watch CI with `gh pr checks --watch`.
4. Triage every review comment (Phase 9d). Run the pr-triage audit.
5. Report Done only after CI is green and the audit exits 0.
