# Shift Protection — build plan

Design: docs/superpowers/specs/2026-09-03-shift-protection-design.md (rev 2)
Branch: `claude/shift-trading-coverage-abuse-9tk54v`

Environment note: this container has no docker daemon, no local Supabase,
and no `gh`/`coderabbit`/`codex` CLIs. Unit tests, typecheck, lint, and
build run locally. pgTAP and E2E tests are written here and run in CI.
PR and CI operations use the GitHub MCP tools.

Migration timestamps below are placeholders `202609030400xx`; generate
the real prefix at file creation and check
`git ls-tree origin/main supabase/migrations/` before push.

## Tasks

### A. Database

- [ ] A1. Migration `shift_protection_settings`: add the 8 NOT NULL
      policy columns to `staffing_settings`. No policy change — the
      write policy already sits on `edit:scheduling`
      (`20260730150000_rewrite_collaborator_policies.sql:154-160`).
      Test: `supabase/tests/shift_protection_settings.test.sql` —
      columns exist with defaults, NOT NULL, and CHECK bounds.
- [ ] A2. Migration `shift_protection_read_rpcs`:
      `get_shift_protection_settings`, `get_timeoff_day_counts`,
      `get_timeoff_coverage_impact` (SECURITY DEFINER, STABLE, pinned
      search_path, guards per design section 6).
      Test: `supabase/tests/shift_protection_read_rpcs.test.sql` —
      member and active employee read settings; outsider denied;
      cross-restaurant employee denied on day counts; non-capability
      caller denied on coverage impact.
- [ ] A3. Migration `shift_protection_review_timeoff`:
      `review_time_off_request` per design section 2.
      Test: `supabase/tests/shift_protection_review_timeoff.test.sql` —
      capability authz (deny outsider, deny plain staff, allow manager),
      pending-only, rejected path writes no findings, notice finding,
      sameday finding, coverage finding, `p_override` approves,
      `reviewed_by`/`reviewed_at` written.
- [ ] A4. Migration `shift_protection_trade_functions`: DROP
      `approve_shift_trade(UUID, UUID, TEXT)`; CREATE the 4-argument
      version from the latest body with findings + override; re-GRANT.
      Re-create `accept_shift_trade` from the latest body with the
      block-mode deadline refusal.
      Test: `supabase/tests/shift_protection_trade_rechecks.test.sql` —
      happy path unchanged, each finding fires, override approves,
      accept refused in block mode inside the window, EXECUTE grant
      present. Check suites 17/54/65 still pass by call shape.
- [ ] A5. Migration `shift_protection_triggers`: the three triggers per
      design section 4 (`shift_protection:` message prefix).
      Test: `supabase/tests/shift_protection_triggers.test.sql` —
      employee blocked on trade INSERT inside window (block mode),
      employee blocked on the open→pending_approval UPDATE, employee
      blocked on time-off INSERT and on a date-edit UPDATE into the
      window, sameday block at limit, capability holder exempt on all,
      warn/off modes never raise, cancel transition unaffected.
- [ ] A6. Migration `shift_protection_auto_expire`:
      `expire_stale_shift_trades()` + pg_cron every 30 minutes.
      Test: `supabase/tests/shift_protection_auto_expire.test.sql` —
      expires only `open` + started + opted-in; sets `cancelled`,
      `reviewed_at`, `manager_note = 'auto_expired'`; pending_approval
      and opted-out rows untouched; cron job registered.

### B. Frontend

- [ ] B1. `src/lib/shiftProtection.ts`: types, `tradeDeadlineFinding`,
      `timeoffNoticeFinding`, `parseShiftProtectionError`.
      Test first: `tests/unit/shiftProtection.test.ts`.
- [ ] B2. Types + settings hook: extend `StaffingSettings`
      (`src/types/scheduling.ts`), `DEFAULTS` + select list
      (`src/hooks/useStaffingSettings.ts`); new `useShiftProtection`
      hook (key `['shift-protection', restaurantId]`, staleTime 60s).
- [ ] B3. RPC plumbing: `ShiftTradePolicyWarning` typed error in
      `executeShiftTradeAction`; `useReviewTimeOffRequest` calls
      `review_time_off_request` and checks `success` before the toast
      and the notification. Unit tests for both behaviors.
- [ ] B4. `ShiftProtectionSettingsDialog` + open buttons in the trades
      tab and the time-off tab of `src/pages/Scheduling.tsx`, gated on
      `canManageSchedule`; save invalidates `['shift-protection', id]`.
- [ ] B5. `TimeOffRequestDialog`: warning panel (create + edit modes),
      day counts via `get_timeoff_day_counts`, block gate with
      `aria-describedby`, `role="status"`, `max-h-[80vh] overflow-y-auto`.
- [ ] B6. `TradeRequestDialog`: deadline warning + responsibility note +
      height cap. Accept confirm flow shows the same deadline finding.
- [ ] B7. `TradeApprovalQueue`: catch `ShiftTradePolicyWarning`, list
      findings in the existing confirm dialog, "Approve anyway" retries
      with `p_override = true`; client-side "Late" chip.
- [ ] B8. `PendingQueue`: approve/reject through the new RPC hook;
      lazy coverage-impact panel (query in `PendingQueue`, on expand);
      "Approve anyway" path.
- [ ] B9. Expired-trade visibility: include
      `cancelled + manager_note = 'auto_expired'` in
      `useMyTradeActivity`; map to an "Expired" outcome in
      `src/lib/tradeStatusProgress.ts`.

### C. E2E

- [ ] C1. `tests/e2e/shift-protection.spec.ts`: manager enables warn
      rules; employee submits a short-notice time-off request and sees
      the warning; manager sees the finding and clicks "Approve anyway".

## Dependencies

A1 → A2..A6 and B2. B1 independent (first). B3 needs A3/A4 shapes.
B4..B8 need B2/B3. B9 needs A6 shape. C1 last.

## Verify (Phase 8, this container)

`npm run test`, `npm run typecheck`, `npm run lint`, `npm run build`
locally. `npm run test:db` and `npm run test:e2e` run in CI — state
this in the PR body and watch the CI checks in Phase 9.
