# Manager-Initiated Shift Trade — Design

- Date: 2026-08-12
- Branch: `feature/manager-initiated-shift-trade`
- Status: Approved (design)
- Author: Claude (via `/dev`)
- Design review: both reviewers returned GO on 2026-08-12. This doc folds their
  feedback. See "Design review notes".

## Problem

A manager cannot post an employee's shift for trade. Today only the shift owner
can create a trade. When an employee asks for time off but does not start a
trade, the manager has no way to open that shift for a coworker to cover.

## Goal

Let an owner or a manager post an employee's shift for trade. The trade runs
through the same accept and approve flow that employees use now.

## Non-goals

- No direct reassignment. A manager can already reassign a shift. The manager
  edits the shift and changes the employee (`ShiftDialog`).
- No change to the accept, approve, reject, or cancel steps.
- No new notification type. The trade reuses the `created` notification.
- No `operations_manager` access in V1 (see "Scope decisions").
- No mobile entry point in V1 (see "Scope decisions").

## Current state (with citations)

The trade lifecycle uses one table and four RPCs.

- Table `shift_trades`, statuses `open → pending_approval → approved/rejected/cancelled`
  (`supabase/migrations/20260104120000_create_shift_trades.sql`).
- The INSERT policy blocks a manager. It requires the offerer to be the caller:
  `offered_by_employee_id IN (SELECT id FROM employees WHERE user_id = auth.uid() AND is_active = true)`
  (`supabase/migrations/20260105000000_fix_shift_trades_rls.sql:10-24`). This
  policy does not check that the offered shift belongs to the offerer.
- The client creates a trade with a direct `.insert()` in `useCreateShiftTrade`
  (`src/hooks/useShiftTrades.ts:296-341`). The INSERT policy blocks this for a
  manager.
- The approve and reject RPCs check role
  `v_user_role IS NULL OR v_user_role NOT IN ('owner', 'manager')`
  (`supabase/migrations/20260713010000_harden_accept_shift_trade.sql:153,230`).
- The manager approval queue is owner/manager-only. The directed-visibility
  migration keeps it that way and excludes `operations_manager` on purpose
  (`supabase/migrations/20260713000000_restrict_directed_shift_trade_visibility.sql:10-17`).
- The shift write path uses a capability. INSERT, UPDATE, and DELETE on `shifts`
  need `user_has_capability(restaurant_id, 'edit:scheduling')`
  (`supabase/migrations/20260730150000_rewrite_collaborator_policies.sql:130-152`).
- `edit:scheduling` maps to `owner, manager, operations_manager, collaborator_operations_manager`
  (`supabase/migrations/20260806140000_legacy_role_sensitive_flags.sql:130`). A
  custom role with `scheduling`/`manage` areas also resolves to `edit:scheduling`.
- The `created` notification path fans out correctly. A directed trade notifies
  only its target. An open trade notifies active employees
  (`supabase/functions/send-shift-trade-notification/index.ts:80-99,480-520`).
- The schedule shift card shows Edit and Delete on hover. The two icon buttons
  are siblings of the `role="button"` card, not nested (accessibility rule)
  (`src/pages/SchedulingShiftCard.tsx:201-231`).
- The employee create dialog `TradeRequestDialog` supports a marketplace trade
  and a directed trade. It uses the `ArrowRightLeft` icon for the trade concept
  (`src/components/schedule/TradeRequestDialog.tsx:98,151,237`).
- `Scheduling.tsx` renders `ShiftCard` from two call sites. The normal view
  wraps it in `DraggableShiftCard` (`src/pages/Scheduling.tsx:1422`). The
  selection mode uses a plain `ShiftCard` and hides hover actions
  (`src/pages/Scheduling.tsx:1406`).
- `EmployeeSchedule.tsx` already uses separate dialog state for this same
  `TradeRequestDialog`: `selectedShiftForTrade` and `tradeDialogOpen`
  (`src/pages/EmployeeSchedule.tsx:426-435`).

## Approaches considered

### A — New SECURITY DEFINER RPC (chosen)

Add `create_shift_trade_for_employee`. The client calls one RPC. The function
checks the caller role, confirms the shift belongs to the named employee and
restaurant, checks the target, then inserts the trade.

- Pro: matches the four RPCs already in this feature.
- Pro: one auditable trust boundary.
- Pro: the function validates that the shift belongs to the named employee.
- Con: one more RPC to maintain.

### B — Widen the INSERT RLS policy

Add a manager branch to the `WITH CHECK`. Keep the client `.insert()`.

- Pro: fewer lines.
- Con: the "shift belongs to that employee" check needs a `shifts` sub-join
  inside a policy.
- Con: the authorization logic splits between RLS and client.
- Con: harder to test and to read.

Decision: **A**. It is consistent with the existing RPCs and isolates the trust
boundary.

## Authorization

The RPC authorizes on `role IN ('owner', 'manager')`. This is the same audience
that approves trades
(`supabase/migrations/20260713010000_harden_accept_shift_trade.sql:153`).

Reason: whoever posts a trade must also be able to approve it. The approval
queue is owner/manager-only. If the RPC used `edit:scheduling` instead, an
`operations_manager` (or a custom role) could post a trade, then never see or
approve it. That result is a dead-end queue.

The migration puts a comment above the role check. The comment states the check
must track `approve_shift_trade`. A later capability migration must not move it
to `edit:scheduling`.

## Backend

Add a migration with one function.

```
create_shift_trade_for_employee(
  p_restaurant_id uuid,
  p_offered_shift_id uuid,
  p_offered_by_employee_id uuid,
  p_target_employee_id uuid DEFAULT NULL,
  p_reason text DEFAULT NULL
) RETURNS uuid
```

- `SECURITY DEFINER`, `SET search_path = public, pg_temp` (matches the hardened
  RPCs).
- `GRANT EXECUTE ... TO authenticated`.
- Every `RAISE EXCEPTION` uses a short, plain message. The client shows
  `error.message` in a toast with no rewrite.

Steps:

1. Read `auth.uid()`. If NULL, raise an error.
2. Read the caller role from `user_restaurants` for `p_restaurant_id`. If
   `v_user_role IS NULL OR v_user_role NOT IN ('owner', 'manager')`, raise an
   error. This NULL-safe form matches the hardened RPCs.
3. Read the offered shift from `shifts` by `p_offered_shift_id` into `v_shift`.
   Test `NOT FOUND` first. If the shift is missing, raise an error before you
   read any field. Then check `restaurant_id = p_restaurant_id` and
   `employee_id = p_offered_by_employee_id`. If either check fails, raise an
   error.
4. Block a shift that is not tradeable. Allow only
   `status IN ('scheduled', 'confirmed')`. `shifts.status` has no CHECK
   constraint, so an allow list stops a new status value from passing by default.
5. Check the offered employee is active and in the restaurant. If not, raise an
   error.
6. If `p_target_employee_id` is not NULL, check the target is active, in the
   restaurant, and not the offered employee. If not, raise an error.
7. Insert the trade with `status = 'open'`. Wrap the insert in an exception
   block. Catch `unique_violation` from `idx_unique_active_trade_per_shift`.
   Raise a clear message: the shift already has an active trade. Two managers can
   post the same shift at the same time, so the catch is required.
8. Return the new trade id.

Note on parity: V1 does not block a past shift. The employee INSERT policy does
not block one either. The shift card hides the action for a non-tradeable shift,
so the client does not send a past shift in normal use.

## Notifications

No change to the edge function. After the RPC returns the new trade id, the
client calls `sendShiftTradeNotification(tradeId, 'created')`. The `created`
path already fans out correctly for a directed trade and for an open trade.

## Frontend

### Entry point — shift card action

Add a third hover action, "Offer for trade", to `ShiftCard`. Put it next to Edit
and Delete. Keep it a sibling of the `role="button"` card, not nested.

- Use the `ArrowRightLeft` icon. `TradeRequestDialog.tsx` uses it for the same
  trade concept.
- Show the action only when the page passes an `onOfferTrade` callback. The page
  passes it in the manager context.
- Show the action only for a tradeable shift (`status IN ('scheduled',
  'confirmed')`). This matches the RPC allow list.
- Add `aria-label="Offer shift for trade"`.
- Add `e.stopPropagation()` on the click. This keeps the click off the card's
  own `onClick`, which opens the Edit dialog.

Width check: the desktop day column is `md:min-w-[130px]`
(`src/pages/Scheduling.tsx:1216`). Three 24px icons need about 76px, in the same
corner as the time text (`src/pages/SchedulingShiftCard.tsx:145-166`). Check the
button row against the real card width in the UI review (Phase 6). If the row
overlaps the time text, put only "Offer for trade" in a small overflow menu.
Keep Edit and Delete as icons.

### Dialog — extend `TradeRequestDialog`

Add one optional prop `onBehalfOfEmployee?: { id: string; name: string }`.

- When the prop is set, the dialog runs in manager mode. The offerer is that
  employee. The target list excludes that employee. The header reads
  "Offer {name}'s shift for trade". The submit calls the new RPC.
- When the prop is absent, the dialog behaves as today.
- The dialog uses `offererId` (from the prop, or from `currentEmployeeId`) to
  build the target list. The one real branch is the submit call.
- Make `currentEmployeeId?` optional. Require at least one of
  `onBehalfOfEmployee` or `currentEmployeeId`.
- Read `loading` and `error` from `useEmployees`. Show a skeleton row while
  `loading` is true. This stops a false "No other employees available" empty
  state before the first fetch finishes.
- Fix the header block to the CLAUDE.md pattern: a `text-[17px] font-semibold`
  title in an icon box. The current line uses `text-2xl`
  (`src/components/schedule/TradeRequestDialog.tsx:97`). This design adds new
  header text, so fix this one block now. A full dialog rewrite is a separate
  task.

### Hook

Add `useCreateShiftTradeForEmployee` in `src/hooks/useShiftTrades.ts`. It calls
`supabase.rpc('create_shift_trade_for_employee', {...})`, then reuses
`sendShiftTradeNotification` and `invalidateShiftTradeQueries`.

- The hook throws on a PostgREST error, the way `useCreateShiftTrade` does. It
  does not call `executeShiftTradeAction`. The RPC returns a bare `uuid`, not a
  `{success, error}` shape.
- Share one `onSuccess` callback between the manager submit and the normal
  submit. It closes the dialog and resets the three fields.

### Wiring

`Scheduling.tsx` holds the trade shift in its own state. Use `tradeShift` and
`tradeDialogOpen`. Do not reuse `selectedShift` or `shiftDialogOpen`. Those two
serve the Edit dialog (`src/pages/Scheduling.tsx:253,1622-1630`). If the trade
dialog reuses `selectedShift`, the Edit dialog and the trade dialog fight over
the same shift. `EmployeeSchedule.tsx` already uses separate state for this same
dialog.

`Scheduling.tsx` passes `onOfferTrade` only to the normal view call site
(`src/pages/Scheduling.tsx:1422`, wrapped in `DraggableShiftCard`). The
selection-mode call site (`src/pages/Scheduling.tsx:1406`) hides all hover
actions, so it needs no callback.

`Scheduling.tsx` renders one trade dialog instance for the trade shift
(single-dialog pattern).

## Data flow

1. Manager hovers a shift card and clicks "Offer for trade".
2. `Scheduling.tsx` sets `tradeShift` and opens the trade dialog.
3. Manager picks marketplace or a specific coworker, adds a reason, and submits.
4. The dialog calls `useCreateShiftTradeForEmployee`.
5. The hook calls the RPC. The RPC validates and inserts the trade.
6. The hook calls `sendShiftTradeNotification(tradeId, 'created')`.
7. The hook invalidates the trade queries. The trade shows in the queue.
8. A coworker accepts. The manager approves. The existing flow runs unchanged.

## Security considerations

- The RPC is the only new write path. It checks role, shift ownership, and
  restaurant scope. It runs as `SECURITY DEFINER` with a pinned `search_path`.
- The RPC does not widen the INSERT RLS policy. The employee path is unchanged.
- The target and offered employee must be in the same restaurant. This keeps
  tenant isolation.
- The client gate on the shift card is a convenience, not the control. The RPC
  is the control.
- The RPC needs no direct SELECT grant for the caller. It returns the new id
  from the insert. The existing SELECT policy already shows the new trade to any
  owner or manager in the restaurant.

## Testing

### pgTAP (`supabase/tests/`)

- A manager posts an open trade. Success.
- A manager posts a directed trade. Success.
- A non-manager (for example `staff`) is blocked.
- A shift from another restaurant is blocked.
- A shift id that does not exist is blocked.
- A shift that does not belong to the named employee is blocked.
- A target equal to the offered employee is blocked.
- A second active trade for the same shift is blocked (the `unique_violation`
  catch raises the clear message).
- A `cancelled` shift is blocked (allow-list check).

### Vitest (`tests/unit/`)

- `useCreateShiftTradeForEmployee` calls the RPC and fires the `created`
  notification.
- `TradeRequestDialog` in manager mode calls the RPC and excludes the offerer
  from the target list.
- `TradeRequestDialog` shows a skeleton row while the employee list loads.

### Playwright (`tests/e2e/`)

- A manager opens a shift card, offers a shift to the marketplace, and sees the
  trade in the queue.

## Scope decisions (V1)

- `operations_manager` and `collaborator_operations_manager` cannot initiate a
  trade. The approval queue is owner/manager-only, so a wider create audience
  would make a dead-end queue. The open question is filed as `task_d9ab7984`.
- Desktop only in V1. `WeekScheduleMobile.tsx` renders `ShiftCard`
  (`src/components/schedule/WeekScheduleMobile.tsx:197`), but a touch screen has
  no hover state. Mobile needs an always-visible button, not the hover action.
  V1 skips mobile on purpose. File a follow-up task for the mobile entry point.
- The manager RPC has a wider blast radius than the employee path. A manager can
  name any shift in the restaurant. A scripted call could post many past shifts.
  V1 accepts this risk. The role check limits the caller to owner or manager.
- No past-shift block in the RPC. This matches the employee path.
- No new notification type. The trade reuses `created`.

## Rollout

- One new migration (the RPC). It is additive. No data change.
- No change to the edge function.
- The frontend change is additive. The employee path is unchanged.

## Design review notes

Both reviewers returned GO with no blockers on 2026-08-12.

Supabase review — folded items:

- Catch `unique_violation` on the insert (Backend step 7).
- Test `NOT FOUND` on the shift read (Backend step 3).
- Use an allow list for the shift status (Backend step 4).
- Add a comment that ties the role check to `approve_shift_trade`
  (Authorization).
- Name the wider manager blast radius as accepted (Scope decisions).
- State the hook throws on a PostgREST error (Hook).

Frontend review — folded items:

- Name the `ArrowRightLeft` icon (Entry point).
- Add the card width check with an overflow-menu fallback (Entry point).
- Add `e.stopPropagation()` on the action (Entry point).
- Use separate `tradeShift` / `tradeDialogOpen` state (Wiring).
- Wire only the normal view call site (Wiring).
- Make `currentEmployeeId?` optional (Dialog).
- Add the employee-list loading state (Dialog).
- Fix the header block to the CLAUDE.md pattern (Dialog).
- Share one `onSuccess` callback (Hook).
- Skip mobile in V1 on purpose (Scope decisions).
