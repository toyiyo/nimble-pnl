-- Migration: Role-based guaranteed and fixed tip pool percentages
-- Lets a restaurant pin a role to a minimum ("at least 10% of the pool") or a
-- fixed ("exactly 15%") share, evaluated per person on the day they worked.
--
-- New objects:
--   ALTER tip_pool_settings – add role_percentages column + shape CHECK
--   ALTER tip_split_items   – add applied_rule column (audit provenance)

-- =============================================================================
-- 1. Add role_percentages to tip_pool_settings
-- =============================================================================
ALTER TABLE tip_pool_settings
  ADD COLUMN IF NOT EXISTS role_percentages JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Shape constraint. RLS gates rows, not column shape: without this, any client
-- with write access could store a negative percentage or an unknown mode and
-- the allocation algorithm's non-negativity assumption would rest entirely on
-- an HTML min/max attribute. Use a DO block so re-running is safe.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'tip_pool_settings_role_percentages_check'
  ) THEN
    ALTER TABLE tip_pool_settings
      ADD CONSTRAINT tip_pool_settings_role_percentages_check
      CHECK (
        jsonb_typeof(role_percentages) = 'object'
        -- jsonpath's lax mode auto-unwraps arrays on member access, so without this
        -- predicate a role value of e.g. [{"mode":"at_least","percentage":10}] would
        -- pass every check below (each is applied to the unwrapped element) while
        -- still being stored as an array. The TypeScript side reads role rules as
        -- Record<string, RoleAllocationRule> and would silently treat that array as
        -- "no rule" (indexing a non-existent `.mode`/`.percentage`), dropping the
        -- guarantee the row claims to encode.
        --
        -- `strict` (not lax) is required here specifically: lax mode's auto-unwrap
        -- also applies to the `.type()` item method itself, so `$.* ? (@.type() !=
        -- "object")` in lax mode silently unwraps a one-element array to its inner
        -- object *before* checking its type — making the array invisible to this
        -- exact check. `strict` keeps `@` bound to the un-unwrapped value so
        -- `.type()` reports "array" as expected. The other predicates below stay in
        -- lax mode on purpose: their member accessors (`.mode`, `.percentage`)
        -- already unwrap correctly and still catch a malformed *inner* object, so
        -- lax mode there is not itself a gap once this array check exists.
        AND NOT jsonb_path_exists(
          role_percentages,
          'strict $.* ? (@.type() != "object")'
        )
        AND NOT jsonb_path_exists(
          role_percentages,
          '$.* ? (@.mode != "at_least" && @.mode != "exactly")'
        )
        AND NOT jsonb_path_exists(
          role_percentages,
          '$.* ? (@.percentage < 0 || @.percentage > 100)'
        )
        AND NOT jsonb_path_exists(
          role_percentages,
          '$.* ? (!exists(@.mode) || !exists(@.percentage))'
        )
        -- A non-numeric percentage (e.g. "abc") silently fails to match the
        -- range predicate above under jsonpath's lax-mode type coercion, so
        -- it would otherwise slip through and produce NaN downstream in
        -- calculateTipSplitWithGuarantees. Require the numeric type explicitly.
        AND NOT jsonb_path_exists(
          role_percentages,
          '$.* ? (exists(@.percentage) && @.percentage.type() != "number")'
        )
        -- Same lax-mode coercion risk for `mode`: a numeric or boolean mode value
        -- would fail the string-comparison predicate above by never matching either
        -- literal, so it would pass unnoticed instead of being rejected.
        AND NOT jsonb_path_exists(
          role_percentages,
          '$.* ? (exists(@.mode) && @.mode.type() != "string")'
        )
      );
  END IF;
END $$;

COMMENT ON COLUMN tip_pool_settings.role_percentages IS
  'Per-role allocation rules: {"<role>": {"mode": "at_least" | "exactly", "percentage": 0-100}}. Evaluated per person, so two people in a 10% role commit 20% of the pool. Full Pool model only.';

-- =============================================================================
-- 2. Add applied_rule to tip_split_items
-- =============================================================================
-- Audit provenance only. NULL means no rule applied, which is every existing
-- row and every plain hours-derived allocation. The split-level audit trigger
-- logs status transitions on tip_splits, not per-employee reasoning, so
-- without this there is no record of why an employee received what they did.
ALTER TABLE tip_split_items
  ADD COLUMN IF NOT EXISTS applied_rule JSONB;

COMMENT ON COLUMN tip_split_items.applied_rule IS
  'Allocation rule in force for this employee when the split was created: {"mode": "at_least" | "exactly", "percentage": number}, or NULL. Audit record — not read back for display.';
