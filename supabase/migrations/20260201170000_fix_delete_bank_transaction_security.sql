-- Migration: Fix delete_bank_transaction security
-- Add restaurant ownership validation to prevent cross-tenant deletion

-- Drop the old function first (signature is changing)
DROP FUNCTION IF EXISTS public.delete_bank_transaction(uuid);

-- Recreate with restaurant validation
CREATE OR REPLACE FUNCTION public.delete_bank_transaction(
  p_transaction_id uuid,
  p_restaurant_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_transaction RECORD;
BEGIN
  -- Get the transaction and verify it exists AND belongs to this restaurant
  SELECT * INTO v_transaction
  FROM bank_transactions
  WHERE id = p_transaction_id
  AND restaurant_id = p_restaurant_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Transaction not found or does not belong to this restaurant'
    );
  END IF;

  -- Delete related bank_transaction_splits first (foreign key constraint)
  DELETE FROM bank_transaction_splits
  WHERE transaction_id = p_transaction_id;

  -- Delete the bank transaction
  DELETE FROM bank_transactions
  WHERE id = p_transaction_id
  AND restaurant_id = p_restaurant_id;

  RETURN jsonb_build_object(
    'success', true,
    'transaction_id', p_transaction_id,
    'message', 'Transaction permanently deleted'
  );
END;
$$;

-- Grant execute to authenticated users
GRANT EXECUTE ON FUNCTION public.delete_bank_transaction(uuid, uuid) TO authenticated;

COMMENT ON FUNCTION public.delete_bank_transaction IS
'Permanently deletes a single bank transaction after validating restaurant ownership.
Used when a transaction from a shared bank account does not belong to this restaurant.';
