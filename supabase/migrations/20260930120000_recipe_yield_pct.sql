-- Add recipe yield percent columns.
-- Design: docs/superpowers/specs/2026-09-30-recipe-yield-waste-design.md §4
--
-- products is a hot table (each POS sale updates current_stock), so this
-- file adds the columns and constraints as NOT VALID. It does not scan the
-- table under ACCESS EXCLUSIVE lock. A separate migration validates the
-- constraints under SHARE UPDATE EXCLUSIVE, in its own transaction.

ALTER TABLE public.products
  ADD COLUMN yield_pct numeric(5,2) NOT NULL DEFAULT 100,
  ADD COLUMN waste_reason text NULL;
ALTER TABLE public.products
  ADD CONSTRAINT products_yield_pct_range
    CHECK (yield_pct >= 50 AND yield_pct <= 100) NOT VALID,
  ADD CONSTRAINT products_waste_reason_len
    CHECK (char_length(waste_reason) <= 120) NOT VALID;

ALTER TABLE public.recipe_ingredients
  ADD COLUMN yield_pct_override numeric(5,2) NULL;
ALTER TABLE public.recipe_ingredients
  ADD CONSTRAINT recipe_ingredients_yield_override_range
    CHECK (yield_pct_override IS NULL
           OR (yield_pct_override >= 50 AND yield_pct_override <= 100)) NOT VALID;
