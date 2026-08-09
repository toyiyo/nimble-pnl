-- Answer the two sensitive flags on a legacy membership.
--
-- public.create_restaurant_with_owner still writes
-- (user_id, restaurant_id, role) and leaves user_restaurants.role_id NULL.
-- backfill_user_restaurants_role_id() ran once, at migration time, so it
-- filled the rows that existed then and nothing since. Every restaurant
-- created from now on therefore has an owner on the legacy path.
--
-- That path ends in the legacy CASE, which predates both flags and denies
-- them through its ELSE FALSE. With the column gate of 20260806110000 in
-- place, that owner reads NULL for every pay and contact column — the same
-- defect this design set out to fix, moved to a new set of users.
--
-- The fix answers the two flags before the fallback, for the five legacy role
-- strings that hold view:employees. Those five are the legacy equivalents of
-- the five builtin roles that 20260806100000 seeds, so both paths agree.
--
-- view:costs stays denied on both paths. No code reads it yet.
--
-- The legacy CASE itself stays byte-for-byte unchanged. Every other line of
-- this function is copied verbatim from
-- 20260805120000_page_areas.sql:149-409.
--
-- Coverage: supabase/tests/user_has_capability_areas_test.sql, section 2b.
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

  -- The two sensitive flags answer here, before the legacy CASE below. That
  -- CASE predates them and denies them through its ELSE FALSE. These five
  -- role strings are the legacy equivalents of the five builtin roles that
  -- 20260806100000 seeds, and they match view:employees exactly.
  IF v_role_id IS NULL AND p_capability IN ('view:pay_rates', 'view:employee_pii') THEN
    RETURN v_role IN (
      'owner', 'manager', 'operations_manager',
      'collaborator_accountant', 'collaborator_operations_manager'
    );
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

      -- Mirrors the role_areas grants inserted above: Owner/Manager/Operations
      -- Manager get 'manage', Chef gets 'view', nobody else (including every
      -- collaborator) gets anything — there is no role_areas row for them.
      WHEN 'view:reviews' THEN v_role IN ('owner', 'manager', 'operations_manager', 'chef')
      WHEN 'manage:reviews' THEN v_role IN ('owner', 'manager', 'operations_manager')

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
      WHERE ra.role_id = v_role_id AND ra.area_key = 'financial_intelligence' AND ra.level IN ('view', 'manage')
    ) AND has_subscription_feature(p_restaurant_id, 'financial_intelligence');
  END IF;

  -- pending_outflows is read by two pages, not one: /print-checks (its own
  -- area) and /expenses (Expenses.tsx calls usePendingOutflows
  -- unconditionally). Either area, held at the matching level, must satisfy
  -- it — a plain single-area VALUES row can't express an OR, so this stays
  -- a hardcoded branch instead of two rows below.
  IF p_capability = 'view:pending_outflows' THEN
    RETURN EXISTS (
      SELECT 1 FROM role_areas ra
      WHERE ra.role_id = v_role_id
        AND ra.area_key IN ('print_checks', 'expenses')
        AND ra.level IN ('view', 'manage')
    );
  END IF;

  IF p_capability = 'edit:pending_outflows' THEN
    RETURN EXISTS (
      SELECT 1 FROM role_areas ra
      WHERE ra.role_id = v_role_id
        AND ra.area_key IN ('print_checks', 'expenses')
        AND ra.level = 'manage'
    );
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
    ('view:dashboard',              'dashboard',           'view'),
    ('view:reports',                'reports',             'view'),
    ('view:pos_sales',              'sales',               'view'),
    ('view:inventory',              'inventory',           'view'),
    ('edit:inventory',              'inventory',           'manage'),
    ('view:inventory_audit',        'inventory_audit',     'view'),
    ('edit:inventory_audit',        'inventory_audit',     'manage'),
    ('view:receipt_import',         'inventory',           'manage'),
    ('edit:receipt_import',         'inventory',           'manage'),
    ('view:inventory_transactions', 'inventory',           'manage'),
    ('edit:inventory_transactions', 'inventory',           'manage'),
    ('view:purchase_orders',        'purchasing',          'view'),
    ('edit:purchase_orders',        'purchasing',          'manage'),
    ('view:recipes',                'recipes',             'view'),
    ('edit:recipes',                'recipes',             'manage'),
    ('view:prep_recipes',           'prep_recipes',        'view'),
    ('edit:prep_recipes',           'prep_recipes',        'manage'),
    ('view:batches',                'recipes',             'view'),
    ('edit:batches',                'recipes',             'manage'),
    ('view:scheduling',             'scheduling',          'view'),
    ('edit:scheduling',             'scheduling',          'manage'),
    ('view:tips',                   'tips',                'view'),
    ('edit:tips',                   'tips',                'manage'),
    ('view:time_punches',           'time_punches',        'view'),
    ('edit:time_punches',           'time_punches',        'manage'),
    ('view:transactions',           'transactions',        'view'),
    ('edit:transactions',           'transactions',        'manage'),
    ('view:banking',                'banking',             'view'),
    ('edit:banking',                'banking',             'manage'),
    ('view:expenses',               'expenses',            'view'),
    ('edit:expenses',               'expenses',            'manage'),
    ('view:financial_statements',   'financial_statements', 'view'),
    ('view:invoices',               'invoices',            'view'),
    ('edit:invoices',               'invoices',            'manage'),
    ('view:customers',              'customers',           'view'),
    ('edit:customers',              'customers',           'manage'),
    -- view:pending_outflows / edit:pending_outflows are NOT here — they're
    -- satisfied by either 'print_checks' or 'expenses', so they're resolved
    -- by the hardcoded IF branches above instead of a single-area row.
    ('view:assets',                 'assets',              'view'),
    ('edit:assets',                 'assets',              'manage'),
    ('view:chart_of_accounts',      'chart_of_accounts',   'view'),
    ('edit:chart_of_accounts',      'chart_of_accounts',   'manage'),
    ('view:payroll',                'payroll',             'view'),
    ('edit:payroll',                'payroll',             'manage'),
    ('view:employees',              'employees',           'view'),
    ('manage:employees',            'employees',           'manage'),
    ('view:team',                   'team',                'view'),
    ('manage:team',                 'team',                'manage'),
    ('view:collaborators',          'collaborators',       'view'),
    ('manage:collaborators',        'collaborators',       'manage'),
    ('view:settings',               'settings',            'view'),
    ('edit:settings',               'settings',            'manage'),
    ('view:integrations',           'integrations',        'view'),
    ('manage:integrations',         'integrations',        'manage'),
    ('view:reviews',                'reviews',             'view'),
    ('manage:reviews',              'reviews',             'manage')
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
