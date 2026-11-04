-- Validate the recipe yield percent CHECK constraints.
-- Design: docs/superpowers/specs/2026-09-30-recipe-yield-waste-design.md §4
--
-- 20260930120000 added these constraints as NOT VALID. VALIDATE CONSTRAINT
-- takes a SHARE UPDATE EXCLUSIVE lock, not ACCESS EXCLUSIVE, so it does not
-- block reads or writes on products while it scans existing rows.

ALTER TABLE public.products
  VALIDATE CONSTRAINT products_yield_pct_range;
ALTER TABLE public.products
  VALIDATE CONSTRAINT products_waste_reason_len;

ALTER TABLE public.recipe_ingredients
  VALIDATE CONSTRAINT recipe_ingredients_yield_override_range;
