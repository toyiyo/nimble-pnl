# Design — Enforce directed-trade privacy in shift_trades RLS

**Date:** 2026-07-13
**Branch:** `fix/shift-trade-directed-rls`
**Ticket:** task_35a15d77 (security gap found in PR #607 review)

## Problem

Directed shift trades (`shift_trades.target_employee_id` set) are meant to be private to the
target, but that privacy is enforced **only client-side** (the marketplace `.or()` filter in
`useShiftTrades.ts`). At the DB layer, `shift_trades` SELECT **Policy 1**
(`20260104120000_create_shift_trades.sql:72-81`) only checks restaurant membership:

```sql
CREATE POLICY "Employees can view shift trades in their restaurant" ON shift_trades FOR SELECT
USING (EXISTS (SELECT 1 FROM employees
  WHERE employees.user_id = auth.uid() AND employees.restaurant_id = shift_trades.restaurant_id
  AND employees.is_active = true));
```

So **any active employee can `SELECT` any directed trade** (target, `reason`, joined shift/offerer)
via a raw PostgREST query or `useShiftTrades(restaurantId)` with no `employeeId`. Pre-existing;
distinct from `task_344afce3` (email client) and the merged email/push leak fixes.

## Approach

**DROP + recreate Policy 1** with a tightened `USING`. Not a new `AS RESTRICTIVE` policy — Policy 1
is the *sole* SELECT grant for regular employees, so narrowing its condition narrows their access
directly; **Policy 4** ("Managers can view all shift trades", permissive, ORed) is untouched, so
managers still see everything. (Per the session lesson: a *new permissive* policy can only widen —
but *replacing* the existing permissive policy's `USING` correctly narrows. `AS RESTRICTIVE` would
also work but is unnecessary here and would complicate the manager path.)

New migration `supabase/migrations/<ts-after-latest>_restrict_directed_shift_trade_visibility.sql`:

```sql
DROP POLICY IF EXISTS "Employees can view shift trades in their restaurant" ON shift_trades;

CREATE POLICY "Employees can view shift trades in their restaurant"
  ON shift_trades FOR SELECT
  USING (
    -- unchanged: must be an active employee of the trade's restaurant
    EXISTS (
      SELECT 1 FROM employees e
      WHERE e.user_id = auth.uid()
        AND e.restaurant_id = shift_trades.restaurant_id
        AND e.is_active = true
    )
    AND (
      -- open marketplace trade: visible to every active employee (unchanged)
      shift_trades.target_employee_id IS NULL
      -- directed trade: only the target, the offerer, or the accepter may see it
      OR EXISTS (
        SELECT 1 FROM employees me
        WHERE me.user_id = auth.uid()
          AND me.restaurant_id = shift_trades.restaurant_id
          AND me.id IN (
            shift_trades.target_employee_id,
            shift_trades.offered_by_employee_id,
            shift_trades.accepted_by_employee_id
          )
      )
    )
  );

COMMENT ON POLICY "Employees can view shift trades in their restaurant" ON shift_trades IS
  'Active employees see open (target NULL) trades; a DIRECTED trade is visible only to its target, '
  'offerer, or accepter. Managers/owners see all via the separate "Managers can view all shift '
  'trades" policy. Directed-trade privacy was previously client-side only (task_35a15d77).';
```

Notes:
- `me.id IN (target, offered_by, accepted_by)` handles NULLs correctly (`accepted_by` NULL simply
  doesn't match). Subquery is restaurant-scoped for defense-in-depth (a user may be an employee at
  multiple restaurants).
- Offerer inclusion lets a poster see/cancel their own directed trade; accepter inclusion keeps a
  claimed trade visible to whoever accepted it.

## No app breakage (verified)

- `useShiftTrades` marketplace query already filters `.or(offered_by.eq.me, accepted_by.eq.me,
  target.eq.me)` when `employeeId` is passed; `useMyTradeActivity` filters offered/accepted; manager
  UIs rely on Policy 4. A `useShiftTrades(restaurantId)` call **without** `employeeId` previously
  leaked directed trades via RLS — now it correctly returns only the caller's visible trades. The
  tighter RLS matches existing app intent; no query needs changing.

## Testing (pgTAP)

New `supabase/tests/<nn>_directed_shift_trade_rls.sql`, using the
`SET LOCAL ROLE authenticated` + `SET LOCAL "request.jwt.claims" TO '{"sub":"<user>","role":"authenticated"}'`
impersonation pattern (from `33_tip_splits_employee_rls.sql` / `22_operations_manager_rls.sql`).
Seed: one restaurant, employees A(offerer), B(target), C(bystander), M(manager), + a second
restaurant employee X; one DIRECTED trade (A→B) and one OPEN trade (A→NULL).

Assertions (`is (SELECT COUNT(*) ...)`):
1. Bystander C: directed trade → **0 rows** (the fix).
2. Target B: directed trade → 1 row.
3. Offerer A: directed trade → 1 row.
4. Accepter (set `accepted_by_employee_id` = B): directed trade still 1 for B.
5. Manager M: directed trade → 1 row (Policy 4).
6. Open trade: visible to A, B, C (all active employees) → each 1 row.
7. Cross-restaurant X: both trades → 0 rows (restaurant isolation intact).
8. `policies_are`/`policy_cmd_is` sanity: Policy 1 still exists and is a SELECT policy.

## Decided trade-offs

- **Managers/owners still see all directed trades** (Policy 4, unchanged) — intended (approval flow).
- **Offerer + accepter included** beyond just the target — they are legitimate participants; matches
  the UPDATE policy's own offerer/target logic (`20260104120000:95-120`).
- **RLS is now the backstop, not the primary filter** — the client `.or()` stays (fast, avoids
  fetching hidden rows), but is no longer the only line of defense.
