# Plan: preserve Focus voids as auditable negative offsets

Design: `docs/superpowers/specs/2026-07-12-focus-preserve-voids-design.md`
Branch: `fix/focus-preserve-voids`

## Task 1 — Handler: soft-delete on DeleteRecord (unit-tested)
- **RED** (`tests/unit/focusTransactionSyncHandler.test.ts`): a datafeed with a
  `<DeleteRecord>` for check X drives `focus_orders.update({ is_voided:true,
  voided_at:<iso> })` scoped to restaurant+business_date+focus_check_id — assert
  `.update` called with those args and **`.delete` NOT called**.
- **GREEN** (`focusTransactionSyncHandler.ts`): replace the DeleteRecord
  `.delete()` loop with the `.update({is_voided,voided_at})` version (keep the
  `voidMarkFailed`→don't-record-fingerprint retry semantics; rename var).
- **Files:** handler + its test. **Dep:** none.

## Task 2 — Migration: focus_orders columns + RPC void branch (pgTAP)
- **Pre-flight:** re-pull `pg_get_functiondef` of `_impl`; assert it contains
  `apply_rules_to_pos_sales_internal` and not `auth.uid()`; re-check the newest
  migration timestamp (use `20260713020000`, after `20260713010000_harden_…`).
- **RED** (`supabase/tests/47_focus_transactions_unified_sales.sql`, plan +N):
  seed order C (priced item → sale + payment tip + item discount + tax_amount)
  and a **user split row** under it; sync → assert its 4 row kinds exist. Set
  `focus_orders.is_voided=true` for C; re-run
  `sync_focus_transactions_to_unified_sales(r,d,d)`; assert:
  - C's `sale`/`tip`/`discount`/`tax` rows (parent_sale_id IS NULL) are **gone**;
  - exactly **one** `adjustment_type='void'` row for C with `total_price =
    -SUM(priced items)`;
  - the **split child is also removed** (whole check gone); a **sibling order
    untouched**;
  - `revenue` (`item_type='sale' AND adjustment_type IS NULL`) dropped by C's
    amount; `SUM(total_price) WHERE adjustment_type='void'` = negated revenue.
  Run against pre-migration state → confirm FAIL.
- **GREEN** (`supabase/migrations/20260713020000_focus_preserve_voids.sql`):
  1. `ALTER TABLE focus_orders ADD is_voided boolean NOT NULL DEFAULT false,
     ADD voided_at timestamptz;`
  2. `CREATE OR REPLACE _impl(...)` = live body + `fo.is_voided` in the loop
     SELECT + the `IF v_order.is_voided THEN <delete revenue rows + upsert one
     _void offset> ELSE <existing Steps 1–6 + parent_sale_id-guarded stale-void
     cleanup> END IF;`
  3. `REVOKE ALL … FROM PUBLIC; GRANT EXECUTE … TO service_role;`
  Apply locally; re-run test 47 → all GREEN.
- **Dep:** Task 1 (semantics), but migration is independent to author.

## Task 3 — Verify + follow-ups
- `npm run test` (handler unit), `npm run test:db` (fresh `db:reset`),
  `typecheck`, lint.
- File follow-up chips: legacy hard-deleted-orphan cleanup; tighten the
  permissive `adjustment_type` CHECK; focus_order_items/payments retention;
  (Voids report UI already a chip via earlier scope Q).

## Notes
- No UI changes → Phase 5 skipped.
- Read layer verified: `void` excluded from revenue/discount/pass-through — no
  consumer changes.
