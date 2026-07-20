# Design: Focus fee-item revenue classification (+ phantom $0 orders)

**Date:** 2026-07-19
**Branch:** `fix/focus-fee-item-classification`
**Follow-up item:** #1 of the Focus POS open follow-ups (`docs/focus-followups.md`)

## Problem

Some Focus orders (reported as "delivery orders") import with $0 revenue, and
third-party delivery **fee** line items (Dispatch Fee, Dispatch Service Fee,
RailsUpcharge) are being counted as **sales revenue**. Both stem from one root
cause: fee line items are priced `CheckItemRecord`s that the sync RPC classifies
as `item_type='sale'`, so they inflate revenue on checks that carry them and — on
a fee-only "phantom" delivery check — are the *only* thing on the check.

### Grounded evidence (real fixture `tests/fixtures/focus-datafeed-sample.xml`, from #563)

| Item name | ReportGroupID | `<Price>` | Current classification | Correct |
|---|---|---|---|---|
| Dispatch Fee | 94 | 1.99 | `item_type='sale'` (in revenue) ❌ | pass-through fee |
| Dispatch Service Fee | 94 | 2.99 | `item_type='sale'` (in revenue) ❌ | pass-through fee |
| Dispatch Tip - Driver | 95 | *(none)* | already excluded (null price) | n/a |
| Real desserts (CLYellow Cake, …) | 20/22/25/29 | present | `item_type='sale'` ✓ | sale |

## Root-cause location

`public._sync_focus_transactions_to_unified_sales_impl(uuid, date, date)`
(latest definition: `20260713020000_focus_preserve_voids.sql`), **Step 3** —
the sale upsert — inserts every `focus_order_items` row with
`price IS NOT NULL AND price != 0` as `item_type='sale'`. Fee items match that
predicate and leak into revenue.

Confirmed single seam: the legacy `sync_all_focus_to_unified_sales()` aggregator
does **not** read `focus_order_items` (it iterates `focus_connections` only), and
`sync_all_focus_transactions_to_unified_sales()` delegates to the impl. All
item-level classification lives in the impl RPC — no duplicate logic to patch
(unlike the #579 legacy-function trap).

## Read-layer contract (no change needed)

`get_unified_sales_totals` (latest: `20260714000000_fix_collected_at_pos_exclude_void.sql`):

- **revenue**: `adjustment_type IS NOT NULL → 0`, else `item_type='sale' → total_price`.
  → a `adjustment_type='fee'` row is **excluded from revenue**. ✓
- **pass_through_amount**: `adjustment_type IS NOT NULL AND NOT IN ('discount','void') → total_price`.
  → a `'fee'` row is **included in pass-through**. ✓
- **collected_at_pos**: `SUM(total_price) FILTER (adjustment_type IS DISTINCT FROM 'void')`.
  → a `'fee'` row **stays counted** (POS did collect it). ✓

`adjustment_type='fee'` already exists in the taxonomy (KNOWN_PASS_THROUGH_TYPES =
`('tax','tip','service_charge','discount','fee')`). **No read-layer migration, no
new enum value.**

## Decisions (approved in brainstorm)

1. **Fee identification: item-name pattern** (case-insensitive), not
   ReportGroupID (per-tenant configurable in Focus). Centralized in one
   `IMMUTABLE` SQL predicate so the list is trivial to extend.
2. **Implementation seam: SQL RPC only.** Fee classification joins the existing
   void/discount/tip/tax classification inside the impl. One function-rewrite
   migration + pgTAP. No parser/handler/column change.
3. **Phantom $0 orders: leave as $0 revenue.** No suppression. Once fees are
   pass-through, a fee-only check correctly shows $0 sales with the fee captured
   in pass_through / collected_at_pos. The paired food check carries the revenue.

## Fee-identification predicate

New helper:

```sql
CREATE OR REPLACE FUNCTION public._focus_is_fee_item(p_name text)
RETURNS boolean
LANGUAGE sql IMMUTABLE
AS $$
  SELECT p_name IS NOT NULL AND (
       lower(p_name) LIKE '%dispatch%fee%'   -- Dispatch Fee, Dispatch Service Fee, Dispatch Fee2
    OR lower(p_name) LIKE '%rails%upcharge%'  -- RailsUpcharge, Rails Upcharge
  );
$$;
```

Conservative: matches only known third-party delivery pass-through fees. It does
**not** broadly match `%fee%` (a real "Corkage"/"Split-Plate" charge stays a sale
until we learn otherwise). Extending is a one-line `OR`. Marked `IMMUTABLE` so it
is index/planner-friendly and callable from the SET-returning inserts.

## RPC changes (non-voided branch of the per-check loop)

1. **Step 1** (`v_current_ids`, the set of sale external_item_ids): add
   `AND NOT public._focus_is_fee_item(foi.name)`. Fee items are no longer
   "current sale rows", so **Step 2's orphan-delete removes any pre-migration
   sale row that was actually a fee** — automatic backfill cleanup on first
   re-sync.
2. **Step 3** (sale insert): add the same `AND NOT public._focus_is_fee_item(foi.name)`
   so fees are never inserted as `'sale'`.
3. **New Step 3b — fee offset rows** (mirrors the discount step):
   - INSERT from `focus_order_items` where `price != 0 AND _focus_is_fee_item(name)`,
     `external_item_id = v_order_id || '__' || item_key || '_fee'`,
     `item_name = name`, `unit_price = total_price = price`,
     `item_type = 'other'`, `adjustment_type = 'fee'`.
     `ON CONFLICT (... ) WHERE parent_sale_id IS NULL DO UPDATE` the mutable cols.
   - DELETE stale fee rows for this order whose `external_item_id` is no longer in
     the current fee set (item un-priced or renamed), guarded by
     `parent_sale_id IS NULL` (matches every other delete in the function).

The **voided branch is unchanged**: a void already deletes the check's entire
footprint (sale + fee + tip + discount + tax) and writes one `adjustment_type='void'`
marker. `v_void_amount = SUM(price)` still nets the whole check; fees inside a
voided check are removed with everything else (audit-preserved via the marker).

### Migration authoring (drift-safe)

Full `CREATE OR REPLACE` of the impl with the new body (matches how
`20260713020000_focus_preserve_voids.sql` was authored), plus a **pre-flight DO
guard** that `RAISE EXCEPTION`s if the current live body does not contain the
Step-3 sale-insert anchor (`item_name, 1, foi.price, foi.price`) — so if prod has
drifted from the repo copy we fail loudly instead of clobbering (the #579/#581
"diff, don't believe" lesson). Re-apply grants after (`CREATE OR REPLACE` resets
ACLs): `service_role` only.

Migration filename: pick a `20260719HHMMSS_*` prefix verified collision-free
against every worktree's `supabase/migrations/` (the #571 14-digit-prefix lesson).

## Testing (pgTAP — `supabase/tests/53_focus_fee_classification.sql`)

Setup: one active `focus_connections`, then focus_orders/items covering:
- **Mixed check**: 1 real dessert (sale) + 1 Dispatch Fee (1.99).
- **Fee-only "phantom" check**: only a Dispatch Service Fee (2.99).
- **Voided fee check**: fee item on an `is_voided=true` order.

Assertions:
1. `_focus_is_fee_item` true for `'Dispatch Fee'`, `'Dispatch Service Fee'`,
   `'RailsUpcharge'`, `'Rails Upcharge'`; false for `'CLYellow Cake'`, `NULL`,
   `'Dispatch Tip'`.
2. After RPC: dessert → `unified_sales` `item_type='sale'`, `adjustment_type IS NULL`.
3. After RPC: Dispatch Fee → `item_type='other'`, `adjustment_type='fee'`,
   `total_price=1.99`, `external_item_id LIKE '%_fee'`.
4. `get_unified_sales_totals`: revenue excludes both fees; `pass_through_amount`
   and `collected_at_pos` include them.
5. **Phantom $0**: fee-only check → its order's revenue contribution is 0, fee in
   pass-through. (No suppression; row exists.)
6. **Backfill cleanup**: pre-seed a stale `item_type='sale'` row for the fee's
   item_key, run RPC, assert it is deleted (Step 2) and replaced by the `_fee` row.
7. **Idempotency**: run RPC twice → identical row counts, no duplicates.
8. Voided fee check → single `adjustment_type='void'` marker, no leftover `_fee`
   row.

## Files

- `supabase/migrations/20260719HHMMSS_focus_fee_classification.sql` (new) — helper
  + impl rewrite + grants.
- `supabase/tests/53_focus_fee_classification.sql` (new) — pgTAP.
- `docs/focus-followups.md` — mark item 1 done (or note remaining RailsUpcharge RG
  confirmation).

## Out of scope / follow-ups

- Confirming RailsUpcharge's ReportGroupID against a real Rails feed (we match by
  name, so not required for correctness, but worth capturing a fixture later).
- Per-restaurant configurable fee lists (hardcoded predicate is enough today).
- The voided-check `v_void_amount` including fee prices (accepted trade-off:
  the void marker is an audit offset, item_type='other', not revenue).
