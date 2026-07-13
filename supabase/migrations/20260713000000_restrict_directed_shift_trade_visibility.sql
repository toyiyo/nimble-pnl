-- Restrict directed shift_trades visibility to their participants
--
-- Policy 1 ("Employees can view shift trades in their restaurant") currently
-- only checks restaurant membership, so any active employee can SELECT a
-- DIRECTED trade (target_employee_id set) even though it is meant to be
-- private to the target/offerer/accepter. Privacy for directed trades was
-- previously enforced only client-side (the marketplace `.or()` filter in
-- useShiftTrades.ts). This migration makes RLS the backstop.
--
-- Policy 4 ("Managers can view all shift trades") is intentionally left
-- unchanged (owner/manager only). operations_manager is NOT added: the
-- approve/reject RPCs and the delete policy are owner/manager-only
-- (20260105000100_create_shift_trade_functions.sql), so granting an
-- operations_manager SELECT on trades they cannot action would only surface a
-- dead approval queue. Keeping SELECT aligned with the write path is the
-- consistent choice (see task_d9ab7984 if operations_manager should ever
-- participate in trade approvals — that's a product decision, not this fix).
--
-- Design: docs/superpowers/specs/2026-07-13-shift-trade-directed-rls-design.md
-- Ticket: task_35a15d77

DROP POLICY IF EXISTS "Employees can view shift trades in their restaurant" ON shift_trades;

CREATE POLICY "Employees can view shift trades in their restaurant"
  ON shift_trades FOR SELECT
  USING (
    -- Single EXISTS: active status and participant identity must be the SAME
    -- employee row. Splitting these into two separate EXISTS clauses would let
    -- a user with more than one employees row for this restaurant satisfy the
    -- active check via one row and the participant check via a different
    -- (possibly inactive) row.
    EXISTS (
      SELECT 1 FROM employees me
      WHERE me.user_id = auth.uid()
        AND me.restaurant_id = shift_trades.restaurant_id
        AND me.is_active = true
        AND (
          -- open marketplace trade: visible to every active employee (unchanged)
          shift_trades.target_employee_id IS NULL
          -- directed trade: only the target, the offerer, or the accepter may see it
          OR me.id IN (
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

-- Policy 4 ("Managers can view all shift trades") is deliberately NOT modified here.
