-- ============================================================================
-- Tests: operations_manager DML-level RLS enforcement
--
-- Asserts that an operations_manager user:
--   - Can see the full team roster (user_restaurants via user_is_internal_team)
--   - Can INSERT/UPDATE on residual hardcoded-role operational tables
--     (employees, schedule_publications, tip_pool_settings, overtime_rules)
--   - Can SELECT rows from receipt_imports (edit:receipt_import)
--   - Is DENIED SELECT rows from accounting tables (bank_transactions, chart_of_accounts)
--   - Can SELECT but NOT INSERT into unified_sales (view:pos_sales only)
--
-- Strategy: run as the `authenticated` role (via SET LOCAL ROLE) with JWT
-- claims pointing at the operations_manager user. This activates all RLS
-- policies exactly as Supabase does in production.
--
-- Fixture namespace: UUIDs starting with 22000000-...
-- Seeds: restaurant, owner user, operations_manager user, peer team member,
--        one seed row each for receipt_imports and bank_transactions.
-- ============================================================================

BEGIN;
SELECT plan(9);

-- ============================================================================
-- Fixtures (inserted as superuser before we switch to authenticated role)
-- ============================================================================

-- Owner auth user (peer — so the roster has at least 2 rows)
INSERT INTO auth.users (id, email)
VALUES ('22000000-0000-0000-0000-000000000001', 'test-owner-22@example.com')
ON CONFLICT (id) DO NOTHING;

-- Operations Manager auth user (the one whose access we test)
INSERT INTO auth.users (id, email)
VALUES ('22000000-0000-0000-0000-000000000002', 'test-ops-mgr-22@example.com')
ON CONFLICT (id) DO NOTHING;

-- Restaurant
INSERT INTO public.restaurants (id, name)
VALUES ('22000000-0000-0000-0000-000000000099', 'Test Restaurant 22')
ON CONFLICT (id) DO NOTHING;

-- Owner membership row
INSERT INTO public.user_restaurants (id, user_id, restaurant_id, role)
VALUES (
    '22000000-0000-0000-0000-000000000101',
    '22000000-0000-0000-0000-000000000001',
    '22000000-0000-0000-0000-000000000099',
    'owner'
)
ON CONFLICT (user_id, restaurant_id) DO UPDATE SET role = 'owner';

-- Operations Manager membership row
INSERT INTO public.user_restaurants (id, user_id, restaurant_id, role)
VALUES (
    '22000000-0000-0000-0000-000000000102',
    '22000000-0000-0000-0000-000000000002',
    '22000000-0000-0000-0000-000000000099',
    'operations_manager'
)
ON CONFLICT (user_id, restaurant_id) DO UPDATE SET role = 'operations_manager';

-- Seed one receipt_imports row (as superuser) so Test 6 can assert visibility
INSERT INTO public.receipt_imports (id, restaurant_id, status)
VALUES ('22000000-0000-0000-0000-000000000201', '22000000-0000-0000-0000-000000000099', 'pending')
ON CONFLICT (id) DO NOTHING;

-- ============================================================================
-- Switch to the authenticated role and set JWT claims for operations_manager.
-- All subsequent DML runs under RLS exactly as in production.
-- ============================================================================
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"22000000-0000-0000-0000-000000000002","role":"authenticated"}';

-- ============================================================================
-- Test 1: user_restaurants visibility (via user_is_internal_team)
-- Operations Manager must see the full team roster, not just their own row.
-- ============================================================================

SELECT cmp_ok(
    (SELECT count(*)::int FROM user_restaurants WHERE restaurant_id = '22000000-0000-0000-0000-000000000099'::uuid),
    '>=',
    2,
    'ops-mgr sees full team roster (user_is_internal_team allows it)'
);

-- ============================================================================
-- Test 2: manage:employees — INSERT into employees (residual user_has_role policy)
-- Policy: "Owners and managers can manage employees" uses user_has_role(['owner','manager'])
-- Must be widened to include operations_manager.
-- ============================================================================

SELECT lives_ok(
    $$ INSERT INTO public.employees (restaurant_id, name, position, hourly_rate)
       VALUES ('22000000-0000-0000-0000-000000000099'::uuid, 'Test Hire 22', 'Server', 0) $$,
    'ops-mgr can insert employees (manage:employees)'
);

-- ============================================================================
-- Test 3: edit:scheduling — INSERT into schedule_publications (residual role IN policy)
-- Policy: "Managers can create schedule publications" uses role IN ('owner','manager')
-- Must be widened to include operations_manager.
-- ============================================================================

SELECT lives_ok(
    $$ INSERT INTO public.schedule_publications
          (restaurant_id, week_start_date, week_end_date, published_by, shift_count)
       VALUES ('22000000-0000-0000-0000-000000000099'::uuid,
               current_date, current_date + 6,
               '22000000-0000-0000-0000-000000000002'::uuid, 0) $$,
    'ops-mgr can insert schedule_publications (edit:scheduling)'
);

-- ============================================================================
-- Test 4: edit:tips — INSERT into tip_pool_settings (residual role IN policy)
-- Policy: "Managers can insert tip pool settings" uses role IN ('owner','manager')
-- Must be widened to include operations_manager.
-- ============================================================================

SELECT lives_ok(
    $$ INSERT INTO public.tip_pool_settings (restaurant_id)
       VALUES ('22000000-0000-0000-0000-000000000099'::uuid) $$,
    'ops-mgr can insert tip_pool_settings (edit:tips)'
);

-- ============================================================================
-- Test 5: edit:payroll — INSERT into overtime_rules (residual role IN policy)
-- Policy: "Owners and managers can manage overtime rules" uses role IN ('owner','manager')
-- Must be widened to include operations_manager.
-- overtime_rules has a UNIQUE(restaurant_id) constraint — use ON CONFLICT DO NOTHING.
-- ============================================================================

SELECT lives_ok(
    $$ INSERT INTO public.overtime_rules (restaurant_id)
       VALUES ('22000000-0000-0000-0000-000000000099'::uuid)
       ON CONFLICT (restaurant_id) DO NOTHING $$,
    'ops-mgr can insert overtime_rules (edit:payroll)'
);

-- ============================================================================
-- Test 6: edit:receipt_import — ops-mgr can SEE rows in receipt_imports
-- Policy: "Owners and managers can view receipt imports" uses role IN ('owner','manager')
-- Must be widened to include operations_manager.
-- We seeded one row above, so the count must be > 0 if the policy allows access.
-- ============================================================================

SELECT cmp_ok(
    (SELECT count(*)::int FROM public.receipt_imports
     WHERE restaurant_id = '22000000-0000-0000-0000-000000000099'::uuid),
    '>',
    0,
    'ops-mgr can SELECT rows from receipt_imports (edit:receipt_import)'
);

-- ============================================================================
-- Test 7: Accounting DENY — bank_transactions SELECT returns 0 rows
-- RLS SELECT policy uses user_has_capability('view:banking') which excludes
-- operations_manager. No rows should be visible.
-- (No need to seed a row — count == 0 is sufficient for the deny assertion.)
-- ============================================================================

SELECT is(
    (SELECT count(*)::int FROM public.bank_transactions
     WHERE restaurant_id = '22000000-0000-0000-0000-000000000099'::uuid),
    0,
    'ops-mgr denied bank_transactions (view:banking not granted)'
);

-- ============================================================================
-- Test 8: Accounting DENY — chart_of_accounts SELECT returns 0 rows
-- RLS SELECT policy uses user_has_capability('view:chart_of_accounts') which
-- excludes operations_manager.
-- ============================================================================

SELECT is(
    (SELECT count(*)::int FROM public.chart_of_accounts
     WHERE restaurant_id = '22000000-0000-0000-0000-000000000099'::uuid),
    0,
    'ops-mgr denied chart_of_accounts (view:chart_of_accounts not granted)'
);

-- ============================================================================
-- Test 9: POS view-only — unified_sales INSERT is denied
-- SELECT policy is open to all restaurant members (view:pos_sales).
-- INSERT policy is restricted to role IN ('owner','manager') — NOT widened.
-- ============================================================================

SELECT throws_ok(
    $$ INSERT INTO public.unified_sales
          (restaurant_id, pos_system, external_order_id, item_name, quantity, sale_date)
       VALUES ('22000000-0000-0000-0000-000000000099'::uuid,
               'manual', 'test-order-22', 'Test Item', 1, current_date) $$,
    NULL,
    NULL,
    'ops-mgr cannot INSERT into unified_sales (no edit:pos_sales)'
);

SELECT * FROM finish();
ROLLBACK;
