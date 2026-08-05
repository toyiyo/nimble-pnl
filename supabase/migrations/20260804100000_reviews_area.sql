-- ============================================================================
-- The `reviews` area.
--
-- Slots into the Operations band at sort_order 6, immediately after
-- scheduling, pushing books/payroll/employees/team/settings down one. No
-- unique constraint exists on area_catalog.sort_order, so the renumber can be
-- a single UPDATE without a deferred-constraint dance.
--
-- Unlike the four split areas (purchasing, chart_of_accounts, collaborators,
-- integrations), `reviews` is its own ui_group: the editor renders one control
-- for it.
-- ============================================================================

UPDATE public.area_catalog
SET sort_order = sort_order + 1
WHERE sort_order >= 6;

INSERT INTO public.area_catalog (area_key, ui_group, band, sort_order, max_level_collaborator)
VALUES ('reviews', 'reviews', 'Operations', 6, 'view');

-- Builtin grants. role_areas_block_builtin_mutation fires BEFORE UPDATE OR
-- DELETE only, so INSERTing builtin rows is permitted; and
-- role_areas_enforce_collaborator_cap returns NEW immediately for builtins.
INSERT INTO public.role_areas (role_id, area_key, level) VALUES
  ('b0000000-0000-0000-0000-000000000001', 'reviews', 'manage'),  -- Owner
  ('b0000000-0000-0000-0000-000000000002', 'reviews', 'manage'),  -- Manager
  ('b0000000-0000-0000-0000-000000000003', 'reviews', 'manage'),  -- Operations Manager
  ('b0000000-0000-0000-0000-000000000004', 'reviews', 'view');    -- Chef
-- Employee, Kiosk, and all four collaborator builtins get nothing.

-- ============================================================================
-- Extend user_has_capability's VALUES map with the two reviews capabilities.
-- Copied verbatim from 20260730140000_user_has_capability_from_areas.sql
-- lines 54-281, with one addition to the area+level VALUES list.
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

  -- Membership is decided by whether a row was found, not by whether `role`
  -- is populated: `user_restaurants.role` is nullable (it has always been
  -- `role TEXT ... DEFAULT 'staff'`, never NOT NULL), so a row carrying only
  -- a role_id — the shape this migration is moving toward — would otherwise
  -- be read as "not a member" and lose every capability its areas grant.
  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  -- Nothing to resolve from: no role_id to read areas off, and no legacy role
  -- string for the fallback CASE below to match. Fail closed.
  IF v_role_id IS NULL AND v_role IS NULL THEN
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
    ('manage:integrations',         'integrations',      'manage'),
    ('view:reviews',                'reviews',           'view'),
    ('manage:reviews',              'reviews',           'manage')
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

COMMENT ON COLUMN public.area_catalog.area_key IS
'Stable key joined by role_areas and by user_has_capability''s VALUES map. Fifteen keys collapse onto eleven ui_groups.';
