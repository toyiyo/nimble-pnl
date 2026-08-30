-- Undo an automatic link between a pending outflow and a bank transaction.
--
-- unlink_pending_outflow: user-context RPC for the "Undo match" action on a
-- cleared PendingOutflowCard. Reverts the categorization only when the
-- revert is safe (design §7); otherwise it keeps the categorization and
-- reports category_kept = true so the UI can tell the user to
-- recategorize on the Banking page. Always clears the transaction's match
-- metadata and resets the outflow, stamping auto_link_suppressed_at so the
-- auto-link sweep does not re-link the same pair on its next tick.
--
-- See docs/superpowers/specs/2026-08-30-pending-outflow-auto-link-design.md
-- section 7.

CREATE OR REPLACE FUNCTION public.unlink_pending_outflow(
  p_pending_outflow_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_po                RECORD;
  v_bt                RECORD;
  v_timezone           TEXT;
  v_entry_day          DATE;
  v_fiscal_period_id    UUID;
  v_journal_entry_id     UUID;
  v_upload_id             UUID;
  v_can_revert            BOOLEAN;
  v_category_kept          BOOLEAN;
  v_new_status              TEXT;
BEGIN
  SELECT * INTO v_po
  FROM pending_outflows
  WHERE id = p_pending_outflow_id
  FOR UPDATE;

  IF v_po.id IS NULL THEN
    RAISE EXCEPTION 'Pending outflow not found';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM user_restaurants
    WHERE restaurant_id = v_po.restaurant_id
      AND user_id = auth.uid()
      AND role IN ('owner', 'manager')
  ) THEN
    RAISE EXCEPTION 'Unauthorized: user does not have access to this restaurant';
  END IF;

  IF v_po.status != 'cleared' OR v_po.linked_bank_transaction_id IS NULL THEN
    RAISE EXCEPTION 'Pending outflow is not linked to a bank transaction';
  END IF;

  SELECT * INTO v_bt
  FROM bank_transactions
  WHERE id = v_po.linked_bank_transaction_id
  FOR UPDATE;

  IF v_bt.id IS NULL THEN
    RAISE EXCEPTION 'Linked bank transaction not found';
  END IF;

  SELECT timezone INTO v_timezone
  FROM restaurants
  WHERE id = v_po.restaurant_id;

  v_entry_day := bank_txn_entry_day(v_bt.transaction_date, v_timezone);

  SELECT id INTO v_fiscal_period_id
  FROM fiscal_periods
  WHERE restaurant_id = v_po.restaurant_id
    AND v_entry_day >= period_start
    AND v_entry_day <= period_end
    AND is_closed = true
  LIMIT 1;

  SELECT id INTO v_journal_entry_id
  FROM journal_entries
  WHERE reference_type = 'bank_transaction'
    AND reference_id = v_bt.id
    AND restaurant_id = v_po.restaurant_id
  LIMIT 1;

  -- Revert-safety condition list (design §7 step 2). All must hold, or the
  -- categorization stays and the UI is told to recategorize manually.
  v_can_revert := v_po.auto_linked_at IS NOT NULL
    AND v_bt.is_categorized = true
    AND v_bt.category_id = v_po.category_id
    AND v_bt.is_reconciled = false
    AND v_fiscal_period_id IS NULL
    AND v_journal_entry_id IS NOT NULL;

  SELECT id INTO v_upload_id
  FROM expense_invoice_uploads
  WHERE pending_outflow_id = v_po.id
  ORDER BY created_at
  LIMIT 1;

  IF v_can_revert THEN
    DELETE FROM journal_entry_lines WHERE journal_entry_id = v_journal_entry_id;
    DELETE FROM journal_entries WHERE id = v_journal_entry_id;

    UPDATE bank_transactions
    SET is_categorized          = false,
        category_id             = NULL,
        suggested_category_id   = NULL,
        rules_evaluated_at      = '-infinity',
        matched_at               = NULL,
        matched_by               = NULL,
        expense_invoice_upload_id = CASE WHEN expense_invoice_upload_id = v_upload_id THEN NULL ELSE expense_invoice_upload_id END,
        updated_at                = now()
    WHERE id = v_bt.id;

    v_category_kept := false;
  ELSE
    UPDATE bank_transactions
    SET matched_at                = NULL,
        matched_by                = NULL,
        expense_invoice_upload_id = CASE WHEN expense_invoice_upload_id = v_upload_id THEN NULL ELSE expense_invoice_upload_id END,
        updated_at                = now()
    WHERE id = v_bt.id;

    v_category_kept := true;
  END IF;

  -- Same thresholds as mark_stale_pending_outflows
  -- (20251107141500_pending_outflows.sql:98-121). No cron job calls that
  -- function, so a plain 'pending' reset on an old outflow would stay
  -- wrong forever.
  v_new_status := CASE
    WHEN v_po.issue_date <= CURRENT_DATE - INTERVAL '90 days' THEN 'stale_90'
    WHEN v_po.issue_date <= CURRENT_DATE - INTERVAL '60 days' THEN 'stale_60'
    WHEN v_po.issue_date <= CURRENT_DATE - INTERVAL '30 days' THEN 'stale_30'
    ELSE 'pending'
  END;

  UPDATE pending_outflows
  SET status                     = v_new_status,
      linked_bank_transaction_id = NULL,
      cleared_at                 = NULL,
      auto_linked_at             = NULL,
      auto_link_suppressed_at    = now(),
      updated_at                 = now()
  WHERE id = v_po.id;

  IF v_can_revert THEN
    PERFORM rebuild_account_balances(v_po.restaurant_id);
  END IF;

  RETURN jsonb_build_object('category_kept', v_category_kept, 'status', v_new_status);
END;
$$;

COMMENT ON FUNCTION public.unlink_pending_outflow(uuid) IS
  'Undoes an automatic (or manual) link between a pending outflow and a bank '
  'transaction. Reverts the categorization only when the revert is safe '
  '(auto-linked, category unchanged, not reconciled, open fiscal period, '
  'journal entry present); otherwise keeps the categorization and returns '
  'category_kept = true. Owner/manager only. Stamps '
  'auto_link_suppressed_at so the sweep does not re-link the pair.';

REVOKE EXECUTE ON FUNCTION public.unlink_pending_outflow(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.unlink_pending_outflow(uuid) FROM anon;
GRANT  EXECUTE ON FUNCTION public.unlink_pending_outflow(uuid) TO authenticated;
