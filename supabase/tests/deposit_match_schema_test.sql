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
-- has_unique only checks that some unique constraint exists — it does not
-- inspect which columns it covers, so a materially different replacement
-- key would still pass. Assert the exact composite instead.
SELECT is(
  (SELECT array_agg(a.attname::text ORDER BY k.ord)
   FROM pg_constraint c
   JOIN LATERAL unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord) ON true
   JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
   WHERE c.conrelid = 'public.deposit_match_rules'::regclass AND c.contype = 'u'
   GROUP BY c.oid),
  ARRAY['restaurant_id', 'pos_source', 'rail'],
  'rules unique constraint is exactly (restaurant_id, pos_source, rail)'
);

-- deposit_match_items columns.
SELECT has_column('public', 'deposit_match_items', 'restaurant_id', 'items has restaurant_id');
SELECT has_column('public', 'deposit_match_items', 'rule_id', 'items has rule_id');
SELECT has_column('public', 'deposit_match_items', 'business_date', 'items has business_date');
SELECT has_column('public', 'deposit_match_items', 'status', 'items has status');
SELECT has_column('public', 'deposit_match_items', 'resolution', 'items has resolution');
SELECT is(
  (SELECT array_agg(a.attname::text ORDER BY k.ord)
   FROM pg_constraint c
   JOIN LATERAL unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord) ON true
   JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
   WHERE c.conrelid = 'public.deposit_match_items'::regclass AND c.contype = 'u'
   GROUP BY c.oid),
  ARRAY['restaurant_id', 'rule_id', 'business_date'],
  'items unique constraint is exactly (restaurant_id, rule_id, business_date)'
);

-- deposit_match_links columns.
SELECT has_column('public', 'deposit_match_links', 'item_id', 'links has item_id');
SELECT has_column('public', 'deposit_match_links', 'bank_transaction_id', 'links has bank_transaction_id');
SELECT has_column('public', 'deposit_match_links', 'allocated_amount', 'links has allocated_amount');
SELECT has_column('public', 'deposit_match_links', 'state', 'links has state');
SELECT is(
  (SELECT array_agg(a.attname::text ORDER BY k.ord)
   FROM pg_constraint c
   JOIN LATERAL unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord) ON true
   JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
   WHERE c.conrelid = 'public.deposit_match_links'::regclass AND c.contype = 'u'
   GROUP BY c.oid),
  ARRAY['item_id', 'bank_transaction_id'],
  'links unique constraint is exactly (item_id, bank_transaction_id)'
);

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
