-- File: supabase/tests/48_receipt_pack_quantity.sql
-- Description: Tests for receipt_line_items.pack_quantity (distributor pack column)

BEGIN;
SELECT plan(5);

SET LOCAL role TO postgres;
SET LOCAL "request.jwt.claims" TO '{"sub": "00000000-0000-0000-0000-000000000000"}';

ALTER TABLE receipt_line_items DISABLE ROW LEVEL SECURITY;
ALTER TABLE receipt_imports DISABLE ROW LEVEL SECURITY;
ALTER TABLE restaurants DISABLE ROW LEVEL SECURITY;

-- Column contract
SELECT has_column('receipt_line_items', 'pack_quantity', 'pack_quantity column exists');
SELECT col_type_is('receipt_line_items', 'pack_quantity', 'integer', 'pack_quantity is integer');
SELECT col_is_null('receipt_line_items', 'pack_quantity', 'pack_quantity is nullable');

-- Fixtures
INSERT INTO restaurants (id, name, address, phone) VALUES
  ('00000000-0000-0000-0000-000000000971', 'Pack Qty Test Restaurant', '1 Test St', '555-0002')
ON CONFLICT (id) DO NOTHING;

INSERT INTO receipt_imports (id, restaurant_id, file_name, processed_by, status) VALUES
  ('00000000-0000-0000-0000-000000000972', '00000000-0000-0000-0000-000000000971', 'pfg.pdf', '00000000-0000-0000-0000-000000000000', 'processed')
ON CONFLICT (id) DO NOTHING;

-- Mustard row: pack 500 (PFG item 87750 — 1 case × 500 packets of 0.32 oz each)
INSERT INTO receipt_line_items (id, receipt_id, raw_text, parsed_name, parsed_quantity, package_type, size_value, size_unit, pack_quantity, line_sequence)
VALUES ('00000000-0000-0000-0000-000000000973', '00000000-0000-0000-0000-000000000972',
        'GULDENS MUSTARD PACKET', 'Guldens Mustard Packet', 500, 'packet', 0.32, 'oz', 500, 1);

-- Retail row: no pack concept (produce by weight)
INSERT INTO receipt_line_items (id, receipt_id, raw_text, parsed_name, parsed_quantity, package_type, size_value, size_unit, pack_quantity, line_sequence)
VALUES ('00000000-0000-0000-0000-000000000974', '00000000-0000-0000-0000-000000000972',
        'ROMA TOMATOES', 'Roma Tomatoes', 0.62, NULL, 0.62, 'lb', NULL, 2);

SELECT is(
  (SELECT pack_quantity FROM receipt_line_items WHERE id = '00000000-0000-0000-0000-000000000973'),
  500, 'pack_quantity round-trips as 500 for mustard row');

SELECT is(
  (SELECT pack_quantity FROM receipt_line_items WHERE id = '00000000-0000-0000-0000-000000000974'),
  NULL::integer, 'pack_quantity is NULL for retail row');

SELECT * FROM finish();
ROLLBACK;
