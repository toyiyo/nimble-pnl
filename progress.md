# Progress: Manager clears stale / expired shift-trade requests

## Spec
Design: docs/superpowers/specs/2026-07-01-manager-clear-stale-trades-design.md
Plan: (pending Phase 3)

## Current Phase
Phase 4-9: Autonomous workflow (dev-build-and-ship) — launched

## Key Decisions
- Remove-only (hard delete), NO DB migration — relies on existing manager DELETE RLS.
- Manager-triggered only, no auto-expire/cron.
- "Expired" = offered_shift.start_time < now (computed). Ghost pending = null accepted_by.
- New: useDeleteShiftTrade hook, isTradeExpired pure helper, OpenTradeCard remove UI + bulk.

## Completed
- [x] Phase 0 lessons consulted
- [x] Phase 1 worktree + npm install
- [x] Phase 2 design doc committed
- [x] Phase 2.5 design review (frontend + supabase; all findings folded in)
- [x] Phase 3 plan committed + user approved
- [x] Phase 4 Task 1: isTradeExpired helper — commit 8730a5df
- [x] Phase 4 Task 2: useDeleteShiftTrade hook — commit ee65f230
- [x] Phase 4 Task 4: Email formatDateTime timezone — commit dd47efbc
- [x] Phase 4 Task 3 (id=3): Manager cleanup UI in TradeApprovalQueue.tsx — commit 55140a80
- [x] Phase 5 (UI Review): Typography scale, dialog structure, color semantics — commit 3517b38e
- [x] Phase 6 (Simplify): IIFE → renderConfirmButtonContent, drop unused onSuccess param — commit 5c4c3815
- [x] Phase 7a (OCR rules review) — 4 findings: 1 major (frozen `now` at mount), 1 major (duplicate remove-button render pattern), 1 minor (hardcoded fallback timezone comment missing), 1 minor (inline arrow closures in map callbacks). No critical findings.
- [x] Phase 7b (fold findings): 4 fixes committed — c719873a
  - frozen `now` at mount (major): evaluate `new Date()` inside partition memos, not hoisted
  - duplicate RemoveButton JSX (major): extracted shared RemoveButton component
  - StalePendingRow typography (minor): text-sm/text-xs → text-[14px]/text-[12px]
  - formatDateTime timezone RangeError (security/minor): added Intl probe with UTC fallback
- [x] Phase 7c (CodeRabbit review iter 1): 2 findings fixed — c356c674
  - major: missing restaurant_id filter on delete query → added .eq('restaurant_id', restaurantId)
  - minor: progress.md fix count mismatch → corrected to 4
- [x] Phase 7c (CodeRabbit review iter 2): skipped — billing/rate-limit reached (resets in ~7 min); CodeRabbit GitHub bot will still review the PR in Phase 9d
- [x] Phase 8 (Verify): all checks run — commit 89feacd4 (lint dep fix)
  - npm run test: 385 passed, 1 skipped (0 failures in our code)
  - npm run typecheck: PASSED (no type errors)
  - npm run lint: pre-existing errors only (our modified files all clean); fixed react-hooks/exhaustive-deps warning in handleConfirmRemove
  - npm run build: ✓ built in 51.84s
  - npm run test:db: 1430/1431 passed; 1 pre-existing failure (enqueue_weekly_brief_jobs expects 0 restaurants but DB has 140 — not introduced by our changes)
  - npm run test:e2e: 145 passed, 12 skipped, 2 failed (manual-sale-tip-not-doubled + scheduling-conflicts — pre-existing, our test files not modified)
- [x] Phase 9 (PR) — https://github.com/toyiyo/nimble-pnl/pull/562
- [x] Phase 9d (Review comment triage) — 2 Codex inline comments triaged
  - bug/correctness (1): mutateAsync+Promise.allSettled for bulk spinner — commit bac84a06
  - informational/declined (1): nowTick timer already fixes expiration refresh — PR reply posted
  - informational/read-only (6): bot status comments (Netlify, Vercel, CodeRabbit, Supabase, SonarCloud, Codex PR-level)
  - Triage artifact: dev-tools/9d-triage-feature/manager-clear-stale-trades.md

## Preflight (Phase 4 gate)
- gh: authenticated (jdelgado2002, repo+workflow scopes)
- jq: 1.7.1, node: v20.20.2, coderabbit: 0.6.4, codex: 0.137.0
- .env.local symlink: created in worktree
- SONAR_TOKEN / SONAR_PROJECT_KEY: NOT set (warning only)

## CI Status
- PR: https://github.com/toyiyo/nimble-pnl/pull/562 (opened 2026-07-01)
- [x] Phase 9b (CI iter 1): ALL checks GREEN (2026-07-01)
  - Unit Tests: pass (both runs)
  - Database Tests (pgTAP): pass (both runs)
  - E2E Tests (Shard 1-4): pass (both runs)
  - Merge E2E Reports: pass (both runs)
  - SonarCloud Code Analysis: pass (quality gate green)
  - CodeQL: pass
  - CodeRabbit: pass
  - Vercel: pass
  - Netlify deploy preview: pass
  - Supabase Preview: pass
