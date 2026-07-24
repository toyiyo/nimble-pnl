-- ============================================================================
-- Migration: Add collaborator_operations_manager role
--
-- External, ISOLATED operations collaborator. Full operational surface
-- (scheduling, tips, time punches, inventory, recipes, view payroll, POS view,
-- AI assistant) but NO admin (team/manage-employees/settings-edit/integrations/
-- collaborators) and NO accounting. NOT added to user_is_internal_team, so the
-- collaborator sees only its own user_restaurants row (isolation preserved).
--
-- ALSO (behavior change to an EXISTING role — see PR description): widens the
-- core shifts/shift_templates/time_off_requests INSERT/UPDATE/DELETE policies to
-- include operations_manager AND collaborator_operations_manager, fixing a latent
-- gap where operations_manager held edit:scheduling but could not write shifts.
--
-- Order: constraint -> user_has_capability -> RLS. The constraint drop/recreate
-- takes a brief lock on user_restaurants (acceptable — small per-tenant table).
-- ============================================================================

-- 1. Extend the role CHECK constraint to include the new collaborator role.
ALTER TABLE public.user_restaurants
  DROP CONSTRAINT IF EXISTS user_restaurants_role_check;

ALTER TABLE public.user_restaurants
  ADD CONSTRAINT user_restaurants_role_check
  CHECK (role IN (
    'owner', 'manager', 'operations_manager', 'chef', 'staff', 'kiosk',
    'collaborator_accountant', 'collaborator_inventory', 'collaborator_chef',
    'collaborator_operations_manager'
  ));

-- ============================================================================
-- 2. Re-create user_has_capability with collaborator_operations_manager added
-- to the SAME branches operations_manager appears in, EXCEPT: view:team,
-- manage:team, manage:employees, edit:payroll (NOT granted — those remain
-- internal-team-only / admin surfaces). Additionally granted: view:payroll,
-- view:employees (both already included operations_manager; the new role is
-- simply added alongside it), and view:ai_assistant (subscription-gated,
-- AND-clause preserved).
--
-- Source: 20260702170000_add_operations_manager_role.sql (live body copied
-- verbatim, then collaborator_operations_manager appended to the applicable
-- v_role IN (...) lists below).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.user_has_capability(
  p_restaurant_id UUID,
  p_capability TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role TEXT;
  v_has_role_permission BOOLEAN;
BEGIN
  -- Get user's role for this restaurant
  SELECT role INTO v_role
  FROM user_restaurants ur
  WHERE ur.restaurant_id = p_restaurant_id
    AND ur.user_id = auth.uid();

  IF v_role IS NULL THEN
    RETURN FALSE;
  END IF;

  -- Check role-based permission AND subscription where applicable
  RETURN CASE p_capability
    -- === SUBSCRIPTION-GATED CAPABILITIES ===

    -- AI Assistant: Role check + Pro subscription required
    -- operations_manager / collaborator_operations_manager included: they run
    -- operations and benefit from AI
    WHEN 'view:ai_assistant' THEN
      v_role IN ('owner', 'manager', 'operations_manager', 'collaborator_operations_manager') AND
      has_subscription_feature(p_restaurant_id, 'ai_assistant')

    -- Financial Intelligence: Role check + Growth+ subscription required
    -- operations_manager / collaborator_operations_manager excluded: this is
    -- an accounting/financial surface
    WHEN 'view:financial_intelligence' THEN
      v_role IN ('owner', 'manager', 'collaborator_accountant') AND
      has_subscription_feature(p_restaurant_id, 'financial_intelligence')

    -- === ROLE-ONLY CAPABILITIES (no subscription check) ===

    -- Dashboard
    -- operations_manager / collaborator_operations_manager included: operational role needs dashboard
    WHEN 'view:dashboard' THEN v_role IN ('owner', 'manager', 'operations_manager', 'chef', 'collaborator_operations_manager')

    -- Financial capabilities (accountant surface) — NOT widened
    WHEN 'view:transactions' THEN v_role IN ('owner', 'manager', 'collaborator_accountant')
    WHEN 'edit:transactions' THEN v_role IN ('owner', 'manager', 'collaborator_accountant')
    WHEN 'view:banking' THEN v_role IN ('owner', 'manager', 'collaborator_accountant')
    WHEN 'edit:banking' THEN v_role IN ('owner', 'manager', 'collaborator_accountant')
    WHEN 'view:expenses' THEN v_role IN ('owner', 'manager', 'collaborator_accountant')
    WHEN 'edit:expenses' THEN v_role IN ('owner', 'manager', 'collaborator_accountant')
    WHEN 'view:financial_statements' THEN v_role IN ('owner', 'manager', 'collaborator_accountant')
    WHEN 'view:chart_of_accounts' THEN v_role IN ('owner', 'manager', 'collaborator_accountant')
    WHEN 'edit:chart_of_accounts' THEN v_role IN ('owner', 'collaborator_accountant')
    WHEN 'view:invoices' THEN v_role IN ('owner', 'manager', 'collaborator_accountant')
    WHEN 'edit:invoices' THEN v_role IN ('owner', 'manager', 'collaborator_accountant')
    WHEN 'view:customers' THEN v_role IN ('owner', 'manager', 'collaborator_accountant')
    WHEN 'edit:customers' THEN v_role IN ('owner', 'manager', 'collaborator_accountant')
    WHEN 'view:pending_outflows' THEN v_role IN ('owner', 'manager', 'collaborator_accountant')
    WHEN 'edit:pending_outflows' THEN v_role IN ('owner', 'manager', 'collaborator_accountant')
    WHEN 'view:assets' THEN v_role IN ('owner', 'manager', 'collaborator_accountant')
    WHEN 'edit:assets' THEN v_role IN ('owner', 'manager', 'collaborator_accountant')

    -- Inventory capabilities — operations_manager / collaborator_operations_manager included
    WHEN 'view:inventory' THEN v_role IN ('owner', 'manager', 'operations_manager', 'chef', 'collaborator_inventory', 'collaborator_chef', 'collaborator_operations_manager')
    WHEN 'edit:inventory' THEN v_role IN ('owner', 'manager', 'operations_manager', 'chef', 'collaborator_inventory', 'collaborator_operations_manager')
    WHEN 'view:inventory_audit' THEN v_role IN ('owner', 'manager', 'operations_manager', 'chef', 'collaborator_inventory', 'collaborator_operations_manager')
    WHEN 'edit:inventory_audit' THEN v_role IN ('owner', 'manager', 'operations_manager', 'chef', 'collaborator_inventory', 'collaborator_operations_manager')
    WHEN 'view:purchase_orders' THEN v_role IN ('owner', 'manager', 'operations_manager', 'chef', 'collaborator_inventory', 'collaborator_operations_manager')
    WHEN 'edit:purchase_orders' THEN v_role IN ('owner', 'manager', 'operations_manager', 'collaborator_inventory', 'collaborator_operations_manager')
    WHEN 'view:receipt_import' THEN v_role IN ('owner', 'manager', 'operations_manager', 'chef', 'collaborator_inventory', 'collaborator_operations_manager')
    WHEN 'edit:receipt_import' THEN v_role IN ('owner', 'manager', 'operations_manager', 'chef', 'collaborator_inventory', 'collaborator_operations_manager')
    WHEN 'view:reports' THEN v_role IN ('owner', 'manager', 'operations_manager', 'chef', 'collaborator_inventory', 'collaborator_operations_manager')
    WHEN 'view:inventory_transactions' THEN v_role IN ('owner', 'manager', 'operations_manager', 'chef', 'collaborator_inventory', 'collaborator_operations_manager')
    WHEN 'edit:inventory_transactions' THEN v_role IN ('owner', 'manager', 'operations_manager', 'chef', 'collaborator_inventory', 'collaborator_operations_manager')

    -- Recipe capabilities — operations_manager / collaborator_operations_manager included
    WHEN 'view:recipes' THEN v_role IN ('owner', 'manager', 'operations_manager', 'chef', 'collaborator_chef', 'collaborator_operations_manager')
    WHEN 'edit:recipes' THEN v_role IN ('owner', 'manager', 'operations_manager', 'chef', 'collaborator_chef', 'collaborator_operations_manager')
    WHEN 'view:prep_recipes' THEN v_role IN ('owner', 'manager', 'operations_manager', 'chef', 'collaborator_chef', 'collaborator_operations_manager')
    WHEN 'edit:prep_recipes' THEN v_role IN ('owner', 'manager', 'operations_manager', 'chef', 'collaborator_chef', 'collaborator_operations_manager')
    WHEN 'view:batches' THEN v_role IN ('owner', 'manager', 'operations_manager', 'chef', 'collaborator_chef', 'collaborator_operations_manager')
    WHEN 'edit:batches' THEN v_role IN ('owner', 'manager', 'operations_manager', 'chef', 'collaborator_chef', 'collaborator_operations_manager')

    -- Operations capabilities — operations_manager / collaborator_operations_manager included
    WHEN 'view:pos_sales' THEN v_role IN ('owner', 'manager', 'operations_manager', 'chef', 'collaborator_operations_manager')
    WHEN 'view:scheduling' THEN v_role IN ('owner', 'manager', 'operations_manager', 'chef', 'collaborator_operations_manager')
    WHEN 'edit:scheduling' THEN v_role IN ('owner', 'manager', 'operations_manager', 'collaborator_operations_manager')
    -- view:payroll includes collaborator_accountant (payroll surface is also financial)
    -- operations_manager / collaborator_operations_manager included for labor/payroll operations (read-only for the collaborator — see edit:payroll below)
    WHEN 'view:payroll' THEN v_role IN ('owner', 'manager', 'operations_manager', 'collaborator_accountant', 'collaborator_operations_manager')
    -- edit:payroll: NOT widened to collaborator_operations_manager (view-only payroll per design)
    WHEN 'edit:payroll' THEN v_role IN ('owner', 'manager', 'operations_manager')
    WHEN 'view:tips' THEN v_role IN ('owner', 'manager', 'operations_manager', 'collaborator_operations_manager')
    WHEN 'edit:tips' THEN v_role IN ('owner', 'manager', 'operations_manager', 'collaborator_operations_manager')
    WHEN 'view:time_punches' THEN v_role IN ('owner', 'manager', 'operations_manager', 'collaborator_operations_manager')
    WHEN 'edit:time_punches' THEN v_role IN ('owner', 'manager', 'operations_manager', 'collaborator_operations_manager')

    -- Admin capabilities — operations_manager included for team/employee;
    -- collaborator_operations_manager NOT added to team/manage-employees
    -- branches (external isolation). view:employees IS granted (read-only,
    -- needed to assign shifts) — RLS enforcement for employees SELECT is
    -- already open to any restaurant member (20260411100000); this branch is
    -- app-level UI gating only.
    WHEN 'view:team' THEN v_role IN ('owner', 'manager', 'operations_manager')
    WHEN 'manage:team' THEN v_role IN ('owner', 'manager', 'operations_manager')
    WHEN 'view:employees' THEN v_role IN ('owner', 'manager', 'operations_manager', 'collaborator_accountant', 'collaborator_operations_manager')
    WHEN 'manage:employees' THEN v_role IN ('owner', 'manager', 'operations_manager')
    -- view:settings: all except kiosk (operations_manager and collaborator_operations_manager pass automatically)
    WHEN 'view:settings' THEN v_role NOT IN ('kiosk')
    -- edit:settings: owner only — NOT widened
    WHEN 'edit:settings' THEN v_role IN ('owner')
    -- view:integrations: NOT widened (admin surface)
    WHEN 'view:integrations' THEN v_role IN ('owner', 'manager')
    -- manage:integrations: NOT widened (admin surface)
    WHEN 'manage:integrations' THEN v_role IN ('owner')
    -- view:collaborators: NOT widened (admin surface)
    WHEN 'view:collaborators' THEN v_role IN ('owner', 'manager')
    -- manage:collaborators: NOT widened (admin surface)
    WHEN 'manage:collaborators' THEN v_role IN ('owner', 'manager')

    -- Subscription management (owner only) — NOT widened
    WHEN 'manage:subscription' THEN v_role = 'owner'

    ELSE FALSE
  END;
END;
$$;

COMMENT ON FUNCTION public.user_has_capability IS
'Check if current user has a specific capability for a restaurant.
Integrates both role-based permissions AND subscription tier checks.

Subscription-gated capabilities:
- view:ai_assistant: Requires Pro tier (owner, manager, operations_manager, collaborator_operations_manager)
- view:financial_intelligence: Requires Growth+ tier (owner, manager, collaborator_accountant)

operations_manager has full operational access (inventory, recipes, scheduling,
payroll, tips, time_punches, team, employees) but NO accounting (transactions,
banking, expenses, financial_statements, chart_of_accounts, invoices, customers,
pending_outflows, assets, financial_intelligence) and NO admin beyond team/employee
management (no edit:settings, view:integrations, manage:integrations,
view:collaborators, manage:collaborators, manage:subscription).

collaborator_operations_manager is an EXTERNAL, ISOLATED collaborator (NOT part
of user_is_internal_team) with the same operational surface as operations_manager
(scheduling, tips, time punches, inventory, recipes, POS view, AI assistant,
dashboard) PLUS read-only view:payroll and view:employees, but WITHOUT
view:team, manage:team, manage:employees, or edit:payroll, and WITHOUT any
accounting or admin capability.

This function MUST stay in sync with ROLE_CAPABILITIES in TypeScript.';

-- ============================================================================
-- 3. Widen hardcoded operational RLS policies to include
-- collaborator_operations_manager alongside operations_manager.
--
-- Each policy below is re-created exactly as it exists in
-- 20260702170000_add_operations_manager_role.sql (same name, same body) with
-- 'collaborator_operations_manager' appended to the role IN (...) list.
--
-- NOT touched: employee_compensation_history INSERT (collaborator has no
-- edit:payroll), employees SELECT (already wide-open via "Team members can
-- view coworkers in their restaurant" — 20260411100000; capability handles UI
-- gating only), and the RESTRICTIVE "Prevent self-escalation to privileged
-- roles" policy (its ('staff','kiosk') allowlist already blocks
-- self-escalation into any privileged role, including this new one).
-- ============================================================================

-- -------------------------------------------------------------------------
-- tip_pool_settings: view / insert / update policies
-- -------------------------------------------------------------------------
DROP POLICY IF EXISTS "Managers can view tip pool settings" ON public.tip_pool_settings;
CREATE POLICY "Managers can view tip pool settings"
ON public.tip_pool_settings
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM user_restaurants
    WHERE user_restaurants.restaurant_id = tip_pool_settings.restaurant_id
      AND user_restaurants.user_id = auth.uid()
      AND user_restaurants.role IN ('owner', 'manager', 'operations_manager', 'collaborator_operations_manager')
  )
);

DROP POLICY IF EXISTS "Managers can insert tip pool settings" ON public.tip_pool_settings;
CREATE POLICY "Managers can insert tip pool settings"
ON public.tip_pool_settings
FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM user_restaurants
    WHERE user_restaurants.restaurant_id = tip_pool_settings.restaurant_id
      AND user_restaurants.user_id = auth.uid()
      AND user_restaurants.role IN ('owner', 'manager', 'operations_manager', 'collaborator_operations_manager')
  )
);

DROP POLICY IF EXISTS "Managers can update tip pool settings" ON public.tip_pool_settings;
CREATE POLICY "Managers can update tip pool settings"
ON public.tip_pool_settings
FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM user_restaurants
    WHERE user_restaurants.restaurant_id = tip_pool_settings.restaurant_id
      AND user_restaurants.user_id = auth.uid()
      AND user_restaurants.role IN ('owner', 'manager', 'operations_manager', 'collaborator_operations_manager')
  )
);

-- -------------------------------------------------------------------------
-- tip_splits: "Managers can ..." (view/insert/update/delete)
-- -------------------------------------------------------------------------
DROP POLICY IF EXISTS "Managers can view tip splits" ON public.tip_splits;
CREATE POLICY "Managers can view tip splits"
ON public.tip_splits FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM user_restaurants
    WHERE user_restaurants.restaurant_id = tip_splits.restaurant_id
      AND user_restaurants.user_id = auth.uid()
      AND user_restaurants.role IN ('owner', 'manager', 'operations_manager', 'collaborator_operations_manager')
  )
);

DROP POLICY IF EXISTS "Managers can insert tip splits" ON public.tip_splits;
CREATE POLICY "Managers can insert tip splits"
ON public.tip_splits FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM user_restaurants
    WHERE user_restaurants.restaurant_id = tip_splits.restaurant_id
      AND user_restaurants.user_id = auth.uid()
      AND user_restaurants.role IN ('owner', 'manager', 'operations_manager', 'collaborator_operations_manager')
  )
);

DROP POLICY IF EXISTS "Managers can update tip splits" ON public.tip_splits;
CREATE POLICY "Managers can update tip splits"
ON public.tip_splits FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM user_restaurants
    WHERE user_restaurants.restaurant_id = tip_splits.restaurant_id
      AND user_restaurants.user_id = auth.uid()
      AND user_restaurants.role IN ('owner', 'manager', 'operations_manager', 'collaborator_operations_manager')
  )
);

DROP POLICY IF EXISTS "Managers can delete tip splits" ON public.tip_splits;
CREATE POLICY "Managers can delete tip splits"
ON public.tip_splits FOR DELETE
USING (
  EXISTS (
    SELECT 1 FROM user_restaurants
    WHERE user_restaurants.restaurant_id = tip_splits.restaurant_id
      AND user_restaurants.user_id = auth.uid()
      AND user_restaurants.role IN ('owner', 'manager', 'operations_manager', 'collaborator_operations_manager')
  )
);

-- -------------------------------------------------------------------------
-- tip_split_items: manager-level policies
-- -------------------------------------------------------------------------
DROP POLICY IF EXISTS "Managers can view tip split items" ON public.tip_split_items;
CREATE POLICY "Managers can view tip split items"
ON public.tip_split_items FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM tip_splits ts
    JOIN user_restaurants ur ON ur.restaurant_id = ts.restaurant_id
    WHERE ts.id = tip_split_items.tip_split_id
      AND ur.user_id = auth.uid()
      AND ur.role IN ('owner', 'manager', 'operations_manager', 'collaborator_operations_manager')
  )
);

DROP POLICY IF EXISTS "Managers can insert tip split items" ON public.tip_split_items;
CREATE POLICY "Managers can insert tip split items"
ON public.tip_split_items FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM tip_splits ts
    JOIN user_restaurants ur ON ur.restaurant_id = ts.restaurant_id
    WHERE ts.id = tip_split_items.tip_split_id
      AND ur.user_id = auth.uid()
      AND ur.role IN ('owner', 'manager', 'operations_manager', 'collaborator_operations_manager')
  )
);

DROP POLICY IF EXISTS "Managers can update tip split items" ON public.tip_split_items;
CREATE POLICY "Managers can update tip split items"
ON public.tip_split_items FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM tip_splits ts
    JOIN user_restaurants ur ON ur.restaurant_id = ts.restaurant_id
    WHERE ts.id = tip_split_items.tip_split_id
      AND ur.user_id = auth.uid()
      AND ur.role IN ('owner', 'manager', 'operations_manager', 'collaborator_operations_manager')
  )
);

DROP POLICY IF EXISTS "Managers can delete tip split items" ON public.tip_split_items;
CREATE POLICY "Managers can delete tip split items"
ON public.tip_split_items FOR DELETE
USING (
  EXISTS (
    SELECT 1 FROM tip_splits ts
    JOIN user_restaurants ur ON ur.restaurant_id = ts.restaurant_id
    WHERE ts.id = tip_split_items.tip_split_id
      AND ur.user_id = auth.uid()
      AND ur.role IN ('owner', 'manager', 'operations_manager', 'collaborator_operations_manager')
  )
);

-- -------------------------------------------------------------------------
-- tip_disputes: manager-level policies
-- -------------------------------------------------------------------------
DROP POLICY IF EXISTS "Managers can view tip disputes" ON public.tip_disputes;
CREATE POLICY "Managers can view tip disputes"
ON public.tip_disputes FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM tip_splits ts
    JOIN user_restaurants ur ON ur.restaurant_id = ts.restaurant_id
    WHERE ts.id = tip_disputes.tip_split_id
      AND ur.user_id = auth.uid()
      AND ur.role IN ('owner', 'manager', 'operations_manager', 'collaborator_operations_manager')
  )
);

DROP POLICY IF EXISTS "Managers can update tip disputes" ON public.tip_disputes;
CREATE POLICY "Managers can update tip disputes"
ON public.tip_disputes FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM tip_splits ts
    JOIN user_restaurants ur ON ur.restaurant_id = ts.restaurant_id
    WHERE ts.id = tip_disputes.tip_split_id
      AND ur.user_id = auth.uid()
      AND ur.role IN ('owner', 'manager', 'operations_manager', 'collaborator_operations_manager')
  )
);

-- -------------------------------------------------------------------------
-- tip_contribution_pools, tip_server_earnings, tip_pool_allocations
-- -------------------------------------------------------------------------
DROP POLICY IF EXISTS "Managers can view tip contribution pools" ON public.tip_contribution_pools;
CREATE POLICY "Managers can view tip contribution pools"
ON public.tip_contribution_pools FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM user_restaurants
    WHERE user_restaurants.restaurant_id = tip_contribution_pools.restaurant_id
      AND user_restaurants.user_id = auth.uid()
      AND user_restaurants.role IN ('owner', 'manager', 'operations_manager', 'collaborator_operations_manager')
  )
);

DROP POLICY IF EXISTS "Managers can insert tip contribution pools" ON public.tip_contribution_pools;
CREATE POLICY "Managers can insert tip contribution pools"
ON public.tip_contribution_pools FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM user_restaurants
    WHERE user_restaurants.restaurant_id = tip_contribution_pools.restaurant_id
      AND user_restaurants.user_id = auth.uid()
      AND user_restaurants.role IN ('owner', 'manager', 'operations_manager', 'collaborator_operations_manager')
  )
);

DROP POLICY IF EXISTS "Managers can update tip contribution pools" ON public.tip_contribution_pools;
CREATE POLICY "Managers can update tip contribution pools"
ON public.tip_contribution_pools FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM user_restaurants
    WHERE user_restaurants.restaurant_id = tip_contribution_pools.restaurant_id
      AND user_restaurants.user_id = auth.uid()
      AND user_restaurants.role IN ('owner', 'manager', 'operations_manager', 'collaborator_operations_manager')
  )
);

DROP POLICY IF EXISTS "Managers can delete tip contribution pools" ON public.tip_contribution_pools;
CREATE POLICY "Managers can delete tip contribution pools"
ON public.tip_contribution_pools FOR DELETE
USING (
  EXISTS (
    SELECT 1 FROM user_restaurants
    WHERE user_restaurants.restaurant_id = tip_contribution_pools.restaurant_id
      AND user_restaurants.user_id = auth.uid()
      AND user_restaurants.role IN ('owner', 'manager', 'operations_manager', 'collaborator_operations_manager')
  )
);

DROP POLICY IF EXISTS "Managers can view tip server earnings" ON public.tip_server_earnings;
CREATE POLICY "Managers can view tip server earnings"
ON public.tip_server_earnings FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM tip_splits ts
    JOIN user_restaurants ur ON ur.restaurant_id = ts.restaurant_id
    WHERE ts.id = tip_server_earnings.tip_split_id
      AND ur.user_id = auth.uid()
      AND ur.role IN ('owner', 'manager', 'operations_manager', 'collaborator_operations_manager')
  )
);

DROP POLICY IF EXISTS "Managers can insert tip server earnings" ON public.tip_server_earnings;
CREATE POLICY "Managers can insert tip server earnings"
ON public.tip_server_earnings FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM tip_splits ts
    JOIN user_restaurants ur ON ur.restaurant_id = ts.restaurant_id
    WHERE ts.id = tip_server_earnings.tip_split_id
      AND ur.user_id = auth.uid()
      AND ur.role IN ('owner', 'manager', 'operations_manager', 'collaborator_operations_manager')
  )
);

DROP POLICY IF EXISTS "Managers can update tip server earnings" ON public.tip_server_earnings;
CREATE POLICY "Managers can update tip server earnings"
ON public.tip_server_earnings FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM tip_splits ts
    JOIN user_restaurants ur ON ur.restaurant_id = ts.restaurant_id
    WHERE ts.id = tip_server_earnings.tip_split_id
      AND ur.user_id = auth.uid()
      AND ur.role IN ('owner', 'manager', 'operations_manager', 'collaborator_operations_manager')
  )
);

DROP POLICY IF EXISTS "Managers can delete tip server earnings" ON public.tip_server_earnings;
CREATE POLICY "Managers can delete tip server earnings"
ON public.tip_server_earnings FOR DELETE
USING (
  EXISTS (
    SELECT 1 FROM tip_splits ts
    JOIN user_restaurants ur ON ur.restaurant_id = ts.restaurant_id
    WHERE ts.id = tip_server_earnings.tip_split_id
      AND ur.user_id = auth.uid()
      AND ur.role IN ('owner', 'manager', 'operations_manager', 'collaborator_operations_manager')
  )
);

DROP POLICY IF EXISTS "Managers can view tip pool allocations" ON public.tip_pool_allocations;
CREATE POLICY "Managers can view tip pool allocations"
ON public.tip_pool_allocations FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM tip_splits ts
    JOIN user_restaurants ur ON ur.restaurant_id = ts.restaurant_id
    WHERE ts.id = tip_pool_allocations.tip_split_id
      AND ur.user_id = auth.uid()
      AND ur.role IN ('owner', 'manager', 'operations_manager', 'collaborator_operations_manager')
  )
);

DROP POLICY IF EXISTS "Managers can insert tip pool allocations" ON public.tip_pool_allocations;
CREATE POLICY "Managers can insert tip pool allocations"
ON public.tip_pool_allocations FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM tip_splits ts
    JOIN user_restaurants ur ON ur.restaurant_id = ts.restaurant_id
    WHERE ts.id = tip_pool_allocations.tip_split_id
      AND ur.user_id = auth.uid()
      AND ur.role IN ('owner', 'manager', 'operations_manager', 'collaborator_operations_manager')
  )
);

DROP POLICY IF EXISTS "Managers can update tip pool allocations" ON public.tip_pool_allocations;
CREATE POLICY "Managers can update tip pool allocations"
ON public.tip_pool_allocations FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM tip_splits ts
    JOIN user_restaurants ur ON ur.restaurant_id = ts.restaurant_id
    WHERE ts.id = tip_pool_allocations.tip_split_id
      AND ur.user_id = auth.uid()
      AND ur.role IN ('owner', 'manager', 'operations_manager', 'collaborator_operations_manager')
  )
);

DROP POLICY IF EXISTS "Managers can delete tip pool allocations" ON public.tip_pool_allocations;
CREATE POLICY "Managers can delete tip pool allocations"
ON public.tip_pool_allocations FOR DELETE
USING (
  EXISTS (
    SELECT 1 FROM tip_splits ts
    JOIN user_restaurants ur ON ur.restaurant_id = ts.restaurant_id
    WHERE ts.id = tip_pool_allocations.tip_split_id
      AND ur.user_id = auth.uid()
      AND ur.role IN ('owner', 'manager', 'operations_manager', 'collaborator_operations_manager')
  )
);

-- -------------------------------------------------------------------------
-- tip_payouts: manager-level policies
-- -------------------------------------------------------------------------
DROP POLICY IF EXISTS "Managers can view tip payouts" ON public.tip_payouts;
CREATE POLICY "Managers can view tip payouts"
ON public.tip_payouts FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM user_restaurants
    WHERE user_restaurants.restaurant_id = tip_payouts.restaurant_id
      AND user_restaurants.user_id = auth.uid()
      AND user_restaurants.role IN ('owner', 'manager', 'operations_manager', 'collaborator_operations_manager')
  )
);

DROP POLICY IF EXISTS "Managers can insert tip payouts" ON public.tip_payouts;
CREATE POLICY "Managers can insert tip payouts"
ON public.tip_payouts FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM user_restaurants
    WHERE user_restaurants.restaurant_id = tip_payouts.restaurant_id
      AND user_restaurants.user_id = auth.uid()
      AND user_restaurants.role IN ('owner', 'manager', 'operations_manager', 'collaborator_operations_manager')
  )
);

DROP POLICY IF EXISTS "Managers can update tip payouts" ON public.tip_payouts;
CREATE POLICY "Managers can update tip payouts"
ON public.tip_payouts FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM user_restaurants
    WHERE user_restaurants.restaurant_id = tip_payouts.restaurant_id
      AND user_restaurants.user_id = auth.uid()
      AND user_restaurants.role IN ('owner', 'manager', 'operations_manager', 'collaborator_operations_manager')
  )
);

DROP POLICY IF EXISTS "Managers can delete tip payouts" ON public.tip_payouts;
CREATE POLICY "Managers can delete tip payouts"
ON public.tip_payouts FOR DELETE
USING (
  EXISTS (
    SELECT 1 FROM user_restaurants
    WHERE user_restaurants.restaurant_id = tip_payouts.restaurant_id
      AND user_restaurants.user_id = auth.uid()
      AND user_restaurants.role IN ('owner', 'manager', 'operations_manager', 'collaborator_operations_manager')
  )
);

-- -------------------------------------------------------------------------
-- PAYROLL-COST MUTATION TABLES — collaborator_operations_manager INTENTIONALLY
-- EXCLUDED (Codex P1 review, PR #596).
--
-- overtime_rules, overtime_adjustments, and daily_labor_allocations all mutate
-- pay amounts (daily_labor_allocations.allocated_cost is written by the Payroll
-- page's Add-Payment flow, src/hooks/usePayroll.tsx). This role is payroll
-- READ-ONLY (has view:payroll, NOT edit:payroll), so it must not write them.
-- These tables keep their existing owner/manager/operations_manager policies
-- from 20260702170000 untouched — no DROP/CREATE here. The role's write grants
-- are limited to tables backed by a capability it actually holds
-- (edit:scheduling, edit:tips, edit:time_punches, edit:inventory, edit:recipes).
-- -------------------------------------------------------------------------

-- -------------------------------------------------------------------------
-- schedule_publications: "Managers can create schedule publications"
-- -------------------------------------------------------------------------
DROP POLICY IF EXISTS "Managers can create schedule publications" ON public.schedule_publications;
CREATE POLICY "Managers can create schedule publications"
ON public.schedule_publications
FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM user_restaurants
    WHERE user_restaurants.restaurant_id = schedule_publications.restaurant_id
      AND user_restaurants.user_id = auth.uid()
      AND user_restaurants.role IN ('owner', 'manager', 'operations_manager', 'collaborator_operations_manager')
  )
);

-- -------------------------------------------------------------------------
-- schedule_change_logs: "Managers can create change logs"
-- -------------------------------------------------------------------------
DROP POLICY IF EXISTS "Managers can create change logs" ON public.schedule_change_logs;
CREATE POLICY "Managers can create change logs"
ON public.schedule_change_logs FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM user_restaurants
    WHERE user_restaurants.restaurant_id = schedule_change_logs.restaurant_id
      AND user_restaurants.user_id = auth.uid()
      AND user_restaurants.role IN ('owner', 'manager', 'operations_manager', 'collaborator_operations_manager')
  )
);

-- -------------------------------------------------------------------------
-- open_shift_claims: managers_view_restaurant_claims (SELECT)
--                    managers_review_claims (UPDATE)
-- -------------------------------------------------------------------------
DROP POLICY IF EXISTS "managers_view_restaurant_claims" ON public.open_shift_claims;
CREATE POLICY "managers_view_restaurant_claims"
ON public.open_shift_claims FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.user_restaurants
    WHERE user_id = auth.uid()
      AND restaurant_id = open_shift_claims.restaurant_id
      AND role IN ('owner', 'manager', 'operations_manager', 'collaborator_operations_manager')
  )
);

DROP POLICY IF EXISTS "managers_review_claims" ON public.open_shift_claims;
CREATE POLICY "managers_review_claims"
ON public.open_shift_claims FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM public.user_restaurants
    WHERE user_id = auth.uid()
      AND restaurant_id = open_shift_claims.restaurant_id
      AND role IN ('owner', 'manager', 'operations_manager', 'collaborator_operations_manager')
  )
);

-- -------------------------------------------------------------------------
-- staffing_settings: "Owners and managers can manage staffing settings"
-- -------------------------------------------------------------------------
DROP POLICY IF EXISTS "Owners and managers can manage staffing settings" ON public.staffing_settings;
CREATE POLICY "Owners and managers can manage staffing settings"
ON public.staffing_settings FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM user_restaurants
    WHERE user_restaurants.restaurant_id = staffing_settings.restaurant_id
      AND user_restaurants.user_id = auth.uid()
      AND user_restaurants.role IN ('owner', 'manager', 'operations_manager', 'collaborator_operations_manager')
  )
);

-- -------------------------------------------------------------------------
-- time_punches: "Managers can create time punches for employees"
-- Adds collaborator_operations_manager alongside the existing kiosk exception.
-- -------------------------------------------------------------------------
DROP POLICY IF EXISTS "Managers can create time punches for employees" ON public.time_punches;
CREATE POLICY "Managers can create time punches for employees"
ON public.time_punches FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.user_restaurants
    WHERE public.user_restaurants.restaurant_id = time_punches.restaurant_id
      AND public.user_restaurants.user_id = auth.uid()
      AND public.user_restaurants.role IN ('owner', 'manager', 'operations_manager', 'collaborator_operations_manager', 'kiosk')
  )
);

-- -------------------------------------------------------------------------
-- receipt_imports: view / insert / update policies
-- -------------------------------------------------------------------------
DROP POLICY IF EXISTS "Owners and managers can view receipt imports" ON public.receipt_imports;
CREATE POLICY "Owners and managers can view receipt imports"
ON public.receipt_imports
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM user_restaurants
    WHERE restaurant_id = receipt_imports.restaurant_id
      AND user_id = auth.uid()
      AND role = ANY(ARRAY['owner', 'manager', 'operations_manager', 'collaborator_operations_manager'])
  )
);

DROP POLICY IF EXISTS "Owners and managers can create receipt imports" ON public.receipt_imports;
CREATE POLICY "Owners and managers can create receipt imports"
ON public.receipt_imports
FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM user_restaurants
    WHERE restaurant_id = receipt_imports.restaurant_id
      AND user_id = auth.uid()
      AND role = ANY(ARRAY['owner', 'manager', 'operations_manager', 'collaborator_operations_manager'])
  )
);

DROP POLICY IF EXISTS "Owners and managers can update receipt imports" ON public.receipt_imports;
CREATE POLICY "Owners and managers can update receipt imports"
ON public.receipt_imports
FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM user_restaurants
    WHERE restaurant_id = receipt_imports.restaurant_id
      AND user_id = auth.uid()
      AND role = ANY(ARRAY['owner', 'manager', 'operations_manager', 'collaborator_operations_manager'])
  )
);

-- ============================================================================
-- NOT touched (per design — see migration header):
--   - employee_compensation_history INSERT: collaborator has no edit:payroll.
--   - employees SELECT: already wide-open via "Team members can view coworkers
--     in their restaurant" (20260411100000); the view:employees capability
--     branch above is app-level UI gating only, not RLS enforcement.
--   - "Prevent self-escalation to privileged roles" (RESTRICTIVE, user_restaurants):
--     its ('staff','kiosk') allowlist already blocks self-escalation into
--     collaborator_operations_manager (or any other privileged role).
--   - products, recipes, prep_recipes, production_runs, inventory_transactions,
--     purchase_orders, invoices, customers, pending_outflows: already migrated
--     to user_has_capability() in 20260120100100 — resolve automatically once
--     the capability function (step 2 above) includes the new role.
--   - bank_transactions, chart_of_accounts, financial_statement_cache,
--     connected_banks: accounting surface — collaborator_operations_manager
--     correctly denied (no accounting capability granted).
--   - unified_sales INSERT: remains owner/manager only (no edit:pos_sales
--     capability exists for any operational role).
-- ============================================================================

-- ============================================================================
-- 4. Widen the core scheduling-table edit policies (functional fix).
--
-- These three tables (shifts, shift_templates, time_off_requests) were NOT
-- touched by 20260702170000 and still hardcode role IN ('owner', 'manager')
-- on their INSERT/UPDATE/DELETE policies, even though operations_manager
-- holds edit:scheduling in user_has_capability(). This widens them to
-- ('owner', 'manager', 'operations_manager', 'collaborator_operations_manager'),
-- fixing that latent gap for the internal role AND enabling the new external
-- collaborator to write shifts. SELECT policies on all three tables already
-- admit any restaurant member and are left unchanged. The employee
-- self-service policies on time_off_requests (20251123100100) are NOT
-- touched — this only widens the MANAGER-scoped policies.
-- Source: 20251114100000_create_scheduling_tables.sql
-- ============================================================================

-- shifts
DROP POLICY IF EXISTS "Users can create shifts for their restaurants" ON public.shifts;
CREATE POLICY "Users can create shifts for their restaurants"
  ON public.shifts FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_restaurants
      WHERE user_restaurants.restaurant_id = shifts.restaurant_id
      AND user_restaurants.user_id = auth.uid()
      AND user_restaurants.role IN ('owner', 'manager', 'operations_manager', 'collaborator_operations_manager')
    )
  );

DROP POLICY IF EXISTS "Users can update shifts for their restaurants" ON public.shifts;
CREATE POLICY "Users can update shifts for their restaurants"
  ON public.shifts FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM user_restaurants
      WHERE user_restaurants.restaurant_id = shifts.restaurant_id
      AND user_restaurants.user_id = auth.uid()
      AND user_restaurants.role IN ('owner', 'manager', 'operations_manager', 'collaborator_operations_manager')
    )
  );

DROP POLICY IF EXISTS "Users can delete shifts for their restaurants" ON public.shifts;
CREATE POLICY "Users can delete shifts for their restaurants"
  ON public.shifts FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM user_restaurants
      WHERE user_restaurants.restaurant_id = shifts.restaurant_id
      AND user_restaurants.user_id = auth.uid()
      AND user_restaurants.role IN ('owner', 'manager', 'operations_manager', 'collaborator_operations_manager')
    )
  );

-- shift_templates
DROP POLICY IF EXISTS "Users can create shift templates for their restaurants" ON public.shift_templates;
CREATE POLICY "Users can create shift templates for their restaurants"
  ON public.shift_templates FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_restaurants
      WHERE user_restaurants.restaurant_id = shift_templates.restaurant_id
      AND user_restaurants.user_id = auth.uid()
      AND user_restaurants.role IN ('owner', 'manager', 'operations_manager', 'collaborator_operations_manager')
    )
  );

DROP POLICY IF EXISTS "Users can update shift templates for their restaurants" ON public.shift_templates;
CREATE POLICY "Users can update shift templates for their restaurants"
  ON public.shift_templates FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM user_restaurants
      WHERE user_restaurants.restaurant_id = shift_templates.restaurant_id
      AND user_restaurants.user_id = auth.uid()
      AND user_restaurants.role IN ('owner', 'manager', 'operations_manager', 'collaborator_operations_manager')
    )
  );

DROP POLICY IF EXISTS "Users can delete shift templates for their restaurants" ON public.shift_templates;
CREATE POLICY "Users can delete shift templates for their restaurants"
  ON public.shift_templates FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM user_restaurants
      WHERE user_restaurants.restaurant_id = shift_templates.restaurant_id
      AND user_restaurants.user_id = auth.uid()
      AND user_restaurants.role IN ('owner', 'manager', 'operations_manager', 'collaborator_operations_manager')
    )
  );

-- time_off_requests (manager-scoped policies only — NOT the employee
-- self-service policies from 20251123100100)
DROP POLICY IF EXISTS "Users can create time off requests for their restaurants" ON public.time_off_requests;
CREATE POLICY "Users can create time off requests for their restaurants"
  ON public.time_off_requests FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_restaurants
      WHERE user_restaurants.restaurant_id = time_off_requests.restaurant_id
      AND user_restaurants.user_id = auth.uid()
      AND user_restaurants.role IN ('owner', 'manager', 'operations_manager', 'collaborator_operations_manager')
    )
  );

DROP POLICY IF EXISTS "Users can update time off requests for their restaurants" ON public.time_off_requests;
CREATE POLICY "Users can update time off requests for their restaurants"
  ON public.time_off_requests FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM user_restaurants
      WHERE user_restaurants.restaurant_id = time_off_requests.restaurant_id
      AND user_restaurants.user_id = auth.uid()
      AND user_restaurants.role IN ('owner', 'manager', 'operations_manager', 'collaborator_operations_manager')
    )
  );

DROP POLICY IF EXISTS "Users can delete time off requests for their restaurants" ON public.time_off_requests;
CREATE POLICY "Users can delete time off requests for their restaurants"
  ON public.time_off_requests FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM user_restaurants
      WHERE user_restaurants.restaurant_id = time_off_requests.restaurant_id
      AND user_restaurants.user_id = auth.uid()
      AND user_restaurants.role IN ('owner', 'manager', 'operations_manager', 'collaborator_operations_manager')
    )
  );
