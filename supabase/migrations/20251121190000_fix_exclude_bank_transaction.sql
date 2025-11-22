-- Fix exclude_bank_transaction function to not use invalid 'excluded' status
-- The exclusion is tracked by excluded_reason column, not by status enum

CREATE OR REPLACE FUNCTION public.exclude_bank_transaction(
  p_transaction_id uuid,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_transaction RECORD;
BEGIN
  SELECT * INTO v_transaction
  FROM bank_transactions
  WHERE id = p_transaction_id;

  IF v_transaction.id IS NULL THEN
    RAISE EXCEPTION 'Transaction not found';
  END IF;

  IF v_transaction.is_reconciled THEN
    RAISE EXCEPTION 'Cannot exclude a reconciled transaction';
  END IF;

  IF v_transaction.is_categorized THEN
    RAISE EXCEPTION 'Cannot exclude a categorized transaction. Uncategorize it first.';
  END IF;

  -- Update transaction with exclusion reason
  -- Note: We do NOT set status to 'excluded' because that's not a valid enum value
  -- The transaction_status_enum only has: 'pending', 'posted', 'reconciled', 'void'
  -- Exclusion is tracked by excluded_reason being NOT NULL
  UPDATE bank_transactions
  SET
    excluded_reason = p_reason,
    updated_at = now()
  WHERE id = p_transaction_id;

  RETURN jsonb_build_object(
    'success', true,
    'transaction_id', p_transaction_id,
    'excluded_reason', p_reason
  );
END;
$$;

COMMENT ON FUNCTION public.exclude_bank_transaction IS 'Excludes a bank transaction from accounting by setting excluded_reason. Transactions with excluded_reason are filtered out in UI (status=excluded filter). Does not modify transaction_status_enum which only tracks posting status.';
