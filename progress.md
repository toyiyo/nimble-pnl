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
- [x] Phase 4 task 3 (REFACTOR + sanity) — no new commit (zero code delta; see below)
      `grep -n "hours" src/pages/EmployeeTips.tsx` confirmed all `.hours` consumers already
      handled: type `hours: number | null` (line 122), `totalTeamHours` reduce already used
      `|| 0` pre-existing (line 142), `periodHours` reduce fixed in task 2 (line 151), both
      display sites guarded with `Boolean(tip.hours) &&` (lines 267/270 Breakdown, 376/378
      History). No other consumers in the file. `npm run typecheck` clean project-wide.
      `npx vitest run tests/unit/EmployeeTips.nullHours.test.tsx` — 3/3 GREEN. Full
      `npm run test` — 410 files / 5421 tests passed; 5 pre-existing failures
      (focusBackfillSyncHandler, focusDatafeedParser, focusBulkSyncHandler,
      focusSyncDataHandler, focusTransactionSyncHandler) all due to unrelated missing
      `fast-xml-parser` module in node_modules (declared in package.json, not installed) —
      confirmed unrelated to EmployeeTips.tsx via git log/grep. Working tree was already
      clean after task 2's commit 022c787e (which already carries the message
      "fix(tips): guard null hours in employee tips history tab (BUG-002)" required by this
      task) — no further code changes were required, so no additional commit was made.
- [x] Phase 5: UI review — only src/pages/EmployeeTips.tsx changed (UI file); reviewed against
      CLAUDE.md Apple/Notion guidelines. Diff is a minimal null-safety fix: type widened to
      `number | null`, `periodHours` reduce coerces null, History tab hours line wrapped in
      `Boolean(tip.hours) &&` — exactly mirroring the pre-existing Breakdown-tab guard/typography
      (`text-[13px] text-muted-foreground`). No new colors, no new interactive elements, no
      three-state-rendering regressions (loading/empty/error states untouched and already correct).
      `npm run lint` shows zero errors in EmployeeTips.tsx (all 1384 errors are pre-existing,
      unrelated files). `npm run typecheck` clean. No violations found — no fixes applied, no
      commit made (working tree already clean).
- [ ] Phase 6–9: code-simplify, CodeRabbit, verify, PR, CI loop, retrospective

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
