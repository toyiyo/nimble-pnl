-- Remove the bank-transaction auto-categorize INSERT trigger.
--
-- Root cause: the BEFORE INSERT trigger auto_apply_bank_categorization_rules
-- races the standing sweep. It sets is_categorized = true but creates no
-- journal entry, and it ignores split rules, so it can also set
-- is_categorized = true with category_id = NULL. The sweep only claims rows
-- where is_categorized = false OR category_id IS NULL, so a trigger-touched
-- row never reaches the sweep again. See
-- docs/superpowers/specs/2026-08-20-trigger-categorization-journal-entries-design.md
-- section 5.1 for the full analysis and the chosen option (Option C: delete
-- the trigger; the sweep owns categorization).

DROP TRIGGER IF EXISTS auto_categorize_bank_transaction ON public.bank_transactions;
DROP FUNCTION IF EXISTS public.auto_apply_bank_categorization_rules();

-- Reset rows the trigger left inconsistent: is_categorized = true with no
-- category, on a non-split, non-reconciled, non-excluded row. This state is
-- inconsistent by construction — a categorized non-split row must have a
-- category. The reset makes the rows honest: uncategorized, so a future
-- matching rule or a manual categorization can fix them. Guards match
-- categorize_bank_transaction and the backfill predicate
-- (20260819232450_backfill_bank_transaction_journal_entries.sql:74-79).
--
-- is_transfer = false: mark_as_transfer sets is_categorized = true with
-- category_id NULL on both pair rows. That state is valid — the transfer
-- journal entry exists. The reset must not touch it (Codex P1, PR #775).
--
-- rules_evaluated_at = '-infinity': the sweep claims only rows with
-- rules_evaluated_at < the rules watermark. The stuck rows carry a fresh
-- stamp, so without the rewind they wait for the next rule change. The
-- rewind puts them into the next 5-minute sweep (CodeRabbit, PR #775).
DO $$
DECLARE
  v_reset_count integer;
BEGIN
  UPDATE bank_transactions
  SET is_categorized = false,
      rules_evaluated_at = '-infinity',
      updated_at = now()
  WHERE is_categorized = true
    AND category_id IS NULL
    AND is_split = false
    AND is_reconciled = false
    AND is_transfer = false
    AND excluded_reason IS NULL;

  GET DIAGNOSTICS v_reset_count = ROW_COUNT;
  RAISE NOTICE 'remove_bank_categorization_insert_trigger: reset % stuck row(s)', v_reset_count;
END $$;

-- Run the existing repair once, now. It creates the missing journal entries
-- for rows the trigger already categorized with a real category_id. Local
-- db reset runs this against an empty database — the function returns zeros
-- and this is a no-op there. Precedent:
-- 20260819232450_backfill_bank_transaction_journal_entries.sql:180-190.
SET statement_timeout = 0;

DO $$
DECLARE
  v_result jsonb;
BEGIN
  v_result := public.backfill_bank_transaction_journal_entries();
  RAISE NOTICE 'remove_bank_categorization_insert_trigger: backfill result %', v_result;
END $$;

RESET statement_timeout;
