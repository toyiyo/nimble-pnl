-- ============================================================
-- §  Preserve Focus voids as auditable negative offsets
--
-- Problem: Focus voids arrive as check-level <DeleteRecord> entries. The
-- handler used to hard-DELETE the focus_orders row (CASCADE removed
-- items/payments), leaving the check's unified_sales rows orphaned
-- (they inflated revenue/tax forever — PR #600) and no audit trail of
-- voids (count/$ was unrecoverable).
--
-- Fix: soft-delete (focus_orders.is_voided/voided_at, set by the handler —
-- see focusTransactionSyncHandler.ts) + branch the sync RPC's per-check
-- loop on is_voided:
--   - voided:     delete this check's sale/tip/discount/tax rows, upsert
--                 ONE negative adjustment_type='void' offset row
--                 (Toast-consistent: item_type='discount', adjustment_type
--                 ='void', total_price = -SUM(focus_order_items.price)).
--                 Because the focus_orders row still exists, the loop keeps
--                 visiting it on every re-sync — this *replaces* the old
--                 orphan-sweep and fixes the bug (no separate pre-loop
--                 sweep needed).
--   - not voided: existing Steps 1-6 (sale/discount/tip/tax), plus a new
--                 cleanup DELETE of any stale "<order_id>_void" row, so an
--                 idempotent un-void (is_voided flips back to false) removes
--                 the stale void marker. Guarded by parent_sale_id IS NULL,
--                 matching every other delete in this function.
--
-- Read-layer note (no read-layer change required): revenue sums
-- item_type='sale' AND adjustment_type IS NULL; discounts sum
-- adjustment_type='discount'; pass-through sums an enumerated adjustment_type
-- list. A row with adjustment_type='void' is excluded from all three
-- automatically.
--
-- Function body re-created from the LIVE definition (pg_get_functiondef),
-- not from a hand-maintained copy, to avoid repo/prod drift (lesson
-- PR #579/#581). Pre-flight verified at build time: the live body contains
-- apply_rules_to_pos_sales_internal and does NOT contain an auth.uid() gate
-- (the PR #565/#567/#573 regression class).
--
-- CREATE OR REPLACE resets function ACLs in Postgres, so grants are
-- re-applied at the end to match production: {postgres, service_role} only
-- (never `authenticated` — only the public wrapper functions are granted to
-- authenticated callers, and those wrappers are unchanged by this
-- migration).
-- ============================================================

ALTER TABLE public.focus_orders
  ADD COLUMN IF NOT EXISTS is_voided boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS voided_at timestamptz;

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
      SELECT ARRAY(
        SELECT v_order_id || '__' || foi.item_key
        FROM public.focus_order_items foi
        WHERE foi.restaurant_id  = p_restaurant_id
          AND foi.business_date  = v_order.business_date
          AND foi.focus_check_id = v_order.focus_check_id
          AND foi.price IS NOT NULL
          AND foi.price != 0
      ) INTO v_current_ids;

      -- ── Step 2: DELETE orphan sale rows no longer in focus_order_items ─────
      -- Only delete base (un-split) rows; parent_sale_id IS NULL guards user-
      -- managed split/child rows from being silently removed on every sync.
      DELETE FROM public.unified_sales us
      WHERE us.restaurant_id     = p_restaurant_id
        AND us.pos_system        = 'focus'
        AND us.item_type         = 'sale'
        AND us.sale_date         = v_order.business_date
        AND us.external_order_id = v_order_id
        AND us.parent_sale_id IS NULL
        AND NOT (us.external_item_id = ANY(v_current_ids));

      -- ── Step 3: UPSERT sale rows (one per priced item) ────────────────────
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

      -- ── Step 4: UPSERT / DELETE discount offset rows ───────────────────────
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
