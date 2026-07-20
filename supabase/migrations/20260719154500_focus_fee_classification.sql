-- Focus fee-item revenue classification
--
-- Design: docs/superpowers/specs/2026-07-19-focus-fee-classification-design.md
--
-- Third-party delivery fee line items (Dispatch Fee, Dispatch Service Fee,
-- RailsUpcharge, ...) are priced CheckItemRecords that the Focus sync RPC
-- currently classifies as item_type='sale', inflating revenue. This
-- migration adds an IMMUTABLE helper predicate to identify them by
-- case-insensitive item-name pattern so the sync RPC can reclassify them
-- as adjustment_type='fee' (pass-through, excluded from revenue).
--
-- Conservative: matches only known third-party delivery pass-through fees.
-- Does NOT broadly match '%fee%' (a real "Corkage"/"Split-Plate" charge
-- stays a sale until we learn otherwise). Extending is a one-line OR.

CREATE OR REPLACE FUNCTION public._focus_is_fee_item(p_name text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT p_name IS NOT NULL AND (
       lower(p_name) LIKE '%dispatch%fee%'   -- Dispatch Fee, Dispatch Service Fee, Dispatch Fee2
    OR lower(p_name) LIKE '%rails%upcharge%'  -- RailsUpcharge, Rails Upcharge
  );
$$;

REVOKE ALL ON FUNCTION public._focus_is_fee_item(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._focus_is_fee_item(text) TO service_role;

-- ============================================================
-- §  Rewrite _sync_focus_transactions_to_unified_sales_impl:
--    reclassify fee items out of revenue
--
-- Non-voided branch changes only (voided branch already removes a check's
-- entire footprint, fees included, and is unchanged here):
--   - Step 1 (v_current_ids): excludes fee items — they are no longer
--     "current sale rows".
--   - New Step 2b: fee-reclassification cleanup. A pre-migration fee item has
--     a legacy item_type='sale' base row under the un-suffixed id; its new
--     fee row (Step 3b) uses a distinct '..._fee' id, so the old sale row
--     (and any user split children on it — unified_sales carries a redundant
--     NO-ACTION FK, unified_sales_parent_sale_id_fkey, 20251031000146,
--     alongside the ON DELETE CASCADE fk_parent_sale, 20251031003130, which
--     would abort the sync if a parent with a live child were deleted alone)
--     is deleted in ONE statement — same technique as the void branch.
--   - Step 3 (sale upsert): excludes fee items.
--   - New Step 3b: fee offset upsert/delete, mirroring the Step 4 discount
--     pattern — item_type='other', adjustment_type='fee',
--     external_item_id suffixed '_fee'.
--   - Step 4 (discount upsert/delete): excludes fee items, so a discounted
--     fee item emits only the Step 3b 'fee' row, not a spurious 'discount'
--     row for the same item_key.
--
-- Function body copied verbatim from the live definition
-- (20260713020000_focus_preserve_voids.sql) — preserves SECURITY DEFINER,
-- search_path, statement_timeout — with only the edits above applied.
-- CREATE OR REPLACE resets function ACLs in Postgres, so grants are
-- re-applied at the end (service_role only, matching production).
--
-- Pre-flight drift trip-wire below verifies the live body still contains the
-- exact Step-3 sale-insert anchor before this migration replaces it wholesale
-- (lesson #579/#581 — "diff, don't believe"; fail loudly on drift instead of
-- silently clobbering an out-of-band prod change).
-- ============================================================

DO $$
BEGIN
  IF pg_get_functiondef('public._sync_focus_transactions_to_unified_sales_impl(uuid,date,date)'::regprocedure)
     NOT LIKE '%foi.name, 1, foi.price, foi.price%'
  THEN
    RAISE EXCEPTION
      '_sync_focus_transactions_to_unified_sales_impl has drifted from the '
      'expected base (20260713020000_focus_preserve_voids.sql) — the Step-3 '
      'sale-insert anchor "foi.name, 1, foi.price, foi.price" was not found '
      'in the live function body. Refusing to CREATE OR REPLACE; reconcile '
      'this migration with the live definition before proceeding.';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public._sync_focus_transactions_to_unified_sales_impl(p_restaurant_id uuid, p_start_date date, p_end_date date)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '120s'
AS $function$
DECLARE
  v_count          integer := 0;
  v_row_count      integer;
  v_sync_start     timestamptz := clock_timestamp();
  v_store_id       text;
  v_order          record;
  v_order_id       text;
  v_sale_time      time;
  v_current_ids    text[];
  v_void_amount    numeric;
BEGIN
  -- Fetch the store_id from the most-recently-created active connection.
  -- Filtering by is_active prevents stale/deleted connections from being used.
  -- ORDER BY + LIMIT 1 makes the query deterministic when multiple rows exist.
  SELECT fc.store_id INTO v_store_id
  FROM public.focus_connections fc
  WHERE fc.restaurant_id = p_restaurant_id
    AND fc.is_active = true
  ORDER BY fc.created_at DESC
  LIMIT 1;

  -- If no active connection found, there is nothing to key external_order_id on.
  -- Proceeding with a NULL store_id would produce orphan unified_sales rows
  -- (pattern: focus-unknown-YYYYMMDD-{check_id}) that can never be re-synced.
  IF v_store_id IS NULL THEN
    RAISE EXCEPTION
      'sync_focus_transactions_to_unified_sales: no active focus_connections row '
      'found for restaurant %', p_restaurant_id;
  END IF;

  -- GUC flag: skip per-row triggers during bulk sync (transaction-local).
  PERFORM set_config('app.skip_unified_sales_triggers', 'true', true);

  -- ── Iterate per check (focus_order) ────────────────────────────────────
  FOR v_order IN
    SELECT fo.business_date, fo.focus_check_id,
           fo.opened_at_local, fo.closed_at_local, fo.tax_amount,
           fo.is_voided
    FROM public.focus_orders fo
    WHERE fo.restaurant_id = p_restaurant_id
      AND (p_start_date IS NULL OR fo.business_date >= p_start_date)
      AND (p_end_date   IS NULL OR fo.business_date <= p_end_date)
    ORDER BY fo.business_date, fo.focus_check_id
  LOOP
    v_order_id := 'focus-' || COALESCE(v_store_id, 'unknown')
                  || '-' || to_char(v_order.business_date, 'YYYYMMDD')
                  || '-' || v_order.focus_check_id;

    -- Time-of-day for this check: prefer TimeOpened (when the customer
    -- transacted — the busy-time signal), fall back to TimeClosed.
    v_sale_time := COALESCE(
      public._focus_parse_local_time(v_order.opened_at_local),
      public._focus_parse_local_time(v_order.closed_at_local)
    );

    IF v_order.is_voided THEN
      -- ── Voided check: remove the check's ENTIRE unified_sales footprint —
      -- base sale rows, their user split children (which share this order's
      -- external_order_id per split_pos_sale), and tip/discount/tax offsets —
      -- and replace it with one negative void offset row. A void means the
      -- transaction didn't happen, so nothing from it survives except the
      -- single audit marker.
      --
      -- NOT guarded by parent_sale_id IS NULL (unlike Steps 2/4/5/6): a void
      -- removes the whole check INCLUDING user splits. Deleting a split-parent
      -- together with its child in ONE statement satisfies the parent_sale_id
      -- FK — the redundant NO-ACTION FK (unified_sales_parent_sale_id_fkey,
      -- a pre-existing duplicate of the ON DELETE CASCADE fk_parent_sale) would
      -- otherwise block deleting a base row that still has a split child.
      -- The void marker itself is excluded so its ON CONFLICT upsert (below)
      -- keeps a stable identity across re-syncs.
      DELETE FROM public.unified_sales us
      WHERE us.restaurant_id     = p_restaurant_id
        AND us.pos_system        = 'focus'
        AND us.external_order_id  = v_order_id
        AND us.external_item_id  <> v_order_id || '_void';

      -- Voided net revenue = SUM of this check's priced items (raw price,
      -- discount not netted in — per design). No priced items → 0 (still a
      -- countable void marker).
      SELECT COALESCE(SUM(foi.price), 0) INTO v_void_amount
      FROM public.focus_order_items foi
      WHERE foi.restaurant_id  = p_restaurant_id
        AND foi.business_date  = v_order.business_date
        AND foi.focus_check_id = v_order.focus_check_id
        AND foi.price != 0;

      INSERT INTO public.unified_sales (
        restaurant_id, pos_system,
        external_order_id, external_item_id,
        item_name, quantity, unit_price, total_price,
        sale_date, sale_time, item_type, adjustment_type, synced_at
      )
      VALUES (
        p_restaurant_id, 'focus',
        v_order_id, v_order_id || '_void',
        'Void', 1, -v_void_amount, -v_void_amount,
        -- item_type='other' (not Toast's 'discount'): the meaningful, Toast-
        -- consistent identifier is adjustment_type='void'; 'other' avoids a
        -- collision with item_type='discount' consumers/tests since a void is
        -- not a discount. Excluded from revenue (not item_type='sale'),
        -- discounts (adjustment_type != 'discount') and pass-through (not in
        -- KNOWN_PASS_THROUGH_TYPES).
        v_order.business_date, v_sale_time, 'other', 'void', now()
      )
      ON CONFLICT (restaurant_id, pos_system, external_order_id, external_item_id)
        WHERE parent_sale_id IS NULL
      DO UPDATE SET
        item_name   = EXCLUDED.item_name,
        unit_price  = EXCLUDED.unit_price,
        total_price = EXCLUDED.total_price,
        sale_date   = EXCLUDED.sale_date,
        sale_time   = EXCLUDED.sale_time,
        synced_at   = EXCLUDED.synced_at;

      GET DIAGNOSTICS v_row_count = ROW_COUNT;
      v_count := v_count + v_row_count;

      -- Because the focus_orders row still exists (soft-deleted, not
      -- CASCADE-removed), this loop keeps visiting it on every re-sync —
      -- this replaces the old orphan-sweep and fixes the bug where a
      -- hard-deleted check's unified_sales rows were left orphaned forever.
    ELSE
      -- ── Step 1: Collect current external_item_ids (sale rows) ──────────────
      -- Fee items (Dispatch Fee, RailsUpcharge, ...) are excluded: they are
      -- reclassified as pass-through (Step 3b), not "current sale rows".
      SELECT ARRAY(
        SELECT v_order_id || '__' || foi.item_key
        FROM public.focus_order_items foi
        WHERE foi.restaurant_id  = p_restaurant_id
          AND foi.business_date  = v_order.business_date
          AND foi.focus_check_id = v_order.focus_check_id
          AND foi.price IS NOT NULL
          AND foi.price != 0
          AND NOT public._focus_is_fee_item(foi.name)
      ) INTO v_current_ids;

      -- ── Step 2b: Fee-reclassification cleanup (backfill-safe) ──────────────
      -- MUST run BEFORE Step 2 below. A pre-migration fee item currently has
      -- a legacy item_type='sale' base row under the un-suffixed id
      -- (v_order_id || '__' || item_key). Its new fee row (Step 3b, below)
      -- uses a distinct '..._fee' id, so the old sale row must be removed. A
      -- user may have split-categorized that legacy fee-as-sale row
      -- (split_pos_sale → child rows with parent_sale_id set), and
      -- unified_sales carries a redundant NO-ACTION FK
      -- (unified_sales_parent_sale_id_fkey, 20251031000146) alongside the
      -- ON DELETE CASCADE fk_parent_sale (20251031003130) — the NO-ACTION FK
      -- blocks deleting a parent that still has a child, which would abort
      -- the entire restaurant's sync. So this cleanup deletes the stale
      -- fee-as-sale base row AND any split children in ONE statement — the
      -- same technique the void branch (above) uses.
      --
      -- Ordering is load-bearing: fee item_keys are excluded from
      -- v_current_ids (Step 1, above), so Step 2's unchanged
      -- "NOT IN v_current_ids" orphan-delete would ALSO match a legacy
      -- fee-as-sale base row — and Step 2 is scoped to parent_sale_id IS NULL
      -- only, so on its own it would try to delete a base row that still has
      -- a live split child, hitting the same NO-ACTION FK abort this cleanup
      -- exists to avoid. Running this DELETE first removes the base row AND
      -- its children together, so by the time Step 2 runs there is nothing
      -- left for it to touch for this item_key — a true no-op, not a race.
      WITH fee_ids AS (
        SELECT v_order_id || '__' || foi.item_key AS ext_id
        FROM public.focus_order_items foi
        WHERE foi.restaurant_id  = p_restaurant_id
          AND foi.business_date  = v_order.business_date
          AND foi.focus_check_id = v_order.focus_check_id
          AND foi.price IS NOT NULL AND foi.price != 0
          AND public._focus_is_fee_item(foi.name)
      )
      DELETE FROM public.unified_sales us
      WHERE us.restaurant_id    = p_restaurant_id
        AND us.pos_system       = 'focus'
        AND us.external_order_id = v_order_id
        AND ( us.external_item_id IN (SELECT ext_id FROM fee_ids)
           OR us.parent_sale_id IN (
                SELECT p.id FROM public.unified_sales p
                WHERE p.restaurant_id = p_restaurant_id
                  AND p.pos_system = 'focus'
                  AND p.external_order_id = v_order_id
                  AND p.external_item_id IN (SELECT ext_id FROM fee_ids)) );

      -- ── Step 2: DELETE orphan sale rows no longer in focus_order_items ─────
      -- Only delete base (un-split) rows; parent_sale_id IS NULL guards user-
      -- managed split/child rows from being silently removed on every sync.
      -- No-op for fee items: Step 2b (above) already removed their legacy
      -- sale rows (base + children) in one statement.
      DELETE FROM public.unified_sales us
      WHERE us.restaurant_id     = p_restaurant_id
        AND us.pos_system        = 'focus'
        AND us.item_type         = 'sale'
        AND us.sale_date         = v_order.business_date
        AND us.external_order_id = v_order_id
        AND us.parent_sale_id IS NULL
        AND NOT (us.external_item_id = ANY(v_current_ids));

      -- ── Step 3: UPSERT sale rows (one per priced item) ────────────────────
      -- Fee items are excluded: reclassified as pass-through in Step 3b below,
      -- never inserted as item_type='sale'.
      INSERT INTO public.unified_sales (
        restaurant_id, pos_system,
        external_order_id, external_item_id,
        item_name, quantity, unit_price, total_price,
        sale_date, sale_time, pos_category, item_type, synced_at
      )
      SELECT
        foi.restaurant_id, 'focus',
        v_order_id, v_order_id || '__' || foi.item_key,
        foi.name, 1, foi.price, foi.price,
        foi.business_date, v_sale_time, foi.report_group_id, 'sale', now()
      FROM public.focus_order_items foi
      WHERE foi.restaurant_id  = p_restaurant_id
        AND foi.business_date  = v_order.business_date
        AND foi.focus_check_id = v_order.focus_check_id
        AND foi.price IS NOT NULL
        AND foi.price != 0
        AND NOT public._focus_is_fee_item(foi.name)
      ON CONFLICT (restaurant_id, pos_system, external_order_id, external_item_id)
        WHERE parent_sale_id IS NULL
      DO UPDATE SET
        item_name    = EXCLUDED.item_name,
        unit_price   = EXCLUDED.unit_price,
        total_price  = EXCLUDED.total_price,
        sale_date    = EXCLUDED.sale_date,
        sale_time    = EXCLUDED.sale_time,
        pos_category = EXCLUDED.pos_category,
        synced_at    = EXCLUDED.synced_at
        -- category_id + is_categorized intentionally omitted →
        -- preserves user-managed categorization on re-sync (design §4)
      ;

      GET DIAGNOSTICS v_row_count = ROW_COUNT;
      v_count := v_count + v_row_count;

      -- ── Step 3b: UPSERT / DELETE fee offset rows ────────────────────────────
      -- Third-party delivery fee line items (Dispatch Fee, Dispatch Service
      -- Fee, RailsUpcharge, ...) are priced CheckItemRecords but are
      -- pass-through, not revenue. Excluded from Step 3's sale insert above;
      -- reclassified here as adjustment_type='fee' (item_type='other', mirrors
      -- the void row's use of 'other' to avoid colliding with a real
      -- item_type value). external_item_id is suffixed '_fee' — distinct from
      -- the legacy un-suffixed sale id Step 2b just cleaned up — so this
      -- upsert has a stable identity across re-syncs.
      INSERT INTO public.unified_sales (
        restaurant_id, pos_system,
        external_order_id, external_item_id,
        item_name, quantity, unit_price, total_price,
        sale_date, sale_time, item_type, adjustment_type, synced_at
      )
      SELECT
        foi.restaurant_id, 'focus',
        v_order_id, v_order_id || '__' || foi.item_key || '_fee',
        foi.name, 1, foi.price, foi.price,
        foi.business_date, v_sale_time, 'other', 'fee', now()
      FROM public.focus_order_items foi
      WHERE foi.restaurant_id  = p_restaurant_id
        AND foi.business_date  = v_order.business_date
        AND foi.focus_check_id = v_order.focus_check_id
        AND foi.price != 0
        AND public._focus_is_fee_item(foi.name)
      ON CONFLICT (restaurant_id, pos_system, external_order_id, external_item_id)
        WHERE parent_sale_id IS NULL
      DO UPDATE SET
        item_name   = EXCLUDED.item_name,
        unit_price  = EXCLUDED.unit_price,
        total_price = EXCLUDED.total_price,
        sale_date   = EXCLUDED.sale_date,
        sale_time   = EXCLUDED.sale_time,
        synced_at   = EXCLUDED.synced_at;

      GET DIAGNOSTICS v_row_count = ROW_COUNT;
      v_count := v_count + v_row_count;

      -- Delete stale fee rows for items that are no longer priced fee items
      -- (item un-priced or renamed away from the fee pattern).
      -- parent_sale_id IS NULL guards user-managed split rows.
      DELETE FROM public.unified_sales us
      WHERE us.restaurant_id     = p_restaurant_id
        AND us.pos_system        = 'focus'
        AND us.adjustment_type   = 'fee'
        AND us.sale_date         = v_order.business_date
        AND us.external_order_id = v_order_id
        AND us.parent_sale_id IS NULL
        AND us.external_item_id NOT IN (
          SELECT v_order_id || '__' || foi.item_key || '_fee'
          FROM public.focus_order_items foi
          WHERE foi.restaurant_id  = p_restaurant_id
            AND foi.business_date  = v_order.business_date
            AND foi.focus_check_id = v_order.focus_check_id
            AND foi.price != 0
            AND public._focus_is_fee_item(foi.name)
        );

      -- ── Step 4: UPSERT / DELETE discount offset rows ───────────────────────
      -- Fee items are excluded from both the insert and the stale-delete
      -- subquery below: a discounted fee is pass-through, not a revenue
      -- discount. Without this exclusion, a discounted fee item would emit
      -- BOTH a Step 3b 'fee' row and a spurious 'discount' row for the same
      -- item_key.
      -- Upsert items that have a non-zero discount.
      -- Focus XML stores DiscountAmount as a negative value (e.g. -3.01).
      -- Use != 0 (not > 0) so that negative amounts are also captured.
      -- -ABS() normalises to negative regardless of stored sign.
      INSERT INTO public.unified_sales (
        restaurant_id, pos_system,
        external_order_id, external_item_id,
        item_name, quantity, unit_price, total_price,
        sale_date, sale_time, item_type, adjustment_type, synced_at
      )
      SELECT
        foi.restaurant_id, 'focus',
        v_order_id, v_order_id || '__' || foi.item_key || '_discount',
        'Discount - ' || COALESCE(foi.name, 'Item'), 1,
        -ABS(foi.discount_amount), -ABS(foi.discount_amount),
        foi.business_date, v_sale_time, 'discount', 'discount', now()
      FROM public.focus_order_items foi
      WHERE foi.restaurant_id  = p_restaurant_id
        AND foi.business_date  = v_order.business_date
        AND foi.focus_check_id = v_order.focus_check_id
        AND foi.discount_amount != 0
        AND NOT public._focus_is_fee_item(foi.name)
      ON CONFLICT (restaurant_id, pos_system, external_order_id, external_item_id)
        WHERE parent_sale_id IS NULL
      DO UPDATE SET
        item_name   = EXCLUDED.item_name,
        unit_price  = EXCLUDED.unit_price,
        total_price = EXCLUDED.total_price,
        sale_date   = EXCLUDED.sale_date,
        sale_time   = EXCLUDED.sale_time,
        synced_at   = EXCLUDED.synced_at;

      GET DIAGNOSTICS v_row_count = ROW_COUNT;
      v_count := v_count + v_row_count;

      -- Delete stale discount rows for items that no longer have a discount.
      -- parent_sale_id IS NULL guards user-managed split rows.
      DELETE FROM public.unified_sales us
      WHERE us.restaurant_id     = p_restaurant_id
        AND us.pos_system        = 'focus'
        AND us.item_type         = 'discount'
        AND us.sale_date         = v_order.business_date
        AND us.external_order_id = v_order_id
        AND us.parent_sale_id IS NULL
        AND us.external_item_id NOT IN (
          SELECT v_order_id || '__' || foi.item_key || '_discount'
          FROM public.focus_order_items foi
          WHERE foi.restaurant_id  = p_restaurant_id
            AND foi.business_date  = v_order.business_date
            AND foi.focus_check_id = v_order.focus_check_id
            AND foi.discount_amount != 0
            AND NOT public._focus_is_fee_item(foi.name)
        );

      -- ── Step 5: UPSERT / DELETE tip offset rows ────────────────────────────
      -- Upsert payments with a non-zero tip
      INSERT INTO public.unified_sales (
        restaurant_id, pos_system,
        external_order_id, external_item_id,
        item_name, quantity, unit_price, total_price,
        sale_date, sale_time, item_type, adjustment_type, synced_at
      )
      SELECT
        fp.restaurant_id, 'focus',
        v_order_id, v_order_id || '_' || fp.payment_key || '_tip',
        'Tip - ' || COALESCE(fp.name, 'Payment'), 1,
        fp.tip, fp.tip,
        fp.business_date, v_sale_time, 'tip', 'tip', now()
      FROM public.focus_payments fp
      WHERE fp.restaurant_id  = p_restaurant_id
        AND fp.business_date  = v_order.business_date
        AND fp.focus_check_id = v_order.focus_check_id
        AND fp.tip != 0
      ON CONFLICT (restaurant_id, pos_system, external_order_id, external_item_id)
        WHERE parent_sale_id IS NULL
      DO UPDATE SET
        item_name   = EXCLUDED.item_name,
        unit_price  = EXCLUDED.unit_price,
        total_price = EXCLUDED.total_price,
        sale_date   = EXCLUDED.sale_date,
        sale_time   = EXCLUDED.sale_time,
        synced_at   = EXCLUDED.synced_at;

      GET DIAGNOSTICS v_row_count = ROW_COUNT;
      v_count := v_count + v_row_count;

      -- Delete stale tip rows for payments that no longer have a tip.
      -- parent_sale_id IS NULL guards user-managed split rows.
      DELETE FROM public.unified_sales us
      WHERE us.restaurant_id     = p_restaurant_id
        AND us.pos_system        = 'focus'
        AND us.item_type         = 'tip'
        AND us.sale_date         = v_order.business_date
        AND us.external_order_id = v_order_id
        AND us.parent_sale_id IS NULL
        AND us.external_item_id NOT IN (
          SELECT v_order_id || '_' || fp.payment_key || '_tip'
          FROM public.focus_payments fp
          WHERE fp.restaurant_id  = p_restaurant_id
            AND fp.business_date  = v_order.business_date
            AND fp.focus_check_id = v_order.focus_check_id
            AND fp.tip != 0
        );

      -- ── Step 6: UPSERT / DELETE tax offset row ─────────────────────────────
      -- Tax is one row per order (SeatRecord.TaxTotal1..5 summed by the parser
      -- into focus_orders.tax_amount) — NOT one row per item/payment like
      -- discount/tip — so the delete below is a plain conditional delete keyed
      -- off "this order's tax_amount is currently 0", not a NOT IN (subquery)
      -- over a per-row source table. Do not change this to the multi-row
      -- pattern; there is nothing to enumerate.
      INSERT INTO public.unified_sales (
        restaurant_id, pos_system,
        external_order_id, external_item_id,
        item_name, quantity, unit_price, total_price,
        sale_date, sale_time, item_type, adjustment_type, synced_at
      )
      SELECT
        p_restaurant_id, 'focus',
        v_order_id, v_order_id || '_tax',
        'Sales Tax', 1,
        v_order.tax_amount, v_order.tax_amount,
        v_order.business_date, v_sale_time, 'tax', 'tax', now()
      WHERE v_order.tax_amount != 0
      ON CONFLICT (restaurant_id, pos_system, external_order_id, external_item_id)
        WHERE parent_sale_id IS NULL
      DO UPDATE SET
        item_name   = EXCLUDED.item_name,
        unit_price  = EXCLUDED.unit_price,
        total_price = EXCLUDED.total_price,
        sale_date   = EXCLUDED.sale_date,
        sale_time   = EXCLUDED.sale_time,
        synced_at   = EXCLUDED.synced_at;

      GET DIAGNOSTICS v_row_count = ROW_COUNT;
      v_count := v_count + v_row_count;

      -- Delete the tax row for this order when it no longer has any tax.
      -- parent_sale_id IS NULL guards user-managed split rows.
      IF v_order.tax_amount = 0 THEN
        DELETE FROM public.unified_sales us
        WHERE us.restaurant_id     = p_restaurant_id
          AND us.pos_system        = 'focus'
          AND us.item_type         = 'tax'
          AND us.sale_date         = v_order.business_date
          AND us.external_order_id = v_order_id
          AND us.external_item_id  = v_order_id || '_tax'
          AND us.parent_sale_id IS NULL;
      END IF;

      -- Stale-void cleanup: idempotent un-void. If this check was voided in
      -- the past (leaving a "<order_id>_void" row) and is_voided has since
      -- flipped back to false, remove the stale void marker so it doesn't
      -- linger alongside the freshly-restored sale/tip/discount/tax rows.
      -- parent_sale_id IS NULL guards user-managed split rows, matching
      -- every other delete in this function.
      DELETE FROM public.unified_sales us
      WHERE us.restaurant_id     = p_restaurant_id
        AND us.pos_system        = 'focus'
        AND us.adjustment_type   = 'void'
        AND us.sale_date         = v_order.business_date
        AND us.external_order_id = v_order_id
        AND us.external_item_id  = v_order_id || '_void'
        AND us.parent_sale_id IS NULL;
    END IF;

  END LOOP;  -- end per-check loop

  -- Reset GUC flag to re-enable per-row triggers
  PERFORM set_config('app.skip_unified_sales_triggers', 'false', true);

  -- Batch-categorize uncategorized sale rows (authenticated callers only;
  -- service-role callers defer to the apply-categorization-rules edge function)
  PERFORM apply_rules_to_pos_sales_internal(p_restaurant_id, 10000);

  -- Batch-aggregate daily totals for all dates touched in this sync.
  -- Union two sources so DELETE-only dates are still re-aggregated: synced_at
  -- only advances on INSERT/UPDATE, so a date whose only change was a removed
  -- offset row (e.g. a tax row deleted when tax_amount is zeroed, with no
  -- sale/tip/discount row re-upserted) would otherwise keep stale daily
  -- totals. The focus_orders business_date range covers every check processed
  -- this run, including those pure-delete dates (the order row still exists).
  PERFORM public.aggregate_unified_sales_to_daily(p_restaurant_id, d.sale_date)
  FROM (
    SELECT DISTINCT sale_date
    FROM public.unified_sales
    WHERE restaurant_id = p_restaurant_id
      AND pos_system    = 'focus'
      AND synced_at    >= v_sync_start
    UNION
    SELECT DISTINCT fo.business_date
    FROM public.focus_orders fo
    WHERE fo.restaurant_id = p_restaurant_id
      AND (p_start_date IS NULL OR fo.business_date >= p_start_date)
      AND (p_end_date   IS NULL OR fo.business_date <= p_end_date)
  ) d;

  RETURN v_count;
END;
$function$;

-- Re-apply grants (CREATE OR REPLACE resets ACLs in Postgres).
REVOKE ALL ON FUNCTION public._sync_focus_transactions_to_unified_sales_impl(uuid, date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._sync_focus_transactions_to_unified_sales_impl(uuid, date, date) TO service_role;
