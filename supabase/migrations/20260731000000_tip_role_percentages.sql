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
