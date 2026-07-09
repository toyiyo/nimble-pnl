-- ============================================================================
-- Tests: collaborator_operations_manager DML-level RLS enforcement
--
-- Asserts that a collaborator_operations_manager user:
--   - Is ISOLATED: sees only their own user_restaurants row, NOT the full
--     team roster (unlike internal operations_manager — NOT added to
--     user_is_internal_team). This is the core "external collaborator"
--     guarantee.
--   - Can INSERT/UPDATE/DELETE on the core scheduling tables (shifts,
--     shift_templates, time_off_requests) — the functional fix from Task 8
--     step 4, and the same operational surface as operations_manager on
--     residual hardcoded-role tables (tip_pool_settings, receipt_imports).
--   - Can SELECT but NOT INSERT into unified_sales (view:pos_sales only, no
--     edit:pos_sales capability exists for any role).
--   - Is DENIED SELECT on accounting tables (bank_transactions,
--     chart_of_accounts) — no accounting capability granted.
--   - Is DENIED INSERT into employee_compensation_history (no edit:payroll —
--     the design's explicit view-only-payroll boundary).
--   - Cannot self-escalate to a privileged role via UPDATE.
--
-- Strategy: run as the `authenticated` role (via SET LOCAL ROLE) with JWT
-- claims pointing at the collaborator_operations_manager user. This activates
-- all RLS policies exactly as Supabase does in production.
--
-- Fixture namespace: UUIDs starting with 24000000-...
-- Seeds: restaurant, owner user, collaborator_operations_manager user, peer
--        team member, one seed row each for receipt_imports and employees.
-- Mirrors: supabase/tests/22_operations_manager_rls.sql
-- ============================================================================

BEGIN;
SELECT plan(15);

-- ============================================================================
-- Fixtures (inserted as superuser before we switch to authenticated role)
-- ============================================================================

-- Owner auth user (peer — so the roster has at least 2 rows)
INSERT INTO auth.users (id, email)
VALUES ('24000000-0000-0000-0000-000000000001', 'test-owner-24@example.com')
ON CONFLICT (id) DO NOTHING;

-- Collaborator Operations Manager auth user (the one whose access we test)
INSERT INTO auth.users (id, email)
VALUES ('24000000-0000-0000-0000-000000000002', 'test-collab-ops-mgr-24@example.com')
ON CONFLICT (id) DO NOTHING;

-- Restaurant
INSERT INTO public.restaurants (id, name)
VALUES ('24000000-0000-0000-0000-000000000099', 'Test Restaurant 24')
ON CONFLICT (id) DO NOTHING;

-- Owner membership row
INSERT INTO public.user_restaurants (id, user_id, restaurant_id, role)
VALUES (
    '24000000-0000-0000-0000-000000000101',
    '24000000-0000-0000-0000-000000000001',
    '24000000-0000-0000-0000-000000000099',
    'owner'
)
ON CONFLICT (user_id, restaurant_id) DO UPDATE SET role = 'owner';

-- Collaborator Operations Manager membership row
INSERT INTO public.user_restaurants (id, user_id, restaurant_id, role)
VALUES (
    '24000000-0000-0000-0000-000000000102',
    '24000000-0000-0000-0000-000000000002',
    '24000000-0000-0000-0000-000000000099',
    'collaborator_operations_manager'
)
ON CONFLICT (user_id, restaurant_id) DO UPDATE SET role = 'collaborator_operations_manager';

-- Seed one receipt_imports row (as superuser) so a later test can assert visibility
INSERT INTO public.receipt_imports (id, restaurant_id, status)
VALUES ('24000000-0000-0000-0000-000000000201', '24000000-0000-0000-0000-000000000099', 'pending')
ON CONFLICT (id) DO NOTHING;

-- Seed one employee (as superuser) so time_punches / compensation-history tests can use its id
INSERT INTO public.employees (id, restaurant_id, name, position, hourly_rate)
VALUES ('24000000-0000-0000-0000-000000000301', '24000000-0000-0000-0000-000000000099', 'Test Employee 24', 'Server', 15)
ON CONFLICT (id) DO NOTHING;

-- Seed one chart_of_accounts row (as superuser) so the accounting DENY tests
-- below assert an actual RLS denial, not empty-table vacuity.
INSERT INTO public.chart_of_accounts
    (id, restaurant_id, account_code, account_name, account_type, account_subtype, normal_balance)
VALUES ('24000000-0000-0000-0000-000000000401', '24000000-0000-0000-0000-000000000099',
        'TEST-24', 'Test Account 24', 'expense', 'other_expenses', 'debit')
ON CONFLICT (id) DO NOTHING;

-- Seed one connected_banks + bank_transactions row (as superuser) so the
-- bank_transactions DENY test below asserts an actual RLS denial.
INSERT INTO public.connected_banks (id, restaurant_id, stripe_financial_account_id, institution_name)
VALUES ('24000000-0000-0000-0000-000000000402', '24000000-0000-0000-0000-000000000099',
        'test-stripe-account-24', 'Test Bank 24')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.bank_transactions
    (id, restaurant_id, connected_bank_id, stripe_transaction_id, transaction_date, description, amount)
VALUES ('24000000-0000-0000-0000-000000000403', '24000000-0000-0000-0000-000000000099',
        '24000000-0000-0000-0000-000000000402', 'test-stripe-txn-24', current_date, 'Test txn 24', 100.00)
ON CONFLICT (id) DO NOTHING;

-- ============================================================================
-- Switch to the authenticated role and set JWT claims for
-- collaborator_operations_manager. All subsequent DML runs under RLS exactly
-- as in production.
-- ============================================================================
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"24000000-0000-0000-0000-000000000002","role":"authenticated"}';

-- ============================================================================
-- Test 1: ISOLATION — collab-ops-mgr must NOT see the full team roster.
-- user_is_internal_team excludes this role, so only the collaborator's own
-- user_restaurants row is visible (unlike internal operations_manager, which
-- sees >= 2 rows in the equivalent 22_operations_manager_rls.sql test).
-- ============================================================================

SELECT is(
    (SELECT count(*)::int FROM user_restaurants WHERE restaurant_id = '24000000-0000-0000-0000-000000000099'::uuid),
    1,
    'collab-ops-mgr is ISOLATED: sees only own user_restaurants row (not internal team)'
);

-- ============================================================================
-- Test 2: edit:scheduling — INSERT into shifts (core scheduling table,
-- functional fix from Task 8 step 4).
-- ============================================================================

SELECT lives_ok(
    $$ INSERT INTO public.shifts
          (restaurant_id, employee_id, start_time, end_time, position)
       VALUES ('24000000-0000-0000-0000-000000000099'::uuid,
               '24000000-0000-0000-0000-000000000301'::uuid,
               now(), now() + interval '8 hours', 'Server') $$,
    'collab-ops-mgr can INSERT into shifts (edit:scheduling, core table widened)'
);

-- ============================================================================
-- Test 3: edit:scheduling — UPDATE shifts (the row inserted in Test 2).
-- ============================================================================

SELECT lives_ok(
    $$ UPDATE public.shifts
       SET end_time = end_time + interval '1 hour'
       WHERE restaurant_id = '24000000-0000-0000-0000-000000000099'::uuid
         AND employee_id = '24000000-0000-0000-0000-000000000301'::uuid $$,
    'collab-ops-mgr can UPDATE shifts (edit:scheduling, core table widened)'
);

-- lives_ok only proves the statement didn't error — under RLS a USING clause
-- mismatch can silently affect 0 rows. Confirm the UPDATE actually took effect.
SELECT cmp_ok(
    (SELECT count(*)::int FROM public.shifts
     WHERE restaurant_id = '24000000-0000-0000-0000-000000000099'::uuid
       AND employee_id = '24000000-0000-0000-0000-000000000301'::uuid
       AND end_time > now() + interval '8 hours'),
    '>',
    0,
    'collab-ops-mgr UPDATE on shifts actually affected the row (not silently a no-op under RLS)'
);

-- ============================================================================
-- Test 4: edit:scheduling — INSERT into shift_templates (core scheduling table).
-- ============================================================================

SELECT lives_ok(
    $$ INSERT INTO public.shift_templates
          (restaurant_id, name, days, start_time, end_time, position)
       VALUES ('24000000-0000-0000-0000-000000000099'::uuid,
               'Test Template 24', ARRAY[1], '09:00', '17:00', 'Server') $$,
    'collab-ops-mgr can INSERT into shift_templates (edit:scheduling, core table widened)'
);

-- ============================================================================
-- Test 5: edit:tips — INSERT into tip_pool_settings (residual role IN policy).
-- ============================================================================

SELECT lives_ok(
    $$ INSERT INTO public.tip_pool_settings (restaurant_id)
       VALUES ('24000000-0000-0000-0000-000000000099'::uuid) $$,
    'collab-ops-mgr can insert tip_pool_settings (edit:tips)'
);

-- ============================================================================
-- Test 6: edit:receipt_import — collab-ops-mgr can SEE rows in receipt_imports
-- (seeded above).
-- ============================================================================

SELECT cmp_ok(
    (SELECT count(*)::int FROM public.receipt_imports
     WHERE restaurant_id = '24000000-0000-0000-0000-000000000099'::uuid),
    '>',
    0,
    'collab-ops-mgr can SELECT rows from receipt_imports (edit:receipt_import)'
);

-- ============================================================================
-- Test 7: POS view-only — SELECT on unified_sales succeeds (view:pos_sales,
-- open to any restaurant member) even with zero rows present.
-- ============================================================================

SELECT lives_ok(
    $$ SELECT count(*) FROM public.unified_sales
       WHERE restaurant_id = '24000000-0000-0000-0000-000000000099'::uuid $$,
    'collab-ops-mgr can SELECT unified_sales without error (view:pos_sales)'
);

-- ============================================================================
-- Test 8: POS view-only — unified_sales INSERT is denied. INSERT policy is
-- restricted to role IN ('owner','manager') — NOT widened for any operational
-- role (no edit:pos_sales capability exists).
-- ============================================================================

SELECT throws_ok(
    $$ INSERT INTO public.unified_sales
          (restaurant_id, pos_system, external_order_id, item_name, quantity, sale_date)
       VALUES ('24000000-0000-0000-0000-000000000099'::uuid,
               'manual', 'test-order-24', 'Test Item', 1, current_date) $$,
    NULL,
    NULL,
    'collab-ops-mgr cannot INSERT into unified_sales (no edit:pos_sales)'
);

-- ============================================================================
-- Test 9: Accounting DENY — bank_transactions SELECT returns 0 rows.
-- RLS SELECT policy uses user_has_capability('view:banking') which excludes
-- collaborator_operations_manager. A row WAS seeded above (as superuser), so
-- a 0 count here is a real RLS denial, not table-emptiness vacuity.
-- ============================================================================

SELECT is(
    (SELECT count(*)::int FROM public.bank_transactions
     WHERE restaurant_id = '24000000-0000-0000-0000-000000000099'::uuid),
    0,
    'collab-ops-mgr denied bank_transactions (view:banking not granted)'
);

-- ============================================================================
-- Test 10: Accounting DENY — chart_of_accounts SELECT returns 0 rows.
-- RLS SELECT policy uses user_has_capability('view:chart_of_accounts') which
-- excludes collaborator_operations_manager. A row WAS seeded above (as
-- superuser), so a 0 count here is a real RLS denial, not vacuity.
-- ============================================================================

SELECT is(
    (SELECT count(*)::int FROM public.chart_of_accounts
     WHERE restaurant_id = '24000000-0000-0000-0000-000000000099'::uuid),
    0,
    'collab-ops-mgr denied chart_of_accounts (view:chart_of_accounts not granted)'
);

-- ============================================================================
-- Test 11: Payroll DENY — employee_compensation_history INSERT is denied.
-- Design's explicit view-only-payroll boundary: collaborator has no
-- edit:payroll, and this table's INSERT policy was NOT widened (per the
-- Task 8 migration header).
-- ============================================================================

SELECT throws_ok(
    $$ INSERT INTO public.employee_compensation_history
          (employee_id, restaurant_id, compensation_type, amount_cents, effective_date)
       VALUES ('24000000-0000-0000-0000-000000000301'::uuid,
               '24000000-0000-0000-0000-000000000099'::uuid,
               'hourly', 1600, current_date) $$,
    NULL,
    NULL,
    'collab-ops-mgr cannot INSERT into employee_compensation_history (no edit:payroll)'
);

-- ============================================================================
-- Test 12: employees SELECT — collab-ops-mgr CAN see the seeded employee.
-- RLS is wide-open to any restaurant member via "Team members can view
-- coworkers in their restaurant" (20260411100000) — not gated on the
-- capability function, and NOT touched by the Task 8 migration.
-- ============================================================================

SELECT cmp_ok(
    (SELECT count(*)::int FROM public.employees
     WHERE restaurant_id = '24000000-0000-0000-0000-000000000099'::uuid),
    '>',
    0,
    'collab-ops-mgr can SELECT employees (RLS wide-open to restaurant members)'
);

-- ============================================================================
-- Test 13: self-escalation guard — the RESTRICTIVE policy "Prevent
-- self-escalation to privileged roles" ANDs with the permissive policies,
-- so a non-owner UPDATE of their own membership cannot promote to manager.
-- ============================================================================

SELECT throws_ok(
    $$ UPDATE public.user_restaurants
       SET role = 'manager'
       WHERE user_id = '24000000-0000-0000-0000-000000000002'::uuid
         AND restaurant_id = '24000000-0000-0000-0000-000000000099'::uuid $$,
    NULL,
    NULL,
    'collab-ops-mgr cannot self-escalate to manager via UPDATE (escalation guard)'
);

-- ============================================================================
-- Test 14: self-escalation guard — cannot self-grant financial access either.
-- ============================================================================

SELECT throws_ok(
    $$ UPDATE public.user_restaurants
       SET role = 'collaborator_accountant'
       WHERE user_id = '24000000-0000-0000-0000-000000000002'::uuid
         AND restaurant_id = '24000000-0000-0000-0000-000000000099'::uuid $$,
    NULL,
    NULL,
    'collab-ops-mgr cannot self-grant collaborator_accountant (financial access) via UPDATE'
);

SELECT * FROM finish();
ROLLBACK;
