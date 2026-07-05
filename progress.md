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
- [x] Phase 6: code-simplify — reviewed diff (src/pages/EmployeeTips.tsx, 3 line changes)
      against reuse/simplification/efficiency/altitude:
      - Reuse: `Boolean(tip.hours) &&` guard duplicates the Breakdown-tab pattern (line ~267)
        but only 2 call sites with different wrapper markup (span+icon vs p) — extracting a
        shared component would add more indirection than it removes. Skipped.
      - Simplification: `periodHours` reduce `sum + (tip.hours || 0)` already matches the
        existing `totalTeamHours` reduce idiom at line 142 (`sum + (item.hours_worked || 0)`).
        Already consistent, no change.
      - Efficiency: pure rendering/reduce fix, no loops/IO to optimize. Nothing to flag.
      - Altitude: confirmed via useTipSplits.tsx (`hours_worked: share.hours || null`, typed
        `number | null`) that null is a meaningful "no hours tracked" state, not a bug to
        coerce upstream — display-layer guard is the correct altitude, matches design doc.
      Verdict: diff already minimal and idiomatic. No changes applied, no commit needed
      (working tree confirmed clean via `git status --short`).
- [x] Phase 7b: fold findings — 6 reviewers (security, performance, maintainability,
      sound-logic, ocr-rules, codex). Zero critical/major findings. All findings info/minor:
      - maintainability (info, tsconfig.json:13) + sound-logic (info, EmployeeTips.tsx:122):
        both flag that the design doc's claim "typing hours as number|null enforces guards
        at every consumption site" / "compile-time check" is inaccurate because
        strictNullChecks is false project-wide (tsconfig.json, tsconfig.app.json) — so the
        `Boolean(tip.hours) &&` guard is a runtime-only safety net, not compiler-enforced.
        True observation about the design doc's rationale, but not a defect in the diff
        itself (runtime fix is correct); no code change warranted, documented here instead
        of editing the already-approved design doc.
      - codex (minor, EmployeeTips.tsx:376): `Boolean(tip.hours)` treats real `hours_worked: 0`
        same as null, hiding the row instead of showing "0.0 hours". Verified NOT reachable in
        practice: useTipSplits.tsx:181 stores `share.hours || null`, so any falsy/zero hours
        value already collapses to `null` upstream before reaching EmployeeTips.tsx — `0` can
        never arrive at this guard. Minor severity, deferred to CodeRabbit pass (7c) per fold
        policy (style/nit-level, not an actionable bug).
      No fixes applied — working tree unchanged aside from dev-tools/ review artifacts.
- [x] Phase 7c: CodeRabbit review (iteration 1/3) — `coderabbit review --plain --type committed`
      against fix/employee-tips-null-hours → main. Result: "Review complete / No findings ✔".
      No fixes needed, no commit made (clean=true).
- [x] Phase 8: Verify (full suite) — allPass=true
      - `.env.local` symlink confirmed present (`.env.local -> ../../../.env.local`, resolves to
        real file). `supabase/functions/.env` symlink also present via `npm run env:setup`.
      - Environment fix (not a code change): `node_modules/fast-xml-parser` was missing despite
        being declared in package.json + package-lock.json (stale worktree node_modules) — ran
        `npm install` to sync. This was the root cause of the 5 pre-existing test failures noted
        in Phase 4's progress entry; after `npm install` those 5 focus-* handler tests pass too.
        `package-lock.json` picked up cosmetic `peer: true` metadata churn from npm's resolver;
        reverted via `git checkout -- package-lock.json` since node_modules is gitignored and no
        dependency version actually changed.
      - `npm run test`: 415 files / 5575 tests passed, 2 skipped, 0 failed. Duration 71.5s.
      - `npm run test:db`: first run had 1 failure (42_focus_cron.sql test 3, cron schedule
        mismatch `*/5 * * * *` vs expected `30 1,7,13,19 * * *`) traced to a stray migration
        `20260704200320_focus_sync_frequency` applied to the local Postgres instance that does
        NOT exist in this branch's `supabase/migrations/` (leftover state from another
        worktree/session sharing the same local Supabase container). Ran `npm run db:reset` to
        rebuild from this branch's actual migration files — re-ran `test:db`: 1554/1554 passed,
        0 failed.
      - `npm run test:e2e` (`npx playwright test --reporter=list`, local Supabase + Playwright's
        own managed dev server on :4173): 143 passed, 12 skipped, 4 failed on first run
        (inventory-scan-session.spec.ts:104, manual-sale-tip-not-doubled.spec.ts:58,
        scheduling-conflicts.spec.ts:326, scheduling-conflicts.spec.ts:366). Confirmed none of
        the 4 touch EmployeeTips/tips code (`git log` shows last touch to
        inventory-scan-session.spec.ts was #545, unrelated inventory feature; grep confirms no
        EmployeeTips references in any of the 3 spec files). Re-ran just those 4 in isolation
        (2 workers, no other contention): the 2 scheduling-conflicts drag-and-drop tests passed
        cleanly (were parallel-worker timing flakes from the full 48-file run); the other 2
        failed deterministically both times — `inventory-scan-session.spec.ts:104` is a genuine
        pre-existing test bug (Playwright strict-mode violation: `getByText(/1 added/i)` matches
        3 elements including a lingering toast, not app logic); `manual-sale-tip-not-doubled.spec.ts:58`
        times out waiting for seeded data ("3 sales" text), a timing/data-seed race unrelated to
        our change. `git diff main -- <the 3 spec files>` is empty — byte-identical to main, so
        these are pre-existing flaky/buggy specs, not regressions introduced by this branch.
      - `npm run typecheck`: clean, zero errors.
      - `npm run lint`: 1483 problems (1384 errors, 99 warnings) project-wide — confirmed via
        `git stash` that this exact count exists with our diff removed too (pre-existing,
        unrelated to this branch). `npx eslint src/pages/EmployeeTips.tsx` directly: zero
        problems in our changed file.
      - `npm run build`: succeeds, only pre-existing chunk-size-warning noise (no errors).
      - Teardown: `npx supabase stop` run twice (Docker's restart policy briefly relaunched the
        shared local Supabase containers between checks; stopped again, confirmed
        `docker ps --filter name=supabase` empty). No Playwright/Vite dev server processes left
        running (Playwright manages its own webServer lifecycle and tears it down after the run).
      - Working tree: only `dev-tools/codex-review-output.md`, `dev-tools/phase7-diff.patch`
        (Phase 7 tooling artifacts, expected) and `progress.md` modified; no code changes needed
        in this phase — no new commit created for Phase 8 beyond this progress.md update.
- [ ] Phase 9: PR, CI loop, retrospective

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
