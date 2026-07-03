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

## CI Status
- PR: not yet created
