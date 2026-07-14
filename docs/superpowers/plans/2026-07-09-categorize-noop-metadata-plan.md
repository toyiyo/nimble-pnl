# Plan: Persist payee/supplier/notes on no-op-category categorize

**Design:** `docs/superpowers/specs/2026-07-09-categorize-noop-metadata-design.md`
**Branch:** `fix/categorize-noop-metadata`

## Tasks

### Task 1 — Write failing pgTAP test (RED)
- Create `supabase/tests/categorize_noop_preserves_metadata.sql`.
- Model on `supabase/tests/categorize_transfer_account.sql` (fixture pattern,
  `SET LOCAL role`, `request.jwt.claims`, ON CONFLICT DO UPDATE).
- Fixtures: auth user, restaurant, `user_restaurants` (owner), chart_of_accounts
  (1000 Cash + one expense category), connected_bank, one bank_transaction
  (uncategorized, negative amount). Dates relative to `CURRENT_DATE`.
- Steps/assertions:
  1. Initial categorize to expense category A → succeeds.
  2. Re-call with **same** category A + `p_supplier_id` + `p_normalized_payee`
     → assert `supplier_id` and `normalized_payee` now persisted.
  3. Assert the no-op call returned `is_reclassification = false` and
     `journal_entry_id IS NULL` (short-circuit still skips ledger).
  4. Assert `notes` preserved when `p_description` is NULL on the no-op call
     (set a note first via the initial categorize's description, then confirm
     it survives the metadata-only call).
  5. Regression: assert the journal-entries count for the txn did not increase
     on the no-op call (no spurious reclassification entry).
- Dependency: none. Expected to FAIL against current function.

### Task 2 — Migration: replace function with metadata-preserving short-circuit (GREEN)
- Create `supabase/migrations/20260709120000_categorize_preserve_metadata_on_noop.sql`
  (bump timestamp if a newer migration has landed; must sort last).
- `CREATE OR REPLACE FUNCTION public.categorize_bank_transaction(...)` copying
  the full latest body from `20251021204739_...sql` verbatim, inserting only the
  metadata `UPDATE ... COALESCE(...)` block inside the short-circuit `IF` before
  its `RETURN` (per design doc).
- Preserve signature, `SECURITY DEFINER`, `SET search_path TO 'public'`, the
  membership auth check, and all journal-entry logic unchanged.
- Header comment explaining the fix + pointer to the design doc.
- Verify test from Task 1 now passes.

### Task 3 — Verify & regression sweep
- `npm run test:db` (pgTAP) — new test green, existing
  `categorize_transfer_account.sql` + `categorization_background_rules.test.sql`
  still green.
- `npm run typecheck`, `npm run lint`, `npm run build` (no TS change expected,
  but run to be safe).
- No frontend change — confirm supplier join + invalidation already present.

## Notes / risks
- Migration-timestamp collision: pick a timestamp strictly greater than the
  latest existing migration.
- No `is_transfer` change; no read-path change; scope is the write path only.
- Fold any Phase 2.5 supabase-design-reviewer concerns before Task 2.
