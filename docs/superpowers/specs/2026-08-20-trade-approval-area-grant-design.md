# Design: shift-trade approval from the scheduling area grant

Date: 2026-08-20
Branch: `fix/trade-approval-area-grant`
Ticket context: closes the product decision filed as `task_d9ab7984`
(supabase/migrations/20260713000000_restrict_directed_shift_trade_visibility.sql:17).

## Problem

A member with a custom role can hold the `scheduling` area at the `manage`
level. The schedule page then shows the trade approval queue to that member.
The approve call fails. The database still checks the legacy role string.

Production evidence: user `edenaragon184@gmail.com` holds the custom
collaborator role "Operations lead". The role grants `scheduling` at
`manage`. The member row has `role = 'collaborator_custom'`. The RPC
returned `Unauthorized: Manager access required`.

## Current behavior (cited)

- `approve_shift_trade` rejects a caller when
  `v_user_role IS NULL OR v_user_role NOT IN ('owner', 'manager')`
  (supabase/migrations/20260713010000_harden_accept_shift_trade.sql:153).
- `reject_shift_trade` has the same guard
  (supabase/migrations/20260713010000_harden_accept_shift_trade.sql:230).
- `create_shift_trade_for_employee` has the same guard in its latest body
  (supabase/migrations/20260814130000_allow_draft_shift_trade.sql:42).
- `cancel_shift_trade` is offerer-only and has no manager branch
  (supabase/migrations/20260713010000_harden_accept_shift_trade.sql:287).
  It does not change.
- RLS policy `"Managers can view all shift trades"` (SELECT) checks
  `role IN ('owner', 'manager')`
  (supabase/migrations/20260104120000_create_shift_trades.sql:123).
- RLS policy `"Managers can approve or reject trades"` (UPDATE) has the same
  check (supabase/migrations/20260104120000_create_shift_trades.sql:135).
- RLS policy `"Managers can delete shift trades"` (DELETE) has the same
  check (supabase/migrations/20260105000000_fix_shift_trades_rls.sql:36).
- The SQL helper `public.user_has_capability(p_restaurant_id, p_capability)`
  resolves a capability from `role_areas` when the member has a `role_id`,
  and from a legacy role CASE when the member does not
  (supabase/migrations/20260730140000_user_has_capability_from_areas.sql:57).
  The map row `('edit:scheduling', 'scheduling', 'manage')` is at line 226.
  The legacy CASE grants `edit:scheduling` to
  `('owner', 'manager', 'operations_manager', 'collaborator_operations_manager')`
  (supabase/migrations/20260730140000_user_has_capability_from_areas.sql:146).
  The helper fails closed for a non-member (line 83) and for a member with
  no `role_id` and no `role` string (line 90).
- RLS policies already call this helper in production. Example:
  `user_has_capability(restaurant_id, 'edit:scheduling')`
  (supabase/migrations/20260730150000_rewrite_collaborator_policies.sql:79).
- The frontend derives the same capability from the same grants
  (src/hooks/usePermissions.ts:140). The approve hook calls the RPC
  (src/hooks/useShiftTrades.ts:448).
- `Scheduling.tsx` shows the trades tab and the approval queue to every
  member who can open the page. The tab trigger has no capability gate
  (src/pages/Scheduling.tsx:906) and the queue render has no capability
  gate (src/pages/Scheduling.tsx:1632). The queue mounts approve, reject,
  and delete mutations (src/components/schedule/TradeApprovalQueue.tsx:117,
  src/components/schedule/TradeApprovalQueue.tsx:155).
- No frontend code matches on the error string
  `Unauthorized: Manager access required` (grep of `src/` returned zero
  rows), so the message can change.
- pgTAP suites that touch these objects:
  `supabase/tests/16_shift_trades_security.sql:144` asserts the policy name
  `Managers can delete shift trades` exists.
  `supabase/tests/17_shift_trade_functions_security.sql:174` asserts a
  caller with no membership row fails closed on approve and reject.
  `supabase/tests/53_directed_shift_trade_rls.sql` covers directed-trade
  visibility.

## Decision

Make `user_has_capability(restaurant_id, 'edit:scheduling')` the single
authorization predicate for every manager-side shift-trade surface: the
three RPC guards and the three RLS policies. The read audience and the
action audience stay equal (lesson 2026-07-13: a read grant without the
matching action grant shows a dead queue).

Audience change, stated plainly:

| Caller | Before | After |
|---|---|---|
| owner, manager (legacy or migrated) | allowed | allowed |
| custom role with `scheduling@manage` (Eden) | denied | allowed |
| builtin `operations_manager` / `collaborator_operations_manager` | denied | allowed |
| custom role with `scheduling@view` | denied | denied |
| chef (has `view:scheduling` only) | denied | denied |
| non-member, or member with no role data | denied | denied (fail closed) |

The `operations_manager` rows are the deliberate product change that
`task_d9ab7984` deferred. The user approved this direction in chat on
2026-08-20.

## Changes

### 1. Migration (one file)

`supabase/migrations/<fresh-timestamp>_trade_approval_area_grant.sql`:

- Re-create `approve_shift_trade` and `reject_shift_trade`. Source the
  bodies from `20260713010000_harden_accept_shift_trade.sql` (the latest
  definitions; confirmed by
  `grep -rlE "FUNCTION\s+(public\.)?approve_shift_trade" supabase/migrations | sort`).
  Change only the guard block:
  `IF NOT user_has_capability(v_trade.restaurant_id, 'edit:scheduling') THEN`
  with error `Unauthorized: schedule manage access required`.
  Keep `SECURITY DEFINER`, keep `SET search_path = public, pg_temp`, keep
  the `p_manager_user_id != auth.uid()` check, keep the grants and update
  the function comments.
- Re-create `create_shift_trade_for_employee`. Source the body from
  `20260814130000_allow_draft_shift_trade.sql`. Same guard swap.
- Drop and re-create the three policies with the same names and with
  `USING (user_has_capability(shift_trades.restaurant_id, 'edit:scheduling'))`:
  `"Managers can view all shift trades"` (SELECT),
  `"Managers can approve or reject trades"` (UPDATE, keep
  `WITH CHECK (true)`),
  `"Managers can delete shift trades"` (DELETE).
  Keep the policy names so `16_shift_trades_security.sql:144` stays true.
- Write a provenance header that names the source migration for each
  re-created object (lesson 2026-07-22).
- Note: the trade row carries `restaurant_id`, so the guard reads
  `v_trade.restaurant_id` after the `FOR UPDATE` fetch. The fetch happens
  before the guard in the current bodies; keep that order.

### 2. pgTAP tests (new file)

`supabase/tests/<NN>_trade_approval_area_grant.test.sql`, with per-clause,
non-vacuous subjects (lesson 2026-07-13):

1. A member whose only grant is a custom role with `scheduling@manage`
   (no `employees` row, `role = 'collaborator_custom'`) can:
   call `approve_shift_trade` with success; call `reject_shift_trade`
   with success; SELECT all trades in the restaurant; DELETE a trade.
2. A member with the same custom-role shape at `scheduling@view` gets
   `Unauthorized: schedule manage access required` from both RPCs, sees
   zero non-participant trades, and deletes zero rows.
3. A legacy `operations_manager` (no `role_id`) can approve — this pins
   the widened legacy audience.
4. A caller with no membership row still fails closed (keeps the intent of
   `17_shift_trade_functions_security.sql:174`).

Impersonate with `set_config('request.jwt.claims', ...)` for `auth.uid()`;
add `SET LOCAL role = 'authenticated'` only for the RLS assertions; `RESET
ROLE` before `finish()` (lesson 2026-07-22).

### 3. Frontend

Gate the manager trade surfaces on the same capability:

- In `src/pages/Scheduling.tsx`, hide the trades `TabsTrigger`
  (line 906) and the trades `TabsContent` (line 1632) when
  `hasCapability('edit:scheduling')` is false. This deletes the dead
  approval queue that a chef sees today.
- No change in `TradeApprovalQueue` internals: after the gate, every
  viewer of the queue can act on it.

### 4. Tests (TypeScript)

- Unit test for the tab gate: with `edit:scheduling` the trades tab shows;
  with only `view:scheduling` it does not.
- E2E: extend `tests/e2e/manager-initiated-shift-trade.spec.ts` (or add a
  spec) so a member with a custom `scheduling@manage` role approves a
  pending trade end to end.

## Out of scope (filed as follow-up)

- Open-shift claims: `approve_open_shift_claim` keeps its
  `('owner','manager','operations_manager')` guard. A custom-role member
  with `scheduling@manage` cannot approve claims yet. Same pattern, its
  own PR.
- The stale-marketplace-trade visibility risk documented in
  `20260805130000_self_scope_employee_reads.sql:60` is unrelated and
  unchanged.

## Decided trade-offs

- The RPC guards and the RLS policies both call a `STABLE SECURITY
  DEFINER` plpgsql helper. The policy rewrite migration `20260730150000`
  set this precedent on hotter tables; trade volume is low.
- `WITH CHECK (true)` on the UPDATE policy is kept as-is. Approve and
  reject go through the SECURITY DEFINER RPCs; the policy exists for
  direct updates by the same audience. Narrowing it is not this task.
