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
- [x] Phase 7b (fold findings): 3 fixes committed — c719873a
  - frozen `now` at mount (major): evaluate `new Date()` inside partition memos, not hoisted
  - duplicate RemoveButton JSX (major): extracted shared RemoveButton component
  - StalePendingRow typography (minor): text-sm/text-xs → text-[14px]/text-[12px]
  - formatDateTime timezone RangeError (security/minor): added Intl probe with UTC fallback
- [ ] Phases 7c-9 (CodeRabbit review, verify, PR) — pending

## Preflight (Phase 4 gate)
- gh: authenticated (jdelgado2002, repo+workflow scopes)
- jq: 1.7.1, node: v20.20.2, coderabbit: 0.6.4, codex: 0.137.0
- .env.local symlink: created in worktree
- SONAR_TOKEN / SONAR_PROJECT_KEY: NOT set (warning only)

## CI Status
- PR: not yet created
