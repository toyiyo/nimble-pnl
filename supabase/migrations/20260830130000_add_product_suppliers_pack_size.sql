-- Add pack size columns to product_suppliers for per-unit price comparison.
-- See docs/superpowers/specs/2026-08-30-supplier-pack-size-design.md.
--
-- Both columns are nullable and paired: a row either has both values or
-- neither. No backfill. No RLS change — the existing row-level policies
-- on product_suppliers apply to these columns without any edit.

ALTER TABLE public.product_suppliers
  ADD COLUMN pack_size_qty NUMERIC,
  ADD COLUMN pack_size_unit TEXT;

ALTER TABLE public.product_suppliers
  ADD CONSTRAINT product_suppliers_pack_size_qty_positive
    CHECK (pack_size_qty IS NULL OR pack_size_qty > 0);

ALTER TABLE public.product_suppliers
  ADD CONSTRAINT product_suppliers_pack_size_paired
    CHECK ((pack_size_qty IS NULL) = (pack_size_unit IS NULL));

COMMENT ON COLUMN public.product_suppliers.pack_size_qty IS
  'Case size in the supplier''s pack unit (e.g. 30 for a 30 lb case). Pairs with pack_size_unit.';
COMMENT ON COLUMN public.product_suppliers.pack_size_unit IS
  'Unit for pack_size_qty (e.g. lb, oz, ea). Pairs with pack_size_qty.';
