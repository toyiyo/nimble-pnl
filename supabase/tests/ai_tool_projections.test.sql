-- The AI tool batch_categorize_pos_sales selects these unified_sales columns
-- (POS_SALE_PREVIEW_COLUMNS in supabase/functions/_shared/aiToolFormatters.ts).
-- A missing column makes PostgREST fail, and the tool returns HTTP 500.
BEGIN;
SELECT plan(6);

SELECT has_column('public', 'unified_sales', 'id', 'unified_sales.id exists');
SELECT has_column('public', 'unified_sales', 'item_name', 'unified_sales.item_name exists');
SELECT has_column('public', 'unified_sales', 'total_price', 'unified_sales.total_price exists');
SELECT has_column('public', 'unified_sales', 'sale_date', 'unified_sales.sale_date exists');
SELECT has_column('public', 'unified_sales', 'pos_system', 'unified_sales.pos_system exists');
SELECT hasnt_column('public', 'unified_sales', 'source', 'unified_sales has no source column; use pos_system');

SELECT * FROM finish();
ROLLBACK;
