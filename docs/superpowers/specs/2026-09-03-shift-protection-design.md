# Shift Protection — soft rules for trades and time off (design)

Date: 2026-09-03 (rev 2 — folds the Phase 2.5 review findings)
Branch: `claude/shift-trading-coverage-abuse-9tk54v`
Mockups: https://claude.ai/code/artifact/71d59e77-d407-4513-a410-69a365618713

## Problem

Employees post shift trades on the day of the shift. Employees request
time off with no notice. Several requests can stack on one day. The
restaurant then runs below coverage. The owner wants rules that warn
first and block only when the owner opts in.

## Current behavior (verified)

Every claim below carries a `file:line` citation. Both Phase 2.5
reviewers checked every citation against the code.

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
- An employee can move an open trade to `pending_approval` with a direct
  table UPDATE; the policy constrains only the status
  (`supabase/migrations/20260104120000_create_shift_trades.sql:94-120`).
  This path skips the accept RPC. (The broader pre-existing hole in that
  policy is out of scope; the reviewer queued it as a separate task.)
- No time rule exists. No column or function limits a trade near the
  shift start. The only time logic is a client label
  (`src/lib/shiftTradeStatus.ts:2` — `isTradeExpired`).
- Self-service trade posts are a direct RLS INSERT
  (`supabase/migrations/20260105000000_fix_shift_trades_rls.sql:8-25`).
  Manager posts go through `create_shift_trade_for_employee`
  (`supabase/migrations/20260821120000_trade_approval_area_grant.sql:164-264`).
- The poster's activity card excludes `cancelled` trades on purpose
  (`src/hooks/useShiftTrades.ts:198-205`;
  `src/lib/tradeStatusProgress.ts:81-82`).
- Trade RPC failures throw a generic `Error(result?.error || failureMessage)`
  (`src/hooks/useShiftTrades.ts:97-100`).

### Time off

- Approval is a plain table UPDATE with zero checks
  (`src/hooks/useTimeOffRequests.tsx:109-118`). The mutation's
  `onSuccess` fires the toast and the notification edge function
  (`src/hooks/useTimeOffRequests.tsx:123-142`).
- The manager UPDATE RLS policy is `role IN ('owner','manager')`
  (`supabase/migrations/20251114100000_create_scheduling_tables.sql:239-248`).
  The SELECT policy admits any `user_restaurants` member (lines 218-226).
- An employee can edit the dates of a `pending` request; the `WITH CHECK`
  keeps the status at `pending`
  (`supabase/migrations/20251123100100_add_employee_self_service_rls.sql:36-45`).
- The conflict function runs in the other direction only. The scheduler
  calls `check_timeoff_conflict` when a shift is created
  (`supabase/migrations/20260723180000_timeoff_conflict_local_tz.sql:26-38`,
  caller `src/hooks/useConflictDetection.tsx:38`). Approval never calls
  it. The function matches `status IN ('approved', 'pending')`
  (`supabase/migrations/20260723180000_timeoff_conflict_local_tz.sql:97`).

### Coverage machinery (exists, unused by trades and time off)

- `shift_templates.capacity` holds the required staff count
  (`supabase/migrations/20260411221543_add_capacity_to_shift_templates.sql`).
- `shift_slot_min_concurrent(p_restaurant_id, p_position, p_date, p_start, p_end, p_tz)`
  computes minimum concurrent staff for a slot
  (`supabase/migrations/20260626120000_open_shift_coverage.sql:17-25`).
  EXECUTE is revoked from `authenticated`
  (`supabase/migrations/20260626120000_open_shift_coverage.sql:136-137`).

### Settings

- `staffing_settings` is the per-restaurant scheduling policy table with
  a `UNIQUE (restaurant_id)` row. Members can SELECT; the write policy is
  `role IN ('owner','manager')`
  (`supabase/migrations/20260306000000_create_staffing_settings.sql:22,33-42`).
  The hook merges defaults and upserts on `restaurant_id`
  (`src/hooks/useStaffingSettings.ts:42-59`). The typed shape is
  `StaffingSettings` (`src/types/scheduling.ts:303-317`).
- No policy exists for trade deadlines, time-off notice, blackout dates,
  or a coverage floor (grep over `supabase/migrations` on 2026-09-03).

## Goals

1. Per-restaurant rules with three modes each: `off`, `warn`, `block`.
2. `warn` never stops a request. The employee sees the rule. The manager
   sees the same finding in the approval queue.
3. `block` stops the employee path only — create AND date edits. A user
   with `edit:scheduling` is exempt and can override at approval.
4. Default every mode to `off`. Existing restaurants see no change.

## Non-goals (v1)

- Blackout dates.
- Push/email notifications for auto-expired trades. The expiry IS
  visible in the poster's activity card (see section 5) — visibility
  replaces the notification.
- Exact sweep-line coverage in the impact preview. The preview uses a
  per-shift overlap count (see "Coverage impact" below).

## Design

Every new SECURITY DEFINER function in this design pins
`SET search_path = public, pg_temp` (lesson:
`supabase/migrations/20260713010000_harden_accept_shift_trade.sql:8-10`).
Read-only RPCs are also `STABLE`.

### 1. Policy columns on `staffing_settings`

One migration adds eight columns. All are NOT NULL — a NULL mode would
make `mode != 'off'` read as NULL and hide the rule silently.

| Column | Type | Default |
|---|---|---|
| `trade_deadline_mode` | TEXT NOT NULL CHECK in (`off`,`warn`,`block`) | `off` |
| `trade_deadline_hours` | INTEGER NOT NULL CHECK (> 0) | 24 |
| `trade_auto_expire` | BOOLEAN NOT NULL | false |
| `timeoff_notice_mode` | TEXT NOT NULL CHECK | `off` |
| `timeoff_notice_days` | INTEGER NOT NULL CHECK (> 0) | 7 |
| `timeoff_sameday_mode` | TEXT NOT NULL CHECK | `off` |
| `timeoff_sameday_limit` | INTEGER NOT NULL CHECK (> 0) | 2 |
| `coverage_floor_mode` | TEXT NOT NULL CHECK | `off` |

Rationale: `staffing_settings` already carries scheduling policy
(`open_shifts_enabled`, `require_shift_claim_approval` —
`src/hooks/useStaffingSettings.ts:31`), has RLS, and has an upsert hook.

The same migration re-creates the `staffing_settings` write policy on
`user_has_capability(restaurant_id, 'edit:scheduling')`. Reason: the new
settings dialog is gated on that capability, and today a capability-only
role (e.g. `operations_manager`) would pass the gate and then fail the
`role IN ('owner','manager')` write RLS
(`supabase/migrations/20260306000000_create_staffing_settings.sql:33-42`).
Copy the original policy body verbatim and swap only the role check
(lesson: widen by copying, never re-derive). Add a pgTAP residual scan
over `pg_policies` that asserts the old predicate is gone (lesson:
`DROP POLICY IF EXISTS` on a wrong name is a silent no-op).

### 2. New RPC: `review_time_off_request`

`review_time_off_request(p_request_id uuid, p_action text, p_override boolean DEFAULT false) RETURNS jsonb`

- SECURITY DEFINER, `SET search_path = public, pg_temp`.
- Guard: `user_has_capability(restaurant_id, 'edit:scheduling')`, checked
  before the `FOR UPDATE` fetch with the pre-fetch subquery pattern, so a
  bad id is not an existence oracle
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
  employee paths (triggers, below).
- Write `status`, `reviewed_at = now()`, `reviewed_by = auth.uid()`.

The frontend hook `useReviewTimeOffRequest`
(`src/hooks/useTimeOffRequests.tsx:97-151`) switches from the direct
UPDATE to this RPC. **The mutation must check `success` on the RPC
result before the toast and before the `send-time-off-notification`
call** — the RPC returns jsonb with no PostgREST error, so today's
`onSuccess` shape would toast "approved" on a `policy_warning` response.
A `policy_warning` result surfaces to the caller as data, not as a toast.

The manager UPDATE RLS policy stays unchanged so the date-edit flow in
`TimeOffRequestDialog` keeps its path
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
per the CREATE-OR-REPLACE lesson. `DROP FUNCTION approve_shift_trade(UUID, UUID, TEXT)`
first — `CREATE OR REPLACE` with a new argument would create an
overload, and two overloads make PostgREST calls ambiguous. The DROP
removes the EXECUTE grant, so the migration re-runs
`GRANT EXECUTE ... TO authenticated` on the new signature.

`approve_shift_trade(p_trade_id uuid, p_manager_user_id uuid, p_manager_note text DEFAULT NULL, p_override boolean DEFAULT false)`

After the existing status and accepter checks, build findings:

- `shift_started`: `now() >= shift.start_time`.
- `inside_deadline`: `trade_deadline_mode != 'off'` and
  `now() > shift.start_time - make_interval(hours => trade_deadline_hours)`.
- `overlap`: the accepter has a `scheduled`/`confirmed` shift that
  overlaps. Copy of the accept-time query
  (`supabase/migrations/20260713010000_harden_accept_shift_trade.sql:91-98`)
  with `accepted_by_employee_id`.
- `timeoff_conflict`: `check_timeoff_conflict(accepted_by_employee_id,
  shift.start_time, shift.end_time)` returns a row. The function is
  SECURITY INVOKER
  (`supabase/migrations/20260723180000_timeoff_conflict_local_tz.sql:24`);
  inside this SECURITY DEFINER body it reads as the function owner, so
  it sees all requests. That is the intent here. The function also
  matches `pending` requests (line 97), so the warning copy says
  "approved or pending time off", not "approved time off".

Findings present and `p_override = false` → return
`{success: false, code: 'policy_warning', warnings: [...]}`. Otherwise
transfer the shift as today.

### 4. Employee-path enforcement for `block` (triggers)

Three SECURITY DEFINER trigger functions with pinned `search_path`.
SECURITY DEFINER is required: employees hold no SELECT grant on
`staffing_settings`, so an INVOKER trigger would read no settings row
and silently no-op. Each trigger no-ops when the caller holds
`edit:scheduling` (so the manager RPC paths are exempt —
`supabase/migrations/20260821120000_trade_approval_area_grant.sql:181-183`).
Each `RAISE EXCEPTION` message starts with the stable prefix
`shift_protection:` so the client maps it to friendly copy.

- `shift_trades` — `BEFORE INSERT`: when `trade_deadline_mode = 'block'`
  and the offered shift starts inside `trade_deadline_hours`, raise.
- `shift_trades` — `BEFORE UPDATE OF status`, fires only on the
  `OLD.status = 'open' AND NEW.status = 'pending_approval'` transition:
  same deadline check. This closes the direct-UPDATE accept path
  (`supabase/migrations/20260104120000_create_shift_trades.sql:94-120`).
  The `cancelled` transition and the cron are untouched — they do not
  match the transition predicate.
- `time_off_requests` — `BEFORE INSERT OR UPDATE OF start_date, end_date`:
  when `timeoff_notice_mode = 'block'` and `start_date` is inside the
  notice window, or when `timeoff_sameday_mode = 'block'` and a
  requested day is at the same-day limit, raise. The UPDATE arm closes
  the date-edit bypass through the employee UPDATE policy
  (`supabase/migrations/20251123100100_add_employee_self_service_rls.sql:36-45`).

`accept_shift_trade` gets one addition (new migration, body copied from
`supabase/migrations/20260713010000_harden_accept_shift_trade.sql:32-117`):
refuse the accept when `trade_deadline_mode = 'block'` and the shift is
inside the window, with a clear message. `warn` mode does not change
accept behavior on the server; the accept UI shows the client-side
finding (section 8).

### 5. Auto-expire open trades

Function `expire_stale_shift_trades()` (SECURITY DEFINER, pinned
`search_path`) cancels `open` trades whose shift already started, for
restaurants with `trade_auto_expire = true`. It sets
`status = 'cancelled'`, `reviewed_at = now()`, and
`manager_note = 'auto_expired'`. A pg_cron schedule runs it every 30
minutes (precedent:
`supabase/migrations/20260706120100_revel_bulk_sync_cron.sql:28`).
`pending_approval` trades stay; the approval RPC carries the
`shift_started` finding for them.

**Visibility.** The poster's activity card excludes `cancelled` trades
on purpose (`src/hooks/useShiftTrades.ts:198-205`) — a plain cancel is
the poster's own act. An auto-expired trade must stay visible or the
poster can no-show a shift they believe is posted. Fix: the activity
query also includes trades with `status = 'cancelled' AND
manager_note = 'auto_expired'` (self-cancels never set `manager_note`,
so the deliberate exclusion holds), and `tradeStatusProgress`
(`src/lib/tradeStatusProgress.ts:81-82`) maps that combination to an
"Expired" outcome with the copy "Nobody accepted before the shift
started. The shift is still yours."

### 6. Read RPCs for the UI

All three are SECURITY DEFINER, STABLE, pinned `search_path`.

- `get_shift_protection_settings(p_restaurant_id uuid) RETURNS jsonb` —
  Guard: the caller is a `user_restaurants` member of `p_restaurant_id`
  or an active employee of `p_restaurant_id`
  (`employees.user_id = auth.uid() AND employees.restaurant_id =
  p_restaurant_id AND is_active`). Returns the eight policy columns.
  Needed because employees have no `staffing_settings` SELECT grant
  (`supabase/migrations/20260306000000_create_staffing_settings.sql:22`).
- `get_timeoff_day_counts(p_restaurant_id uuid, p_employee_id uuid, p_start date, p_end date)` —
  Guard, both branches bound to `p_restaurant_id`: the caller owns
  `p_employee_id` **in that restaurant**
  (`employees.id = p_employee_id AND employees.user_id = auth.uid() AND
  employees.restaurant_id = p_restaurant_id`), or the caller holds
  `user_has_capability(p_restaurant_id, 'edit:scheduling')`. The counts
  query also filters `restaurant_id = p_restaurant_id`. This closes the
  cross-tenant read the review found. Returns, per day, the count of
  other employees with the same position and an approved request that
  covers the day. Counts only — no names.
- `get_timeoff_coverage_impact(p_request_id uuid)` — Guard:
  `user_has_capability((SELECT restaurant_id FROM time_off_requests
  WHERE id = p_request_id), 'edit:scheduling')`, checked before any
  fetch (existence-oracle pattern,
  `supabase/migrations/20260821120000_trade_approval_area_grant.sql:52`).
  See next section.

Index note: the same-day count filters `time_off_requests` on
`restaurant_id + status + date range`. Only single-column indexes exist
(`supabase/migrations/20251114100000_create_scheduling_tables.sql:75-77`).
Per-tenant row counts are small; no new index in v1.

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
acceptable for a warning preview; the exact function stays revoked from
`authenticated`
(`supabase/migrations/20260626120000_open_shift_coverage.sql:136-137`).
The RPC also returns the count of other approved requests that overlap
the range, for the queue's context line.

### 8. Frontend

New pure module `src/lib/shiftProtection.ts`: finding calculators for
the trade deadline and the notice window, shared types, and
`parseShiftProtectionError` — maps a `shift_protection:` trigger message
to friendly copy. Unit tests cover all of it.

**RPC plumbing.** `executeShiftTradeAction` throws
`new Error(result?.error || failureMessage)` on every `success: false`
(`src/hooks/useShiftTrades.ts:97-100`), which would swallow the
`policy_warning` payload. Change: on `code = 'policy_warning'` the
helper throws a typed `ShiftTradePolicyWarning` error that carries the
warnings; the notification call stays skipped on that path (the throw
already skips it). `useReviewTimeOffRequest` checks `success` on the
RPC result before the toast and the notification (section 2).

- `useShiftProtection` hook: wraps `get_shift_protection_settings`
  (React Query, `staleTime` 60s, key
  `['shift-protection', restaurantId]`).
- `ShiftProtectionSettingsDialog` (new): the Off/Warn/Block panel from
  the mockups. Off/Warn/Block renders as a `RadioGroup` with one
  `Label` per option (pattern:
  `src/components/schedule/TradeRequestDialog.tsx:195`), labels in the
  `text-[12px] font-medium uppercase tracking-wider` style. Numeric
  fields validate `> 0` client-side; the save button disables while
  `isSaving`. Writes through `useStaffingSettings.updateSettings`
  (`src/hooks/useStaffingSettings.ts:42-59`); the save handler also
  invalidates `['shift-protection', restaurantId]` so the warning
  panels never read stale rules (the upsert invalidates only its own
  key — `src/hooks/useStaffingSettings.ts:56-58`). Opened from the
  trades tab and the time-off tab in `src/pages/Scheduling.tsx` (tab
  shells at `src/pages/Scheduling.tsx:901-948,1586-1611`), gated on
  `canManageSchedule` (`src/pages/Scheduling.tsx:234`).
- `TimeOffRequestDialog`: amber warning panel (notice + same-day counts
  via `get_timeoff_day_counts`), shown in create mode AND in edit mode
  (`request` prop set) — the edit path can move dates into the window.
  In `block` mode for a non-capability caller, disable submit and show
  the reason as an inline alert linked with `aria-describedby`. The
  panel carries `role="status"` (it appears while the user picks
  dates). Style: `bg-amber-500/10 border-amber-500/20`, body text
  `text-foreground`, amber icon only. Add
  `max-h-[80vh] overflow-y-auto` to the dialog content
  (`src/components/TimeOffRequestDialog.tsx:90` has no height cap).
- `TradeRequestDialog`: deadline warning plus the static responsibility
  note ("This shift stays yours until a manager approves the trade").
  Same panel style and `max-h-[80vh] overflow-y-auto`
  (`src/components/schedule/TradeRequestDialog.tsx:157` has no height
  cap). The accept confirm flow shows the same client-side deadline
  finding, so the accepter also sees the rule in `warn` mode.
- `TradeApprovalQueue`: a `ShiftTradePolicyWarning` opens the existing
  approve/reject confirm dialog
  (`src/components/schedule/TradeApprovalQueue.tsx:55,124,793-900`)
  with the findings listed and an "Approve anyway" action that retries
  with `p_override = true`
  (approve call site: `src/hooks/useShiftTrades.ts:448-475`).
- `PendingQueue`/`TimeOffRow`: approve/reject through the new RPC.
  The coverage-impact panel loads lazily — on row expand or on the
  approve action, with the query in `PendingQueue`, never inside the
  memoized `TimeOffRow` (`src/components/timeoff/TimeOffRow.tsx:44` is
  a `React.memo` row; a hook inside breaks its contract, and one RPC
  per row is an N+1). "Approve anyway" on `policy_warning`.
- **Three-state rendering** (CLAUDE.md): the day-counts panel, the
  coverage panel, and the settings dialog each define loading (skeleton
  or spinner line), error (compact inline error, request still
  submittable), and empty (no panel). The client block gate fails open
  on a settings load error — the server trigger is the backstop.
- Type updates: `StaffingSettings` (`src/types/scheduling.ts:303-317`),
  `DEFAULTS` and the select list
  (`src/hooks/useStaffingSettings.ts:9-19,31`).

### 9. Tests

- pgTAP: new specs for `review_time_off_request` (authz per the trade
  pattern, pending-only, findings, override), `approve_shift_trade`
  (findings, override, unchanged happy path, EXECUTE grant present
  after the DROP/CREATE), `accept_shift_trade` block-mode deadline,
  the three triggers (block fires for an employee on INSERT and on the
  bypass UPDATE paths; does not fire for a capability holder; cancel
  and cron transitions unaffected), `expire_stale_shift_trades`
  (only `open` + opted-in restaurants; sets the `auto_expired` marker),
  the read RPC guards (cross-restaurant caller denied on all three),
  and the `staffing_settings` policy swap (capability write allowed,
  residual scan over `pg_policies` shows the old role predicate gone).
  Update existing suites that call the changed functions
  (`supabase/tests/17_shift_trade_functions_security.sql`,
  `54_accept_shift_trade_authz.sql`, `65_trade_approval_area_grant.test.sql`).
- Unit: `tests/unit/shiftProtection.test.ts` for the calculators and
  the error parser.
- E2E: `tests/e2e/shift-protection.spec.ts` — manager turns on warn
  rules; employee submits a short-notice time-off request and sees the
  warning; manager sees the finding and approves with "Approve anyway".

### 10. Rollout and safety

- All modes default to `off`; the triggers and RPC findings no-op until
  a restaurant opts in.
- The old direct UPDATE approval path stays valid for owner/manager
  during deploy; the new UI stops using it. No RLS tightening on
  `time_off_requests` in v1.
- Migration timestamps get generated at file-creation time; check
  `git ls-tree origin/main supabase/migrations/` for prefix collisions
  before push (lessons: collisions recur).

## Decided trade-offs

1. Approval-time `block` equals `warn` (override allowed). Managers stay
   flexible; `block` binds only the employee paths. This matches the
   mockup footer copy the user approved.
2. The coverage preview uses per-shift overlap counts, not the
   sweep-line minimum. Cheaper, close enough for a warning.
3. Auto-expired trades send no push/email in v1. The poster sees the
   "Expired" outcome in the activity card instead (section 5).
4. The direct owner/manager UPDATE on `time_off_requests` remains. An
   old client can still approve without findings until it reloads.
5. `warn`-mode trade accepts stay server-silent; the accept UI shows
   the client-side finding, and the warning repeats at approval time.
6. The `sameday` count in `review_time_off_request` can race: two
   concurrent approvals on the same day can both pass under the limit.
   The rule is a warning with an override; the race is accepted.
7. The `timeoff_conflict` finding matches approved AND pending requests
   (`check_timeoff_conflict` semantics); the warning copy states that.
