-- Fix "canceling statement due to statement timeout" on Bulk Process Sales.
--
-- Root cause: bulk_process_historical_sales(uuid, date, date) ran an
-- unbounded FOR loop over every unified_sales row in the date range inside
-- ONE RPC statement, and never SET statement_timeout (unlike its 18+
-- siblings), so it inherited the ~8s Supabase `authenticated`-role default.
-- A user backfilling a new recipe naturally picks a wide date range
-- (months) -> tens of thousands of sales -> timeout.
--
-- Fix: client-driven keyset batching. Each RPC call processes a bounded
-- batch (LIMIT p_batch_size) and returns a cursor; the caller loops until
-- `done`. See docs/superpowers/specs/2026-07-20-bulk-deduction-timeout-design.md.
--
-- Drop the old exact 3-arg signature first so PostgREST doesn't see two
-- overloads (3-arg vs 7-arg-with-defaults) and reject the call as ambiguous.
DROP FUNCTION IF EXISTS public.bulk_process_historical_sales(uuid, date, date);

CREATE OR REPLACE FUNCTION public.bulk_process_historical_sales(
    p_restaurant_id     uuid,
    p_start_date        date,
    p_end_date          date,
    p_batch_size        integer     DEFAULT 500,
    p_after_sale_date   date        DEFAULT NULL,
    p_after_created_at  timestamptz DEFAULT NULL,
    p_after_id          uuid        DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '120s'  -- escape the ~8s API default (per-batch headroom)
AS $function$
DECLARE
    v_sale RECORD;
    v_processed_count integer := 0;
    v_skipped_count integer := 0;
    v_error_count integer := 0;
    v_batch_count integer := 0;
    v_deduction_result jsonb;
    v_restaurant_timezone text;
    v_last_sale_date date;
    v_last_created_at timestamptz;
    v_last_id uuid;
BEGIN
    -- Tenant authorization: this function is SECURITY DEFINER and takes a
    -- bare p_restaurant_id, so without this guard any authenticated user
    -- could mutate another tenant's stock. Membership-only (no role gate),
    -- matching complete_production_run -- chef / collaborator_inventory
    -- keep access.
    IF NOT public.user_has_restaurant_access(p_restaurant_id) THEN
        RAISE EXCEPTION 'Not authorized for this restaurant';
    END IF;

    -- Get restaurant timezone
    SELECT timezone INTO v_restaurant_timezone
    FROM restaurants
    WHERE id = p_restaurant_id;

    v_restaurant_timezone := COALESCE(v_restaurant_timezone, 'America/Chicago');

    -- Process a bounded batch of sales in the date range, ordered by a
    -- strict total order (sale_date, created_at, id) so keyset pagination
    -- never skips or duplicates a row -- even when two rows share both
    -- sale_date and created_at (id, the PK, is always unique).
    --
    -- The cursor predicate uses sentinel COALESCE (not `p_after_id IS NULL
    -- OR ...`) so it stays a single pushable row-comparison bound on the
    -- (restaurant_id, sale_date, created_at, id) index -- an OR disjunct
    -- would force a Filter that re-walks the range from the start on every
    -- call (O(n^2) total cost across a full backfill).
    FOR v_sale IN
        SELECT item_name, quantity, sale_date, created_at, id,
               sale_date::text AS sale_date_text, sale_time::text AS sale_time_text,
               external_order_id
        FROM unified_sales
        WHERE restaurant_id = p_restaurant_id
          AND sale_date BETWEEN p_start_date AND p_end_date
          AND (sale_date, created_at, id) > (
                COALESCE(p_after_sale_date,  '-infinity'::date),
                COALESCE(p_after_created_at, '-infinity'::timestamptz),
                COALESCE(p_after_id, '00000000-0000-0000-0000-000000000000'::uuid))
        ORDER BY sale_date, created_at, id
        LIMIT p_batch_size
    LOOP
        v_batch_count := v_batch_count + 1;
        v_last_sale_date := v_sale.sale_date;
        v_last_created_at := v_sale.created_at;
        v_last_id := v_sale.id;

        BEGIN
            v_deduction_result := public.process_unified_inventory_deduction(
                p_restaurant_id,
                v_sale.item_name,
                v_sale.quantity::integer,
                v_sale.sale_date_text,
                v_sale.external_order_id,
                v_sale.sale_time_text,
                v_restaurant_timezone
            );

            IF (v_deduction_result->>'already_processed')::boolean THEN
                v_skipped_count := v_skipped_count + 1;
            ELSIF v_deduction_result->>'recipe_name' != '' THEN
                v_processed_count := v_processed_count + 1;
            ELSE
                v_skipped_count := v_skipped_count + 1;
            END IF;

        EXCEPTION WHEN OTHERS THEN
            v_error_count := v_error_count + 1;
            RAISE NOTICE 'Error processing sale %: %', v_sale.item_name, SQLERRM;
        END;
    END LOOP;

    RETURN jsonb_build_object(
        'processed',   v_processed_count,
        'skipped',     v_skipped_count,
        'errors',      v_error_count,
        'batch_count', v_batch_count,
        'done',        (v_batch_count < p_batch_size),  -- short batch = finished
        'next_cursor', CASE WHEN v_batch_count < p_batch_size THEN NULL
                            ELSE jsonb_build_object(
                                'sale_date',  v_last_sale_date,
                                'created_at', v_last_created_at,
                                'id',         v_last_id) END
    );
END;
$function$;

-- No explicit GRANT targeted the old 3-arg signature; Supabase schema-level
-- default privileges re-apply EXECUTE to anon/authenticated/service_role on
-- the recreated function (same pattern as process_unified_inventory_deduction
-- in 20260705000000_fix_prep_shadow_recipe_costing.sql). No manual GRANT
-- needed here.

-- ---------------------------------------------------------------------------
-- Supporting indexes (per-row cost + cursor scan)
-- ---------------------------------------------------------------------------

-- The dedup EXISTS inside process_unified_inventory_deduction currently
-- scans the restaurant's inventory_transactions per sale with no supporting
-- index on reference_id.
CREATE INDEX IF NOT EXISTS idx_inventory_transactions_dedup
  ON public.inventory_transactions (restaurant_id, reference_id, transaction_type);

-- Backs the keyset ORDER BY + range walk within a restaurant. The existing
-- idx_unified_sales_restaurant_date (restaurant_id, sale_date) is a strict
-- prefix of this wider index, so this one fully subsumes it. unified_sales
-- is a hot-write POS-sync table, so keeping both would double
-- index-maintenance cost per INSERT for no query gain -- drop the narrow one.
DROP INDEX IF EXISTS public.idx_unified_sales_restaurant_date;
CREATE INDEX IF NOT EXISTS idx_unified_sales_restaurant_keyset
  ON public.unified_sales (restaurant_id, sale_date, created_at, id);

-- Recipe lookup inside process_unified_inventory_deduction matches
-- (pos_item_name = X OR name = X) with only `name` indexed today. Two
-- partial indexes let the planner BitmapOr them; the partial predicate
-- matches the query's `is_active = true` exactly, so there's no residual
-- filter.
CREATE INDEX IF NOT EXISTS idx_recipes_restaurant_pos_item_name
  ON public.recipes (restaurant_id, pos_item_name) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_recipes_restaurant_name
  ON public.recipes (restaurant_id, name) WHERE is_active = true;
