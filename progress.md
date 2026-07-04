# Progress: BUG-002 null.toFixed() crash on /employee/tips

## Spec
Link: docs/superpowers/specs/2026-07-04-employee-tips-null-hours-design.md

## Current Phase
Phase 4–9: dev-build-and-ship workflow — in-progress

## Completed Tasks
- [x] Phase 0: lessons consulted (synthetic-zero lesson → hide-when-absent over ??0); stale root progress.md deleted
- [x] Phase 1: worktree .claude/worktrees/employee-tips-null-hours, branch fix/employee-tips-null-hours
- [x] Phase 2: design doc committed (3d93bb54); approach pre-approved by user in task args
- [x] Phase 2.5: frontend reviewer ran (0 critical; 3 major = doc completeness, folded in 8b7d3622); supabase reviewer skipped (no DB surface)
- [x] Phase 3: plan committed (cb78b2d4) — docs/superpowers/plans/2026-07-04-employee-tips-null-hours-plan.md
- [x] Phase 4 task 1 (RED): failing unit test added — commit 8536f6ca
      tests/unit/EmployeeTips.nullHours.test.tsx (Case A confirmed RED with
      "Cannot read properties of null (reading 'toFixed')" at EmployeeTips.tsx:377:36
      before fix; Cases B/C passed immediately — those sites were already safe per design doc)
- [x] Phase 4 task 2 (GREEN): fix EmployeeTips.tsx — commit 022c787e
      Type `hours: number` → `hours: number | null` in `myTips` (line ~122);
      History-tab hours `<p>` (line ~377) wrapped in `Boolean(tip.hours) &&` guard
      matching Breakdown tab; `periodHours` reduce (line ~151) made explicit
      `sum + (tip.hours || 0)`. `npx vitest run tests/unit/EmployeeTips.nullHours.test.tsx`
      — all 3 cases (A/B/C) GREEN. `npm run typecheck` clean.
- [ ] Phase 4 task 3 (REFACTOR + full local suite sanity, commit)
- [ ] Phase 5–9: UI review, code-simplify, CodeRabbit, verify, PR, CI loop, retrospective

## CI Status
- PR: not yet created

## Blockers
- none

## Key Decisions
- Root cause: useTipSplits hours_worked is number|null (manual splits store share.hours || null);
  EmployeeTips.tsx:377 (History tab) calls tip.hours.toFixed(1) unguarded. Breakdown tab (line 267)
  and TipTransparency (line 47) are already guarded.
- Fix: hide hours line when null (match Breakdown-tab idiom), type hours as number|null, explicit
  reduce coercion — NOT (value ?? 0).toFixed which would render fake "0.0 hours".
- PostHog error tracking has no matching issue (searched toFixed + /employee/tips, 90d) — report
  likely from an older window/different tracker; static analysis is deterministic.
