-- ============================================================================
-- Migration: rewrite user_has_capability() to resolve from role_areas/
-- role_flags, with a verbatim legacy-CASE fallback
--
-- Task 5 of the "data-driven roles built from areas" design
-- (docs/superpowers/specs/2026-07-29-roles-and-areas-design.md). This is the
-- 6th rewrite of this function (after 20260120100000, 20260120100200,
-- 20260129000000, 20260702170000, 20260723120000) and, per the design,
-- MUST restate the exact signature — LANGUAGE plpgsql STABLE SECURITY
-- DEFINER SET search_path = public — rather than relying on CREATE OR
-- REPLACE to carry it forward: dropping SET search_path on a SECURITY
-- DEFINER function is a privilege-escalation vector, so it is spelled out
-- again here on purpose, not by inheritance.
--
-- Dispatch:
--   role_id IS NULL     -> the legacy role-literal CASE, verbatim (byte-
--                          identical to 20260723120000's body). Every
--                          membership created before Task 3's backfill (or
--                          any future membership never assigned a role_id)
--                          keeps behaving exactly as it always has.
--   role_id IS NOT NULL -> resolve from role_areas (+ role_flags for the
--                          three sensitive flags), via the capability ->
--                          (area_key, required_level) map below.
--
-- Three capabilities are not plain area+level lookups and are special-cased
-- ahead of the map:
--   - manage:subscription: a direct role_id check against the Owner builtin
--     (b0000000-0000-0000-0000-000000000001) — this was never an area-
--     shaped capability, even in the legacy CASE (v_role = 'owner').
--   - view:ai_assistant: reports@manage AND has_subscription_feature(...,
--     'ai_assistant') — the AND-clause is preserved exactly, only the role
--     check moves from a literal IN-list to reports@manage.
--   - view:financial_intelligence: books@view AND has_subscription_feature(
--     ..., 'financial_intelligence') — same shape, books@view.
--
-- One capability pair, view:assets/edit:assets, exists in the legacy CASE
-- (both map to the accountant-only branch) but not in today's TypeScript
-- Capability union (design's defect 1, closed for the UI in Task 7). They
-- are included in the map below at books/view and books/manage respectively
-- so the SQL-level round trip against the legacy CASE stays byte-identical;
-- Task 2's seed migration already grants them implicitly via the books area.
--
-- The one INTENTIONAL, documented deviation from byte-identical: Inventory
-- Helper (collaborator_inventory) + view:reports. The legacy CASE granted
-- it; Task 2's seed migration deliberately did not grant Inventory Helper a
-- 'reports' area, following ROLE_CAPABILITIES (src/lib/permissions/
-- definitions.ts) rather than the SQL-only grant, per the design's defect-3
-- resolution (zero production memberships/invitations on this role at the
-- time; see PR #596). This function does not special-case that role — it
-- is a natural, accepted consequence of the seed's area grants, verified by
-- supabase/tests/user_has_capability_areas_test.sql.
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
  v_role_id UUID;
  v_area_key TEXT;
  v_required_level TEXT;
BEGIN
  SELECT role, role_id INTO v_role, v_role_id
  FROM user_restaurants ur
  WHERE ur.restaurant_id = p_restaurant_id
    AND ur.user_id = auth.uid();

  IF v_role IS NULL THEN
    RETURN FALSE;
  END IF;

  -- ==========================================================================
  -- role_id IS NULL: legacy fallback, verbatim transcription of the CASE
  -- body from 20260723120000_add_collaborator_operations_manager_role.sql.
  -- Do not "clean up" or reorder branches here.
  -- ==========================================================================
  IF v_role_id IS NULL THEN
    RETURN CASE p_capability
      WHEN 'view:ai_assistant' THEN
        v_role IN ('owner', 'manager', 'operations_manager', 'collaborator_operations_manager') AND
        has_subscription_feature(p_restaurant_id, 'ai_assistant')

      WHEN 'view:financial_intelligence' THEN
        v_role IN ('owner', 'manager', 'collaborator_accountant') AND
        has_subscription_feature(p_restaurant_id, 'financial_intelligence')

      WHEN 'view:dashboard' THEN v_role IN ('owner', 'manager', 'operations_manager', 'chef', 'collaborator_operations_manager')

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

      WHEN 'view:recipes' THEN v_role IN ('owner', 'manager', 'operations_manager', 'chef', 'collaborator_chef', 'collaborator_operations_manager')
      WHEN 'edit:recipes' THEN v_role IN ('owner', 'manager', 'operations_manager', 'chef', 'collaborator_chef', 'collaborator_operations_manager')
      WHEN 'view:prep_recipes' THEN v_role IN ('owner', 'manager', 'operations_manager', 'chef', 'collaborator_chef', 'collaborator_operations_manager')
      WHEN 'edit:prep_recipes' THEN v_role IN ('owner', 'manager', 'operations_manager', 'chef', 'collaborator_chef', 'collaborator_operations_manager')
      WHEN 'view:batches' THEN v_role IN ('owner', 'manager', 'operations_manager', 'chef', 'collaborator_chef', 'collaborator_operations_manager')
      WHEN 'edit:batches' THEN v_role IN ('owner', 'manager', 'operations_manager', 'chef', 'collaborator_chef', 'collaborator_operations_manager')

      WHEN 'view:pos_sales' THEN v_role IN ('owner', 'manager', 'operations_manager', 'chef', 'collaborator_operations_manager')
      WHEN 'view:scheduling' THEN v_role IN ('owner', 'manager', 'operations_manager', 'chef', 'collaborator_operations_manager')
      WHEN 'edit:scheduling' THEN v_role IN ('owner', 'manager', 'operations_manager', 'collaborator_operations_manager')
      WHEN 'view:payroll' THEN v_role IN ('owner', 'manager', 'operations_manager', 'collaborator_accountant', 'collaborator_operations_manager')
      WHEN 'edit:payroll' THEN v_role IN ('owner', 'manager', 'operations_manager')
      WHEN 'view:tips' THEN v_role IN ('owner', 'manager', 'operations_manager', 'collaborator_operations_manager')
      WHEN 'edit:tips' THEN v_role IN ('owner', 'manager', 'operations_manager', 'collaborator_operations_manager')
      WHEN 'view:time_punches' THEN v_role IN ('owner', 'manager', 'operations_manager', 'collaborator_operations_manager')
      WHEN 'edit:time_punches' THEN v_role IN ('owner', 'manager', 'operations_manager', 'collaborator_operations_manager')

      WHEN 'view:team' THEN v_role IN ('owner', 'manager', 'operations_manager')
      WHEN 'manage:team' THEN v_role IN ('owner', 'manager', 'operations_manager')
      WHEN 'view:employees' THEN v_role IN ('owner', 'manager', 'operations_manager', 'collaborator_accountant', 'collaborator_operations_manager')
      WHEN 'manage:employees' THEN v_role IN ('owner', 'manager', 'operations_manager')
      WHEN 'view:settings' THEN v_role NOT IN ('kiosk')
      WHEN 'edit:settings' THEN v_role IN ('owner')
      WHEN 'view:integrations' THEN v_role IN ('owner', 'manager')
      WHEN 'manage:integrations' THEN v_role IN ('owner')
      WHEN 'view:collaborators' THEN v_role IN ('owner', 'manager')
      WHEN 'manage:collaborators' THEN v_role IN ('owner', 'manager')

      WHEN 'manage:subscription' THEN v_role = 'owner'

      ELSE FALSE
    END;
  END IF;

  -- ==========================================================================
  -- role_id IS NOT NULL: area/level/flag resolution.
  -- ==========================================================================

  -- Direct role_id check — not area-shaped in the legacy CASE either.
  IF p_capability = 'manage:subscription' THEN
    RETURN v_role_id = 'b0000000-0000-0000-0000-000000000001'::uuid;
  END IF;

  -- Subscription-gated capabilities: area check AND has_subscription_feature.
  IF p_capability = 'view:ai_assistant' THEN
    RETURN EXISTS (
      SELECT 1 FROM role_areas ra
      WHERE ra.role_id = v_role_id AND ra.area_key = 'reports' AND ra.level = 'manage'
    ) AND has_subscription_feature(p_restaurant_id, 'ai_assistant');
  END IF;

  IF p_capability = 'view:financial_intelligence' THEN
    RETURN EXISTS (
      SELECT 1 FROM role_areas ra
      WHERE ra.role_id = v_role_id AND ra.area_key = 'books' AND ra.level IN ('view', 'manage')
    ) AND has_subscription_feature(p_restaurant_id, 'financial_intelligence');
  END IF;

  -- Sensitive flags: independent of area grants, no legacy equivalent.
  IF p_capability IN ('view:costs', 'view:pay_rates', 'view:employee_pii') THEN
    RETURN EXISTS (
      SELECT 1 FROM role_flags rf
      WHERE rf.role_id = v_role_id AND rf.flag = p_capability
    );
  END IF;

  -- Every remaining capability is a plain area+level lookup.
  SELECT m.area_key, m.required_level INTO v_area_key, v_required_level
  FROM (VALUES
    ('view:dashboard',              'reports',           'view'),
    ('view:reports',                'reports',           'view'),
    ('view:pos_sales',              'sales',             'view'),
    ('view:inventory',              'inventory',         'view'),
    ('edit:inventory',              'inventory',         'manage'),
    ('view:inventory_audit',        'inventory',         'manage'),
    ('edit:inventory_audit',        'inventory',         'manage'),
    ('view:receipt_import',         'inventory',         'manage'),
    ('edit:receipt_import',         'inventory',         'manage'),
    ('view:inventory_transactions', 'inventory',         'manage'),
    ('edit:inventory_transactions', 'inventory',         'manage'),
    ('view:purchase_orders',        'purchasing',        'view'),
    ('edit:purchase_orders',        'purchasing',        'manage'),
    ('view:recipes',                'recipes',           'view'),
    ('edit:recipes',                'recipes',           'manage'),
    ('view:prep_recipes',           'recipes',           'view'),
    ('edit:prep_recipes',           'recipes',           'manage'),
    ('view:batches',                'recipes',           'view'),
    ('edit:batches',                'recipes',           'manage'),
    ('view:scheduling',             'scheduling',        'view'),
    ('edit:scheduling',             'scheduling',        'manage'),
    ('view:tips',                   'scheduling',        'manage'),
    ('edit:tips',                   'scheduling',        'manage'),
    ('view:time_punches',           'scheduling',        'manage'),
    ('edit:time_punches',           'scheduling',        'manage'),
    ('view:transactions',           'books',             'view'),
    ('edit:transactions',           'books',             'manage'),
    ('view:banking',                'books',             'view'),
    ('edit:banking',                'books',             'manage'),
    ('view:expenses',               'books',             'view'),
    ('edit:expenses',               'books',             'manage'),
    ('view:financial_statements',   'books',             'view'),
    ('view:invoices',               'books',             'view'),
    ('edit:invoices',               'books',             'manage'),
    ('view:customers',              'books',             'view'),
    ('edit:customers',              'books',             'manage'),
    ('view:pending_outflows',       'books',             'view'),
    ('edit:pending_outflows',       'books',             'manage'),
    ('view:assets',                 'books',             'view'),
    ('edit:assets',                 'books',             'manage'),
    ('view:chart_of_accounts',      'chart_of_accounts', 'view'),
    ('edit:chart_of_accounts',      'chart_of_accounts', 'manage'),
    ('view:payroll',                'payroll',           'view'),
    ('edit:payroll',                'payroll',           'manage'),
    ('view:employees',              'employees',         'view'),
    ('manage:employees',            'employees',         'manage'),
    ('view:team',                   'team',              'view'),
    ('manage:team',                 'team',              'manage'),
    ('view:collaborators',          'collaborators',     'view'),
    ('manage:collaborators',        'collaborators',     'manage'),
    ('view:settings',               'settings',          'view'),
    ('edit:settings',               'settings',          'manage'),
    ('view:integrations',           'integrations',      'view'),
    ('manage:integrations',         'integrations',      'manage')
  ) AS m(capability, area_key, required_level)
  WHERE m.capability = p_capability;

  -- Unrecognized capability: fail closed, matching the legacy CASE's ELSE FALSE.
  IF v_area_key IS NULL THEN
    RETURN FALSE;
  END IF;

  IF v_required_level = 'manage' THEN
    RETURN EXISTS (
      SELECT 1 FROM role_areas ra
      WHERE ra.role_id = v_role_id AND ra.area_key = v_area_key AND ra.level = 'manage'
    );
  ELSE
    -- 'view' tier: manage also satisfies it (manage is a superset of view).
    RETURN EXISTS (
      SELECT 1 FROM role_areas ra
      WHERE ra.role_id = v_role_id AND ra.area_key = v_area_key AND ra.level IN ('view', 'manage')
    );
  END IF;
END;
$$;

COMMENT ON FUNCTION public.user_has_capability IS
'Check if current user has a specific capability for a restaurant.
When user_restaurants.role_id IS NOT NULL, resolves from role_areas/
role_flags (data-driven roles). When role_id IS NULL, falls back to the
verbatim legacy role-literal CASE for backward compatibility with
memberships not yet backfilled onto a role_id.
Integrates subscription tier checks for view:ai_assistant and
view:financial_intelligence exactly as before.';
