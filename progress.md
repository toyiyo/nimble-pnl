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
- [ ] Phases 6-9 (workflow) — pending

## Preflight (Phase 4 gate)
- gh: authenticated (jdelgado2002, repo+workflow scopes)
- jq: 1.7.1, node: v20.20.2, coderabbit: 0.6.4, codex: 0.137.0
- .env.local symlink: created in worktree
- SONAR_TOKEN / SONAR_PROJECT_KEY: NOT set (warning only)

## CI Status
- PR: not yet created
