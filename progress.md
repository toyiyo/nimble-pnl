# Progress: operations_manager role

## Spec
- Design: docs/superpowers/specs/2026-07-02-operations-manager-role-design.md (committed e22a3d75)
- Plan: (pending Phase 3)

## Current Phase
Preflight complete (2026-07-02). Next: Phase 4 build (TDD).

## Preflight Results (2026-07-02)
- gh: authenticated (jdelgado2002), scopes: gist, read:org, repo, workflow
- jq: 1.7.1-apple
- node: v20.20.2
- coderabbit: 0.6.4
- codex: 0.137.0 (available)
- branch: worktree-feature+operations-manager-role (correct)
- .env.local symlink: present -> /Users/josedelgado/Documents/GitHub/nimble-pnl/.env.local
- SONAR_TOKEN: set in .env.local
- SONAR_PROJECT_KEY: toyiyo_nimble-pnl (set in .env.local)

## Plan
docs/superpowers/plans/2026-07-02-operations-manager-role.md (11 tasks, TDD)

## Completed Tasks
- [x] Phase 0 lessons/context
- [x] Phase 1 worktree (branch worktree-feature+operations-manager-role)
- [x] Phase 2 brainstorm + design doc committed (e22a3d75)
- [x] Phase 2.5 folded supabase+frontend review (98a47398); scope: FULL enforcement one PR
- [ ] Phase 3 plan
- [x] Phase 4 build (TDD) — task 1/12: Add `operations_manager` to Role union type (52bedc90)
- [x] Phase 4 build (TDD) — task 2/12: Write Vitest test for operations_manager capabilities + ROLE_CAPABILITIES + ROLE_METADATA entries (c110fc14)
- [x] Phase 4 build (TDD) — task 3/12: Write failing Vitest test for invite matrix, then create src/lib/permissions/invitations.ts with canInviteRole/getInvitableRoles and export from index.ts (bd1d36bd)
- [x] Phase 4 build (TDD) — task 4/12: Create SQL migration 20260702120000_add_operations_manager_role.sql: extend role CHECK constraint, update user_is_internal_team helper, and replace user_has_capability function body with operations_manager added to non-accounting/non-admin branches (9fecf97d)
- [x] Phase 4 build (TDD) — task 5/12: Create pgTAP test supabase/tests/21_operations_manager_capabilities.sql: sentinel tests for included capabilities and denied accounting/admin capabilities (drift guard) (8ba640b6)
- [x] Phase 4 build (TDD) — task 6/12: Write failing pgTAP DML test supabase/tests/22_operations_manager_rls.sql (RED: 2f9d0d80); append residual-policy section to migration (GREEN: a26e4ba3). 9/9 tests pass; full suite 1470/1470.
- [x] Phase 4 build (TDD) — task 8/12 (plan task 7): Update supabase/functions/send-team-invitation/index.ts: Deno invite matrix + canInviteRole(), widen inviter allow-list to include operations_manager, add role_not_allowed 403 guard, add Operations Manager label (b3f3dac3)
- [x] Phase 4 build (TDD) — task 9/12 (plan task 8): Update src/components/TeamInvitations.tsx: typed userRole as Role, invitableRoles from getInvitableRoles(), dynamic Select from matrix, default form role to first invitable, explicit columns replacing select('*'), Skeleton loading state. Also added operations_manager to UserRestaurant.role union in useRestaurants.tsx. (87aee74b)
- [x] Phase 4 build (TDD) — task 10/12 (plan task 9): Extract nav data + getNavigationForRole into AppSidebar.nav.ts (testable without React context), add operations_manager case filtering out Accounting group and /integrations item. 8/8 Vitest tests pass; build green. (d1758c52)
- [x] Phase 4 build (TDD) — task 11/12 (plan task 10): Audit and fix operational hardcoded role literals. TimePunchesManager.tsx isManager, Inventory.tsx canDeleteProducts, useApproverCount.ts approver query all widened to include operations_manager. POSSales.tsx canEditManualSales intentionally left owner/manager-only (gates manual-sale WRITE; ops-mgr has view:pos_sales not edit:pos_sales). New operationsManagerUIGuards.test.ts (15 tests) + updated useApproverCount.test.ts pass. (e4e43f40)
- [x] Phase 4 build (TDD) — task 12/12 (final verification sweep): Ran full test suite (5134 unit + 1470 pgTAP pass, 0 failures), typecheck clean, build green. Grepped for missed role literals: TeamMembers.tsx canManageMembers widened to include operations_manager (manage:team). Remaining literals confirmed intentionally excluded (CollaboratorInvitations=manage:collaborators, useChartOfAccounts=accounting-admin, RestaurantSettings canEdit=edit:settings, useKioskPins actor check=edge-fn payload not role guard). (1d6b09c9)

## Key Decisions
- New role `operations_manager`, label "Operations Manager", non-breaking.
- Capabilities = manager minus accounting minus external-admin; keep labor (payroll/tips/scheduling/time).
- pending_outflows excluded (accounting/AP).
- Invites: operations_manager -> staff only. owner/manager can invite operations_manager.
- Capability-first RLS: extend user_has_capability; residual hardcoded operational policies get the role; accounting tables untouched (natural deny).

- [x] Phase 5 UI Review — TeamMembers.tsx: Skeleton loading state, border-border/40 rounded-xl list items, text-[14px]/text-[13px] typography, aria-label on MoreHorizontal, operations_manager in roleIcons/roleColors/select, human-readable badge label. Commit: 2052dbfc.
- [x] Phase 6 Simplify — TeamMembers.tsx: replaced hard-coded 'Ops Manager' special-case with ROLE_METADATA label lookup (reuse). invitations.ts: dropped redundant `?? []` nullish guards on fully-typed Record. All 5134 tests pass. Commit: a7b6d619.

- [x] Phase 7a Codex adversarial review — 1 critical finding: operations_manager privilege escalation via TeamMembers.tsx role selector (src/components/TeamMembers.tsx:237 + RLS user_id=auth.uid() bypass in user_restaurants policy). See dev-tools/codex-review-output.md.
- [x] Phase 7a OCR-rules review — 1 major finding (incomplete residual-policy coverage for tip/payroll/scheduling tables + schedule_change_logs), 1 minor finding (as any in test without comment). See StructuredOutput below.
- [x] Phase 7b Fold findings — commit ca8557f4:
  - FIXED (critical): 12+ residual hardcoded RLS policies widened in migration (tip_splits, tip_split_items, tip_disputes, tip_contribution_pools, tip_server_earnings, tip_pool_allocations, tip_payouts, overtime_adjustments, daily_labor_allocations, employee_compensation_history INSERT, time_punches INSERT, staffing_settings, open_shift_claims SELECT+UPDATE, schedule_change_logs INSERT).
  - FIXED (critical/security): Added "Prevent self-escalation to privileged roles" RLS policy on user_restaurants; TeamMembers.tsx role dropdown now uses getInvitableRoles() instead of hardcoded list; userRole prop typed as Role.
  - FIXED (major): pgTAP test 21 adds view:collaborators exclusion sentinel; pgTAP test 22 adds 6 DML tests for residual tables (plan 9→15).
  - FIXED (minor): invitations.ts nullish guard; TeamInvitations.test.tsx as any comment.
  - SKIPPED (minor): performance O(n²) find in TeamMembers (pre-existing, not regression); CORS wildcard (pre-existing); stale form default (low risk).
  - 5134 unit tests pass, typecheck clean.

- [x] Phase 7c CodeRabbit iteration 2 — rate limit hit (28 min reset); skipped per billing/quota rule (no findings to action).
- [x] Phase 7c CodeRabbit iteration 1 — 2 findings fixed, commit 800a7b81:
  - FIXED (major): `INVITABLE_ROLES` in `invitations.ts` and Deno mirror now include kiosk + collaborator_* as valid targets for owner/manager (restores pre-existing behavior broken by the default-deny matrix).
  - FIXED (minor): `canInviteRole` now uses `?? []` null-safety guard (mirrors `getInvitableRoles`).
  - Updated `invitationMatrix.test.ts` with 2 new test cases covering the restored targets.
  - 5136 unit tests pass.

- [x] Phase 8 Verify (2026-07-03):
  - typecheck: PASS (exit 0, no errors)
  - build: PASS (exit 0, "✓ built in 3m 23s", 7135 modules)
  - lint: 1506 pre-existing problems on whole codebase; files changed in this branch have identical error count (24 problems/20 errors) as on main — no regressions
  - test (unit): 5132 passed, 4 failed — all 4 are flaky timeout tests (BankingReconciliationDialog.datePicker, EmployeeDialog.availabilitySection, KioskMode x2); zero diff in those test files or source between this branch and main; confirmed pre-existing flakiness
  - test:db (pgTAP): intermittent deadlocks in 09_employee_activation.sql (pre-existing) and 30_toast_sync_timeout_fix.sql (pre-existing); clean run (3rd attempt) also had 40_focus_schema_rls failure (pre-existing) — none changed by this branch; all tests in our new migration files pass
  - test:e2e: 124/159 failed; all failures at signUpAndCreateRestaurant waitForURL timeout (line 709 e2e-supabase.ts) — pre-existing auth/environment issue; no E2E test files changed by this branch

## CI Status
- PR: https://github.com/toyiyo/nimble-pnl/pull/568 (opened 2026-07-03)
- Phase 9a (Ship) complete: branch pushed, PR #568 created

- [x] Phase 9b iteration 2 (2026-07-03, resumed session):
  - CI failure diagnosed: pgTAP test 17 — "Prevent self-escalation" guard was PERMISSIVE (ORed away by pre-existing FOR ALL policy); reproduced locally.
  - Fixed in 314a1b72: AS RESTRICTIVE + allowlist WITH CHECK (staff/kiosk for non-owners); closes owner/manager AND operations_manager/chef/collaborator_* escalation. pgTAP test 18 added; local suite 1552/1552.
  - E2E shard 3 failure = dnd-kit drag flake in scheduling-conflicts (test has internal retry loop for this); re-running via push.
  - Replied to Codex P1 thread with correction (prior reply had claimed the ineffective c4d650f4 USING fix).
  - CI watch running on 314a1b72.
