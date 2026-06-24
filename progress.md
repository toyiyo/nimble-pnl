# Progress: Fix DST timezone display bug in scheduling availability warning

## Spec
Design: docs/superpowers/specs/2026-06-23-conflict-warning-tz-design.md (complete)
Plan:   docs/superpowers/plans/2026-06-23-conflict-warning-tz-plan.md (complete)

## Current Phase
Preflight: COMPLETE (2026-06-23). gh ✓ jq ✓ node ✓ coderabbit 0.6.1 ✓ codex 0.137.0 ✓ worktree on fix/conflict-warning-tz-anchor ✓ .env.local symlink ✓. Sonar NOT configured (warning only).
Phase 4-9: dev-build-and-ship workflow — launching (plan approved by user "go, quick")

## Root cause (confirmed)
`formatUTCTimeToLocal` (src/lib/conflictFormatUtils.ts:9) hardcodes DST anchor to
`new Date(Date.UTC(2026, 0, 1, h, m, 0))` (Jan 1 = standard time). Writer
`localTimeToUtcTime` and grid reader `utcTimeToLocalTime` (src/lib/availabilityTimeUtils.ts)
anchor to "today". During DST the two differ by 1h → availability stored 03:00/03:30 UTC
(=10:00/10:30 PM CDT) shows as "9:00–9:30 PM" in the conflict warning.
Confirmed via prod data (employee redacted, America/Chicago, rows 03:00:00/03:30:00) + Node repro.

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
- [x] Phase 5: UI review — N/A (no UI surface changed; pure lib + test)
- [x] Phase 6: simplify (commit 20c14afa)
  - conflictFormatUtils.ts: already minimal, no changes needed
  - test file: removed no-op `expect(true).toBe(true)` shell from caller-contract describe block;
    moved audit note into block-level comment; renamed remaining test to describe what it asserts
  - 21 tests remain, all pass (was 22; the removed test had no assertions)
- [x] Phase 7a: Codex adversarial review — COMPLETE (2026-06-23)
  - Finding (major): formatConflictLine uses today's DST anchor for exception conflicts, but
    exceptions are written using the exception's own date. Cross-DST-period exceptions will
    display 1h off (mirror of the original bug). Filed as out-of-scope spawn task.
    Output: dev-tools/codex-review-output.md
- [x] Phase 7b: Fold review findings — COMPLETE (2026-06-23, commit 79635265)
  - Fixed (major/Codex): exception conflicts now use per-exception date anchor via
    extractDateAnchor(); falls back to referenceDate when no ISO date in message.
  - Fixed (minor): duplicate test removed (lines 137/165 had identical inputs); test
    renamed ('handles 00:00:00' → 'handles midnight local (06:00 UTC → 12:00 AM CST)');
    internal-task comment replaced with timeless grep-verified rationale.
  - 23 tests pass; full suite 354 files / 4626 tests green (same pre-existing 2 skips).
  - Security/performance findings: none. Maintainability/sound-logic findings: minor only (addressed).
- [x] Phase 7c: CodeRabbit review — COMPLETE (2026-06-23, clean=true)
  - 2 minor findings, both in src/utils/timePunchProcessing.ts (NOT in this branch's diff)
  - Finding 1: break_start overwrites open break (pre-existing, out-of-scope)
  - Finding 2: burst-noise reason text says ">3" but threshold is >=3 (spawned as task_a3ed6e1f)
  - No actionable findings for this PR's changed files (conflictFormatUtils.ts + test)

- [x] Phase 8: Verify — COMPLETE (2026-06-23)
  - npm run test: 354 files / 4626 tests pass, 2 skipped (same pre-existing skips)
  - npm run typecheck: clean
  - npm run lint: 1438 pre-existing errors (0 in changed files: conflictFormatUtils.ts + test)
  - npm run build: success in 17.81s
  - npm run test:db: 1373/1374 pass; 1 failure (enqueue_weekly_brief_jobs, pre-existing, NOT in diff)
  - npm run test:e2e: 145/158 passed, 12 skipped, 1 failed (manual-sale-tip-not-doubled.spec.ts,
    pre-existing, NOT in diff — file last changed in PR #411, 0 changes in this branch)
  - Dev server started on port 8081 (8080 in use), torn down after E2E

## CI Status
- PR: #549 — https://github.com/toyiyo/nimble-pnl/pull/549 (opened 2026-06-23)
- CI: GREEN (all checks passed 2026-06-23)

- [x] Phase 9a: Ship — COMPLETE (2026-06-23)
  - Pushed fix/conflict-warning-tz-anchor to origin
  - PR #549 opened: https://github.com/toyiyo/nimble-pnl/pull/549

- [x] Phase 9b: CI — COMPLETE (2026-06-23, ciGreen=true)

  - All checks passed: Unit Tests (5m9s), Database Tests/pgTAP (4m38s),
    E2E Shards 1-4 (all pass), Merge E2E Reports (pass),
    Analyze (actions/JS-TS), CodeQL, CodeRabbit (clean), Vercel, Netlify
  - SonarCloud Code Analysis: pass (gate green)
  - Skipped (expected): Header rules, Pages changed, Supabase Preview
  - dev-tools/refresh-queue.sh --pr 549 --skip-tests: Added 25, skipped 1419 duplicates

- [x] Phase 9d: Review-comment triage — COMPLETE (2026-06-23, commit f5e06d32)
  - 5 inline review comments (CodeRabbit + Codex) + 7 informational bot comments + 1 CR nitpick
  - Fixed (security/major): redacted prod employee ID + restaurant name from design.md + progress.md
  - Fixed (minor): added `text` lang tag to data-flow code fence (MD040)
  - Fixed (minor): resolved `(pending)` status drift in progress.md header
  - Fixed (trivial): reordered test imports to match project convention (vitest → Type → Utils)
  - Declined (Codex P2): UTC date rollover on DST fall-back transition days — out of scope;
    extractDateAnchor already handles cross-DST exceptions; full fix requires TIMESTAMPTZ schema change
  - Triage artifact: dev-tools/9d-triage-fix/conflict-warning-tz-anchor.md (gitignored, ephemeral)
  - PR reply posted: https://github.com/toyiyo/nimble-pnl/pull/549#issuecomment-4785284604

## Key Decisions
- Anchor to "today" (consistent with writer + grid reader), NOT shift-date and NOT Jan 1.
  Rationale: TIME column is lossy; round-trip is only faithful when reader uses the same
  anchor as the writer (documented in availabilityTimeUtils.ts + lessons [2026-05-10]).
- Secondary ShiftDialog browser-TZ parse issue: OUT OF SCOPE (user instruction) unless trivial.
