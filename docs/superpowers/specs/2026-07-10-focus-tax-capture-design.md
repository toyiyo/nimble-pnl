# Design: Capture Focus POS tax into unified_sales

**Date:** 2026-07-10
**Branch:** `fix/focus-tax-capture`
**Author:** Claude (with Jose)

## Problem

Focus POS sales flow through the Lynk transaction feed
(`focusDatafeedParser` → `focus_orders`/`focus_order_items`/`focus_payments`
→ `sync_focus_transactions_to_unified_sales` → `unified_sales`). This path
emits `sale`, `discount`, and `tip` rows but **never emits tax**. As a
result P&L and the POS Sales page show **$0 tax** for Focus restaurants.

Concrete gap (Wetzel's – Cold Stone – Alamo Ranch, `7c0c76e3-…`, June): the
Focus daily report shows **Total Tax $555.55** for the Cold Stone revenue
center, but `unified_sales` has zero `item_type='tax'` rows for the store.

### Root cause

Two layers:
1. **Parser** (`focusDatafeedParser.ts`) reads `CheckRecord.TaxableSales1..5`
   (the taxable *base*) but never the tax *collected*.
2. **`focus_orders`** has a `taxable_sales` column but **no tax amount
   column**, so `_sync_focus_transactions_to_unified_sales_impl` has nothing
   to emit.

The tax capability *does* exist in the older report-based RPC
(`sync_focus_to_unified_sales`, sourced from `focus_daily_reports.total_tax`),
but that path is unused for this store (`focus_daily_reports` = 0 rows). Tax
was silently dropped in the migration from the report path to the
transaction-feed path (documented in
`20260701130000_focus_transactions_unified_sales.sql`:31).

## How the other integrations do it (the target convention)

Square, Toast, and Clover all store tax as a **per-order adjustment row** in
`unified_sales`, not a daily total:

| field | value |
|---|---|
| `external_item_id` | `<external_order_id>_tax` |
| `item_name` | `Sales Tax` |
| `item_type` | `tax` |
| `adjustment_type` | `tax` |
| `total_price` | the order's tax amount |

Revenue line items are stored pre-tax. The read side already counts this:
`KNOWN_PASS_THROUGH_TYPES = {tax, tip, service_charge, discount, fee}` in
`useRevenueBreakdown` + `get_pass_through_totals` (lessons 2026-05, PR #485),
and the `unified_sales_item_type_check` / `unified_sales_adjustment_type_check`
constraints already permit `'tax'`. **No read-side or schema-constraint
changes are needed** — only production of the rows.

## Data model (verified against `tests/fixtures/focus-datafeed-sample.xml`)

- Tax is on the **`SeatRecord`**, not the `CheckRecord`:
  `SeatRecord.TaxTotal1..5` (tax collected per bucket), parallel to the
  `CheckRecord.TaxableSales1..5` base already parsed.
- A check can have multiple seats → **sum `TaxTotal1..5` across all seats**.
- Verified reconciliation on a real check: seat `Subtotal` 44.97 +
  `TaxTotal1` 3.30 + `TaxTotal2` 0.16 = `Total` **48.43**. ✓
- Up to 5 buckets (Cold Stone report shows 4: Food/Beverage/Soda/Tax5).

## Design — three layers + backfill

### Layer 1 — Parser (`focusDatafeedParser.ts`)
- Add `taxAmount: number` to `FocusCheck`.
- In `parseCheck`, while looping seats, read `seat.SeatRecord` and sum
  `TaxTotal1..5` across all seats, rounding once at the end (same
  binary-float-safe idiom already used for `taxableSales`).

### Layer 2 — Schema + persistence
- Migration: `ALTER TABLE focus_orders ADD COLUMN tax_amount numeric NOT NULL
  DEFAULT 0`. (Tiny table; metadata-only default in PG11+. Existing 1,484 rows
  get 0 until re-synced — correct, tax was never captured.) Keep this ALTER in
  its **own** migration file (not batched with other/larger-table DDL) so the
  fast-path default is not lost.
- Migration filenames: timestamps must sort **after** the latest existing
  migration (`20260708193107_…`) and be repo-wide unique — use
  `20260710HHMMSS_…` generated at file-creation time; `git ls-tree
  origin/main supabase/migrations/` immediately before the PR to re-check for
  collisions (lesson PR #571/#576).
- `focusTransactionSyncHandler.upsertOrder`: persist
  `tax_amount: check.taxAmount`.

### Layer 3 — RPC (`_sync_focus_transactions_to_unified_sales_impl`)
Add **Step 6: tax offset row**, mirroring the existing tip/discount blocks
and the report RPC's tax block:
- Add `fo.tax_amount` to the per-check `FOR` loop `SELECT`.
- `INSERT … SELECT` one row where `tax_amount != 0`:
  `external_item_id = v_order_id || '_tax'`, `item_name = 'Sales Tax'`,
  `total_price = tax_amount`, `item_type='tax'`, `adjustment_type='tax'`.
  **`sale_time = v_sale_time` MUST appear in both the INSERT column list AND
  the `DO UPDATE SET`** (same as tip/discount — omitting it from `DO UPDATE`
  leaves the busy-time signal stale on re-sync; this is the exact bug
  `20260703120000` fixed for the other row kinds). Same `ON CONFLICT …
  WHERE parent_sale_id IS NULL DO UPDATE` shape; `category_id`/`is_categorized`
  omitted from `DO UPDATE` to preserve user categorization.
- **Delete-orphan is simpler than Step 4/5** because tax is **one row per
  order** (one-to-one), not one-per-item/payment. Use a plain conditional
  delete keyed off the order having zero tax — delete `external_item_id =
  v_order_id || '_tax'` when `v_order.tax_amount = 0` (or the guarded INSERT's
  WHERE excludes it) — **not** a `NOT IN (subquery)` pattern. Add a migration
  comment explaining *why* the shape differs so a future reader doesn't
  "normalise" it to the multi-row form. `parent_sale_id IS NULL` still guards
  user split rows.

Both overloads share the impl, so both the manual and cron paths pick up tax.

**Implementation guards (from Phase 2.5 review):**
1. **Pre-flight, before authoring the migration:** re-pull the live body via
   `pg_get_functiondef` and assert it is the *ungated* form — contains
   `apply_rules_to_pos_sales_internal` and does **not** contain an
   `auth.uid()` gate (the PR #565/#567/#573 regression class). Verified at
   design time: `ok=true, has_authuid_gate=false`. Re-verify at build time.
2. **Preserve grants on `CREATE OR REPLACE`** (Postgres resets ACL). Live ACL
   is `{postgres, service_role}`. Re-apply:
   `REVOKE ALL ON FUNCTION …_impl(uuid,date,date) FROM PUBLIC;`
   `GRANT EXECUTE ON FUNCTION …_impl(uuid,date,date) TO service_role;`
   Do **not** grant the impl to `authenticated` (only the public wrappers are,
   and they are unchanged — the migration re-creates the impl only).
3. The function is re-created from the **live prod definition** to avoid
   repo/prod drift (lesson PR #579/#581); splice Step 6 in with the loop
   `SELECT` extended by `fo.tax_amount`.

### Backfill (post-deploy, manual)
Tax lives only in the raw datafeed, which is not stored — so existing
`focus_orders` rows must be **re-fetched + re-parsed** to populate
`tax_amount`. The custom-range / backfill sync paths do **not** wire the
delta-skip `stateStore`, so a re-run re-parses fresh.

Plan: after merge + deploy, run two custom-range Focus syncs (≤14-day cap):
June 24–Jul 7 and Jul 8–present, for `7c0c76e3-…`. Then verify Cold Stone RC
June tax ≈ **$555.55**.

## Idempotency & edge cases
- Tax row is one-per-order, fixed key `…_tax`; re-sync UPSERTs, preserving
  user categorization (category_id omitted from `DO UPDATE`), exactly like the
  sale/tip/discount blocks.
- Negative tax (refund checks) flows through unchanged (sum may be negative) —
  consistent with how discounts are handled.
- Voids/deleted checks: tax row behaves identically to the existing sale/tip
  rows for that order (no new void semantics introduced).

## Alternatives considered
1. **Per-bucket tax columns/rows (Tax1..5 separately).** Rejected: diverges
   from the single-`Sales Tax`-row convention used by Square/Toast/Clover;
   `unified_sales` has no bucket concept; P&L wants the total. We still *sum*
   all five buckets, so no data is lost — only the split is not persisted.
2. **Revive the report path (`focus_daily_reports`).** Rejected: that path is
   unused, would double-source sales, and its parser has a separate
   inclusive-vs-exclusive tax bug. The transaction feed is the live source of
   truth.
3. **New `tax` column on `unified_sales`.** Rejected: the established pattern
   is an adjustment *row*; a column would require read-side changes and
   diverge from every other POS.

## Testing
- **Unit** (`focusDatafeedParser.test.ts`): the fixture check reconciles —
  `taxAmount` = 3.46 (3.30 + 0.16) for check 1, 0.33 for check 2; multi-seat
  sum; missing SeatRecord → 0.
- **Unit** (`focusTransactionSyncHandler.test.ts`): `upsertOrder` persists
  `tax_amount`.
- **pgTAP** (`supabase/tests/`): after inserting a `focus_orders` row with
  `tax_amount`, the RPC emits exactly one `item_type='tax'` /
  `adjustment_type='tax'` row with matching `total_price` and external key;
  setting tax_amount to 0 and re-running deletes it; zero-tax orders emit none.
- **Reconciliation (post-deploy):** Cold Stone RC June tax ≈ $555.55.

## Decided trade-offs
- Existing focus_orders rows default `tax_amount=0` until re-synced; the
  backfill re-populates. Acceptable — no historical tax existed to lose.
- Per-bucket tax breakdown is summed away; the report's Food/Bev/Soda split is
  not reproduced in `unified_sales`. Acceptable per the cross-POS convention.
