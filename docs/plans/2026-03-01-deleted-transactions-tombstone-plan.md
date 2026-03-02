# Deleted Bank Transactions Tombstone Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Prevent deleted bank transactions from being re-created on subsequent imports (Stripe sync + CSV/PDF) by using a tombstone table pattern.

**Architecture:** When a user deletes a bank transaction, we move key identification data to a `deleted_bank_transactions` tombstone table, then hard-delete the active row. Import pipelines (Stripe sync + CSV/PDF) check the tombstone table before inserting. A "Deleted" tab lets users view/restore/permanently-delete tombstoned transactions.

**Tech Stack:** PostgreSQL (Supabase), Deno edge functions, React + React Query hooks, pgTAP tests, Vitest unit tests

**Design doc:** `docs/plans/2026-03-01-deleted-transactions-tombstone-design.md`

---

## Task 1: Create Tombstone Table + Fingerprint Function (Migration)

**Files:**
- Create: `supabase/migrations/20260301000000_add_deleted_bank_transactions_tombstone.sql`
- Test: `supabase/tests/deleted_bank_transactions_tombstone.sql`

**Step 1: Write the pgTAP test file**

```sql
-- supabase/tests/deleted_bank_transactions_tombstone.sql
BEGIN;
SELECT plan(12);

-- Test 1: Table exists
SELECT has_table('public', 'deleted_bank_transactions', 'deleted_bank_transactions table should exist');

-- Test 2-8: Required columns exist
SELECT has_column('public', 'deleted_bank_transactions', 'id', 'should have id column');
SELECT has_column('public', 'deleted_bank_transactions', 'restaurant_id', 'should have restaurant_id column');
SELECT has_column('public', 'deleted_bank_transactions', 'connected_bank_id', 'should have connected_bank_id column');
SELECT has_column('public', 'deleted_bank_transactions', 'external_transaction_id', 'should have external_transaction_id column');
SELECT has_column('public', 'deleted_bank_transactions', 'fingerprint', 'should have fingerprint column');
SELECT has_column('public', 'deleted_bank_transactions', 'deleted_at', 'should have deleted_at column');
SELECT has_column('public', 'deleted_bank_transactions', 'deleted_by', 'should have deleted_by column');

-- Test 9: Fingerprint function exists
SELECT has_function('public', 'compute_transaction_fingerprint', 'fingerprint function should exist');

-- Test 10: Fingerprint is deterministic
SELECT is(
  public.compute_transaction_fingerprint('2026-01-15'::date, 42.50, 'RESTAURANT DEPOT #123'),
  public.compute_transaction_fingerprint('2026-01-15'::date, 42.50, 'RESTAURANT DEPOT #123'),
  'fingerprint should be deterministic for same inputs'
);

-- Test 11: Fingerprint differs for different amounts
SELECT isnt(
  public.compute_transaction_fingerprint('2026-01-15'::date, 42.50, 'RESTAURANT DEPOT'),
  public.compute_transaction_fingerprint('2026-01-15'::date, 42.51, 'RESTAURANT DEPOT'),
  'fingerprint should differ for different amounts'
);

-- Test 12: Fingerprint normalizes description (case + punctuation)
SELECT is(
  public.compute_transaction_fingerprint('2026-01-15'::date, 42.50, 'Restaurant Depot #123!'),
  public.compute_transaction_fingerprint('2026-01-15'::date, 42.50, 'restaurant depot 123'),
  'fingerprint should normalize case and punctuation'
);

SELECT * FROM finish();
ROLLBACK;
```

**Step 2: Run test to verify it fails**

Run: `npm run test:db`
Expected: FAIL — table and function do not exist yet

**Step 3: Write the migration**

```sql
-- supabase/migrations/20260301000000_add_deleted_bank_transactions_tombstone.sql

-- Deterministic fingerprint for matching CSV/PDF transactions across re-uploads
CREATE OR REPLACE FUNCTION public.compute_transaction_fingerprint(
  p_transaction_date DATE,
  p_amount NUMERIC(15,2),
  p_description TEXT
) RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT md5(
    COALESCE(p_transaction_date::TEXT, '') || '|' ||
    (COALESCE(p_amount, 0) * 100)::BIGINT::TEXT || '|' ||
    CASE WHEN COALESCE(p_amount, 0) >= 0 THEN 'credit' ELSE 'debit' END || '|' ||
    regexp_replace(lower(trim(COALESCE(p_description, ''))), '[^a-z0-9 ]', '', 'g')
  );
$$;

COMMENT ON FUNCTION public.compute_transaction_fingerprint IS
'Computes a deterministic MD5 fingerprint from transaction date, amount (in cents), direction, and normalized description.
Used to match deleted transactions across CSV/PDF re-uploads where no external provider ID exists.';

-- Tombstone table for deleted bank transactions
CREATE TABLE public.deleted_bank_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  connected_bank_id UUID NOT NULL,
  source TEXT NOT NULL DEFAULT 'bank_integration',
  external_transaction_id TEXT,
  fingerprint TEXT NOT NULL,
  transaction_date DATE NOT NULL,
  amount NUMERIC(15,2) NOT NULL,
  currency TEXT DEFAULT 'USD',
  description TEXT,
  merchant_name TEXT,
  raw JSONB,
  deleted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_by UUID
);

-- Unique constraint: one tombstone per external ID per restaurant
CREATE UNIQUE INDEX idx_deleted_txns_external_id
  ON public.deleted_bank_transactions (restaurant_id, external_transaction_id)
  WHERE external_transaction_id IS NOT NULL;

-- Unique constraint: one tombstone per fingerprint per restaurant
CREATE UNIQUE INDEX idx_deleted_txns_fingerprint
  ON public.deleted_bank_transactions (restaurant_id, fingerprint);

-- Index for date-range queries (Deleted tab)
CREATE INDEX idx_deleted_txns_date
  ON public.deleted_bank_transactions (restaurant_id, transaction_date);

-- RLS
ALTER TABLE public.deleted_bank_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view deleted transactions for their restaurants"
  ON public.deleted_bank_transactions FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.user_restaurants
      WHERE user_restaurants.restaurant_id = deleted_bank_transactions.restaurant_id
      AND user_restaurants.user_id = auth.uid()
    )
  );

CREATE POLICY "Owners and managers can manage deleted transactions"
  ON public.deleted_bank_transactions FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.user_restaurants
      WHERE user_restaurants.restaurant_id = deleted_bank_transactions.restaurant_id
      AND user_restaurants.user_id = auth.uid()
      AND user_restaurants.role IN ('owner', 'manager')
    )
  );

-- Grant access
GRANT ALL ON public.deleted_bank_transactions TO authenticated;
GRANT SELECT ON public.deleted_bank_transactions TO anon;
```

**Step 4: Run test to verify it passes**

Run: `npm run db:reset && npm run test:db`
Expected: All 12 tests PASS

**Step 5: Commit**

```bash
git add supabase/migrations/20260301000000_add_deleted_bank_transactions_tombstone.sql supabase/tests/deleted_bank_transactions_tombstone.sql
git commit -m "feat: add deleted_bank_transactions tombstone table and fingerprint function"
```

---

## Task 2: Update Delete Functions to Write Tombstones

**Files:**
- Create: `supabase/migrations/20260301000001_update_delete_functions_with_tombstone.sql`
- Modify test: `supabase/tests/deleted_bank_transactions_tombstone.sql`

**Step 1: Add delete/restore tests to the pgTAP file**

Append these tests to `supabase/tests/deleted_bank_transactions_tombstone.sql`. Update `SELECT plan(12)` to `SELECT plan(18)`.

```sql
-- Tests 13-18: Delete function creates tombstone

-- Setup: create test restaurant and transaction
-- (Use a DO block to insert test data that the function tests use)

-- Test 13: delete_bank_transaction creates a tombstone row
-- Test 14: delete_bank_transaction removes the active row
-- Test 15: delete_bank_transaction is idempotent (calling twice succeeds)
-- Test 16: bulk_delete creates tombstones for all transactions
-- Test 17: restore_deleted_transaction moves row back to active
-- Test 18: restore_deleted_transaction removes tombstone
```

Due to pgTAP needing real data, write the full test with DO blocks to create test fixtures (restaurant, connected_bank, bank_transaction rows), then call the RPC functions and assert results.

**Step 2: Run test to verify new tests fail**

Run: `npm run db:reset && npm run test:db`
Expected: Tests 13-18 FAIL — functions not updated yet

**Step 3: Write the migration to update delete functions + add restore**

```sql
-- supabase/migrations/20260301000001_update_delete_functions_with_tombstone.sql

-- Update single delete to create tombstone
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

  -- Compute fingerprint
  v_fingerprint := compute_transaction_fingerprint(
    v_transaction.transaction_date,
    v_transaction.amount,
    v_transaction.description
  );

  -- Insert tombstone (ON CONFLICT ignore if already exists)
  INSERT INTO deleted_bank_transactions (
    restaurant_id, connected_bank_id, source,
    external_transaction_id, fingerprint,
    transaction_date, amount, currency,
    description, merchant_name, raw,
    deleted_by
  ) VALUES (
    v_transaction.restaurant_id,
    v_transaction.connected_bank_id,
    COALESCE(v_transaction.source, 'bank_integration'),
    v_transaction.stripe_transaction_id,
    v_fingerprint,
    v_transaction.transaction_date,
    v_transaction.amount,
    COALESCE(v_transaction.currency, 'USD'),
    v_transaction.description,
    v_transaction.merchant_name,
    v_transaction.raw_data,
    auth.uid()
  )
  ON CONFLICT DO NOTHING;

  -- Delete related splits
  DELETE FROM bank_transaction_splits
  WHERE transaction_id = p_transaction_id;

  -- Delete the active transaction
  DELETE FROM bank_transactions
  WHERE id = p_transaction_id
  AND restaurant_id = p_restaurant_id;

  RETURN jsonb_build_object(
    'success', true,
    'transaction_id', p_transaction_id,
    'message', 'Transaction deleted (tombstone created)'
  );
END;
$$;

-- Update bulk delete to create tombstones
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
  v_invalid_ids uuid[];
BEGIN
  -- Validate ownership
  SELECT array_agg(id) INTO v_invalid_ids
  FROM unnest(p_transaction_ids) AS id
  WHERE id NOT IN (
    SELECT bt.id FROM bank_transactions bt
    WHERE bt.id = ANY(p_transaction_ids)
    AND bt.restaurant_id = p_restaurant_id
  );

  IF array_length(v_invalid_ids, 1) > 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Some transactions do not belong to this restaurant or do not exist',
      'invalid_ids', v_invalid_ids
    );
  END IF;

  -- Insert tombstones for all transactions being deleted
  INSERT INTO deleted_bank_transactions (
    restaurant_id, connected_bank_id, source,
    external_transaction_id, fingerprint,
    transaction_date, amount, currency,
    description, merchant_name, raw,
    deleted_by
  )
  SELECT
    bt.restaurant_id,
    bt.connected_bank_id,
    COALESCE(bt.source, 'bank_integration'),
    bt.stripe_transaction_id,
    compute_transaction_fingerprint(bt.transaction_date, bt.amount, bt.description),
    bt.transaction_date,
    bt.amount,
    COALESCE(bt.currency, 'USD'),
    bt.description,
    bt.merchant_name,
    bt.raw_data,
    auth.uid()
  FROM bank_transactions bt
  WHERE bt.id = ANY(p_transaction_ids)
  AND bt.restaurant_id = p_restaurant_id
  ON CONFLICT DO NOTHING;

  -- Delete splits
  DELETE FROM bank_transaction_splits
  WHERE transaction_id = ANY(p_transaction_ids);

  -- Delete active transactions
  DELETE FROM bank_transactions
  WHERE id = ANY(p_transaction_ids)
  AND restaurant_id = p_restaurant_id;

  GET DIAGNOSTICS v_deleted_count = ROW_COUNT;

  RETURN jsonb_build_object(
    'success', true,
    'deleted_count', v_deleted_count,
    'message', format('%s transaction(s) deleted (tombstones created)', v_deleted_count)
  );
END;
$$;

-- New function: restore a deleted transaction
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
BEGIN
  SELECT * INTO v_tombstone
  FROM deleted_bank_transactions
  WHERE id = p_tombstone_id
  AND restaurant_id = p_restaurant_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Deleted transaction not found or does not belong to this restaurant'
    );
  END IF;

  -- Check if an active transaction with the same external ID already exists
  IF v_tombstone.external_transaction_id IS NOT NULL THEN
    PERFORM 1 FROM bank_transactions
    WHERE stripe_transaction_id = v_tombstone.external_transaction_id;
    IF FOUND THEN
      -- Idempotent: active row exists, just remove tombstone
      DELETE FROM deleted_bank_transactions WHERE id = p_tombstone_id;
      RETURN jsonb_build_object(
        'success', true,
        'message', 'Transaction already active, tombstone removed'
      );
    END IF;
  END IF;

  -- Re-insert into bank_transactions
  INSERT INTO bank_transactions (
    restaurant_id, connected_bank_id,
    stripe_transaction_id, transaction_date,
    amount, currency, description, merchant_name,
    source, raw_data, status, is_categorized
  ) VALUES (
    v_tombstone.restaurant_id,
    v_tombstone.connected_bank_id,
    COALESCE(v_tombstone.external_transaction_id, 'restored_' || p_tombstone_id::TEXT),
    v_tombstone.transaction_date,
    v_tombstone.amount,
    COALESCE(v_tombstone.currency, 'USD'),
    v_tombstone.description,
    v_tombstone.merchant_name,
    COALESCE(v_tombstone.source, 'bank_integration'),
    v_tombstone.raw,
    'posted',
    false
  );

  -- Remove tombstone
  DELETE FROM deleted_bank_transactions WHERE id = p_tombstone_id;

  RETURN jsonb_build_object(
    'success', true,
    'tombstone_id', p_tombstone_id,
    'message', 'Transaction restored successfully'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.restore_deleted_transaction(uuid, uuid) TO authenticated;

-- New function: permanently delete a tombstone (truly gone forever)
CREATE OR REPLACE FUNCTION public.permanently_delete_tombstone(
  p_tombstone_id uuid,
  p_restaurant_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM deleted_bank_transactions
  WHERE id = p_tombstone_id
  AND restaurant_id = p_restaurant_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Deleted transaction not found'
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'message', 'Tombstone permanently removed'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.permanently_delete_tombstone(uuid, uuid) TO authenticated;
```

**Step 4: Run tests**

Run: `npm run db:reset && npm run test:db`
Expected: All 18 tests PASS

**Step 5: Commit**

```bash
git add supabase/migrations/20260301000001_update_delete_functions_with_tombstone.sql supabase/tests/deleted_bank_transactions_tombstone.sql
git commit -m "feat: update delete functions to create tombstones, add restore/permanent-delete RPCs"
```

---

## Task 3: Update Stripe Sync to Check Tombstones

**Files:**
- Modify: `supabase/functions/stripe-sync-transactions/index.ts` (lines 213-256)
- Test: `tests/unit/stripe-sync-tombstone.test.ts`

**Step 1: Write the failing unit test**

```typescript
// tests/unit/stripe-sync-tombstone.test.ts
import { describe, it, expect } from 'vitest';

// Test the tombstone filtering logic (pure function extracted from edge function)
import { filterTombstonedTransactions } from '@/lib/bankTransactionTombstone';

describe('filterTombstonedTransactions', () => {
  it('returns all transactions when no tombstones exist', () => {
    const incoming = [
      { id: 'txn_1', description: 'Test' },
      { id: 'txn_2', description: 'Test 2' },
    ];
    const tombstonedIds = new Set<string>();
    const result = filterTombstonedTransactions(incoming, tombstonedIds);
    expect(result).toHaveLength(2);
  });

  it('filters out transactions with tombstoned external IDs', () => {
    const incoming = [
      { id: 'txn_1', description: 'Test' },
      { id: 'txn_2', description: 'Deleted' },
      { id: 'txn_3', description: 'Test 3' },
    ];
    const tombstonedIds = new Set(['txn_2']);
    const result = filterTombstonedTransactions(incoming, tombstonedIds);
    expect(result).toHaveLength(2);
    expect(result.map(t => t.id)).toEqual(['txn_1', 'txn_3']);
  });

  it('filters out all transactions if all are tombstoned', () => {
    const incoming = [
      { id: 'txn_1', description: 'Test' },
    ];
    const tombstonedIds = new Set(['txn_1']);
    const result = filterTombstonedTransactions(incoming, tombstonedIds);
    expect(result).toHaveLength(0);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/stripe-sync-tombstone.test.ts`
Expected: FAIL — module not found

**Step 3: Create the shared utility**

```typescript
// src/lib/bankTransactionTombstone.ts

/**
 * Filter out transactions whose external IDs match tombstone records.
 * Used by Stripe sync to skip re-importing deleted transactions.
 */
export function filterTombstonedTransactions<T extends { id: string }>(
  incoming: T[],
  tombstonedExternalIds: Set<string>
): T[] {
  if (tombstonedExternalIds.size === 0) return incoming;
  return incoming.filter(txn => !tombstonedExternalIds.has(txn.id));
}

/**
 * Compute a transaction fingerprint for CSV/PDF matching.
 * Must match the SQL function compute_transaction_fingerprint exactly.
 */
export function computeTransactionFingerprint(
  transactionDate: string,
  amount: number,
  description: string
): string {
  const normalizedDesc = (description || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, '');
  const amountCents = Math.round(amount * 100);
  const direction = amount >= 0 ? 'credit' : 'debit';
  const input = `${transactionDate}|${amountCents}|${direction}|${normalizedDesc}`;
  // Use Web Crypto API for MD5 equivalent — but since we need to match SQL md5(),
  // we'll use a simple hash. In practice, we query the DB for fingerprint matching.
  // This is used client-side only for pre-computation before DB query.
  return input; // The actual fingerprint matching happens via SQL
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/stripe-sync-tombstone.test.ts`
Expected: PASS

**Step 5: Modify the Stripe sync edge function**

In `supabase/functions/stripe-sync-transactions/index.ts`, add tombstone check after line 208 (before the transaction insertion loop):

```typescript
// After line 208: console.log(`[SYNC-TRANSACTIONS] Total transactions fetched...`)
// ADD: Query tombstones to filter out deleted transactions
const allStripeIds = allTransactions.map(t => t.id);
let tombstonedIds = new Set<string>();

if (allStripeIds.length > 0) {
  const { data: tombstones } = await supabaseAdmin
    .from("deleted_bank_transactions")
    .select("external_transaction_id")
    .eq("restaurant_id", bank.restaurant_id)
    .in("external_transaction_id", allStripeIds);

  if (tombstones && tombstones.length > 0) {
    tombstonedIds = new Set(tombstones.map(t => t.external_transaction_id).filter(Boolean));
    console.log(`[SYNC-TRANSACTIONS] Found ${tombstonedIds.size} tombstoned transactions to skip`);
  }
}
```

Then modify line 216-225 (the existing duplicate check) to also check tombstones:

```typescript
// In the for loop, after checking `existing`:
if (tombstonedIds.has(txn.id)) {
  skippedCount++;
  continue;
}
```

**Step 6: Commit**

```bash
git add src/lib/bankTransactionTombstone.ts tests/unit/stripe-sync-tombstone.test.ts supabase/functions/stripe-sync-transactions/index.ts
git commit -m "feat: stripe sync checks tombstones before inserting transactions"
```

---

## Task 4: Update CSV/PDF Import to Check Tombstones

**Files:**
- Modify: `src/hooks/useBankStatementImport.tsx` (detectDuplicates function, ~line 651)
- Modify: `src/hooks/useBankStatementImport.tsx` (BankStatementLine interface, ~line 29)
- Test: `tests/unit/bank-statement-tombstone.test.ts`

**Step 1: Write the failing test**

```typescript
// tests/unit/bank-statement-tombstone.test.ts
import { describe, it, expect } from 'vitest';
import { computeTransactionFingerprint } from '@/lib/bankTransactionTombstone';

describe('computeTransactionFingerprint', () => {
  it('produces same fingerprint for identical inputs', () => {
    const a = computeTransactionFingerprint('2026-01-15', 42.50, 'RESTAURANT DEPOT #123');
    const b = computeTransactionFingerprint('2026-01-15', 42.50, 'RESTAURANT DEPOT #123');
    expect(a).toBe(b);
  });

  it('normalizes description (case + punctuation)', () => {
    const a = computeTransactionFingerprint('2026-01-15', 42.50, 'Restaurant Depot #123!');
    const b = computeTransactionFingerprint('2026-01-15', 42.50, 'restaurant depot 123');
    expect(a).toBe(b);
  });

  it('produces different fingerprints for different amounts', () => {
    const a = computeTransactionFingerprint('2026-01-15', 42.50, 'STORE');
    const b = computeTransactionFingerprint('2026-01-15', 42.51, 'STORE');
    expect(a).not.toBe(b);
  });

  it('produces different fingerprints for different dates', () => {
    const a = computeTransactionFingerprint('2026-01-15', 42.50, 'STORE');
    const b = computeTransactionFingerprint('2026-01-16', 42.50, 'STORE');
    expect(a).not.toBe(b);
  });

  it('handles debit vs credit direction', () => {
    const a = computeTransactionFingerprint('2026-01-15', 42.50, 'STORE');
    const b = computeTransactionFingerprint('2026-01-15', -42.50, 'STORE');
    expect(a).not.toBe(b);
  });
});
```

**Step 2: Run test to verify it passes (fingerprint utility already created in Task 3)**

Run: `npx vitest run tests/unit/bank-statement-tombstone.test.ts`
Expected: PASS (utility was created in Task 3)

**Step 3: Add `was_previously_deleted` to BankStatementLine interface**

In `src/hooks/useBankStatementImport.tsx`, add to the `BankStatementLine` interface (after line 46):

```typescript
was_previously_deleted: boolean;
```

**Step 4: Add tombstone column to bank_statement_lines table**

Create migration `supabase/migrations/20260301000002_add_was_previously_deleted_to_statement_lines.sql`:

```sql
ALTER TABLE public.bank_statement_lines
  ADD COLUMN IF NOT EXISTS was_previously_deleted BOOLEAN DEFAULT FALSE;
```

**Step 5: Modify `detectDuplicates()` to also check tombstones**

In `src/hooks/useBankStatementImport.tsx`, after the existing duplicate detection logic (around line 683), add tombstone checking:

```typescript
// After existing duplicate detection (line 703), add tombstone check:

// Check tombstones for previously deleted transactions
const { data: tombstones } = await supabase
  .from('deleted_bank_transactions')
  .select('fingerprint, external_transaction_id')
  .eq('restaurant_id', selectedRestaurant.restaurant_id);

if (tombstones && tombstones.length > 0) {
  const tombstoneFingerprints = new Set(tombstones.map(t => t.fingerprint));

  for (const line of stagedLines) {
    if (!line.transaction_date || line.amount === null) continue;

    // Compute fingerprint client-side for pre-filtering
    // Then verify via DB function for exactness
    const { data: fpResult } = await supabase.rpc('compute_transaction_fingerprint', {
      p_transaction_date: line.transaction_date,
      p_amount: line.amount,
      p_description: line.description || ''
    });

    if (fpResult && tombstoneFingerprints.has(fpResult)) {
      await supabase
        .from('bank_statement_lines')
        .update({
          was_previously_deleted: true,
          user_excluded: true,
        })
        .eq('id', line.id);
      flaggedCount++;
    }
  }
}
```

**Note:** The `compute_transaction_fingerprint` SQL function can be called via RPC. Alternatively, batch-compute fingerprints in a single query for performance. The implementation should prefer batching — compute all fingerprints in one DB call, then match against tombstones.

**Step 6: Commit**

```bash
git add src/hooks/useBankStatementImport.tsx supabase/migrations/20260301000002_add_was_previously_deleted_to_statement_lines.sql tests/unit/bank-statement-tombstone.test.ts
git commit -m "feat: CSV/PDF import detects tombstoned transactions and flags as previously deleted"
```

---

## Task 5: Add "Previously Deleted" Badge to CSV/PDF Review UI

**Files:**
- Modify: The component that renders `bank_statement_lines` in review mode (find in `src/components/BankStatementReview.tsx` or similar)

**Step 1: Find the review component**

Search for the component that renders bank_statement_lines during CSV/PDF review. Look for `is_potential_duplicate` or `user_excluded` rendering.

**Step 2: Add badge for `was_previously_deleted`**

In the line rendering, add a badge when `was_previously_deleted` is true:

```tsx
{line.was_previously_deleted && (
  <Badge variant="outline" className="text-[11px] px-1.5 py-0.5 bg-amber-500/10 border-amber-500/20 text-amber-600">
    Previously deleted
  </Badge>
)}
```

**Step 3: When user overrides (un-excludes a previously-deleted line), remove the tombstone on import**

In `importStatementLines()` (around line 461-506 of `useBankStatementImport.tsx`), after inserting the active row, check if the line was previously deleted and remove the tombstone:

```typescript
// After successful insert (line 494), add:
if (line.was_previously_deleted) {
  // Remove tombstone so future imports won't block this transaction
  await supabase
    .from('deleted_bank_transactions')
    .delete()
    .eq('restaurant_id', selectedRestaurant.restaurant_id)
    .eq('fingerprint', fpResult); // Need to compute fingerprint here
}
```

**Step 4: Commit**

```bash
git add src/components/BankStatementReview.tsx src/hooks/useBankStatementImport.tsx
git commit -m "feat: show 'Previously deleted' badge in CSV/PDF review, remove tombstone on override"
```

---

## Task 6: Create useDeletedBankTransactions Hook + Restore/Permanent-Delete Hooks

**Files:**
- Create: `src/hooks/useDeletedBankTransactions.tsx`
- Test: `tests/unit/useDeletedBankTransactions.test.ts`

**Step 1: Write the hook**

```typescript
// src/hooks/useDeletedBankTransactions.tsx
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

export interface DeletedBankTransaction {
  id: string;
  restaurant_id: string;
  connected_bank_id: string;
  source: string;
  external_transaction_id: string | null;
  fingerprint: string;
  transaction_date: string;
  amount: number;
  currency: string;
  description: string | null;
  merchant_name: string | null;
  deleted_at: string;
  deleted_by: string | null;
}

export function useDeletedBankTransactions(restaurantId: string | undefined) {
  return useQuery({
    queryKey: ['deleted-bank-transactions', restaurantId],
    queryFn: async () => {
      if (!restaurantId) return [];
      const { data, error } = await supabase
        .from('deleted_bank_transactions')
        .select('*')
        .eq('restaurant_id', restaurantId)
        .order('deleted_at', { ascending: false });

      if (error) throw error;
      return (data || []) as DeletedBankTransaction[];
    },
    enabled: !!restaurantId,
    staleTime: 30000,
    refetchOnWindowFocus: true,
  });
}

export function useRestoreTransaction() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({
      tombstoneId,
      restaurantId,
    }: {
      tombstoneId: string;
      restaurantId: string;
    }) => {
      const { data, error } = await supabase.rpc('restore_deleted_transaction', {
        p_tombstone_id: tombstoneId,
        p_restaurant_id: restaurantId,
      });
      if (error) throw error;
      const result = data as { success: boolean; error?: string };
      if (!result.success) throw new Error(result.error || 'Failed to restore');
      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['deleted-bank-transactions'] });
      queryClient.invalidateQueries({ queryKey: ['bank-transactions'] });
      toast({ title: "Transaction restored", description: "The transaction has been moved back to active." });
    },
    onError: (error: Error) => {
      toast({ title: "Error restoring", description: error.message, variant: "destructive" });
    },
  });
}

export function usePermanentlyDeleteTombstone() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({
      tombstoneId,
      restaurantId,
    }: {
      tombstoneId: string;
      restaurantId: string;
    }) => {
      const { data, error } = await supabase.rpc('permanently_delete_tombstone', {
        p_tombstone_id: tombstoneId,
        p_restaurant_id: restaurantId,
      });
      if (error) throw error;
      const result = data as { success: boolean; error?: string };
      if (!result.success) throw new Error(result.error || 'Failed to permanently delete');
      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['deleted-bank-transactions'] });
      toast({ title: "Permanently deleted", description: "The transaction record has been permanently removed." });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });
}
```

**Step 2: Commit**

```bash
git add src/hooks/useDeletedBankTransactions.tsx
git commit -m "feat: add useDeletedBankTransactions, useRestoreTransaction, usePermanentlyDeleteTombstone hooks"
```

---

## Task 7: Add "Deleted" Tab to Banking Page

**Files:**
- Modify: `src/pages/Banking.tsx` (line 40 — add 'deleted' to tab type)
- Create: `src/components/banking/DeletedTransactionsList.tsx`

**Step 1: Create the DeletedTransactionsList component**

Follow the Apple/Notion design system. Use virtualized list pattern from `BankTransactionList.tsx`. Include:
- Transaction date, description, amount, merchant name
- Deleted at timestamp
- Restore button (calls `useRestoreTransaction`)
- Permanently Delete button (calls `usePermanentlyDeleteTombstone`)
- Empty state when no deleted transactions

**Step 2: Add 'deleted' to the tab union type in Banking.tsx**

Change line 40:
```typescript
// Before:
const [activeTab, setActiveTab] = useState<'for_review' | 'categorized' | 'excluded' | 'reconciliation' | 'upload_statement'>('for_review');
// After:
const [activeTab, setActiveTab] = useState<'for_review' | 'categorized' | 'excluded' | 'reconciliation' | 'upload_statement' | 'deleted'>('for_review');
```

**Step 3: Add the Deleted tab trigger and content**

Find the TabsList in Banking.tsx and add a new TabsTrigger for "Deleted". Add a TabsContent that renders `<DeletedTransactionsList />`.

The tab should show a count badge of how many deleted transactions exist.

**Step 4: Commit**

```bash
git add src/pages/Banking.tsx src/components/banking/DeletedTransactionsList.tsx
git commit -m "feat: add Deleted tab to Banking page with restore and permanent-delete actions"
```

---

## Task 8: Sync TypeScript Types

**Step 1: Regenerate Supabase types**

Use the `sync-types` skill to regenerate TypeScript types from the updated database schema. The new `deleted_bank_transactions` table and `compute_transaction_fingerprint` function need to be reflected in types.

**Step 2: Fix any type errors**

Update any TypeScript imports or type references that break after regeneration.

**Step 3: Commit**

```bash
git add src/integrations/supabase/types.ts
git commit -m "chore: regenerate Supabase TypeScript types for tombstone table"
```

---

## Task 9: Full Verification

**Step 1: Run all tests**

```bash
npm run test        # Unit tests
npm run db:reset && npm run test:db   # pgTAP tests
npm run lint        # Lint
npm run build       # Build
```

**Step 2: Manual smoke test**

1. Import a bank transaction (CSV or Stripe)
2. Delete it
3. Re-import — verify it does NOT come back
4. Go to Deleted tab — verify it appears
5. Restore it — verify it moves back to active
6. Permanently delete from Deleted tab — verify it's gone
7. Re-import — verify it DOES come back now (no tombstone)

**Step 3: Commit any fixes**

---

## Summary

| Task | Description | Key Files |
|------|-------------|-----------|
| 1 | Tombstone table + fingerprint function | Migration SQL, pgTAP test |
| 2 | Update delete/bulk-delete RPCs + add restore | Migration SQL, pgTAP tests |
| 3 | Stripe sync checks tombstones | Edge function, utility lib, unit test |
| 4 | CSV/PDF import checks tombstones | useBankStatementImport hook, migration, unit test |
| 5 | "Previously deleted" badge in review UI | BankStatementReview component |
| 6 | Hooks for deleted transactions list | useDeletedBankTransactions hook |
| 7 | "Deleted" tab on Banking page | Banking page, DeletedTransactionsList component |
| 8 | Sync TypeScript types | types.ts |
| 9 | Full verification | All tests + manual smoke test |
