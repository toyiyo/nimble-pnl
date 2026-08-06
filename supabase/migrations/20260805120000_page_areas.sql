-- ============================================================================
-- Migration: re-cut area_catalog along the sidebar — one area per page
--
-- Design: docs/superpowers/specs/2026-08-05-permissions-menu-mirror-design.md
--
-- The ordering below is forced, not preferred — see spec §4.0. Two facts:
--   1. role_areas_block_builtin_mutation is BEFORE UPDATE OR DELETE with no
--      migration exemption (20260730100000_roles_and_areas_tables.sql:419-465).
--      It does NOT cover INSERT, so only removing the old `books` rows needs
--      the guard down.
--   2. role_areas.area_key REFERENCES area_catalog(area_key) with no
--      ON DELETE clause (:229), therefore RESTRICT.
-- ============================================================================

ALTER TABLE public.role_areas DISABLE TRIGGER role_areas_block_builtin_mutation;

-- `band` is retired on the client (five sidebar groups replace the three
-- invented bands) but the column is NOT NULL and other migrations reference
-- it. Set it equal to ui_group here; dropping it is a separate later change.

-- Re-point the fourteen survivors onto their sidebar group and position.
UPDATE public.area_catalog SET ui_group = 'Main',       band = 'Main',       sort_order = 2, max_level_collaborator = 'view'   WHERE area_key = 'integrations';
UPDATE public.area_catalog SET ui_group = 'Main',       band = 'Main',       sort_order = 3, max_level_collaborator = 'view'   WHERE area_key = 'sales';
UPDATE public.area_catalog SET ui_group = 'Main',       band = 'Main',       sort_order = 5, max_level_collaborator = 'view'   WHERE area_key = 'reviews';
UPDATE public.area_catalog SET ui_group = 'Operations', band = 'Operations', sort_order = 1, max_level_collaborator = 'manage' WHERE area_key = 'scheduling';
UPDATE public.area_catalog SET ui_group = 'Operations', band = 'Operations', sort_order = 4, max_level_collaborator = 'view'   WHERE area_key = 'payroll';
UPDATE public.area_catalog SET ui_group = 'Inventory',  band = 'Inventory',  sort_order = 1, max_level_collaborator = 'manage' WHERE area_key = 'recipes';
UPDATE public.area_catalog SET ui_group = 'Inventory',  band = 'Inventory',  sort_order = 3, max_level_collaborator = 'manage' WHERE area_key = 'inventory';
UPDATE public.area_catalog SET ui_group = 'Inventory',  band = 'Inventory',  sort_order = 5, max_level_collaborator = 'manage' WHERE area_key = 'purchasing';
UPDATE public.area_catalog SET ui_group = 'Inventory',  band = 'Inventory',  sort_order = 6, max_level_collaborator = 'view'   WHERE area_key = 'reports';
UPDATE public.area_catalog SET ui_group = 'Accounting', band = 'Accounting', sort_order = 11, max_level_collaborator = 'manage' WHERE area_key = 'chart_of_accounts';
UPDATE public.area_catalog SET ui_group = 'Admin',      band = 'Admin',      sort_order = 1, max_level_collaborator = 'manage' WHERE area_key = 'employees';
UPDATE public.area_catalog SET ui_group = 'Admin',      band = 'Admin',      sort_order = 2, max_level_collaborator = NULL     WHERE area_key = 'team';
UPDATE public.area_catalog SET ui_group = 'Admin',      band = 'Admin',      sort_order = 3, max_level_collaborator = NULL     WHERE area_key = 'collaborators';
UPDATE public.area_catalog SET ui_group = 'Admin',      band = 'Admin',      sort_order = 4, max_level_collaborator = 'view'   WHERE area_key = 'settings';

-- The nineteen new page keys.
INSERT INTO public.area_catalog (area_key, ui_group, band, sort_order, max_level_collaborator) VALUES
  ('dashboard',              'Main',       'Main',       1,  'view'),
  ('ops_inbox',              'Main',       'Main',       4,  'view'),
  ('weekly_brief',           'Main',       'Main',       6,  'view'),
  ('time_punches',           'Operations', 'Operations', 2,  'manage'),
  ('tips',                   'Operations', 'Operations', 3,  'manage'),
  ('labor',                  'Operations', 'Operations', 5,  'view'),
  ('prep_recipes',           'Inventory',  'Inventory',  2,  'manage'),
  ('inventory_audit',        'Inventory',  'Inventory',  4,  'manage'),
  ('budget',                 'Accounting', 'Accounting', 1,  'view'),
  ('customers',              'Accounting', 'Accounting', 2,  'manage'),
  ('invoices',               'Accounting', 'Accounting', 3,  'manage'),
  ('stripe_account',         'Accounting', 'Accounting', 4,  'view'),
  ('banking',                'Accounting', 'Accounting', 5,  'manage'),
  ('expenses',               'Accounting', 'Accounting', 6,  'manage'),
  ('print_checks',           'Accounting', 'Accounting', 7,  'manage'),
  ('assets',                 'Accounting', 'Accounting', 8,  'manage'),
  ('financial_intelligence', 'Accounting', 'Accounting', 9,  'view'),
  ('transactions',           'Accounting', 'Accounting', 10, 'manage'),
  ('financial_statements',   'Accounting', 'Accounting', 12, 'view');

-- ============================================================================
-- Step 3: fan out role_areas, then retire books
--
-- Insert before deleting — the FK is RESTRICT and the new rows do not
-- depend on the old ones surviving. Every fan-out below targets keys that
-- were only just inserted above, and no two fan-outs share a target key, so
-- a plain INSERT cannot conflict. Left unqualified: if that premise is ever
-- wrong, a loud unique-violation is the right outcome.
-- ============================================================================

-- books:manage -> manage on all nine books pages.
-- books:view   -> view on eight; print_checks is SKIPPED (spec §4.1) —
--                 /print-checks is the only books path gated at manage today.
-- financial_statements/financial_intelligence are clamped to 'view'
-- regardless of the source books level: both are seeded above (lines 55,57)
-- with max_level_collaborator = 'view' and have no manage tier at all
-- (spec §3.2/§3.3 — "Pages with no edit capability get no manage tier").
-- Copying a raw books:manage level onto them verbatim would (a) materialize
-- a 'manage' row for a page the product defines as view-only, and (b) abort
-- this migration outright for any pre-existing non-builtin collaborator role
-- holding books:manage, since role_areas_enforce_collaborator_cap stays
-- ENABLED throughout (only role_areas_block_builtin_mutation is toggled).
INSERT INTO public.role_areas (role_id, area_key, level)
SELECT
  ra.role_id,
  page.area_key,
  CASE
    WHEN page.area_key IN ('financial_statements', 'financial_intelligence') THEN 'view'
    ELSE ra.level
  END
FROM public.role_areas ra
CROSS JOIN LATERAL (VALUES
  ('transactions'), ('banking'), ('expenses'), ('invoices'), ('customers'),
  ('financial_statements'), ('financial_intelligence'), ('assets'), ('print_checks')
) AS page(area_key)
WHERE ra.area_key = 'books'
  AND NOT (page.area_key = 'print_checks' AND ra.level = 'view');

-- reports -> dashboard at view. The `reports` row keeps its own level:
-- view:ai_assistant is resolved by a hardcoded `area_key = 'reports' AND
-- level = 'manage'` check below, so downgrading it would silently kill AI
-- Assistant for Owner, Manager and both Operations Manager roles.
INSERT INTO public.role_areas (role_id, area_key, level)
SELECT ra.role_id, 'dashboard', 'view'
FROM public.role_areas ra
WHERE ra.area_key = 'reports';

-- scheduling:manage -> manage on time_punches and tips. scheduling:view fans
-- out to nothing: a view-level holder reaches neither page today.
INSERT INTO public.role_areas (role_id, area_key, level)
SELECT ra.role_id, page.area_key, 'manage'
FROM public.role_areas ra
CROSS JOIN LATERAL (VALUES ('time_punches'), ('tips')) AS page(area_key)
WHERE ra.area_key = 'scheduling' AND ra.level = 'manage';

-- inventory:manage -> inventory_audit:manage. inventory:view fans out to
-- nothing (/inventory-audit is manage-gated today).
INSERT INTO public.role_areas (role_id, area_key, level)
SELECT ra.role_id, 'inventory_audit', 'manage'
FROM public.role_areas ra
WHERE ra.area_key = 'inventory' AND ra.level = 'manage';

-- recipes -> prep_recipes at the same level.
INSERT INTO public.role_areas (role_id, area_key, level)
SELECT ra.role_id, 'prep_recipes', ra.level
FROM public.role_areas ra
WHERE ra.area_key = 'recipes';

-- The five new areas (ops_inbox, weekly_brief, budget, labor,
-- stripe_account) intentionally receive NO rows. Grantable from now on;
-- nobody holds them on deploy day.

DELETE FROM public.role_areas   WHERE area_key = 'books';
DELETE FROM public.area_catalog WHERE area_key = 'books';

-- ============================================================================
-- Step 4: rewrite user_has_capability's map and its one hardcoded special
-- case to match the re-cut catalog. Body copied from
-- 20260804100000_reviews_area.sql with four edits: the
-- view:financial_intelligence special case re-points off 'books'; three
-- capability groups (tips, time_punches, inventory_audit) move down a tier
-- onto their own area at the level the old bundle granted; pending_outflows
-- becomes a hardcoded OR across two areas ('print_checks' and 'expenses' —
-- Expenses.tsx reads it unconditionally, so it can't be a single-area VALUES
-- row); the rest of the former `books` capabilities re-point onto their own
-- per-page area at the same level. Everything else — view:ai_assistant,
-- manage:subscription, the sensitive-flag branches, and the entire legacy
-- v_role_id IS NULL CASE — is byte-for-byte unchanged.
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

ALTER TABLE public.role_areas ENABLE TRIGGER role_areas_block_builtin_mutation;

COMMENT ON COLUMN public.area_catalog.area_key IS
'Stable key joined by role_areas and by user_has_capability''s VALUES map. One key per gateable sidebar page: 33 keys across the 5 sidebar ui_groups.';
