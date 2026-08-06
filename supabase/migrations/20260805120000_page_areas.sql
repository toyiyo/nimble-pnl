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
UPDATE public.area_catalog SET ui_group = 'Accounting', band = 'Accounting', sort_order = 12, max_level_collaborator = 'manage' WHERE area_key = 'chart_of_accounts';
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
  ('financial_statements',   'Accounting', 'Accounting', 11, 'view');

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
INSERT INTO public.role_areas (role_id, area_key, level)
SELECT ra.role_id, page.area_key, ra.level
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
