# Deleted Bank Transactions Tombstone Design

**Date:** 2026-03-01
**Status:** Approved
**Problem:** Deleted bank transactions are re-created on subsequent imports (Stripe sync + CSV/PDF)

---

## Domain Decision

### Goal
If a customer deletes a bank transaction, future imports (Stripe sync + CSV/PDF) must **not recreate it**, unless the user explicitly restores or overrides it.

### Key Rule
**Deletion is a business action, not data loss.** We preserve a "tombstone" (proof of deletion) that import pipelines consult. The main `bank_transactions` table stays clean — no soft-delete columns, no query changes needed for existing calculations.

---

## Business Rules (Source-Agnostic)

### Entities
- **BankTransaction** — active transaction used in reports/calculations
- **DeletedBankTransaction (Tombstone)** — record that "this transaction was intentionally excluded"

### Invariants
1. **Active calculations MUST ignore deleted transactions** — ensured by physically removing the row from `bank_transactions`
2. **A deleted transaction MUST block re-import** — if an import record maps to a tombstone, importer must mark it as excluded and must not insert into `bank_transactions`
3. **Restore is the only way to re-activate** — restore moves the record back to `bank_transactions` and removes the tombstone
4. **Users can override during CSV/PDF review** — override is functionally equivalent to "restore + import"

---

## Data Model

### Table: `deleted_bank_transactions`

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | `gen_random_uuid()` |
| `restaurant_id` | UUID NOT NULL | FK to restaurants |
| `connected_bank_id` | UUID NOT NULL | Original bank connection |
| `source` | TEXT NOT NULL | `bank_integration`, `csv_import`, `manual_upload` |
| `external_provider` | TEXT NULL | `stripe`, etc. |
| `external_transaction_id` | TEXT NULL | Stripe unique id (stripe_transaction_id) |
| `fingerprint` | TEXT NOT NULL | Deterministic hash for CSV/PDF matching |
| `transaction_date` | DATE NOT NULL | |
| `amount` | NUMERIC(15,2) NOT NULL | |
| `currency` | TEXT | DEFAULT 'USD' |
| `description` | TEXT | |
| `merchant_name` | TEXT | |
| `raw` | JSONB NULL | Original payload for perfect restore |
| `deleted_at` | TIMESTAMPTZ NOT NULL | DEFAULT NOW() |
| `deleted_by` | UUID NULL | Who deleted it |

### Constraints & Indexes
- `UNIQUE(restaurant_id, external_provider, external_transaction_id) WHERE external_transaction_id IS NOT NULL`
- `UNIQUE(restaurant_id, fingerprint)` — fingerprint already includes date+amount+description
- Index: `(restaurant_id, transaction_date)` — for date-range queries in Deleted tab
- Index: `(restaurant_id, external_transaction_id)` partial where not null — for Stripe lookups

### RLS Policies
- SELECT: users with restaurant access (same as bank_transactions)
- ALL: owners/managers only (same as bank_transactions)

---

## Fingerprint Rule (Critical for CSV/PDF)

For CSV/PDF imports without a stable provider ID, we need a deterministic fingerprint stable across re-uploads.

### Fingerprint Input
- `transaction_date` (YYYY-MM-DD)
- `amount` normalized to cents (integer)
- `direction` (debit/credit) derived from sign
- `normalized_description`

### Description Normalization
1. Trim whitespace
2. Lowercase
3. Collapse multiple whitespace to single space
4. Remove punctuation

### Matching Strategy: **Strict** (not similarity)
Start strict. Similarity matching creates false positives and will "keep deleted" things the user didn't actually delete.

### Fingerprint Computation (SQL function)
```sql
CREATE FUNCTION compute_transaction_fingerprint(
  p_transaction_date DATE,
  p_amount NUMERIC(15,2),
  p_description TEXT
) RETURNS TEXT AS $$
  SELECT md5(
    p_transaction_date::TEXT || '|' ||
    (p_amount * 100)::BIGINT::TEXT || '|' ||
    CASE WHEN p_amount >= 0 THEN 'credit' ELSE 'debit' END || '|' ||
    regexp_replace(lower(trim(COALESCE(p_description, ''))), '[[:punct:]]', '', 'g')
  );
$$ LANGUAGE sql IMMUTABLE;
```

---

## Command Rules

### DeleteBankTransaction(restaurant_id, bank_transaction_id)

**Single transaction (wraps in one DB transaction):**
1. Read the transaction row (must exist)
2. Compute fingerprint from its canonical fields
3. INSERT INTO `deleted_bank_transactions` with:
   - `external_transaction_id` if present (Stripe id)
   - `fingerprint`
   - Core fields + raw payload
4. DELETE FROM `bank_transactions`
5. DELETE FROM `bank_transaction_splits` (cascade or explicit)

**Idempotency:** If tombstone already exists (same external id OR same fingerprint), treat as success.

### BulkDeleteBankTransactions(restaurant_id, transaction_ids[])
Same logic in a loop/batch, all within one transaction.

### RestoreDeletedTransaction(deleted_bank_transaction_id)

1. Read tombstone row
2. Re-insert into `bank_transactions` from stored columns
3. Delete tombstone row

**Idempotency:** If active row already exists, remove tombstone and succeed.

### PermanentlyDeleteTransaction(deleted_bank_transaction_id)
Remove the tombstone record entirely. Transaction is truly gone — future imports will re-create it.

---

## Import Flow Rules

### Stripe Sync (Batch)
1. Fetch incoming transactions (list of external ids)
2. Query tombstones once:
   ```sql
   SELECT external_transaction_id
   FROM deleted_bank_transactions
   WHERE restaurant_id = ?
     AND external_provider = 'stripe'
     AND external_transaction_id = ANY($1)
   ```
3. Filter out blocked ids
4. Insert remaining

### CSV/PDF Import (Review Mode)
1. Parse rows → compute fingerprint for each candidate
2. Query tombstones once:
   ```sql
   SELECT fingerprint
   FROM deleted_bank_transactions
   WHERE restaurant_id = ?
     AND fingerprint = ANY($1)
   ```
3. Mark candidates:
   - `was_previously_deleted = true` (new field on `bank_statement_lines`)
   - `user_excluded = true` (default)
4. If user overrides:
   - Insert active row
   - Remove tombstone (by fingerprint match)

---

## UI Rules

### Bank Transactions Page — Tabs
- **Active** (existing view)
- **Deleted** (new tab)

### Deleted Tab
- Transaction date, description, amount, merchant name
- Deleted at, deleted by
- **Restore** button per row (moves back to active)
- **Permanently Delete** button (removes tombstone — truly gone)
- Bulk selection with restore/permanent-delete actions
- Virtualized list (same pattern as active transactions)

### CSV/PDF Review UI
- Rows matching tombstone: badge "Previously deleted"
- Included toggle defaults OFF
- Turning ON triggers restore + import

---

## Schema Changes Required

### New table
- `deleted_bank_transactions` (described above)

### New column on `bank_statement_lines`
- `was_previously_deleted BOOLEAN DEFAULT FALSE`

### Modified SQL functions
- `delete_bank_transaction` → insert tombstone before delete
- `bulk_delete_bank_transactions` → insert tombstones before bulk delete

### New SQL functions
- `compute_transaction_fingerprint(date, amount, description)` → IMMUTABLE
- `restore_deleted_transaction(tombstone_id, restaurant_id)` → move back + remove tombstone
- `permanently_delete_transaction(tombstone_id, restaurant_id)` → remove tombstone

### Modified hooks
- `useDeleteTransaction` → calls updated RPC
- `useBankStatementImport.detectDuplicates()` → also checks tombstones
- New: `useDeletedBankTransactions(restaurantId)` → fetch tombstone list
- New: `useRestoreTransaction()` → calls restore RPC

### Stripe sync changes
- Edge function that handles Stripe sync must query tombstones before inserting

---

## TDD Test Plan

### DB/Service Tests (pgTAP)
1. Delete active txn creates tombstone and removes active row
2. Delete is idempotent (run twice; still one tombstone, no active row)
3. Restore moves back to active and removes tombstone
4. Restore when active already exists → idempotent (tombstone removed)
5. Fingerprint computation is deterministic and stable
6. Tombstone blocks only within same restaurant_id (multi-tenant isolation)

### Importer Tests (Vitest)
7. Stripe import inserts new txn when no tombstone
8. Stripe import skips txn when tombstone exists by external id
9. After restore, next import treats it normally (no tombstone)
10. CSV/PDF candidate matching tombstone fingerprint is flagged and excluded
11. CSV/PDF override includes it and removes tombstone
12. Same statement re-upload after delete does not recreate active rows

### Concurrency
13. Delete and import race — delete inserts tombstone then deletes active, import sees tombstone and skips (transactional guarantee)

---

## Rollout Plan

1. Add tombstone table + indexes + fingerprint function (migration)
2. Update delete RPCs to write tombstone then delete active in a single DB transaction
3. Update Stripe importer to consult tombstones (batch query)
4. Update CSV/PDF importer to compute fingerprint + consult tombstones
5. Add Deleted tab UI + restore/permanent-delete endpoints
6. No backfill needed (can't recover past hard-deletes without audit logs)
