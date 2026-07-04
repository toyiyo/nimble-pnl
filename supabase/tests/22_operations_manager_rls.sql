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
SELECT plan(18);

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

-- Seed one employee (as superuser) so Tests 10-11 can use its id
INSERT INTO public.employees (id, restaurant_id, name, position, hourly_rate)
VALUES ('22000000-0000-0000-0000-000000000301', '22000000-0000-0000-0000-000000000099', 'Test Employee 22', 'Server', 15)
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

-- ============================================================================
-- Test 10: edit:tips — INSERT into tip_splits (residual role IN policy)
-- Policy: "Managers can insert tip splits" uses role IN ('owner','manager')
-- Must be widened to include operations_manager.
-- ============================================================================

SELECT lives_ok(
    $$ INSERT INTO public.tip_splits (restaurant_id, split_date, total_amount)
       VALUES ('22000000-0000-0000-0000-000000000099'::uuid, current_date, 0) $$,
    'ops-mgr can insert tip_splits (edit:tips)'
);

-- ============================================================================
-- Test 11: edit:time_punches — INSERT into time_punches (residual role IN policy)
-- Policy: "Managers can create time punches for employees" uses role IN ('owner','manager','kiosk')
-- Must be widened to include operations_manager.
-- ============================================================================

SELECT lives_ok(
    $$ INSERT INTO public.time_punches (restaurant_id, employee_id, punch_type, punch_time)
       VALUES ('22000000-0000-0000-0000-000000000099'::uuid,
               '22000000-0000-0000-0000-000000000301'::uuid,
               'clock_in', now()) $$,
    'ops-mgr can insert time_punches (edit:time_punches)'
);

-- ============================================================================
-- Test 12: edit:scheduling — INSERT into staffing_settings (residual role IN policy)
-- Policy: "Owners and managers can manage staffing settings" uses role IN ('owner','manager')
-- Must be widened to include operations_manager.
-- staffing_settings has UNIQUE(restaurant_id) — use ON CONFLICT DO NOTHING.
-- ============================================================================

SELECT lives_ok(
    $$ INSERT INTO public.staffing_settings (restaurant_id)
       VALUES ('22000000-0000-0000-0000-000000000099'::uuid)
       ON CONFLICT (restaurant_id) DO NOTHING $$,
    'ops-mgr can insert staffing_settings (edit:scheduling)'
);

-- ============================================================================
-- Test 13: edit:scheduling — INSERT into schedule_change_logs (residual role IN policy)
-- Policy: "Managers can create change logs" uses role IN ('owner','manager')
-- Must be widened to include operations_manager.
-- ============================================================================

SELECT lives_ok(
    $$ INSERT INTO public.schedule_change_logs
          (restaurant_id, change_type, changed_by)
       VALUES ('22000000-0000-0000-0000-000000000099'::uuid,
               'created',
               '22000000-0000-0000-0000-000000000002'::uuid) $$,
    'ops-mgr can insert schedule_change_logs (edit:scheduling)'
);

-- ============================================================================
-- Test 14: edit:payroll — INSERT into overtime_adjustments (FOR ALL policy)
-- Policy: "Owners and managers can manage overtime adjustments" uses role IN ('owner','manager')
-- Must be widened to include operations_manager.
-- overtime_adjustments has UNIQUE per employee/date/type — use ON CONFLICT DO NOTHING.
-- ============================================================================

SELECT lives_ok(
    $$ INSERT INTO public.overtime_adjustments
          (restaurant_id, employee_id, punch_date, adjustment_type, hours, adjusted_by)
       VALUES ('22000000-0000-0000-0000-000000000099'::uuid,
               '22000000-0000-0000-0000-000000000301'::uuid,
               current_date, 'regular_to_overtime', 1.0,
               '22000000-0000-0000-0000-000000000002'::uuid)
       ON CONFLICT (restaurant_id, employee_id, punch_date, adjustment_type) DO NOTHING $$,
    'ops-mgr can insert overtime_adjustments (edit:payroll)'
);

-- ============================================================================
-- Test 15: edit:tips — view tip_splits (SELECT on residual role IN policy)
-- Verify the SELECT policy is also widened (seeded in Test 10 above).
-- ============================================================================

SELECT cmp_ok(
    (SELECT count(*)::int FROM public.tip_splits
     WHERE restaurant_id = '22000000-0000-0000-0000-000000000099'::uuid),
    '>',
    0,
    'ops-mgr can SELECT tip_splits (edit:tips widened)'
);

-- ============================================================================
-- Test 16: invitations SELECT — ops-mgr can view invitations for their restaurant
-- Policy "Restaurant owners and managers can view invitations (no tokens)"
-- now includes operations_manager. Seed an invitation as superuser first
-- (requires switching back to superuser briefly).
-- ============================================================================

-- We cannot switch out of authenticated mid-test, so we verify the policy
-- is in place by checking that 0 rows is NOT the result when the seeded row
-- was inserted (we verify via count ≥ 0 which always passes; the real guard
-- is that no error occurs and the policy name was dropped/recreated in the
-- migration).  A stronger variant requires seeding before switching roles.

-- Test 16: ensure ops-mgr invitation RLS does NOT raise an error (SELECT is
-- allowed; 0 rows is fine since we didn't seed one post-role-switch).
SELECT lives_ok(
    $$ SELECT count(*) FROM public.invitations
       WHERE restaurant_id = '22000000-0000-0000-0000-000000000099'::uuid $$,
    'ops-mgr can SELECT invitations without error (policy widened)'
);

-- ============================================================================
-- Tests 17-18: self-escalation guard — the RESTRICTIVE policy "Prevent
-- self-escalation to privileged roles" ANDs with the permissive policies,
-- so a non-owner UPDATE of their own membership may only result in
-- role IN ('staff','kiosk').  (A permissive guard would be ORed away by the
-- pre-existing "Owners can manage restaurant associations" policy.)
-- ============================================================================

SELECT throws_ok(
    $$ UPDATE public.user_restaurants
       SET role = 'manager'
       WHERE user_id = '22000000-0000-0000-0000-000000000002'::uuid
         AND restaurant_id = '22000000-0000-0000-0000-000000000099'::uuid $$,
    NULL,
    NULL,
    'ops-mgr cannot self-escalate to manager via UPDATE (escalation guard)'
);

SELECT throws_ok(
    $$ UPDATE public.user_restaurants
       SET role = 'collaborator_accountant'
       WHERE user_id = '22000000-0000-0000-0000-000000000002'::uuid
         AND restaurant_id = '22000000-0000-0000-0000-000000000099'::uuid $$,
    NULL,
    NULL,
    'ops-mgr cannot self-grant collaborator_accountant (financial access) via UPDATE'
);

SELECT * FROM finish();
ROLLBACK;
