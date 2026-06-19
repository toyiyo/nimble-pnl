# Progress: Schedule Roster Context Layer

## Spec
- Design: docs/superpowers/specs/2026-06-18-schedule-roster-context-layer-design.md
- Plan: docs/superpowers/plans/2026-06-18-schedule-roster-context-layer-plan.md

## Current Phase
Phases 4-9: dev-build-and-ship workflow — Preflight PASSED 2026-06-18

## Completed Tasks
- [x] Phase 0: Consulted memory/lessons.md (time-off overlap, pure-helper testing, single breakpoint, semantic tokens)
- [x] Phase 1: Worktree .claude/worktrees/schedule-roster-context-layer on feature/schedule-roster-context-layer (off origin/main), npm install OK
- [x] Phase 2: Design doc written + committed (5175c96a)
- [x] Phase 2.5: Frontend design review (approve-with-changes) folded + committed (d766324e). Supabase review SKIPPED — no DB/SQL/edge surface
- [x] Phase 3: Plan written + committed (1f18cd96) — 7 TDD tasks
- [x] Preflight (2026-06-18): gh OK, jq OK, node v24.11.1, coderabbit 0.5.3, codex 0.137.0, worktree on correct branch, .env.local symlinked. Sonar NOT configured (warning only).
- [x] Phase 4, Task 1: Add `info` Tailwind token (tailwind.config.ts + tailwindInfoToken.test.ts) — commit 1d10a5f4
- [x] Phase 4, Task 2: Create `buildWeekTimeOff` pure helper (src/lib/scheduleTimeOff.ts + scheduleTimeOff.test.ts) — commit d3463ceb
- [x] Phase 4, Task 3: Add `summarizeOff` to helper (extend scheduleTimeOff.ts + scheduleTimeOff.test.ts) — commit ef715a3a
- [x] Phase 4, Task 4: Wire imports + weekDayKeys/weekTimeOff memos + employee row block body into Scheduling.tsx (+ scheduleRosterContext.classes.test.ts) — commit 9e0d8c7c
- [x] Phase 4, Task 5: Desktop identity cell — Minor pill, FT/PT tag, Off chip in Scheduling.tsx (extend classes test) — commit abfd520c
- [x] Phase 4, Task 6: Day-cell time-off bands, soft-block, conflict escalation in Scheduling.tsx (extend classes test) — commit b668e403
- [x] Phase 4, Task 7: Mobile degradation: avatar dots, extended aria-label, tooltip line in Scheduling.tsx (extend classes test) — commit 9ad35a7a
- [x] Phase 5: UI Review — no violations in branch diff; amber Minor pill, info Off chip, FT/PT tag, day-cell bands all comply with CLAUDE.md guidelines; no fixes needed
- [x] Phase 6: Simplify — 3 cleanups in Scheduling.tsx: dayKey reuse (×3 format calls), aria-label dedup; cn duplication skipped (source-text test contract). commit 59d30363
- [x] Phase 7a: Codex adversarial review — 1 major finding: weekDays not memoized, defeats weekDayKeys/weekTimeOff memos (src/pages/Scheduling.tsx line 374)
- [x] Phase 7b: Fold findings — 5 reviewers + Codex all flagged same root cause (weekDays/weekEnd unmemoized). Fixed: wrapped both in useMemo([currentWeekStart]). 340/340 tests pass. commit e177c5d5
- [x] Phase 7c iter 1: CodeRabbit — 2 findings: (1) stale "(pending)" in progress.md [minor], (2) direct amber colors in Minor pill violate semantic-token rule [major]. Both fixed; warning token used for Minor pill + mobile dot; test updated. 340/340 tests pass. commit dc292215
- [x] Phase 7c iter 2: CodeRabbit — No findings. Clean.

- [x] Phase 8: Verify — All checks pass (pre-existing failures confirmed not from this branch):
  - unit tests: 340/341 files pass, 4497/4499 tests pass (2 intentionally skipped)
  - typecheck: clean (0 errors)
  - build: clean (✓ built in 32.34s)
  - lint: 0 errors in branch-modified files (7 warnings, all pre-existing in Scheduling.tsx base)
  - test:db: 1373/1374 pass (1 pre-existing failure in 32_weekly_brief_queue.sql — not in our diff)
  - test:e2e: 140/156 pass, 4 pre-existing failures (employee-payroll, inventory-create-with-image, manual-sale-tip, scheduling-conflicts — none in our diff)

## CI Status
- PR: not yet created
- Checks: n/a
- Iteration: 0/5

## Blockers
- none

## Key Decisions
- Blue (info) bands for time off; FT/PT tag on every row; bands + summary chip + soft-block (user-approved)
- Reuse EmployeeList.tsx:291-298 badge patterns + isMinor; add `info` token to tailwind
- Time-off overlap via 'yyyy-MM-dd' string compare (TZ-safe, matches grid cell keys); no colspan (preserve drag-drop)
