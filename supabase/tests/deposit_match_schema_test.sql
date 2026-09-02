BEGIN;
SELECT plan(21);

-- Tables exist.
SELECT has_table('public', 'deposit_match_rules', 'deposit_match_rules table should exist');
SELECT has_table('public', 'deposit_match_items', 'deposit_match_items table should exist');
SELECT has_table('public', 'deposit_match_links', 'deposit_match_links table should exist');

-- deposit_match_rules columns.
SELECT has_column('public', 'deposit_match_rules', 'restaurant_id', 'rules has restaurant_id');
SELECT has_column('public', 'deposit_match_rules', 'pos_source', 'rules has pos_source');
SELECT has_column('public', 'deposit_match_rules', 'rail', 'rules has rail');
SELECT has_column('public', 'deposit_match_rules', 'connected_bank_id', 'rules has connected_bank_id');
SELECT has_unique('public', 'deposit_match_rules', 'rules has a unique constraint');

-- deposit_match_items columns.
SELECT has_column('public', 'deposit_match_items', 'restaurant_id', 'items has restaurant_id');
SELECT has_column('public', 'deposit_match_items', 'rule_id', 'items has rule_id');
SELECT has_column('public', 'deposit_match_items', 'business_date', 'items has business_date');
SELECT has_column('public', 'deposit_match_items', 'status', 'items has status');
SELECT has_column('public', 'deposit_match_items', 'resolution', 'items has resolution');
SELECT has_unique('public', 'deposit_match_items', 'items has a unique constraint');

-- deposit_match_links columns.
SELECT has_column('public', 'deposit_match_links', 'item_id', 'links has item_id');
SELECT has_column('public', 'deposit_match_links', 'bank_transaction_id', 'links has bank_transaction_id');
SELECT has_column('public', 'deposit_match_links', 'allocated_amount', 'links has allocated_amount');
SELECT has_column('public', 'deposit_match_links', 'state', 'links has state');
SELECT has_unique('public', 'deposit_match_links', 'links has a unique constraint');

-- Named indexes from the plan: (restaurant_id, business_date) on items,
-- (bank_transaction_id, state) on links.
SELECT is(
  (SELECT array_agg(a.attname::text ORDER BY k.n)
   FROM pg_index i
   JOIN unnest(i.indkey) WITH ORDINALITY AS k(attnum, n) ON true
   JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum
   WHERE i.indexrelid = 'public.deposit_match_items_rid_date_idx'::regclass),
  ARRAY['restaurant_id', 'business_date'],
  'deposit_match_items_rid_date_idx covers (restaurant_id, business_date) in order'
);

SELECT is(
  (SELECT array_agg(a.attname::text ORDER BY k.n)
   FROM pg_index i
   JOIN unnest(i.indkey) WITH ORDINALITY AS k(attnum, n) ON true
   JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum
   WHERE i.indexrelid = 'public.deposit_match_links_txn_state_idx'::regclass),
  ARRAY['bank_transaction_id', 'state'],
  'deposit_match_links_txn_state_idx covers (bank_transaction_id, state) in order'
);

SELECT * FROM finish();
ROLLBACK;
