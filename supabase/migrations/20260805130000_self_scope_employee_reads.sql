-- Self-scope employee reads on six tables so a staff/kiosk-tier caller can only read their own
-- rows via RLS (defense in depth for the client-side scoping added in this change).
--
-- For each table, the single membership-only SELECT policy is replaced by:
--   1. an own-row policy (employee_id resolves to the caller via employees.user_id)
--   2. a privileged restaurant-wide policy gated on
--      user_has_capability(restaurant_id, 'view:scheduling') OR
--      user_has_capability(restaurant_id, 'view:payroll')
--
-- `shifts` additionally needs a third clause so the shift-trade marketplace (which reads other
-- employees' offered/requested shift rows via an embedded join) keeps working.
--
-- `time_punches` and `employee_tips` already carry a legacy own-row policy and two
-- byte-identical legacy manager policies: one created by
-- 20251114100100_create_time_tracking_tables.sql ("Managers can view all time punches for
-- their restaurants" / "Managers can view all employee tips for their restaurants") and a
-- same-logic twin created under a different name by
-- 20251115165031_3275bc7c-bc33-4b20-b42c-fd1a9c022d07.sql ("Managers can view restaurant
-- time punches" / "Managers can view restaurant tips") — the latter migration's own
-- `DROP POLICY IF EXISTS` only ever targeted its own name idempotently, so it never removed
-- the older-named twin. The legacy own-row policy is dropped in favor of the uniform one
-- (stacking both would double-evaluate an own-row subquery on the two highest-volume tables
-- in this change), and BOTH duplicate manager policies (both names) are dropped so only the
-- new capability-gated policy remains (A OR A ≡ A, so this is behaviour-preserving and
-- removes a redundant per-row user_restaurants subquery).
--
-- See docs/superpowers/specs/2026-08-05-employee-self-scoped-data-design.md §4 for the full
-- rationale; policy bodies below are transcribed from production pg_policies, not re-derived.

-- ---------------------------------------------------------------------------
-- shifts
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "Users can view shifts for their restaurants" ON shifts;

CREATE POLICY "Employees can view own shifts"
  ON shifts
  FOR SELECT
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM employees e
    WHERE e.id = shifts.employee_id
      AND e.user_id = (select auth.uid())
      AND e.restaurant_id = shifts.restaurant_id
  ));

CREATE POLICY "Scheduling or payroll capability view shifts"
  ON shifts
  FOR SELECT
  TO authenticated
  USING (
    user_has_capability(restaurant_id, 'view:scheduling')
    OR user_has_capability(restaurant_id, 'view:payroll')
  );

-- Deliberately carries no status/participant filter. The subquery is itself evaluated under
-- the caller's RLS on shift_trades, so this implements exactly "you may see a shift iff you
-- may see a trade referencing it" — the two policies stay in lockstep by construction.
--
-- Accepted residual risk (design §4.3.1): shift_trades' own SELECT policy admits any active
-- employee to every open-marketplace trade (target_employee_id IS NULL) regardless of status,
-- so a resolved trade keeps its shift readable by coworkers. Measured at 37 of 8,195 shifts
-- (0.45%) across 2 restaurants, all of them shifts their owner broadcast to the marketplace.
-- The root-cause fix belongs in the shift_trades policy — a product decision about trade
-- history — and is filed as a follow-up. When it lands, this clause inherits it unchanged.
CREATE POLICY "Employees can view shift-trade-referenced shifts"
  ON shifts
  FOR SELECT
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM shift_trades st
    WHERE st.restaurant_id = shifts.restaurant_id
      AND (st.offered_shift_id = shifts.id OR st.requested_shift_id = shifts.id)
  ));

-- §4.6: the new shifts clause filters shift_trades on requested_shift_id, which has no index
-- in production today (only offered_shift_id is indexed).
CREATE INDEX IF NOT EXISTS idx_shift_trades_requested_shift
  ON shift_trades (requested_shift_id);

-- ---------------------------------------------------------------------------
-- employee_compensation_history
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "Users can view compensation history for their restaurants" ON employee_compensation_history;

CREATE POLICY "Employees can view own compensation history"
  ON employee_compensation_history
  FOR SELECT
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM employees e
    WHERE e.id = employee_compensation_history.employee_id
      AND e.user_id = (select auth.uid())
      AND e.restaurant_id = employee_compensation_history.restaurant_id
  ));

CREATE POLICY "Scheduling or payroll capability view comp history"
  ON employee_compensation_history
  FOR SELECT
  TO authenticated
  USING (
    user_has_capability(restaurant_id, 'view:scheduling')
    OR user_has_capability(restaurant_id, 'view:payroll')
  );

-- ---------------------------------------------------------------------------
-- overtime_adjustments
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "Users can view their restaurant overtime adjustments" ON overtime_adjustments;

CREATE POLICY "Employees can view own overtime adjustments"
  ON overtime_adjustments
  FOR SELECT
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM employees e
    WHERE e.id = overtime_adjustments.employee_id
      AND e.user_id = (select auth.uid())
      AND e.restaurant_id = overtime_adjustments.restaurant_id
  ));

CREATE POLICY "Scheduling or payroll capability view overtime adjustments"
  ON overtime_adjustments
  FOR SELECT
  TO authenticated
  USING (
    user_has_capability(restaurant_id, 'view:scheduling')
    OR user_has_capability(restaurant_id, 'view:payroll')
  );

-- ---------------------------------------------------------------------------
-- daily_labor_allocations
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "Users can view allocations for their restaurants" ON daily_labor_allocations;

CREATE POLICY "Employees can view own daily labor allocations"
  ON daily_labor_allocations
  FOR SELECT
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM employees e
    WHERE e.id = daily_labor_allocations.employee_id
      AND e.user_id = (select auth.uid())
      AND e.restaurant_id = daily_labor_allocations.restaurant_id
  ));

CREATE POLICY "Scheduling or payroll capability view daily labor allocations"
  ON daily_labor_allocations
  FOR SELECT
  TO authenticated
  USING (
    user_has_capability(restaurant_id, 'view:scheduling')
    OR user_has_capability(restaurant_id, 'view:payroll')
  );

-- ---------------------------------------------------------------------------
-- time_punches (§4.2.1: replace legacy own-row policy + membership policy;
-- collapse the two duplicate legacy manager policies to one)
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "Users can view time punches for their restaurants" ON time_punches;
DROP POLICY IF EXISTS "Employees can view own time punches" ON time_punches;
DROP POLICY IF EXISTS "Managers can view restaurant time punches" ON time_punches;
-- Byte-identical duplicate left behind by 20251114100100_create_time_tracking_tables.sql;
-- 20251115165031 only ever dropped-and-recreated the "...restaurant time punches" name
-- above under its own idempotent DROP IF EXISTS, so this older-named twin was never
-- actually removed. Must be dropped here too or it stays ORed against the new
-- capability-gated policy below, silently keeping restaurant-wide access for any
-- owner/manager regardless of view:scheduling/view:payroll capability.
DROP POLICY IF EXISTS "Managers can view all time punches for their restaurants" ON time_punches;

CREATE POLICY "Employees can view own time punches"
  ON time_punches
  FOR SELECT
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM employees e
    WHERE e.id = time_punches.employee_id
      AND e.user_id = (select auth.uid())
      AND e.restaurant_id = time_punches.restaurant_id
  ));

CREATE POLICY "Scheduling or payroll capability view time punches"
  ON time_punches
  FOR SELECT
  TO authenticated
  USING (
    user_has_capability(restaurant_id, 'view:scheduling')
    OR user_has_capability(restaurant_id, 'view:payroll')
  );

-- ---------------------------------------------------------------------------
-- employee_tips (§4.2.1: replace legacy own-row policy + membership policy;
-- collapse the two duplicate legacy manager policies to one)
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "Users can view tips for their restaurants" ON employee_tips;
DROP POLICY IF EXISTS "Employees can view own tips" ON employee_tips;
DROP POLICY IF EXISTS "Managers can view restaurant tips" ON employee_tips;
-- Byte-identical duplicate left behind by the original tips migration, same
-- as the time_punches twin above — never dropped by any later migration.
DROP POLICY IF EXISTS "Managers can view all employee tips for their restaurants" ON employee_tips;

CREATE POLICY "Employees can view own tips"
  ON employee_tips
  FOR SELECT
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM employees e
    WHERE e.id = employee_tips.employee_id
      AND e.user_id = (select auth.uid())
      AND e.restaurant_id = employee_tips.restaurant_id
  ));

CREATE POLICY "Scheduling or payroll capability view tips"
  ON employee_tips
  FOR SELECT
  TO authenticated
  USING (
    user_has_capability(restaurant_id, 'view:scheduling')
    OR user_has_capability(restaurant_id, 'view:payroll')
  );
