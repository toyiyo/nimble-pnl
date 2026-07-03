-- pgTAP tests for categorization background rule application + supplier-assign semantics.
-- Spec: docs/superpowers/specs/2026-07-02-categorization-background-and-supplier-assign-design.md
--
-- Task 1 (tests a–f): supplier-assign semantics in the three bank match/apply paths.
-- These tests are written FIRST (RED phase) and cover:
--   (a) find_matching_rules_for_bank_transaction: rule with description+supplier matches
--       a supplier-less transaction and exposes supplier_id in output
--   (b) supplier-only rule does NOT match a supplier-less transaction
--   (c) supplier-only rule DOES match a transaction already linked to the supplier
--   (d) supplier + transaction_type='debit' only (no description/amount) stays FILTER:
--       does NOT match a supplier-less debit
--   (e) trigger (auto_apply_bank_categorization_rules): INSERT a bank_transactions row
--       matching a description+supplier auto_apply rule -> category_id set,
--       is_categorized=true, AND supplier_id assigned from the rule
--   (f) trigger path: INSERT a row whose transaction supplier is already set;
--       rule supplier must NOT overwrite it (COALESCE: txn supplier wins)
--
-- Task 2 (tests g–i): apply_rules_to_pos_sales_internal privilege trio + NULL-auth path
--   + public wrapper enforcement. Written RED (§4 not yet implemented).
--   (g) privilege trio:
--       - authenticated cannot EXECUTE apply_rules_to_pos_sales_internal(uuid,integer)
--       - anon cannot EXECUTE apply_rules_to_pos_sales_internal(uuid,integer)
--       - service_role CAN EXECUTE apply_rules_to_pos_sales_internal(uuid,integer)
--   (h) NULL-auth functional path:
--       with jwt.claims cleared (no auth context), seed an uncategorized unified_sales row
--       (item_name 'Sales Tax', is_categorized=false) + an active auto_apply pos_sales rule
--       (item_name_pattern 'Sales Tax', match_type 'contains'); insert the row with
--       app.skip_unified_sales_triggers='true' so the trigger doesn't pre-categorize it;
--       call apply_rules_to_pos_sales_internal(restaurant_g, 100):
--         assert applied_count=1 AND the sale row is is_categorized=true
--   (i) public wrapper still enforces membership:
--       with jwt.claims sub = a UUID NOT in user_restaurants for restaurant G:
--         assert apply_rules_to_pos_sales(restaurant_g, 10) raises
--         'Permission denied: user does not have access to apply rules for this restaurant'

BEGIN;
SELECT plan(14);

-- ============================================================
-- Setup
-- ============================================================
SET LOCAL role TO postgres;
-- Simulate NULL auth context (service-role / background caller).
-- Trigger tests that need auth context will set/clear jwt.claims individually.
SET LOCAL "request.jwt.claims" TO '';

-- Disable RLS on all touched tables so fixture INSERTs work without auth.
ALTER TABLE public.restaurants              DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.chart_of_accounts       DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.suppliers               DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.categorization_rules    DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.connected_banks         DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.bank_transactions       DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.unified_sales           DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_restaurants        DISABLE ROW LEVEL SECURITY;

-- UUID key:
-- Restaurants (one per logical test group to prevent cross-rule bleed)
--   c1a00000-...-000000000a01 = Restaurant A  (tests a)
--   c1a00000-...-000000000b01 = Restaurant B  (tests b, d)
--   c1a00000-...-000000000c01 = Restaurant C  (tests c)
--   c1a00000-...-000000000e01 = Restaurant E  (tests e, f)
--   c1a00007-...-000000000701 = Restaurant G  (tests g, h, i; uses c1a00007 prefix for group G)
-- Chart-of-accounts
--   c1a00000-...-000000000f01/0f02 = rest A  (expense + cash)
--   c1a00000-...-000000000f03      = rest B
--   c1a00000-...-000000000f04      = rest C
--   c1a00000-...-000000000f05      = rest E
--   c1a00007-...-000000000706      = rest G expense (Sales Tax category)
--   c1a00007-...-000000000707      = rest G cash account (account_code='1000')
-- Suppliers
--   c1a00000-...-000000000d01 = Supplier A (SYGMA)
--   c1a00000-...-000000000d02 = Supplier B
--   c1a00000-...-000000000d03 = Supplier C
--   c1a00000-...-000000000d04 = Supplier E
--   c1a00000-...-000000000d05 = Supplier E-other (for test f)
-- Rules
--   c1a00000-...-000000000001 = rule A (description+supplier)
--   c1a00000-...-000000000002 = rule B supplier-only
--   c1a00000-...-000000000003 = rule C supplier-only
--   c1a00000-...-000000000004 = rule B supplier+debit (no description/amount)
--   c1a00000-...-000000000005 = rule E (description+supplier)
--   c1a00007-...-000000000700 = rule G (pos_sales, item_name 'Sales Tax', auto_apply)
-- Connected banks
--   c1a00000-...-0000000000ba = bank A
--   c1a00000-...-0000000000be = bank E
-- Transactions
--   c1a00000-...-000000000101 = txn e01 (test e)
--   c1a00000-...-000000000102 = txn e02 (test f)
-- unified_sales
--   c1a00007-...-000000000201 = sale g01 (test h: uncategorized 'Sales Tax' row for internal engine)
-- Users / auth
--   c1a00007-...-0000000000aa = non-member user (NOT in user_restaurants for rest G; used in test i)

-- Restaurants
INSERT INTO public.restaurants (id, name)
VALUES
  ('c1a00000-0000-0000-0000-000000000a01', 'CAT-BG Test Restaurant A'),
  ('c1a00000-0000-0000-0000-000000000b01', 'CAT-BG Test Restaurant B'),
  ('c1a00000-0000-0000-0000-000000000c01', 'CAT-BG Test Restaurant C'),
  ('c1a00000-0000-0000-0000-000000000e01', 'CAT-BG Test Restaurant E'),
  ('c1a00007-0000-0000-0000-000000000701', 'CAT-BG Test Restaurant G')
ON CONFLICT (id) DO NOTHING;

-- Chart of accounts
INSERT INTO public.chart_of_accounts
  (id, restaurant_id, account_code, account_name, account_type, account_subtype, normal_balance)
VALUES
  ('c1a00000-0000-0000-0000-000000000f01', 'c1a00000-0000-0000-0000-000000000a01', '5100', 'Food Costs A',
   'expense', 'cost_of_goods_sold', 'debit'),
  ('c1a00000-0000-0000-0000-000000000f02', 'c1a00000-0000-0000-0000-000000000a01', '1000', 'Cash A',
   'asset', 'cash', 'debit'),
  ('c1a00000-0000-0000-0000-000000000f03', 'c1a00000-0000-0000-0000-000000000b01', '5100', 'Food Costs B',
   'expense', 'cost_of_goods_sold', 'debit'),
  ('c1a00000-0000-0000-0000-000000000f04', 'c1a00000-0000-0000-0000-000000000c01', '5100', 'Food Costs C',
   'expense', 'cost_of_goods_sold', 'debit'),
  ('c1a00000-0000-0000-0000-000000000f05', 'c1a00000-0000-0000-0000-000000000e01', '5100', 'Food Costs E',
   'expense', 'cost_of_goods_sold', 'debit'),
  -- Restaurant G: expense account (for POS rule category) + cash account (apply_rules needs '1000')
  ('c1a00007-0000-0000-0000-000000000706', 'c1a00007-0000-0000-0000-000000000701', '5200', 'Tax Expense G',
   'expense', 'cost_of_goods_sold', 'debit'),
  ('c1a00007-0000-0000-0000-000000000707', 'c1a00007-0000-0000-0000-000000000701', '1000', 'Cash G',
   'asset', 'cash', 'debit')
ON CONFLICT (id) DO NOTHING;

-- Suppliers
INSERT INTO public.suppliers (id, restaurant_id, name)
VALUES
  ('c1a00000-0000-0000-0000-000000000d01', 'c1a00000-0000-0000-0000-000000000a01', 'SYGMA Network'),
  ('c1a00000-0000-0000-0000-000000000d02', 'c1a00000-0000-0000-0000-000000000b01', 'Supplier B'),
  ('c1a00000-0000-0000-0000-000000000d03', 'c1a00000-0000-0000-0000-000000000c01', 'Supplier C'),
  ('c1a00000-0000-0000-0000-000000000d04', 'c1a00000-0000-0000-0000-000000000e01', 'Supplier E'),
  ('c1a00000-0000-0000-0000-000000000d05', 'c1a00000-0000-0000-0000-000000000e01', 'Supplier E-other')
ON CONFLICT (id) DO NOTHING;

-- Categorization rules
-- Rule A: description_pattern='SYGMA' contains + supplier_id=d01  (description+supplier)
INSERT INTO public.categorization_rules
  (id, restaurant_id, rule_name, applies_to, description_pattern, description_match_type,
   supplier_id, category_id, priority, is_active, auto_apply)
VALUES
  ('c1a00000-0000-0000-0000-000000000001',
   'c1a00000-0000-0000-0000-000000000a01',
   'SYGMA with description',
   'bank_transactions',
   'SYGMA', 'contains',
   'c1a00000-0000-0000-0000-000000000d01',
   'c1a00000-0000-0000-0000-000000000f01',
   10, true, true)
ON CONFLICT (id) DO NOTHING;

-- Rule B: supplier-only (no description/amount)
INSERT INTO public.categorization_rules
  (id, restaurant_id, rule_name, applies_to, supplier_id,
   category_id, priority, is_active, auto_apply)
VALUES
  ('c1a00000-0000-0000-0000-000000000002',
   'c1a00000-0000-0000-0000-000000000b01',
   'Supplier-only rule B',
   'bank_transactions',
   'c1a00000-0000-0000-0000-000000000d02',
   'c1a00000-0000-0000-0000-000000000f03',
   10, true, true)
ON CONFLICT (id) DO NOTHING;

-- Rule B2: supplier + transaction_type='debit' ONLY (no description/amount)
-- transaction_type alone does NOT promote supplier to an assignment.
INSERT INTO public.categorization_rules
  (id, restaurant_id, rule_name, applies_to, supplier_id, transaction_type,
   category_id, priority, is_active, auto_apply)
VALUES
  ('c1a00000-0000-0000-0000-000000000004',
   'c1a00000-0000-0000-0000-000000000b01',
   'Supplier+debit rule B (no description/amount)',
   'bank_transactions',
   'c1a00000-0000-0000-0000-000000000d02',
   'debit',
   'c1a00000-0000-0000-0000-000000000f03',
   5, true, true)
ON CONFLICT (id) DO NOTHING;

-- Rule C: supplier-only (matches pre-linked txns)
INSERT INTO public.categorization_rules
  (id, restaurant_id, rule_name, applies_to, supplier_id,
   category_id, priority, is_active, auto_apply)
VALUES
  ('c1a00000-0000-0000-0000-000000000003',
   'c1a00000-0000-0000-0000-000000000c01',
   'Supplier-only rule C',
   'bank_transactions',
   'c1a00000-0000-0000-0000-000000000d03',
   'c1a00000-0000-0000-0000-000000000f04',
   10, true, true)
ON CONFLICT (id) DO NOTHING;

-- Rule E: description+supplier (for trigger tests e, f)
INSERT INTO public.categorization_rules
  (id, restaurant_id, rule_name, applies_to, description_pattern, description_match_type,
   supplier_id, category_id, priority, is_active, auto_apply)
VALUES
  ('c1a00000-0000-0000-0000-000000000005',
   'c1a00000-0000-0000-0000-000000000e01',
   'Rule E with supplier assign',
   'bank_transactions',
   'VENDOR-E', 'contains',
   'c1a00000-0000-0000-0000-000000000d04',
   'c1a00000-0000-0000-0000-000000000f05',
   10, true, true)
ON CONFLICT (id) DO NOTHING;

-- Rule G: POS sales rule matching 'Sales Tax' in item_name (for tests h)
-- Rule ID: c1a00007-...-000000000700 (distinct from chart-of-accounts IDs 0706/0707)
INSERT INTO public.categorization_rules
  (id, restaurant_id, rule_name, applies_to, item_name_pattern, item_name_match_type,
   category_id, priority, is_active, auto_apply)
VALUES
  ('c1a00007-0000-0000-0000-000000000700',
   'c1a00007-0000-0000-0000-000000000701',
   'Sales Tax Rule G',
   'pos_sales',
   'Sales Tax', 'contains',
   'c1a00007-0000-0000-0000-000000000706',
   10, true, true)
ON CONFLICT (id) DO NOTHING;

-- Connected banks (needed for bank_transactions FK)
INSERT INTO public.connected_banks (id, restaurant_id, stripe_financial_account_id, institution_name)
VALUES
  ('c1a00000-0000-0000-0000-0000000000ba', 'c1a00000-0000-0000-0000-000000000a01', 'cbt-stripe-a', 'Test Bank A'),
  ('c1a00000-0000-0000-0000-0000000000be', 'c1a00000-0000-0000-0000-000000000e01', 'cbt-stripe-e', 'Test Bank E')
ON CONFLICT (id) DO NOTHING;

-- unified_sales row for test (h): uncategorized 'Sales Tax' row.
-- Insert with app.skip_unified_sales_triggers='true' so the auto_categorize_pos_sale
-- BEFORE INSERT trigger does NOT pre-categorize the row. The internal engine test (h)
-- then calls apply_rules_to_pos_sales_internal to categorize it.
SELECT set_config('app.skip_unified_sales_triggers', 'true', true);

INSERT INTO public.unified_sales
  (id, restaurant_id, pos_system, external_order_id, item_name,
   quantity, total_price, sale_date, is_categorized)
VALUES
  ('c1a00007-0000-0000-0000-000000000201',
   'c1a00007-0000-0000-0000-000000000701',
   'toast',
   'cat-bg-order-g01',
   'Sales Tax',
   1,
   0.75,
   CURRENT_DATE,
   false)
ON CONFLICT (id) DO NOTHING;

SELECT set_config('app.skip_unified_sales_triggers', 'false', true);

-- ============================================================
-- Test (a): find_matching_rules_for_bank_transaction
--   rule with description+supplier MATCHES supplier-less txn AND returns supplier_id
-- ============================================================
-- The updated find_matching_rules_for_bank_transaction must include a supplier_id
-- output column. The description+supplier rule must match when description matches,
-- regardless of the transaction having no supplier_id.
-- RED: will fail because the current RETURNS TABLE has no supplier_id column.

SELECT is(
  (SELECT m.supplier_id
   FROM find_matching_rules_for_bank_transaction(
     'c1a00000-0000-0000-0000-000000000a01'::uuid,
     jsonb_build_object(
       'description', 'SYGMA Network; Payment; ACME - SYGMA Network',
       'amount', -100.00,
       'supplier_id', NULL
     )
   ) m),
  'c1a00000-0000-0000-0000-000000000d01'::uuid,
  '(a) description+supplier rule matches supplier-less txn and exposes supplier_id'
);

-- ============================================================
-- Test (b): supplier-only rule does NOT match a supplier-less txn
-- ============================================================
-- supplier_id IS NOT NULL, description_pattern IS NULL, amount_min IS NULL,
-- amount_max IS NULL. transaction_type alone does not promote to assignment.
-- A transaction with supplier_id=NULL must not match this rule.
-- Restaurant B has two rules (rule B priority=10, rule B2 priority=5);
-- neither should match a supplier-less transaction.
-- RED: currently the existing NULL-comparison bug may cause NULL result (excluded row)
--      but the correct fix also returns 0 rows, so this test may pass early —
--      which is acceptable. The important RED assertion is (a) above.

SELECT is(
  (SELECT count(*)::int
   FROM find_matching_rules_for_bank_transaction(
     'c1a00000-0000-0000-0000-000000000b01'::uuid,
     jsonb_build_object(
       'description', 'anything',
       'amount', -50.00,
       'supplier_id', NULL
     )
   )
  ),
  0,
  '(b) supplier-only rule does not match supplier-less txn (returns 0 rows)'
);

-- ============================================================
-- Test (c): supplier-only rule DOES match a txn already linked to the supplier
-- ============================================================
SELECT is(
  (SELECT count(*)::int
   FROM find_matching_rules_for_bank_transaction(
     'c1a00000-0000-0000-0000-000000000c01'::uuid,
     jsonb_build_object(
       'description', 'Any description',
       'amount', -75.00,
       'supplier_id', 'c1a00000-0000-0000-0000-000000000d03'
     )
   )
  ),
  1,
  '(c) supplier-only rule matches txn already linked to that supplier'
);

-- ============================================================
-- Test (d): supplier + transaction_type='debit' ONLY stays a FILTER rule
-- ============================================================
-- Rule B2 has supplier_id and transaction_type='debit' but no description/amount.
-- transaction_type does NOT count as a "positive criterion" for assign-not-filter.
-- A supplier-less debit must NOT match.
-- Restaurant B: both rule B (supplier-only) and rule B2 (supplier+debit) present;
-- neither matches a supplier-less debit.

SELECT is(
  (SELECT count(*)::int
   FROM find_matching_rules_for_bank_transaction(
     'c1a00000-0000-0000-0000-000000000b01'::uuid,
     jsonb_build_object(
       'description', 'random debit payment',
       'amount', -25.00,
       'supplier_id', NULL
     )
   )
  ),
  0,
  '(d) supplier+transaction_type-only rule stays a FILTER -- does not match supplier-less debit'
);

-- ============================================================
-- Test (e): trigger path (auto_apply_bank_categorization_rules)
--   INSERT a bank_transactions row matching a description+supplier auto_apply rule:
--   assert category_id set, is_categorized=true, AND supplier_id assigned from rule
-- ============================================================
-- The trigger fires BEFORE INSERT. After INSERT, the row should have:
--   is_categorized = true
--   category_id = 'c1a0...0f05'  (from rule E)
--   supplier_id = 'c1a0...0d04'  (assigned from rule — assign-not-filter semantics)
-- RED: supplier_id will remain NULL because the current trigger does not set it.

INSERT INTO public.bank_transactions
  (id, restaurant_id, connected_bank_id, stripe_transaction_id,
   transaction_date, description, amount, is_categorized)
VALUES
  ('c1a00000-0000-0000-0000-000000000101',
   'c1a00000-0000-0000-0000-000000000e01',
   'c1a00000-0000-0000-0000-0000000000be',
   'cbt-stripe-txn-e01',
   CURRENT_DATE,
   'Payment to VENDOR-E Corp.',
   -200.00,
   false);

SELECT is(
  (SELECT is_categorized FROM public.bank_transactions
   WHERE id = 'c1a00000-0000-0000-0000-000000000101'),
  true,
  '(e) trigger path: is_categorized=true after INSERT matching description+supplier rule'
);

SELECT is(
  (SELECT category_id FROM public.bank_transactions
   WHERE id = 'c1a00000-0000-0000-0000-000000000101'),
  'c1a00000-0000-0000-0000-000000000f05'::uuid,
  '(e) trigger path: category_id set from rule'
);

SELECT is(
  (SELECT supplier_id FROM public.bank_transactions
   WHERE id = 'c1a00000-0000-0000-0000-000000000101'),
  'c1a00000-0000-0000-0000-000000000d04'::uuid,
  '(e) trigger path: supplier_id assigned from rule (assign-not-filter semantics)'
);

-- ============================================================
-- Test (f): trigger path — INSERT a row whose txn supplier is already set;
--   rule supplier must NOT overwrite it (COALESCE: txn supplier wins)
-- ============================================================
-- The txn's supplier_id = d05 (Supplier E-other).
-- The matching rule E has supplier_id = d04 (Supplier E).
-- After trigger fires, supplier_id must still be d05 (txn supplier wins).

INSERT INTO public.bank_transactions
  (id, restaurant_id, connected_bank_id, stripe_transaction_id,
   transaction_date, description, amount, is_categorized, supplier_id)
VALUES
  ('c1a00000-0000-0000-0000-000000000102',
   'c1a00000-0000-0000-0000-000000000e01',
   'c1a00000-0000-0000-0000-0000000000be',
   'cbt-stripe-txn-e02',
   CURRENT_DATE,
   'Invoice from VENDOR-E Corp.',
   -350.00,
   false,
   'c1a00000-0000-0000-0000-000000000d05');

SELECT is(
  (SELECT supplier_id FROM public.bank_transactions
   WHERE id = 'c1a00000-0000-0000-0000-000000000102'),
  'c1a00000-0000-0000-0000-000000000d05'::uuid,
  '(f) trigger path: pre-existing txn supplier_id is NOT overwritten by rule supplier'
);

-- ============================================================
-- Tests (g): privilege trio for apply_rules_to_pos_sales_internal(uuid,integer)
-- ============================================================
-- RED: the function does not exist yet — has_function_privilege returns false
-- for all three (function not found = no privilege).
-- After §4 lands: authenticated/anon = false (REVOKE), service_role = true (GRANT).
--
-- Note: has_function_privilege with a role that has no privilege on a non-existent
-- function raises an error. We use the two-argument form which returns false if the
-- function is not found (on Postgres 14+). We wrap in an ok(...) so missing function
-- fails the assertion rather than aborting the transaction.

SELECT ok(
  NOT has_function_privilege('authenticated', 'apply_rules_to_pos_sales_internal(uuid,integer)', 'EXECUTE'),
  '(g) authenticated cannot EXECUTE apply_rules_to_pos_sales_internal'
);

SELECT ok(
  NOT has_function_privilege('anon', 'apply_rules_to_pos_sales_internal(uuid,integer)', 'EXECUTE'),
  '(g) anon cannot EXECUTE apply_rules_to_pos_sales_internal'
);

SELECT ok(
  has_function_privilege('service_role', 'apply_rules_to_pos_sales_internal(uuid,integer)', 'EXECUTE'),
  '(g) service_role can EXECUTE apply_rules_to_pos_sales_internal'
);

-- ============================================================
-- Test (h): NULL-auth functional path for apply_rules_to_pos_sales_internal
-- ============================================================
-- Clear JWT claims so auth.uid() returns NULL (simulates background/service-role call).
-- Verify the internal engine categorizes the uncategorized 'Sales Tax' row inserted above.
-- RED: function does not exist yet.

SET LOCAL "request.jwt.claims" TO '';

SELECT is(
  (SELECT applied_count
   FROM apply_rules_to_pos_sales_internal(
     'c1a00007-0000-0000-0000-000000000701'::uuid,
     100
   )),
  1,
  '(h) internal POS engine applied_count=1 with NULL auth context'
);

SELECT is(
  (SELECT is_categorized
   FROM public.unified_sales
   WHERE id = 'c1a00007-0000-0000-0000-000000000201'),
  true,
  '(h) sale row is_categorized=true after internal engine call'
);

-- ============================================================
-- Test (i): public wrapper apply_rules_to_pos_sales still enforces membership
-- ============================================================
-- Set JWT claims to a UUID that has no user_restaurants row for restaurant G.
-- The public wrapper must raise 'Permission denied...' for non-members.
-- Note: c1a0...aa01 is deliberately NOT inserted into user_restaurants for rest G.

SET LOCAL "request.jwt.claims" TO '{"sub": "c1a00007-0000-0000-0000-0000000000aa"}';

SELECT throws_ok(
  $$SELECT * FROM apply_rules_to_pos_sales('c1a00007-0000-0000-0000-000000000701'::uuid, 10)$$,
  'Permission denied: user does not have access to apply rules for this restaurant',
  '(i) public POS wrapper raises permission denied for non-member sub'
);

-- Reset JWT claims to NULL (clean up for any subsequent tests)
SET LOCAL "request.jwt.claims" TO '';

SELECT * FROM finish();
ROLLBACK;
