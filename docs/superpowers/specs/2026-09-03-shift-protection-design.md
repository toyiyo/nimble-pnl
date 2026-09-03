# Shift Protection — soft rules for trades and time off (design)

Date: 2026-09-03
Branch: `claude/shift-trading-coverage-abuse-9tk54v`
Mockups: https://claude.ai/code/artifact/71d59e77-d407-4513-a410-69a365618713

## Problem

Employees post shift trades on the day of the shift. Employees request
time off with no notice. Several requests can stack on one day. The
restaurant then runs below coverage. The owner wants rules that warn
first and block only when the owner opts in.

## Current behavior (verified)

Every claim below carries a `file:line` citation.

### Shift trades

- A manager must approve every trade. `approve_shift_trade` requires the
  `edit:scheduling` capability
  (`supabase/migrations/20260821120000_trade_approval_area_grant.sql:52`).
- `approve_shift_trade` re-checks nothing before the shift transfer: after
  the status and accepter checks (lines 67-74) it updates `shifts`
  directly (`supabase/migrations/20260821120000_trade_approval_area_grant.sql:77-81`).
- `accept_shift_trade` checks only the accepter's shift overlap
  (`supabase/migrations/20260713010000_harden_accept_shift_trade.sql:91-105`).
  It does not check the accepter's time off. No migration after
  `20260713010000` redefines `accept_shift_trade` (grep over
  `supabase/migrations` on 2026-09-03).
- No time rule exists. No column or function limits a trade near the
  shift start. The only time logic is a client label
  (`src/lib/shiftTradeStatus.ts` — `isTradeExpired`).
- Self-service trade posts are a direct RLS INSERT
  (`supabase/migrations/20260105000000_fix_shift_trades_rls.sql:8-25`).
  Manager posts go through `create_shift_trade_for_employee`
  (`supabase/migrations/20260821120000_trade_approval_area_grant.sql:164-264`).

### Time off

- Approval is a plain table UPDATE with zero checks
  (`src/hooks/useTimeOffRequests.tsx:109-118`).
- The manager UPDATE RLS policy is `role IN ('owner','manager')`
  (`supabase/migrations/20251114100000_create_scheduling_tables.sql:239-248`).
  The SELECT policy admits any `user_restaurants` member (lines 218-226).
- An employee can edit only a `pending` request; the `WITH CHECK`
  keeps the status at `pending`
  (`supabase/migrations/20251123100100_add_employee_self_service_rls.sql:36-45`).
- The conflict function runs in the other direction only. The scheduler
  calls `check_timeoff_conflict` when a shift is created
  (`supabase/migrations/20260723180000_timeoff_conflict_local_tz.sql:26-38`,
  caller `src/hooks/useConflictDetection.tsx`). Approval never calls it.

### Coverage machinery (exists, unused by trades and time off)

- `shift_templates.capacity` holds the required staff count
  (`supabase/migrations/20260411221543_add_capacity_to_shift_templates.sql`).
- `shift_slot_min_concurrent(p_restaurant_id, p_position, p_date, p_start, p_end, p_tz)`
  computes minimum concurrent staff for a slot
  (`supabase/migrations/20260626120000_open_shift_coverage.sql:17-25`).
  EXECUTE is revoked from `authenticated`; only SECURITY DEFINER callers
  reach it (same file, REVOKE statements).

### Settings

- `staffing_settings` is the per-restaurant scheduling policy table with
  a `UNIQUE (restaurant_id)` row and owner/manager write RLS
  (`supabase/migrations/20260306000000_create_staffing_settings.sql`).
  The hook merges defaults and upserts on `restaurant_id`
  (`src/hooks/useStaffingSettings.ts:42-59`). The typed shape is
  `StaffingSettings` (`src/types/scheduling.ts:303-317`).
- No policy exists for trade deadlines, time-off notice, blackout dates,
  or a coverage floor (grep over `supabase/migrations` on 2026-09-03).

## Goals

1. Per-restaurant rules with three modes each: `off`, `warn`, `block`.
2. `warn` never stops a request. The employee sees the rule. The manager
   sees the same finding in the approval queue.
3. `block` stops the employee path only. A user with `edit:scheduling`
   is exempt and can override at approval.
4. Default every mode to `off`. Existing restaurants see no change.

## Non-goals (v1)

- Blackout dates.
- Notifications for auto-expired trades. The trade shows as cancelled in
  the existing UI.
- Exact sweep-line coverage in the impact preview. The preview uses a
  per-shift overlap count (see "Coverage impact" below).

## Design

### 1. Policy columns on `staffing_settings`

One migration adds eight columns:

| Column | Type | Default |
|---|---|---|
| `trade_deadline_mode` | TEXT CHECK in (`off`,`warn`,`block`) | `off` |
| `trade_deadline_hours` | INTEGER CHECK (> 0) | 24 |
| `trade_auto_expire` | BOOLEAN NOT NULL | false |
| `timeoff_notice_mode` | TEXT CHECK | `off` |
| `timeoff_notice_days` | INTEGER CHECK (> 0) | 7 |
| `timeoff_sameday_mode` | TEXT CHECK | `off` |
| `timeoff_sameday_limit` | INTEGER CHECK (> 0) | 2 |
| `coverage_floor_mode` | TEXT CHECK | `off` |

Rationale: `staffing_settings` already carries scheduling policy
(`open_shifts_enabled`, `require_shift_claim_approval` —
`src/hooks/useStaffingSettings.ts:31`), has RLS, and has an upsert hook.
A new table would add a second settings row shape with no gain.

### 2. New RPC: `review_time_off_request`

`review_time_off_request(p_request_id uuid, p_action text, p_override boolean DEFAULT false) RETURNS jsonb`

- SECURITY DEFINER, `SET search_path = public, pg_temp`.
- Guard: `user_has_capability(restaurant_id, 'edit:scheduling')`, checked
  before the `FOR UPDATE` fetch. This copies the trade pattern and its
  existence-oracle rationale
  (`supabase/migrations/20260821120000_trade_approval_area_grant.sql:20-24,52`).
- `p_action` must be `approved` or `rejected`.
- The request must hold status `pending` (row lock first).
- On `approved`, compute findings:
  - `notice`: `timeoff_notice_mode != 'off'` and the start date is inside
    `timeoff_notice_days` of today in the restaurant timezone.
  - `sameday`: `timeoff_sameday_mode != 'off'` and any requested day
    already has `timeoff_sameday_limit` or more approved requests from
    other employees with the same `employees.position`.
  - `coverage`: `coverage_floor_mode != 'off'` and approval drops any of
    the employee's scheduled shifts below required staff (see "Coverage
    impact").
- Findings present and `p_override = false` → return
  `{success: false, code: 'policy_warning', warnings: [...]}` and write
  nothing. `p_override = true` → approve.
- At approval time `warn` and `block` behave the same: both produce
  findings and both yield to the override. `block` differs only on the
  employee create path (trigger, below).
- Write `status`, `reviewed_at = now()`, `reviewed_by = auth.uid()`.

The frontend hook `useReviewTimeOffRequest`
(`src/hooks/useTimeOffRequests.tsx:97-151`) switches from the direct
UPDATE to this RPC. The manager UPDATE RLS policy stays unchanged so the
date-edit flow in `TimeOffRequestDialog` keeps its path
(`src/components/TimeOffRequestDialog.tsx:68-76`).

**Audience note.** The RPC widens the approval audience from
`role IN ('owner','manager')` to `edit:scheduling`. This is deliberate
and copies the shift-trade precedent
(`supabase/migrations/20260821120000_trade_approval_area_grant.sql:1-4`).
The SELECT policy already admits all members
(`supabase/migrations/20251114100000_create_scheduling_tables.sql:218-226`),
so readers of the queue and actors on the queue stay in sync.

### 3. Rebuild `approve_shift_trade` with re-checks and an override

New migration. Source body: the latest definition
(`supabase/migrations/20260821120000_trade_approval_area_grant.sql:28-95`),
per the CREATE-OR-REPLACE lesson. The old 3-argument function is dropped
first — `CREATE OR REPLACE` with a new argument would create an
overload, and two overloads make PostgREST calls ambiguous.

`approve_shift_trade(p_trade_id uuid, p_manager_user_id uuid, p_manager_note text DEFAULT NULL, p_override boolean DEFAULT false)`

After the existing status and accepter checks, build findings:

- `shift_started`: `now() >= shift.start_time`.
- `inside_deadline`: `trade_deadline_mode != 'off'` and
  `now() > shift.start_time - trade_deadline_hours`.
- `overlap`: the accepter has a `scheduled`/`confirmed` shift that
  overlaps. Copy of the accept-time query
  (`supabase/migrations/20260713010000_harden_accept_shift_trade.sql:91-98`)
  with `accepted_by_employee_id`.
- `timeoff_conflict`: `check_timeoff_conflict(accepted_by_employee_id,
  shift.start_time, shift.end_time)` returns a row. The function is
  SECURITY INVOKER
  (`supabase/migrations/20260723180000_timeoff_conflict_local_tz.sql:24`);
  inside this SECURITY DEFINER body it reads as the function owner, so
  it sees all requests. That is the intent here.

Findings present and `p_override = false` → return
`{success: false, code: 'policy_warning', warnings: [...]}`. Otherwise
transfer the shift as today.

### 4. Employee-path enforcement for `block` (triggers)

Two `BEFORE INSERT` trigger functions, SECURITY DEFINER, that no-op when
the caller holds `edit:scheduling`:

- `shift_trades`: when `trade_deadline_mode = 'block'` and the offered
  shift starts inside `trade_deadline_hours`, raise an exception with a
  clear message. The manager RPC path is exempt because its caller holds
  the capability
  (`supabase/migrations/20260821120000_trade_approval_area_grant.sql:181-183`).
- `time_off_requests`: when `timeoff_notice_mode = 'block'` and
  `start_date` is inside the notice window, or when
  `timeoff_sameday_mode = 'block'` and a requested day is at the
  same-day limit, raise an exception.

`accept_shift_trade` gets one addition (new migration, body copied from
`supabase/migrations/20260713010000_harden_accept_shift_trade.sql:32-117`):
refuse the accept when `trade_deadline_mode = 'block'` and the shift is
inside the window. `warn` mode does not change accept behavior.

### 5. Auto-expire open trades

Function `expire_stale_shift_trades()` cancels `open` trades whose shift
already started, for restaurants with `trade_auto_expire = true`.
Status moves to `cancelled` (allowed by the status CHECK —
`supabase/migrations/20260104120000_create_shift_trades.sql`). A pg_cron
schedule runs it every 30 minutes (precedent:
`supabase/migrations/20260706120100_revel_bulk_sync_cron.sql:28`).
`pending_approval` trades stay; the approval RPC carries the
`shift_started` finding for them.

### 6. Read RPCs for the UI

- `get_shift_protection_settings(p_restaurant_id uuid) RETURNS jsonb` —
  SECURITY DEFINER. Guard: the caller is a `user_restaurants` member or
  an active employee of the restaurant. Returns the eight policy
  columns. Needed because employees have no `staffing_settings` SELECT
  grant (member-only RLS —
  `supabase/migrations/20260306000000_create_staffing_settings.sql`).
- `get_timeoff_day_counts(p_restaurant_id uuid, p_employee_id uuid, p_start date, p_end date)` —
  SECURITY DEFINER. Guard: the caller owns `p_employee_id`
  (`employees.user_id = auth.uid()`) or holds `edit:scheduling`.
  Returns, per day, the count of other employees with the same position
  and an approved request that covers the day. Counts only — no names.
- `get_timeoff_coverage_impact(p_request_id uuid)` — SECURITY DEFINER.
  Guard: `edit:scheduling`. See next section.

### 7. Coverage impact (manager preview)

For the request's employee, list `scheduled`/`confirmed` shifts inside
the request range. Per shift return:

- `required` = the linked template's `capacity`, else 1
  (`shifts.shift_template_id` —
  `supabase/migrations/20260416000000_add_shift_template_id.sql`).
- `current` = count of distinct employees with the same `position` whose
  shift overlaps this shift's window.
- `after` = `current - 1`.

This is a per-shift overlap count, not the sweep-line minimum. It can
overstate coverage inside a window where staff arrive late. That is
acceptable for a warning preview; the exact function stays reserved for
open shifts. The RPC also returns the count of other approved requests
that overlap the range, for the queue's context line.

### 8. Frontend

New pure module `src/lib/shiftProtection.ts`: finding calculators for
the trade deadline and the notice window, plus shared types. Unit
tests cover them.

- `useShiftProtection` hook: wraps `get_shift_protection_settings`
  (React Query, `staleTime` 60s).
- `ShiftProtectionSettingsDialog` (new): the Off/Warn/Block panel from
  the mockups. Writes through `useStaffingSettings.updateSettings`
  (`src/hooks/useStaffingSettings.ts:42-59`). Opened from the trades tab
  and the time-off tab in `src/pages/Scheduling.tsx` (tab shells at
  `src/pages/Scheduling.tsx:901-948,1586-1611`), gated on
  `edit:scheduling`.
- `TimeOffRequestDialog`: amber warning panel (notice + same-day
  counts via `get_timeoff_day_counts`). In `block` mode for a
  non-capability caller, disable submit and show the reason. Style: the
  `bg-amber-500/10 border-amber-500/20` panel from CLAUDE.md.
- `TradeRequestDialog`: deadline warning plus the static responsibility
  note ("This shift stays yours until a manager approves the trade").
- `TradeApprovalQueue`: a `policy_warning` response opens the existing
  confirm dialog with the findings and an "Approve anyway" action that
  retries with `p_override = true`
  (approve call site: `src/hooks/useShiftTrades.ts:448-475`).
- `PendingQueue`/`TimeOffRow`: approve/reject through the new RPC; show
  the coverage-impact panel from `get_timeoff_coverage_impact` on
  pending rows; "Approve anyway" on `policy_warning`.
- Type updates: `StaffingSettings` (`src/types/scheduling.ts:303-317`),
  `DEFAULTS` and the select list
  (`src/hooks/useStaffingSettings.ts:9-19,31`).

### 9. Tests

- pgTAP: new specs for `review_time_off_request` (authz per the trade
  pattern, pending-only, findings, override), `approve_shift_trade`
  (findings, override, unchanged happy path), `accept_shift_trade`
  block-mode deadline, both triggers (block fires for an employee, not
  for a capability holder), `expire_stale_shift_trades`, and the new
  read RPC guards. Update existing suites that call the changed
  functions (`supabase/tests/17_shift_trade_functions_security.sql`,
  `54_accept_shift_trade_authz.sql`, `65_trade_approval_area_grant.test.sql`).
- Unit: `tests/unit/shiftProtection.test.ts` for the calculators.
- E2E: `tests/e2e/shift-protection.spec.ts` — manager turns on warn
  rules; employee submits a short-notice time-off request and sees the
  warning; manager sees the finding and approves with "Approve anyway".

### 10. Rollout and safety

- All modes default to `off`; the triggers and RPC findings no-op until
  a restaurant opts in.
- The old direct UPDATE approval path stays valid for owner/manager
  during deploy; the new UI stops using it. No RLS tightening in v1.
- Migration timestamps get generated at file-creation time; check
  `git ls-tree origin/main supabase/migrations/` for prefix collisions
  before push (lessons: collisions recur).

## Decided trade-offs

1. Approval-time `block` equals `warn` (override allowed). Managers stay
   flexible; `block` binds only the employee create path. This matches
   the mockup footer copy the user approved.
2. The coverage preview uses per-shift overlap counts, not the
   sweep-line minimum. Cheaper, close enough for a warning.
3. Auto-expired trades send no notification in v1.
4. The direct owner/manager UPDATE on `time_off_requests` remains. An
   old client can still approve without findings until it reloads.
5. `warn`-mode trade accepts stay server-silent; the warning shows at
   post time and at approval time.
