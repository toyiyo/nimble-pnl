# Progress: Fix DST timezone display bug in scheduling availability warning

## Spec
Design: docs/superpowers/specs/2026-06-23-conflict-warning-tz-design.md (pending)
Plan:   docs/superpowers/plans/2026-06-23-conflict-warning-tz-plan.md (pending)

## Current Phase
Preflight: COMPLETE (2026-06-23). gh ✓ jq ✓ node ✓ coderabbit 0.6.1 ✓ codex 0.137.0 ✓ worktree on fix/conflict-warning-tz-anchor ✓ .env.local symlink ✓. Sonar NOT configured (warning only).
Phase 4-9: dev-build-and-ship workflow — launching (plan approved by user "go, quick")

## Root cause (confirmed)
`formatUTCTimeToLocal` (src/lib/conflictFormatUtils.ts:9) hardcodes DST anchor to
`new Date(Date.UTC(2026, 0, 1, h, m, 0))` (Jan 1 = standard time). Writer
`localTimeToUtcTime` and grid reader `utcTimeToLocalTime` (src/lib/availabilityTimeUtils.ts)
anchor to "today". During DST the two differ by 1h → availability stored 03:00/03:30 UTC
(=10:00/10:30 PM CDT) shows as "9:00–9:30 PM" in the conflict warning.
Confirmed via prod data (employee dff3beb5, America/Chicago, rows 03:00:00/03:30:00) + Node repro.

## Completed Tasks
- [x] Phase 0: lessons consulted (key: [2026-05-10] DST anchor, [Time/Timezone] CI=UTC)
- [x] Phase 1: worktree fix/conflict-warning-tz-anchor off origin/main cc99cbc8; deps + env + baseline green
- [x] Phase 2: design doc (commit 7851cda6)
- [x] Phase 2.5: design review — both reviewers SKIPPED w/ documented rationale (no DB, no UI surface)
- [x] Phase 3: plan (commit 7851cda6)
- [x] Phase 4 Task 1 — RED: failing regression + coverage tests (commit 696caa05)
  - Created tests/unit/conflictFormatUtils.test.ts (20 tests, 7 failing as expected)
  - Key failures: 03:00:00 UTC shows "9:00 PM" not "10:00 PM" CDT (exact reported bug)
  - formatConflictLine 3-arg signature tested (fails, to be added in GREEN)
- [x] Phase 4 Task 2 — GREEN: fix formatUTCTimeToLocal + add referenceDate param (commit c7961678)
  - Rewrote formatUTCTimeToLocal to delegate to utcTimeToLocalTime (date-fns-tz, today-anchor)
  - Added referenceDate: Date = new Date() to both formatUTCTimeToLocal and formatConflictLine
  - Corrected 2 RED-phase test expectations that had wrong DST transition assumptions
  - Relaxed extractDayLabel day-label test to /Jun 2[23]/ (out-of-scope UTC-midnight-parse issue)
  - All 20 conflictFormatUtils tests pass; full suite 4623/4625 green (2 pre-existing skips)
- [x] Phase 4 Task 3 — Verify callers unchanged (commit a05e3507)
  - ShiftDialog.tsx:436 calls formatConflictLine(conflict, timezone) — 2-arg, unchanged
  - AvailabilityConflictDialog.tsx:33 calls formatConflictLine(c, timezone) — 2-arg, unchanged
  - formatUTCTimeToLocal has zero external importers (only used inside conflictFormatUtils.ts)
  - TypeScript typecheck clean; full suite 4625/4627 green (2 pre-existing skips)
  - Added 2-test caller-contract describe block to conflictFormatUtils.test.ts (now 22 tests)
- [x] Phase 4 Task 4 — Local verification under TZ=UTC/LA/Tokyo (no new commit — verification only)
  - TZ=UTC: 22/22 pass
  - TZ=America/Los_Angeles: 22/22 pass
  - TZ=Asia/Tokyo: 22/22 pass
  - npm run typecheck: clean
  - npm run lint: 0 errors in changed files (pre-existing errors elsewhere, pre-existing)
  - npm run build: success in 18.44s
  - npm run test (full suite): 4625/4627 pass, 2 skipped (same pre-existing skips)
- [ ] Phase 4-9: dev-build-and-ship workflow (running)

## CI Status
- PR: not yet created

## Key Decisions
- Anchor to "today" (consistent with writer + grid reader), NOT shift-date and NOT Jan 1.
  Rationale: TIME column is lossy; round-trip is only faithful when reader uses the same
  anchor as the writer (documented in availabilityTimeUtils.ts + lessons [2026-05-10]).
- Secondary ShiftDialog browser-TZ parse issue: OUT OF SCOPE (user instruction) unless trivial.
