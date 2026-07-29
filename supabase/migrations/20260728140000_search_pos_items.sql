-- Migration: server-side search + top-N aggregate for the POS item dropdown
--
-- Design:  docs/superpowers/specs/2026-07-28-pos-items-truncation-and-scroll-design.md
-- Plan:    docs/superpowers/plans/2026-07-28-pos-items-truncation-and-scroll-plan.md
--
-- usePOSItems (src/hooks/usePOSItems.tsx) issues two unbounded selects
-- against pos_sales and unified_sales and aggregates them in the browser.
-- PostgREST caps an unbounded response at 1000 rows and still returns
-- HTTP 200, so the hook silently aggregates over an arbitrary 1000-row
-- window instead of the tenant's whole catalogue -- this is the same
-- failure mode already solved server-side by
-- 20251201100000_aggregate_pass_through_totals.sql and
-- 20251202100000_aggregate_monthly_metrics.sql.
--
-- search_pos_items() moves the union, case-insensitive dedupe, ranking,
-- search filter and top-N cap into a single SECURITY INVOKER SQL function
-- so the query never fetches more than p_limit rows over the wire.

-- pos_sales has no restaurant_id index today (only pos_sales_pkey). The
-- table is empty in production, so this is a zero-cost safety net rather
-- than a perf fix in itself -- see design doc S1 for the measurement that
-- justifies not also adding a pg_trgm index on unified_sales.
CREATE INDEX IF NOT EXISTS idx_pos_sales_restaurant_id
  ON public.pos_sales (restaurant_id);

CREATE OR REPLACE FUNCTION public.search_pos_items(
  p_restaurant_id uuid,
  p_search        text DEFAULT NULL,
  p_limit         int  DEFAULT 100
)
RETURNS TABLE (
  item_name   text,
  item_id     text,
  source      text,
  sales_count bigint,
  last_sold   date
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $function$
  WITH escaped_search AS (
    -- NULL/blank p_search means "no filter". Otherwise the term is
    -- treated as a literal: backslash is escaped first (so a user's own
    -- backslash isn't later mistaken for an escape character), then %
    -- and _ so they match themselves instead of acting as ILIKE
    -- wildcards.
    SELECT
      CASE
        WHEN p_search IS NULL OR btrim(p_search) = '' THEN NULL
        ELSE replace(replace(replace(p_search, '\', '\\'), '%', '\%'), '_', '\_')
      END AS pattern
  ),
  clamped_limit AS (
    -- NULL/0/negative -> default 100. Above 500 -> clamp to 500.
    -- Deliberately not greatest(1, ...): a p_limit of 0 must fall back to
    -- the documented default, not floor to a 1-row page.
    SELECT least(
      CASE WHEN coalesce(p_limit, 0) < 1 THEN 100 ELSE p_limit END,
      500
    ) AS n
  ),
  raw_rows AS (
    -- Explicit restaurant_id filter kept even though RLS also enforces
    -- it: RLS is the backstop, this is the stated intent (2026-07-02
    -- multi-tenant lesson).
    SELECT
      pos_item_name     AS item_name,
      pos_item_id       AS item_id,
      'pos_sales'::text AS source,
      sale_date
    FROM public.pos_sales
    WHERE restaurant_id = p_restaurant_id

    UNION ALL

    SELECT
      item_name,
      external_item_id      AS item_id,
      'unified_sales'::text AS source,
      sale_date
    FROM public.unified_sales
    WHERE restaurant_id = p_restaurant_id
  ),
  filtered_rows AS (
    SELECT r.*
    FROM raw_rows r
    CROSS JOIN escaped_search es
    WHERE es.pattern IS NULL
       OR r.item_name ILIKE ('%' || es.pattern || '%') ESCAPE '\'
  ),
  grouped AS (
    -- Both "most recent value" picks below are spelled as max() over a
    -- [sale_date, value] array rather than the more obvious
    -- array_agg(value ORDER BY sale_date DESC). That is deliberate and
    -- load-bearing for performance: an aggregate carrying its own ORDER BY
    -- disqualifies the whole grouping step from hash aggregation, so the
    -- planner must sort every one of the tenant's sales rows first. On the
    -- largest production tenant (~70k rows) that sort spilled to disk
    -- ("external merge Disk: 6968kB") and the call took 332ms; as a plain
    -- max() it hash-aggregates in parallel with no spill, at 174ms.
    -- Array comparison is element-wise and sale_date is a `date`, whose
    -- ::text form (YYYY-MM-DD) sorts chronologically, so element 1 decides
    -- the winner and only rows tied on the newest date ever reach element
    -- 2. That makes the tie-break the value itself -- deterministic, where
    -- the ordered-aggregate form left it up to the query plan.
    SELECT
      -- Display name comes from the most recent contributing row.
      (max(ARRAY[sale_date::text, item_name]))[2] AS item_name,
      -- item_id must survive a newer row whose id is NULL: the FILTER
      -- drops NULL ids before taking the most-recent survivor, so an
      -- older non-NULL id is returned instead of NULL. This mirrors the
      -- fallback the client code performs today and is load-bearing, not
      -- decoration.
      (max(ARRAY[sale_date::text, item_id])
         FILTER (WHERE item_id IS NOT NULL))[2] AS item_id,
      -- 'pos_sales' wins whenever any contributing row came from that
      -- table, preserving today's POS/Unified badge.
      CASE WHEN bool_or(source = 'pos_sales')
           THEN 'pos_sales' ELSE 'unified_sales' END AS source,
      count(*)      AS sales_count,
      max(sale_date) AS last_sold
    FROM filtered_rows
    GROUP BY lower(item_name)
  )
  SELECT item_name, item_id, source, sales_count, last_sold
  FROM grouped
  ORDER BY sales_count DESC, lower(item_name) ASC
  LIMIT (SELECT n FROM clamped_limit);
$function$;

-- Postgres grants EXECUTE to PUBLIC by default on function creation.
-- SECURITY INVOKER + the underlying RLS policies already deny anon
-- callers (auth.uid() is NULL -> zero rows), so there is no live bypass
-- here, but the explicit REVOKE/GRANT is the least-privilege default.
REVOKE ALL ON FUNCTION public.search_pos_items(uuid, text, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_pos_items(uuid, text, int) TO authenticated;
