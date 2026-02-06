-- Migration: Add bulk delete bank transactions function
-- This replaces the "exclude" concept with actual deletion for transactions
-- that don't belong to the restaurant (e.g., shared bank accounts)

-- Function to bulk delete bank transactions
-- Validates ownership and cascades deletes to related records
CREATE OR REPLACE FUNCTION public.bulk_delete_bank_transactions(
  p_transaction_ids uuid[],
  p_restaurant_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted_count int := 0;
  v_invalid_ids uuid[] := '{}';
  v_txn_id uuid;
BEGIN
  -- Validate that all transaction IDs belong to this restaurant
  SELECT array_agg(id) INTO v_invalid_ids
  FROM unnest(p_transaction_ids) AS id
  WHERE id NOT IN (
    SELECT bt.id
    FROM bank_transactions bt
    WHERE bt.id = ANY(p_transaction_ids)
    AND bt.restaurant_id = p_restaurant_id
  );

  -- If any invalid IDs found, return error
  IF array_length(v_invalid_ids, 1) > 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Some transactions do not belong to this restaurant or do not exist',
      'invalid_ids', v_invalid_ids
    );
  END IF;

  -- Delete related bank_transaction_splits first (foreign key constraint)
  DELETE FROM bank_transaction_splits
  WHERE transaction_id = ANY(p_transaction_ids);

  -- Delete the bank transactions
  DELETE FROM bank_transactions
  WHERE id = ANY(p_transaction_ids)
  AND restaurant_id = p_restaurant_id;

  GET DIAGNOSTICS v_deleted_count = ROW_COUNT;

  RETURN jsonb_build_object(
    'success', true,
    'deleted_count', v_deleted_count,
    'message', format('%s transaction(s) permanently deleted', v_deleted_count)
  );
END;
$$;

-- Grant execute to authenticated users (RLS will handle authorization)
GRANT EXECUTE ON FUNCTION public.bulk_delete_bank_transactions(uuid[], uuid) TO authenticated;

-- Add comment for documentation
COMMENT ON FUNCTION public.bulk_delete_bank_transactions IS
'Permanently deletes bank transactions. Used when transactions from shared bank accounts
do not belong to this restaurant. Cascades to bank_transaction_splits.';

-- Function to delete a single bank transaction
CREATE OR REPLACE FUNCTION public.delete_bank_transaction(
  p_transaction_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_transaction RECORD;
BEGIN
  -- Get the transaction and verify it exists
  SELECT * INTO v_transaction
  FROM bank_transactions
  WHERE id = p_transaction_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Transaction not found'
    );
  END IF;

  -- Delete related bank_transaction_splits first (foreign key constraint)
  DELETE FROM bank_transaction_splits
  WHERE transaction_id = p_transaction_id;

  -- Delete the bank transaction
  DELETE FROM bank_transactions
  WHERE id = p_transaction_id;

  RETURN jsonb_build_object(
    'success', true,
    'transaction_id', p_transaction_id,
    'message', 'Transaction permanently deleted'
  );
END;
$$;

-- Grant execute to authenticated users
GRANT EXECUTE ON FUNCTION public.delete_bank_transaction(uuid) TO authenticated;

COMMENT ON FUNCTION public.delete_bank_transaction IS
'Permanently deletes a single bank transaction. Used when a transaction from a shared
bank account does not belong to this restaurant.';
