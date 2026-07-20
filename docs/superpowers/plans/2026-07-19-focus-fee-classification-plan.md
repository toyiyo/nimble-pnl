# Plan: Focus fee-item revenue classification

**Design:** `docs/superpowers/specs/2026-07-19-focus-fee-classification-design.md`
**Branch:** `fix/focus-fee-item-classification`

TDD, one commit per task. All server-side; pure SQL/pgTAP (no TS change).

## Task 1 — pgTAP: `_focus_is_fee_item` predicate (RED→GREEN)
- New file `supabase/tests/55_focus_fee_classification.sql`, `plan()` section 1.
- Assert `_focus_is_fee_item` is TRUE for `'Dispatch Fee'`, `'Dispatch Service Fee'`,
  `'Dispatch Fee2'`, `'RailsUpcharge'`, `'Rails Upcharge'`; FALSE for
  `'CLYellow Cake'`, `'Dispatch Tip'`, `NULL`, `''`.
- GREEN: add the `IMMUTABLE` helper to the migration
  `supabase/migrations/20260719154500_focus_fee_classification.sql`.
- Commit: `test(focus): _focus_is_fee_item predicate` + `feat(focus): add _focus_is_fee_item helper`.

## Task 2 — Migration: rewrite the impl RPC
- In `20260719154500_focus_fee_classification.sql`, after the helper:
  1. **Pre-flight DO guard**: `RAISE EXCEPTION` unless `pg_get_functiondef(
     '_sync_focus_transactions_to_unified_sales_impl(uuid,date,date)'::regprocedure)`
     contains the literal `foi.name, 1, foi.price, foi.price` (drift trip-wire).
  2. Full `CREATE OR REPLACE FUNCTION _sync_focus_transactions_to_unified_sales_impl`
     — copy the current body from `20260713020000_focus_preserve_voids.sql` verbatim,
     preserving `SECURITY DEFINER`, `SET search_path='public'`,
     `SET statement_timeout='120s'`, and apply the non-voided-branch edits:
     - Step 1 `v_current_ids`: `AND NOT public._focus_is_fee_item(foi.name)`.
     - New **Step 2b** fee-reclassification cleanup (base + split children in one
       DELETE, per design).
     - Step 3 sale insert: `AND NOT public._focus_is_fee_item(foi.name)`.
     - New **Step 3b** fee-offset INSERT (`..._fee` id, `item_type='other'`,
       `adjustment_type='fee'`) + stale-fee DELETE (`parent_sale_id IS NULL`).
     - Step 4 discount insert + stale-delete subquery:
       `AND NOT public._focus_is_fee_item(foi.name)`.
     - Void branch: unchanged.
  3. Re-apply grants: `REVOKE ALL ... FROM PUBLIC; GRANT EXECUTE ... TO service_role;`.
- Commit: `feat(focus): classify delivery fee items as adjustment_type='fee' (drop out of revenue)`.

## Task 3 — pgTAP: end-to-end classification (RED→GREEN against Task 2)
- Extend `55_focus_fee_classification.sql` (bump `plan()`), seed one active
  `focus_connections` + focus_orders/items:
  - **Mixed check**: real dessert (sale) + Dispatch Fee 1.99.
  - **Fee-only phantom check**: only Dispatch Service Fee 2.99.
  - **Voided fee check**: fee on `is_voided=true` order.
  - **Discounted-fee check**: fee item with `discount_amount != 0`.
- Call `_sync_focus_transactions_to_unified_sales_impl`; assert cases 2–9 from the
  design (sale row NULL adjustment_type; fee row `item_type='other'`/`'fee'`/`_fee`
  id; totals: revenue excludes fees, pass_through + collected_at_pos include them;
  phantom $0 revenue; split-child backfill deletes parent+child no FK abort;
  idempotency on double-run; voided → one `void` marker no `_fee`; discounted fee →
  no discount row).
- Commit: `test(focus): end-to-end fee classification, phantom $0, backfill, idempotency`.

## Task 4 — Docs
- Update `docs/focus-followups.md`: mark item 1 done; note RailsUpcharge RG fixture
  capture as a later nice-to-have.
- Commit: `docs(focus): mark fee-classification follow-up done`.

## Verify (Phase 8)
- `npm run test:db` (pgTAP) — primary gate.
- `npm run typecheck && npm run lint && npm run build` (no TS change, but keep green).
- Symlink `.env.local` into the worktree for db tests; `npm ci` if node_modules is
  Vite-cache-only (lesson #1165).

## Risks / watch-items
- Drift trip-wire must match the live body exactly (guard RAISEs otherwise).
- Migration prefix `20260719154500` — re-verify free at push time.
- Keep the `ON CONFLICT ... WHERE parent_sale_id IS NULL` arbiter on every upsert
  (matches `unified_sales_unique_square` partial index).
