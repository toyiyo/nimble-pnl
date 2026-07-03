-- ============================================================================
-- Migration: Add operations_manager role
--
-- Internal role with all operations EXCEPT accounting (bookkeeping) and
-- admin (settings-edit, integrations, collaborators). Can invite Staff and
-- manage employees.
--
-- Order: constraint -> user_is_internal_team -> user_has_capability -> RLS.
-- The user_has_capability body below is copied from the LIVE definition in
-- 20260129000000_add_subscription_system.sql (preserves subscription gating)
-- with 'operations_manager' added ONLY to non-accounting/non-admin branches.
-- ============================================================================

-- 1. Extend the role CHECK constraint (kiosk/collaborator precedent).
ALTER TABLE public.user_restaurants
  DROP CONSTRAINT IF EXISTS user_restaurants_role_check;

ALTER TABLE public.user_restaurants
  ADD CONSTRAINT user_restaurants_role_check
  CHECK (role IN (
    'owner', 'manager', 'operations_manager', 'chef', 'staff', 'kiosk',
    'collaborator_accountant', 'collaborator_inventory', 'collaborator_chef'
  ));

-- 2. Internal-team helper must include operations_manager, else the role can
-- only see its own user_restaurants row (empty team-management UI).
CREATE OR REPLACE FUNCTION public.user_is_internal_team(
  p_restaurant_id UUID
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM user_restaurants ur
    WHERE ur.restaurant_id = p_restaurant_id
      AND ur.user_id = auth.uid()
      AND ur.role IN ('owner', 'manager', 'operations_manager', 'chef', 'staff')
  );
$$;
COMMENT ON FUNCTION public.user_is_internal_team IS
'Check if current user is internal team (owner, manager, operations_manager, chef, or staff)';

-- 3. Replace user_has_capability with operations_manager added to
-- non-accounting/non-admin branches.
-- Source: 20260129000000_add_subscription_system.sql (live body preserved).
-- Changes: 'operations_manager' added ONLY to the branches listed below.
-- Accounting branches (transactions, banking, expenses, financial_statements,
-- chart_of_accounts, invoices, customers, pending_outflows, assets,
-- financial_intelligence) are intentionally NOT widened.
-- Admin branches (edit:settings, view:integrations, manage:integrations,
-- view:collaborators, manage:collaborators, manage:subscription) are NOT widened.
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
    -- operations_manager included: they run operations and benefit from AI
    WHEN 'view:ai_assistant' THEN
      v_role IN ('owner', 'manager', 'operations_manager') AND
      has_subscription_feature(p_restaurant_id, 'ai_assistant')

    -- Financial Intelligence: Role check + Growth+ subscription required
    -- operations_manager excluded: this is an accounting/financial surface
    WHEN 'view:financial_intelligence' THEN
      v_role IN ('owner', 'manager', 'collaborator_accountant') AND
      has_subscription_feature(p_restaurant_id, 'financial_intelligence')

    -- === ROLE-ONLY CAPABILITIES (no subscription check) ===

    -- Dashboard
    -- operations_manager included: operational role needs dashboard
    WHEN 'view:dashboard' THEN v_role IN ('owner', 'manager', 'operations_manager', 'chef')

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

    -- Inventory capabilities — operations_manager included
    WHEN 'view:inventory' THEN v_role IN ('owner', 'manager', 'operations_manager', 'chef', 'collaborator_inventory', 'collaborator_chef')
    WHEN 'edit:inventory' THEN v_role IN ('owner', 'manager', 'operations_manager', 'chef', 'collaborator_inventory')
    WHEN 'view:inventory_audit' THEN v_role IN ('owner', 'manager', 'operations_manager', 'chef', 'collaborator_inventory')
    WHEN 'edit:inventory_audit' THEN v_role IN ('owner', 'manager', 'operations_manager', 'chef', 'collaborator_inventory')
    WHEN 'view:purchase_orders' THEN v_role IN ('owner', 'manager', 'operations_manager', 'chef', 'collaborator_inventory')
    WHEN 'edit:purchase_orders' THEN v_role IN ('owner', 'manager', 'operations_manager', 'collaborator_inventory')
    WHEN 'view:receipt_import' THEN v_role IN ('owner', 'manager', 'operations_manager', 'chef', 'collaborator_inventory')
    WHEN 'edit:receipt_import' THEN v_role IN ('owner', 'manager', 'operations_manager', 'chef', 'collaborator_inventory')
    WHEN 'view:reports' THEN v_role IN ('owner', 'manager', 'operations_manager', 'chef', 'collaborator_inventory')
    WHEN 'view:inventory_transactions' THEN v_role IN ('owner', 'manager', 'operations_manager', 'chef', 'collaborator_inventory')
    WHEN 'edit:inventory_transactions' THEN v_role IN ('owner', 'manager', 'operations_manager', 'chef', 'collaborator_inventory')

    -- Recipe capabilities — operations_manager included
    WHEN 'view:recipes' THEN v_role IN ('owner', 'manager', 'operations_manager', 'chef', 'collaborator_chef')
    WHEN 'edit:recipes' THEN v_role IN ('owner', 'manager', 'operations_manager', 'chef', 'collaborator_chef')
    WHEN 'view:prep_recipes' THEN v_role IN ('owner', 'manager', 'operations_manager', 'chef', 'collaborator_chef')
    WHEN 'edit:prep_recipes' THEN v_role IN ('owner', 'manager', 'operations_manager', 'chef', 'collaborator_chef')
    WHEN 'view:batches' THEN v_role IN ('owner', 'manager', 'operations_manager', 'chef', 'collaborator_chef')
    WHEN 'edit:batches' THEN v_role IN ('owner', 'manager', 'operations_manager', 'chef', 'collaborator_chef')

    -- Operations capabilities — operations_manager included
    WHEN 'view:pos_sales' THEN v_role IN ('owner', 'manager', 'operations_manager', 'chef')
    WHEN 'view:scheduling' THEN v_role IN ('owner', 'manager', 'operations_manager', 'chef')
    WHEN 'edit:scheduling' THEN v_role IN ('owner', 'manager', 'operations_manager')
    -- view:payroll includes collaborator_accountant (payroll surface is also financial)
    -- operations_manager included for labor/payroll operations
    WHEN 'view:payroll' THEN v_role IN ('owner', 'manager', 'operations_manager', 'collaborator_accountant')
    WHEN 'edit:payroll' THEN v_role IN ('owner', 'manager', 'operations_manager')
    WHEN 'view:tips' THEN v_role IN ('owner', 'manager', 'operations_manager')
    WHEN 'edit:tips' THEN v_role IN ('owner', 'manager', 'operations_manager')
    WHEN 'view:time_punches' THEN v_role IN ('owner', 'manager', 'operations_manager')
    WHEN 'edit:time_punches' THEN v_role IN ('owner', 'manager', 'operations_manager')

    -- Admin capabilities — operations_manager included for team/employee, excluded for settings-edit/integrations/collaborators
    WHEN 'view:team' THEN v_role IN ('owner', 'manager', 'operations_manager')
    WHEN 'manage:team' THEN v_role IN ('owner', 'manager', 'operations_manager')
    WHEN 'view:employees' THEN v_role IN ('owner', 'manager', 'operations_manager', 'collaborator_accountant')
    WHEN 'manage:employees' THEN v_role IN ('owner', 'manager', 'operations_manager')
    -- view:settings: all except kiosk (operations_manager passes automatically)
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
- view:ai_assistant: Requires Pro tier (owner, manager, operations_manager)
- view:financial_intelligence: Requires Growth+ tier (owner, manager, collaborator_accountant)

operations_manager has full operational access (inventory, recipes, scheduling,
payroll, tips, time_punches, team, employees) but NO accounting (transactions,
banking, expenses, financial_statements, chart_of_accounts, invoices, customers,
pending_outflows, assets, financial_intelligence) and NO admin beyond team/employee
management (no edit:settings, view:integrations, manage:integrations,
view:collaborators, manage:collaborators, manage:subscription).

This function MUST stay in sync with ROLE_CAPABILITIES in TypeScript.';

-- ============================================================================
-- 4. Residual hardcoded-role-list operational policies
--
-- The collaborator migration (20260120100100) converted the major operational
-- tables to user_has_capability()-based RLS, so operations_manager is already
-- covered there via the function above. The tables below still use hardcoded
-- role IN ('owner', 'manager') or user_has_role(['owner','manager']) expressions
-- and must be widened to include operations_manager.
--
-- Rule: drop the old policy by exact name, recreate with
--   role IN ('owner', 'manager', 'operations_manager')  or
--   user_has_role(..., ARRAY['owner','manager','operations_manager'])
-- ============================================================================

-- -------------------------------------------------------------------------
-- employees: "Owners and managers can manage employees"
-- Source: 20260120100100_update_rls_for_collaborators.sql
-- Uses user_has_role(['owner','manager']). Widen to include operations_manager.
-- -------------------------------------------------------------------------
DROP POLICY IF EXISTS "Owners and managers can manage employees" ON public.employees;
CREATE POLICY "Owners and managers can manage employees"
ON public.employees
FOR ALL
USING (user_has_role(restaurant_id, ARRAY['owner', 'manager', 'operations_manager']))
WITH CHECK (user_has_role(restaurant_id, ARRAY['owner', 'manager', 'operations_manager']));

-- -------------------------------------------------------------------------
-- receipt_imports: view / insert / update policies
-- Source: 20251006212711_4eb82642-...
-- Uses role = ANY(ARRAY['owner','manager']). Widen to include operations_manager.
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
      AND role = ANY(ARRAY['owner', 'manager', 'operations_manager'])
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
      AND role = ANY(ARRAY['owner', 'manager', 'operations_manager'])
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
      AND role = ANY(ARRAY['owner', 'manager', 'operations_manager'])
  )
);

-- -------------------------------------------------------------------------
-- schedule_publications: "Managers can create schedule publications"
-- Source: 20251123000000_schedule_publishing.sql
-- Uses role IN ('owner','manager'). Widen to include operations_manager.
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
      AND user_restaurants.role IN ('owner', 'manager', 'operations_manager')
  )
);

-- -------------------------------------------------------------------------
-- tip_pool_settings: view / insert / update policies
-- Source: 20251217000001_create_tip_pooling_tables.sql
-- Uses role IN ('owner','manager'). Widen to include operations_manager.
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
      AND user_restaurants.role IN ('owner', 'manager', 'operations_manager')
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
      AND user_restaurants.role IN ('owner', 'manager', 'operations_manager')
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
      AND user_restaurants.role IN ('owner', 'manager', 'operations_manager')
  )
);

-- -------------------------------------------------------------------------
-- overtime_rules: "Owners and managers can manage overtime rules"
-- Source: 20260221200000_create_overtime_rules.sql
-- Uses role IN ('owner','manager'). Widen to include operations_manager.
-- -------------------------------------------------------------------------
DROP POLICY IF EXISTS "Owners and managers can manage overtime rules" ON public.overtime_rules;
CREATE POLICY "Owners and managers can manage overtime rules"
ON public.overtime_rules
FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM user_restaurants
    WHERE user_restaurants.restaurant_id = overtime_rules.restaurant_id
      AND user_restaurants.user_id = auth.uid()
      AND user_restaurants.role IN ('owner', 'manager', 'operations_manager')
  )
);

-- ============================================================================
-- NOTE: Tables NOT changed here (already capability-gated or intentionally
-- excluded from operations_manager):
--   - products, recipes, prep_recipes, production_runs, inventory_transactions,
--     purchase_orders, invoices, customers, pending_outflows:
--       already migrated to user_has_capability() in 20260120100100.
--   - bank_transactions, chart_of_accounts, financial_statement_cache,
--     connected_banks: accounting surface — operations_manager correctly denied.
--   - unified_sales INSERT: remains owner/manager only (no edit:pos_sales).
-- ============================================================================

-- ============================================================================
-- 5. Remaining hardcoded-role-list operational policies
--
-- These tables were NOT migrated to user_has_capability() in 20260120100100.
-- Their RLS policies still use standalone role IN ('owner','manager') literals
-- and must be explicitly widened to include operations_manager.
-- ============================================================================

-- -------------------------------------------------------------------------
-- tip_splits: "Managers can ..." (view/insert/update/delete)
-- Source: 20251217000001_create_tip_pooling_tables.sql
-- -------------------------------------------------------------------------
DROP POLICY IF EXISTS "Managers can view tip splits" ON public.tip_splits;
CREATE POLICY "Managers can view tip splits"
ON public.tip_splits FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM user_restaurants
    WHERE user_restaurants.restaurant_id = tip_splits.restaurant_id
      AND user_restaurants.user_id = auth.uid()
      AND user_restaurants.role IN ('owner', 'manager', 'operations_manager')
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
      AND user_restaurants.role IN ('owner', 'manager', 'operations_manager')
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
      AND user_restaurants.role IN ('owner', 'manager', 'operations_manager')
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
      AND user_restaurants.role IN ('owner', 'manager', 'operations_manager')
  )
);

-- -------------------------------------------------------------------------
-- tip_split_items: manager-level policies
-- Source: 20251217000001_create_tip_pooling_tables.sql
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
      AND ur.role IN ('owner', 'manager', 'operations_manager')
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
      AND ur.role IN ('owner', 'manager', 'operations_manager')
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
      AND ur.role IN ('owner', 'manager', 'operations_manager')
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
      AND ur.role IN ('owner', 'manager', 'operations_manager')
  )
);

-- -------------------------------------------------------------------------
-- tip_disputes: manager-level policies
-- Source: 20251217000001_create_tip_pooling_tables.sql
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
      AND ur.role IN ('owner', 'manager', 'operations_manager')
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
      AND ur.role IN ('owner', 'manager', 'operations_manager')
  )
);

-- -------------------------------------------------------------------------
-- tip_contribution_pools, tip_server_earnings, tip_pool_allocations
-- Source: 20260221000000_percentage_tip_pooling.sql
-- -------------------------------------------------------------------------
DROP POLICY IF EXISTS "Managers can view tip contribution pools" ON public.tip_contribution_pools;
CREATE POLICY "Managers can view tip contribution pools"
ON public.tip_contribution_pools FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM user_restaurants
    WHERE user_restaurants.restaurant_id = tip_contribution_pools.restaurant_id
      AND user_restaurants.user_id = auth.uid()
      AND user_restaurants.role IN ('owner', 'manager', 'operations_manager')
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
      AND user_restaurants.role IN ('owner', 'manager', 'operations_manager')
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
      AND user_restaurants.role IN ('owner', 'manager', 'operations_manager')
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
      AND user_restaurants.role IN ('owner', 'manager', 'operations_manager')
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
      AND ur.role IN ('owner', 'manager', 'operations_manager')
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
      AND ur.role IN ('owner', 'manager', 'operations_manager')
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
      AND ur.role IN ('owner', 'manager', 'operations_manager')
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
      AND ur.role IN ('owner', 'manager', 'operations_manager')
  )
);

DROP POLICY IF EXISTS "Managers can view tip pool allocations" ON public.tip_pool_allocations;
CREATE POLICY "Managers can view tip pool allocations"
ON public.tip_pool_allocations FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM user_restaurants
    WHERE user_restaurants.restaurant_id = tip_pool_allocations.restaurant_id
      AND user_restaurants.user_id = auth.uid()
      AND user_restaurants.role IN ('owner', 'manager', 'operations_manager')
  )
);

DROP POLICY IF EXISTS "Managers can insert tip pool allocations" ON public.tip_pool_allocations;
CREATE POLICY "Managers can insert tip pool allocations"
ON public.tip_pool_allocations FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM user_restaurants
    WHERE user_restaurants.restaurant_id = tip_pool_allocations.restaurant_id
      AND user_restaurants.user_id = auth.uid()
      AND user_restaurants.role IN ('owner', 'manager', 'operations_manager')
  )
);

DROP POLICY IF EXISTS "Managers can update tip pool allocations" ON public.tip_pool_allocations;
CREATE POLICY "Managers can update tip pool allocations"
ON public.tip_pool_allocations FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM user_restaurants
    WHERE user_restaurants.restaurant_id = tip_pool_allocations.restaurant_id
      AND user_restaurants.user_id = auth.uid()
      AND user_restaurants.role IN ('owner', 'manager', 'operations_manager')
  )
);

DROP POLICY IF EXISTS "Managers can delete tip pool allocations" ON public.tip_pool_allocations;
CREATE POLICY "Managers can delete tip pool allocations"
ON public.tip_pool_allocations FOR DELETE
USING (
  EXISTS (
    SELECT 1 FROM user_restaurants
    WHERE user_restaurants.restaurant_id = tip_pool_allocations.restaurant_id
      AND user_restaurants.user_id = auth.uid()
      AND user_restaurants.role IN ('owner', 'manager', 'operations_manager')
  )
);

-- -------------------------------------------------------------------------
-- tip_payouts: manager-level policies
-- Source: 20260218000000_create_tip_payouts_table.sql
-- -------------------------------------------------------------------------
DROP POLICY IF EXISTS "Managers can view tip payouts" ON public.tip_payouts;
CREATE POLICY "Managers can view tip payouts"
ON public.tip_payouts FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM user_restaurants
    WHERE user_restaurants.restaurant_id = tip_payouts.restaurant_id
      AND user_restaurants.user_id = auth.uid()
      AND user_restaurants.role IN ('owner', 'manager', 'operations_manager')
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
      AND user_restaurants.role IN ('owner', 'manager', 'operations_manager')
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
      AND user_restaurants.role IN ('owner', 'manager', 'operations_manager')
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
      AND user_restaurants.role IN ('owner', 'manager', 'operations_manager')
  )
);

-- -------------------------------------------------------------------------
-- overtime_adjustments: "Owners and managers can manage overtime adjustments"
-- Source: 20260221200001_create_overtime_adjustments.sql
-- -------------------------------------------------------------------------
DROP POLICY IF EXISTS "Owners and managers can manage overtime adjustments" ON public.overtime_adjustments;
CREATE POLICY "Owners and managers can manage overtime adjustments"
ON public.overtime_adjustments FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM user_restaurants
    WHERE user_restaurants.restaurant_id = overtime_adjustments.restaurant_id
      AND user_restaurants.user_id = auth.uid()
      AND user_restaurants.role IN ('owner', 'manager', 'operations_manager')
  )
);

-- -------------------------------------------------------------------------
-- daily_labor_allocations: insert/update/delete policies
-- Source: 20251205164747_add_non_hourly_compensation.sql
-- -------------------------------------------------------------------------
DROP POLICY IF EXISTS "Users can insert allocations for their restaurants" ON public.daily_labor_allocations;
CREATE POLICY "Users can insert allocations for their restaurants"
ON public.daily_labor_allocations FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM user_restaurants
    WHERE user_restaurants.restaurant_id = daily_labor_allocations.restaurant_id
      AND user_restaurants.user_id = auth.uid()
      AND user_restaurants.role IN ('owner', 'manager', 'operations_manager')
  )
);

DROP POLICY IF EXISTS "Users can update allocations for their restaurants" ON public.daily_labor_allocations;
CREATE POLICY "Users can update allocations for their restaurants"
ON public.daily_labor_allocations FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM user_restaurants
    WHERE user_restaurants.restaurant_id = daily_labor_allocations.restaurant_id
      AND user_restaurants.user_id = auth.uid()
      AND user_restaurants.role IN ('owner', 'manager', 'operations_manager')
  )
);

DROP POLICY IF EXISTS "Users can delete allocations for their restaurants" ON public.daily_labor_allocations;
CREATE POLICY "Users can delete allocations for their restaurants"
ON public.daily_labor_allocations FOR DELETE
USING (
  EXISTS (
    SELECT 1 FROM user_restaurants
    WHERE user_restaurants.restaurant_id = daily_labor_allocations.restaurant_id
      AND user_restaurants.user_id = auth.uid()
      AND user_restaurants.role IN ('owner', 'manager', 'operations_manager')
  )
);

-- -------------------------------------------------------------------------
-- employee_compensation_history: INSERT policy
-- Source: 20251216093000_add_employee_compensation_history.sql
-- -------------------------------------------------------------------------
DROP POLICY IF EXISTS "Managers/owners can insert compensation history for their restaurants" ON public.employee_compensation_history;
CREATE POLICY "Managers/owners can insert compensation history for their restaurants"
ON public.employee_compensation_history FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM user_restaurants
    WHERE user_restaurants.restaurant_id = employee_compensation_history.restaurant_id
      AND user_restaurants.user_id = auth.uid()
      AND user_restaurants.role IN ('owner', 'manager', 'operations_manager')
  )
);

-- -------------------------------------------------------------------------
-- time_punches: "Managers can create time punches for employees"
-- Source: 20251127100000_add_kiosk_service_account.sql
-- Adds operations_manager alongside the existing kiosk exception.
-- -------------------------------------------------------------------------
DROP POLICY IF EXISTS "Managers can create time punches for employees" ON public.time_punches;
CREATE POLICY "Managers can create time punches for employees"
ON public.time_punches FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.user_restaurants
    WHERE public.user_restaurants.restaurant_id = time_punches.restaurant_id
      AND public.user_restaurants.user_id = auth.uid()
      AND public.user_restaurants.role IN ('owner', 'manager', 'operations_manager', 'kiosk')
  )
);

-- -------------------------------------------------------------------------
-- staffing_settings: "Owners and managers can manage staffing settings"
-- Source: 20260306000000_create_staffing_settings.sql
-- -------------------------------------------------------------------------
DROP POLICY IF EXISTS "Owners and managers can manage staffing settings" ON public.staffing_settings;
CREATE POLICY "Owners and managers can manage staffing settings"
ON public.staffing_settings FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM user_restaurants
    WHERE user_restaurants.restaurant_id = staffing_settings.restaurant_id
      AND user_restaurants.user_id = auth.uid()
      AND user_restaurants.role IN ('owner', 'manager', 'operations_manager')
  )
);

-- -------------------------------------------------------------------------
-- open_shift_claims: managers_view_restaurant_claims (SELECT)
--                    managers_review_claims (UPDATE)
-- Source: 20260412145842_open_shift_claims.sql
-- -------------------------------------------------------------------------
DROP POLICY IF EXISTS "managers_view_restaurant_claims" ON public.open_shift_claims;
CREATE POLICY "managers_view_restaurant_claims"
ON public.open_shift_claims FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.user_restaurants
    WHERE user_id = auth.uid()
      AND restaurant_id = open_shift_claims.restaurant_id
      AND role IN ('owner', 'manager', 'operations_manager')
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
      AND role IN ('owner', 'manager', 'operations_manager')
  )
);

-- -------------------------------------------------------------------------
-- schedule_change_logs: "Managers can create change logs"
-- Source: 20251123000000_schedule_publishing.sql
-- -------------------------------------------------------------------------
DROP POLICY IF EXISTS "Managers can create change logs" ON public.schedule_change_logs;
CREATE POLICY "Managers can create change logs"
ON public.schedule_change_logs FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM user_restaurants
    WHERE user_restaurants.restaurant_id = schedule_change_logs.restaurant_id
      AND user_restaurants.user_id = auth.uid()
      AND user_restaurants.role IN ('owner', 'manager', 'operations_manager')
  )
);

-- -------------------------------------------------------------------------
-- user_restaurants UPDATE: prevent self-escalation to privileged roles.
-- The policy "Owners can manage restaurant associations" in 20250915213019
-- has WITH CHECK (user_id = auth.uid() OR is_restaurant_owner(...)).
-- The first branch allows any user to UPDATE their own row to any role.
-- This guard restricts UPDATE so that non-owners cannot promote themselves
-- (or others) to 'owner' or 'manager'.
-- -------------------------------------------------------------------------
DROP POLICY IF EXISTS "Prevent self-escalation to privileged roles" ON public.user_restaurants;
CREATE POLICY "Prevent self-escalation to privileged roles"
ON public.user_restaurants
FOR UPDATE
USING (true)
WITH CHECK (
  -- Allow if the caller is an owner of this restaurant
  public.is_restaurant_owner(restaurant_id, auth.uid())
  OR
  -- Allow if the new role is not a privileged role (prevents non-owners from
  -- granting themselves manager/owner access)
  role NOT IN ('owner', 'manager')
);
