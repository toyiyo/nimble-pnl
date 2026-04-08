-- Migration: Update delete functions to write tombstone records
-- Purpose: When bank transactions are deleted, store a tombstone record in
--          deleted_bank_transactions so import pipelines can prevent re-import.
--          Also adds restore_deleted_transaction and permanently_delete_tombstone RPCs.

-- ============================================================
-- 1. Update delete_bank_transaction(uuid, uuid)
--    Now writes a tombstone before hard-deleting.
-- ============================================================
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
  v_fingerprint TEXT;
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

  -- Compute fingerprint for CSV/PDF matching
  -- Cast transaction_date to DATE (column is TIMESTAMPTZ in bank_transactions)
  v_fingerprint := compute_transaction_fingerprint(
    v_transaction.transaction_date::DATE,
    v_transaction.amount,
    v_transaction.description
  );

  -- Insert tombstone record (ON CONFLICT DO NOTHING for idempotency)
  INSERT INTO deleted_bank_transactions (
    restaurant_id,
    connected_bank_id,
    source,
    external_transaction_id,
    fingerprint,
    transaction_date,
    amount,
    currency,
    description,
    merchant_name,
    deleted_by
  ) VALUES (
    v_transaction.restaurant_id,
    v_transaction.connected_bank_id,
    COALESCE(v_transaction.source, 'bank_integration'),
    v_transaction.stripe_transaction_id,
    v_fingerprint,
    v_transaction.transaction_date::DATE,
    v_transaction.amount,
    v_transaction.currency,
    v_transaction.description,
    v_transaction.merchant_name,
    auth.uid()
  )
  ON CONFLICT DO NOTHING;

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
    'message', 'Transaction deleted (tombstone preserved for re-import prevention)'
  );
END;
$$;

-- Grant execute to authenticated users
GRANT EXECUTE ON FUNCTION public.delete_bank_transaction(uuid, uuid) TO authenticated;

COMMENT ON FUNCTION public.delete_bank_transaction(uuid, uuid) IS
'Deletes a single bank transaction after validating restaurant ownership.
Writes a tombstone record to deleted_bank_transactions for re-import prevention.';

-- ============================================================
-- 2. Update bulk_delete_bank_transactions(uuid[], uuid)
--    Now writes tombstones before hard-deleting.
-- ============================================================
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

  -- Bulk insert tombstone records (ON CONFLICT DO NOTHING for idempotency)
  INSERT INTO deleted_bank_transactions (
    restaurant_id,
    connected_bank_id,
    source,
    external_transaction_id,
    fingerprint,
    transaction_date,
    amount,
    currency,
    description,
    merchant_name,
    deleted_by
  )
  SELECT
    bt.restaurant_id,
    bt.connected_bank_id,
    COALESCE(bt.source, 'bank_integration'),
    bt.stripe_transaction_id,
    compute_transaction_fingerprint(bt.transaction_date::DATE, bt.amount, bt.description),
    bt.transaction_date::DATE,
    bt.amount,
    bt.currency,
    bt.description,
    bt.merchant_name,
    auth.uid()
  FROM bank_transactions bt
  WHERE bt.id = ANY(p_transaction_ids)
  AND bt.restaurant_id = p_restaurant_id
  ON CONFLICT DO NOTHING;

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
    'message', format('%s transaction(s) deleted (tombstones preserved)', v_deleted_count)
  );
END;
$$;

-- Grant execute to authenticated users
GRANT EXECUTE ON FUNCTION public.bulk_delete_bank_transactions(uuid[], uuid) TO authenticated;

COMMENT ON FUNCTION public.bulk_delete_bank_transactions IS
'Bulk deletes bank transactions after validating restaurant ownership.
Writes tombstone records to deleted_bank_transactions for re-import prevention.
Cascades to bank_transaction_splits.';

-- ============================================================
-- 3. New: restore_deleted_transaction(uuid, uuid)
--    Restores a transaction from the tombstone table back to bank_transactions.
-- ============================================================
CREATE OR REPLACE FUNCTION public.restore_deleted_transaction(
  p_tombstone_id uuid,
  p_restaurant_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tombstone RECORD;
  v_existing_id UUID;
  v_stripe_txn_id TEXT;
BEGIN
  -- Read the tombstone row and verify restaurant
  SELECT * INTO v_tombstone
  FROM deleted_bank_transactions
  WHERE id = p_tombstone_id
  AND restaurant_id = p_restaurant_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Tombstone not found or does not belong to this restaurant'
    );
  END IF;

  -- Check if an active transaction with the same external_transaction_id already exists
  -- (idempotent case: someone already restored or the transaction was re-imported)
  IF v_tombstone.external_transaction_id IS NOT NULL THEN
    SELECT id INTO v_existing_id
    FROM bank_transactions
    WHERE stripe_transaction_id = v_tombstone.external_transaction_id
    AND restaurant_id = p_restaurant_id;

    IF FOUND THEN
      -- Active row exists; just remove the tombstone and return success
      DELETE FROM deleted_bank_transactions WHERE id = p_tombstone_id;

      RETURN jsonb_build_object(
        'success', true,
        'transaction_id', v_existing_id,
        'message', 'Active transaction already exists; tombstone removed'
      );
    END IF;
  END IF;

  -- Determine stripe_transaction_id for the restored row
  -- Use external_transaction_id if present, otherwise generate a unique ID
  v_stripe_txn_id := COALESCE(
    v_tombstone.external_transaction_id,
    'restored_' || p_tombstone_id::text
  );

  -- Re-insert into bank_transactions from tombstone data
  INSERT INTO bank_transactions (
    restaurant_id,
    connected_bank_id,
    stripe_transaction_id,
    transaction_date,
    description,
    merchant_name,
    amount,
    currency,
    source
  ) VALUES (
    v_tombstone.restaurant_id,
    v_tombstone.connected_bank_id,
    v_stripe_txn_id,
    v_tombstone.transaction_date,
    COALESCE(v_tombstone.description, ''),
    v_tombstone.merchant_name,
    v_tombstone.amount,
    COALESCE(v_tombstone.currency, 'USD'),
    COALESCE(v_tombstone.source, 'bank_integration')
  );

  -- Delete the tombstone
  DELETE FROM deleted_bank_transactions WHERE id = p_tombstone_id;

  RETURN jsonb_build_object(
    'success', true,
    'stripe_transaction_id', v_stripe_txn_id,
    'message', 'Transaction restored from tombstone'
  );
END;
$$;

-- Grant execute to authenticated users
GRANT EXECUTE ON FUNCTION public.restore_deleted_transaction(uuid, uuid) TO authenticated;

COMMENT ON FUNCTION public.restore_deleted_transaction IS
'Restores a previously deleted bank transaction from the tombstone table back to bank_transactions.
If an active transaction with the same external ID already exists, just removes the tombstone.';

-- ============================================================
-- 4. New: permanently_delete_tombstone(uuid, uuid)
--    Removes a tombstone record completely (allows future re-import).
-- ============================================================
CREATE OR REPLACE FUNCTION public.permanently_delete_tombstone(
  p_tombstone_id uuid,
  p_restaurant_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted_count int;
BEGIN
  DELETE FROM deleted_bank_transactions
  WHERE id = p_tombstone_id
  AND restaurant_id = p_restaurant_id;

  GET DIAGNOSTICS v_deleted_count = ROW_COUNT;

  IF v_deleted_count = 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Tombstone not found or does not belong to this restaurant'
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'tombstone_id', p_tombstone_id,
    'message', 'Tombstone permanently deleted (transaction can be re-imported)'
  );
END;
$$;

-- Grant execute to authenticated users
GRANT EXECUTE ON FUNCTION public.permanently_delete_tombstone(uuid, uuid) TO authenticated;

COMMENT ON FUNCTION public.permanently_delete_tombstone IS
'Permanently removes a tombstone record from deleted_bank_transactions.
After removal, the transaction can be re-imported by sync/CSV/PDF pipelines.';
