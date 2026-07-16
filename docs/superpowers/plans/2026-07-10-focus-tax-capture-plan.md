# Plan: Capture Focus POS tax into unified_sales

Design: `docs/superpowers/specs/2026-07-10-focus-tax-capture-design.md`
Branch: `fix/focus-tax-capture`

Each task = RED → GREEN → REFACTOR → COMMIT.

## Task 1 — Parser: sum SeatRecord.TaxTotal1..5 into FocusCheck.taxAmount
- **RED:** In `tests/unit/focusDatafeedParser.test.ts`, add cases:
  - fixture check 1 → `taxAmount === 3.46` (3.30 + 0.16); check 2 → `0.33`
  - multi-seat check → sum of both seats' `TaxTotal*`
  - check with no `SeatRecord` / no `TaxTotal*` → `0`
  - negative `TaxTotal` → negative sum (refund case)
- **GREEN:** `focusDatafeedParser.ts`:
  - add `taxAmount: number` to `FocusCheck`
  - in `parseCheck`, accumulate `TaxTotal1..5` across `toArray(seat.SeatRecord)`
    for every seat, round once (`Math.round(sum*100)/100`), assign `taxAmount`
- **Files:** `supabase/functions/_shared/focusDatafeedParser.ts`,
  `tests/unit/focusDatafeedParser.test.ts`
- **Dep:** none

## Task 2 — Persist tax_amount on focus_orders upsert
- **RED:** In `tests/unit/focusTransactionSyncHandler.test.ts`, assert the
  `focus_orders` upsert payload includes `tax_amount` from `check.taxAmount`.
- **GREEN:** `focusTransactionSyncHandler.ts` `upsertOrder`: add
  `tax_amount: check.taxAmount` to the upsert object.
- **Files:** `supabase/functions/_shared/focusTransactionSyncHandler.ts`,
  `tests/unit/focusTransactionSyncHandler.test.ts`
- **Dep:** Task 1 (FocusCheck.taxAmount)

## Task 3 — Migration A: add focus_orders.tax_amount
- New file `supabase/migrations/20260710HHMMSS_focus_orders_tax_amount.sql`
  (generate timestamp at creation; verify no prefix collision):
  `ALTER TABLE public.focus_orders ADD COLUMN IF NOT EXISTS tax_amount numeric
  NOT NULL DEFAULT 0;` + `COMMENT ON COLUMN`.
- Own file, no other DDL.
- **Dep:** none (but ordered before Task 4)

## Task 4 — Migration B: Step 6 tax row in the impl RPC
- **Pre-flight:** re-pull `pg_get_functiondef` of
  `_sync_focus_transactions_to_unified_sales_impl(uuid,date,date)`; assert it
  contains `apply_rules_to_pos_sales_internal` and NOT `auth.uid()`.
- New file `supabase/migrations/20260710HHMMSS_focus_tax_unified_sales.sql`
  (timestamp strictly after Task 3's):
  - `CREATE OR REPLACE FUNCTION …_impl(...)` = live body + `fo.tax_amount` in
    the loop `SELECT` + **Step 6** tax INSERT/DELETE block (per design Layer 3;
    `sale_time` in INSERT and `DO UPDATE SET`; single-row conditional delete
    with an explanatory comment).
  - Re-apply `REVOKE ALL … FROM PUBLIC; GRANT EXECUTE … TO service_role;`
- **Dep:** Task 3

## Task 5 — pgTAP test for the RPC tax row
- New/extended test under `supabase/tests/` (mirror
  `47_focus_transactions_unified_sales.sql`):
  - seed `focus_connections` + a `focus_orders` row with `tax_amount = 5.55`
    (+ a priced `focus_order_items` row), run
    `sync_focus_transactions_to_unified_sales(restaurant, d, d)`
  - assert exactly one row `item_type='tax'`, `adjustment_type='tax'`,
    `external_item_id = <order>_tax`, `total_price = 5.55`
  - set `tax_amount = 0`, re-run → tax row deleted
  - order with `tax_amount = 0` from the start → no tax row
- **Dep:** Task 4

## Task 6 — Verify (Phase 8) + backfill note
- Local: `npm run test` (parser + handler), `npm run typecheck`,
  `npm run lint`, `npm run build`; `npm run test:db` for pgTAP.
- **Backfill (post-merge/deploy, documented in PR):** run custom-range Focus
  syncs (≤14 days each) for `7c0c76e3-…`: Jun 24–Jul 7 and Jul 8–present
  (custom-range path re-parses; not delta-skipped — safe to re-run). Then
  verify Cold Stone RC June `item_type='tax'` total ≈ **$555.55**.

## Notes
- No UI/component changes → Phase 5 (UI review) skipped.
- Read side already counts `item_type='tax'` — no consumer changes.
