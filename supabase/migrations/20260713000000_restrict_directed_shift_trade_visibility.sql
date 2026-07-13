-- Restrict directed shift_trades visibility to their participants
--
-- Policy 1 ("Employees can view shift trades in their restaurant") currently
-- only checks restaurant membership, so any active employee can SELECT a
-- DIRECTED trade (target_employee_id set) even though it is meant to be
-- private to the target/offerer/accepter. Privacy for directed trades was
-- previously enforced only client-side (the marketplace `.or()` filter in
-- useShiftTrades.ts). This migration makes RLS the backstop.
--
-- Also widens Policy 4 ("Managers can view all shift trades") to include
-- operations_manager, which is a manager-tier role granted scheduling/ops
-- visibility elsewhere (see 22_operations_manager_rls.sql). Without this,
-- tightening Policy 1 would regress operations_manager visibility for any
-- operations_manager who is also an employees row (they currently see all
-- trades via Policy 1), and a pure operations_manager with no employees row
-- would see nothing at all.
--
-- Design: docs/superpowers/specs/2026-07-13-shift-trade-directed-rls-design.md
-- Ticket: task_35a15d77

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
  'offerer, or accepter. Managers/owners/operations_managers see all via the separate "Managers can '
  'view all shift trades" policy. Directed-trade privacy was previously client-side only (task_35a15d77).';

DROP POLICY IF EXISTS "Managers can view all shift trades" ON shift_trades;

CREATE POLICY "Managers can view all shift trades"
  ON shift_trades FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_restaurants
      WHERE user_restaurants.user_id = auth.uid()
      AND user_restaurants.restaurant_id = shift_trades.restaurant_id
      AND user_restaurants.role IN ('owner', 'manager', 'operations_manager')
    )
  );

COMMENT ON POLICY "Managers can view all shift trades" ON shift_trades IS
  'Owners, managers, and operations_managers see every trade in their restaurant (approval/triage '
  'flow), bypassing the target/offerer/accepter restriction on the employee-facing policy. Widened to '
  'operations_manager alongside the directed-trade privacy fix to avoid a visibility regression '
  '(task_35a15d77).';
