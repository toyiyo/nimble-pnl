# Design: Persist payee/supplier/notes on no-op-category categorize

**Date:** 2026-07-09
**Type:** Bug fix (database RPC)
**Branch:** `fix/categorize-noop-metadata`

## Problem

On `/banking`, setting a **payee/supplier** on a transaction that is *already
categorized* shows a success toast ("Transaction categorized") but the value
never displays after refetch.

Reproduction (deterministic):
1. Open a bank transaction that already has a category (e.g. a Shift4 POS
   processing fee already categorized as "POS processing fees").
2. In the detail sheet, set Payee/Supplier to a supplier (e.g. "Cold Stone
   Creamery"), keeping the same category. Save.
3. Toast says saved; the supplier/payee is not shown on the row or on reopen.

## Root cause

`categorize_bank_transaction` (latest definition:
`supabase/migrations/20251021204739_73ec6be4-...sql`, lines 118-126) has a
short-circuit that returns early **when the category does not change**:

```sql
IF v_is_reclassification AND v_original_category_id = p_category_id THEN
  RETURN jsonb_build_object('success', true, ...);   -- returns HERE
END IF;
```

This short-circuit was added intentionally to avoid emitting a spurious
*reclassification* journal entry for a no-op category change. But it returns
**before** the `UPDATE bank_transactions` (lines 248-256) that persists
`normalized_payee`, `supplier_id`, and `notes`. So a metadata-only edit that
keeps the same category is silently dropped:

- RPC returns `success: true` → `onSuccess` fires → toast shows "saved".
- `supplier_id` / `normalized_payee` were never written → React Query refetch
  shows the old row → "it doesn't display it".

The **display path is correct** — `useBankTransactions` already joins
`supplier:suppliers(id, name)` and selects `normalized_payee`. The defect is
entirely in the write path.

### Who can reach the short-circuit

Only UI callers. The rules engine
(`apply_matching_rules_to_bank_transactions_batch`, migration
`20251127120000`) selects `is_categorized = false OR category_id IS NULL`
only (line 156), so it can never satisfy the short-circuit's
`v_is_reclassification` precondition (`is_categorized = true AND category_id
IS NOT NULL`). Confirmed for all `PERFORM categorize_bank_transaction` call
sites. UI callers: `TransactionDetailSheet.handleSave` (passes
description/payee/supplier) and `Transactions.tsx.handleCategorize` (passes
neither description, payee, nor supplier).

## Fix

Add a metadata-preserving `UPDATE` inside the short-circuit branch, before the
early `RETURN`. Keep the journal-entry skip (that part is correct — no ledger
movement for a no-op category).

```sql
IF v_is_reclassification AND v_original_category_id = p_category_id THEN
  -- Category unchanged: no journal entry needed (skipping rebuild_account_balances
  -- is correct — no ledger movement), but still persist metadata edits
  -- (payee / supplier / notes) so a UI "Save" is not a silent no-op.
  UPDATE bank_transactions
  SET
    normalized_payee = COALESCE(p_normalized_payee, normalized_payee),
    supplier_id      = COALESCE(p_supplier_id, supplier_id),
    -- COALESCE (preserve-on-null), NOT the main path's unconditional
    -- `notes = p_description`: Transactions.tsx calls this RPC with
    -- p_description = NULL, so an unconditional write here would wipe a user's
    -- note on a same-category call. Intentional asymmetry — do not "fix".
    notes            = COALESCE(p_description, notes),
    updated_at       = now()
  WHERE id = p_transaction_id;

  RETURN jsonb_build_object(
    'success', true,
    'journal_entry_id', NULL,
    'is_reclassification', false,
    'transaction_id', p_transaction_id
  );
END IF;
```

Delivered as a new migration that `CREATE OR REPLACE`s the whole function
(copying the latest body verbatim and inserting only this block). `CREATE OR
REPLACE` preserves existing GRANTs. **The inline `notes` comment above must
appear verbatim in the migration** (Phase 2.5 review) so a future reader does
not collapse the intentional asymmetry.

### Decided trade-offs

- **`notes` uses `COALESCE(p_description, notes)`** (preserve-on-null), not the
  unconditional `notes = p_description` used by the main path. Rationale:
  `Transactions.tsx` calls the RPC with `p_description = NULL`; if it ever
  targets an already-categorized txn at the same category, an unconditional
  overwrite would wipe a user's manual note. Preserve-on-null is also
  consistent with how `normalized_payee`/`supplier_id` are already handled here
  ("preserve … with COALESCE"). Consequence: a user cannot *clear* notes to
  empty via a no-op-category edit — acceptable, and moot in practice because
  the detail sheet already sends `description || undefined` (empty string never
  reaches the RPC as a value).
- **Clearing a supplier is still not supported** (`COALESCE` keeps the existing
  value when `NULL` is passed). Unchanged from current behavior; out of scope.
- **No frontend change.** The React Query invalidation and supplier join
  already exist; once the write persists, the refetch displays it.
- **Tenant-scope guard hoisted (scope expansion, post-review).** Codex (Phase
  7b) and CodeRabbit (PR review) both flagged that `p_supplier_id` is written
  without verifying it belongs to the transaction's restaurant — a cross-tenant
  supplier-link gap on a `SECURITY DEFINER` function whose `supplier_id` column
  has only a plain FK to `suppliers(id)`. The gap existed in both the new no-op
  branch and the pre-existing main path. Rather than guard only the new branch,
  the guard is **hoisted** to run once right after the membership auth check, so
  it sanitizes `p_supplier_id` (reset to `NULL` when not visible to the
  restaurant) for both the short-circuit and the main categorize/reclassify
  UPDATE. Silently dropping (not raising) matches the metadata-preserving intent
  and the COALESCE-preserve semantics. Justification for expanding beyond the
  original "only the new block" scope: two independent reviewers flagged the same
  defensive gap in the exact function being replaced, and a sibling guard already
  existed — per `memory/lessons.md`, consistency + security outrank the
  minimal-diff default here.

## Test plan

New pgTAP test `supabase/tests/categorize_noop_preserves_metadata.sql`
(modeled on `categorize_transfer_account.sql`):

1. Categorize a txn to category A (initial categorization creates the row +
   journal entry).
2. Re-call `categorize_bank_transaction` with the **same** category A plus a
   `supplier_id` and `normalized_payee` → assert both are persisted and
   `journal_entry_id` is NULL / `is_reclassification` false (short-circuit
   still skips the ledger).
3. Assert `notes` is preserved when `p_description` is NULL on a no-op call.
4. Regression: assert no extra reclassification journal entry was created for
   the no-op call.
5. Cross-tenant guard (no-op branch): passing a foreign-restaurant supplier UUID
   on a no-op call leaves the own-tenant `supplier_id` intact.
6. Cross-tenant guard (main path): reclassifying to a different category while
   passing a foreign-restaurant supplier UUID also preserves the own-tenant
   `supplier_id` (proves the hoisted guard covers the main path).

Dates computed relative to `CURRENT_DATE` (no hardcoded future dates).
12 assertions total.
