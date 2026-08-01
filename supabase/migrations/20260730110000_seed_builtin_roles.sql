-- ============================================================================
-- Migration: seed the ten builtin roles from ROLE_CAPABILITIES
--
-- Task 2 of the "data-driven roles built from areas" design
-- (docs/superpowers/specs/2026-07-29-roles-and-areas-design.md). Seeds
-- `roles` with the ten global builtins (restaurant_id IS NULL, builtin =
-- true) and their `role_areas` grants, derived mechanically and written out
-- literally (not computed) from `ROLE_CAPABILITIES`
-- (src/lib/permissions/definitions.ts:17) against the fourteen-area catalog
-- from 20260730100000. No `role_flags` rows are seeded: the three sensitive
-- flags (view:costs, view:pay_rates, view:employee_pii) are new capabilities
-- with no equivalent anywhere in today's `Capability` union, so any builtin
-- with a non-empty role_flags set would immediately fail the byte-identical
-- round trip this migration exists to satisfy. Populating flags to express
-- the cost-visibility intent (design's defect 2) is deliberately left to a
-- later task.
--
-- Derivation: an "area" bundles existing view:*/edit:* capability pairs.
-- Fourteen areas, each with a 'view' tier and a 'manage' tier (view tier
-- plus more). The mapping below was derived by exhaustively reconstructing
-- each of the ten roles' exact ROLE_CAPABILITIES set from candidate area
-- grants and iterating until every one round-tripped with zero missing and
-- zero extra capabilities in both directions — this is the same property
-- supabase/tests/roles_seed_test.sql asserts directly against this seed.
--
--   reports            view: view:dashboard, view:reports
--                       manage adds: view:ai_assistant
--   sales               view: view:pos_sales (no manage tier — no edit exists)
--   inventory           view: view:inventory
--                       manage adds: edit:inventory, view/edit:inventory_audit,
--                         view/edit:receipt_import, view/edit:inventory_transactions
--   purchasing          view: view:purchase_orders
--                       manage adds: edit:purchase_orders
--   recipes             view: view:recipes, view:prep_recipes, view:batches
--                       manage adds: edit:recipes, edit:prep_recipes, edit:batches
--   scheduling          view: view:scheduling
--                       manage adds: edit:scheduling, view/edit:tips,
--                         view/edit:time_punches
--   books               view: view:transactions, view:banking, view:expenses,
--                         view:financial_statements, view:invoices,
--                         view:customers, view:financial_intelligence,
--                         view:pending_outflows
--                       manage adds: edit:transactions, edit:banking,
--                         edit:expenses, edit:invoices, edit:customers,
--                         edit:pending_outflows
--   chart_of_accounts   view: view:chart_of_accounts
--                       manage adds: edit:chart_of_accounts
--   payroll             view: view:payroll
--                       manage adds: edit:payroll
--   employees           view: view:employees
--                       manage adds: manage:employees
--   team                view: view:team
--                       manage adds: manage:team
--   collaborators       view: view:collaborators
--                       manage adds: manage:collaborators
--   settings            view: view:settings
--                       manage adds: edit:settings
--   integrations        view: view:integrations
--                       manage adds: manage:integrations
--
-- `name` is the human-readable label from ROLE_METADATA (matching the
-- 'Owner' fixture already used in roles_schema_test.sql), not the legacy
-- machine key — Task 3's backfill maps the legacy `role` string to these
-- rows explicitly, it does not rely on name equality.
-- ============================================================================

INSERT INTO public.roles (id, restaurant_id, name, description, flavor, builtin) VALUES
  ('b0000000-0000-0000-0000-000000000001', NULL, 'Owner', 'Full access to all features', 'platform', true),
  ('b0000000-0000-0000-0000-000000000002', NULL, 'Manager', 'Manage operations and team', 'platform', true),
  ('b0000000-0000-0000-0000-000000000003', NULL, 'Operations Manager', 'Run operations, scheduling, and staffing (no accounting or admin)', 'platform', true),
  ('b0000000-0000-0000-0000-000000000004', NULL, 'Chef', 'Manage recipes and inventory', 'platform', true),
  ('b0000000-0000-0000-0000-000000000005', NULL, 'Employee (self-service)', 'Clock in/out, view their own schedule, request time off', 'platform', true),
  ('b0000000-0000-0000-0000-000000000006', NULL, 'Kiosk', 'Time clock only', 'platform', true),
  ('b0000000-0000-0000-0000-000000000007', NULL, 'Accountant', 'Financial data access for bookkeeping', 'collaborator', true),
  ('b0000000-0000-0000-0000-000000000008', NULL, 'Inventory Helper', 'Inventory and purchasing access', 'collaborator', true),
  ('b0000000-0000-0000-0000-000000000009', NULL, 'Recipe Consultant', 'Recipe development access', 'collaborator', true),
  ('b0000000-0000-0000-0000-00000000000a', NULL, 'Operations Manager (Collaborator)', 'Run scheduling, labor, tips, and inventory operations', 'collaborator', true);

-- Kiosk (b...006) has no capabilities in ROLE_CAPABILITIES at all — it
-- deliberately gets zero role_areas rows.
INSERT INTO public.role_areas (role_id, area_key, level) VALUES
  -- Owner — full access to every area, at manage level throughout (sales and
  -- reports have no manage-tier capability, so 'view'/'manage' are chosen to
  -- match the bundle that reproduces the role's exact capability set).
  ('b0000000-0000-0000-0000-000000000001', 'reports', 'manage'),
  ('b0000000-0000-0000-0000-000000000001', 'sales', 'view'),
  ('b0000000-0000-0000-0000-000000000001', 'inventory', 'manage'),
  ('b0000000-0000-0000-0000-000000000001', 'purchasing', 'manage'),
  ('b0000000-0000-0000-0000-000000000001', 'recipes', 'manage'),
  ('b0000000-0000-0000-0000-000000000001', 'scheduling', 'manage'),
  ('b0000000-0000-0000-0000-000000000001', 'books', 'manage'),
  ('b0000000-0000-0000-0000-000000000001', 'chart_of_accounts', 'manage'),
  ('b0000000-0000-0000-0000-000000000001', 'payroll', 'manage'),
  ('b0000000-0000-0000-0000-000000000001', 'employees', 'manage'),
  ('b0000000-0000-0000-0000-000000000001', 'team', 'manage'),
  ('b0000000-0000-0000-0000-000000000001', 'collaborators', 'manage'),
  ('b0000000-0000-0000-0000-000000000001', 'settings', 'manage'),
  ('b0000000-0000-0000-0000-000000000001', 'integrations', 'manage'),

  -- Manager — same as Owner except chart_of_accounts/settings/integrations
  -- are view-only (holds view:chart_of_accounts but not edit:, etc.).
  ('b0000000-0000-0000-0000-000000000002', 'reports', 'manage'),
  ('b0000000-0000-0000-0000-000000000002', 'sales', 'view'),
  ('b0000000-0000-0000-0000-000000000002', 'inventory', 'manage'),
  ('b0000000-0000-0000-0000-000000000002', 'purchasing', 'manage'),
  ('b0000000-0000-0000-0000-000000000002', 'recipes', 'manage'),
  ('b0000000-0000-0000-0000-000000000002', 'scheduling', 'manage'),
  ('b0000000-0000-0000-0000-000000000002', 'books', 'manage'),
  ('b0000000-0000-0000-0000-000000000002', 'chart_of_accounts', 'view'),
  ('b0000000-0000-0000-0000-000000000002', 'payroll', 'manage'),
  ('b0000000-0000-0000-0000-000000000002', 'employees', 'manage'),
  ('b0000000-0000-0000-0000-000000000002', 'team', 'manage'),
  ('b0000000-0000-0000-0000-000000000002', 'collaborators', 'manage'),
  ('b0000000-0000-0000-0000-000000000002', 'settings', 'view'),
  ('b0000000-0000-0000-0000-000000000002', 'integrations', 'view'),

  -- Operations Manager — all operations, no books/chart_of_accounts/
  -- collaborators/integrations at all.
  ('b0000000-0000-0000-0000-000000000003', 'reports', 'manage'),
  ('b0000000-0000-0000-0000-000000000003', 'sales', 'view'),
  ('b0000000-0000-0000-0000-000000000003', 'inventory', 'manage'),
  ('b0000000-0000-0000-0000-000000000003', 'purchasing', 'manage'),
  ('b0000000-0000-0000-0000-000000000003', 'recipes', 'manage'),
  ('b0000000-0000-0000-0000-000000000003', 'scheduling', 'manage'),
  ('b0000000-0000-0000-0000-000000000003', 'payroll', 'manage'),
  ('b0000000-0000-0000-0000-000000000003', 'employees', 'manage'),
  ('b0000000-0000-0000-0000-000000000003', 'team', 'manage'),
  ('b0000000-0000-0000-0000-000000000003', 'settings', 'view'),

  -- Chef — inventory manage, purchasing view-only (view:purchase_orders but
  -- no edit:), scheduling view-only, no payroll/team/books at all.
  ('b0000000-0000-0000-0000-000000000004', 'reports', 'view'),
  ('b0000000-0000-0000-0000-000000000004', 'sales', 'view'),
  ('b0000000-0000-0000-0000-000000000004', 'inventory', 'manage'),
  ('b0000000-0000-0000-0000-000000000004', 'purchasing', 'view'),
  ('b0000000-0000-0000-0000-000000000004', 'recipes', 'manage'),
  ('b0000000-0000-0000-0000-000000000004', 'scheduling', 'view'),
  ('b0000000-0000-0000-0000-000000000004', 'settings', 'view'),

  -- Employee (self-service) — view:settings only.
  ('b0000000-0000-0000-0000-000000000005', 'settings', 'view'),

  -- Accountant — books/chart_of_accounts manage, payroll/employees/settings
  -- view-only.
  ('b0000000-0000-0000-0000-000000000007', 'books', 'manage'),
  ('b0000000-0000-0000-0000-000000000007', 'chart_of_accounts', 'manage'),
  ('b0000000-0000-0000-0000-000000000007', 'payroll', 'view'),
  ('b0000000-0000-0000-0000-000000000007', 'employees', 'view'),
  ('b0000000-0000-0000-0000-000000000007', 'settings', 'view'),

  -- Inventory Helper — inventory/purchasing manage, settings view-only.
  ('b0000000-0000-0000-0000-000000000008', 'inventory', 'manage'),
  ('b0000000-0000-0000-0000-000000000008', 'purchasing', 'manage'),
  ('b0000000-0000-0000-0000-000000000008', 'settings', 'view'),

  -- Recipe Consultant — recipes manage, inventory view-only (ingredient
  -- context), settings view-only.
  ('b0000000-0000-0000-0000-000000000009', 'inventory', 'view'),
  ('b0000000-0000-0000-0000-000000000009', 'recipes', 'manage'),
  ('b0000000-0000-0000-0000-000000000009', 'settings', 'view'),

  -- Operations Manager (Collaborator) — mirrors internal Operations Manager
  -- minus team, with payroll/employees view-only.
  ('b0000000-0000-0000-0000-00000000000a', 'reports', 'manage'),
  ('b0000000-0000-0000-0000-00000000000a', 'sales', 'view'),
  ('b0000000-0000-0000-0000-00000000000a', 'inventory', 'manage'),
  ('b0000000-0000-0000-0000-00000000000a', 'purchasing', 'manage'),
  ('b0000000-0000-0000-0000-00000000000a', 'recipes', 'manage'),
  ('b0000000-0000-0000-0000-00000000000a', 'scheduling', 'manage'),
  ('b0000000-0000-0000-0000-00000000000a', 'payroll', 'view'),
  ('b0000000-0000-0000-0000-00000000000a', 'employees', 'view'),
  ('b0000000-0000-0000-0000-00000000000a', 'settings', 'view');
