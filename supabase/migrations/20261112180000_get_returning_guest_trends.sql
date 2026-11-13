-- get_returning_guest_trends
-- Design: docs/superpowers/specs/2026-11-12-returning-guests-design.md sections 4.1 to 4.6.
-- The RPC compares returning card spend before and after a campaign start.
-- The RPC builds a card match key inside a CTE. It never returns the key or any card digit.

CREATE OR REPLACE FUNCTION public.get_returning_guest_trends(
  p_restaurant_id  UUID,
  p_campaign_start DATE,
  p_weeks          INT DEFAULT 8
) RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tz     TEXT;
  v_today  DATE;
  v_n      INT;
  v_result JSONB;
BEGIN
  -- Guard 1: owner and manager only
  IF NOT public.user_has_restaurant_access(p_restaurant_id, true) THEN
    RAISE EXCEPTION 'Access denied' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Guard 2: argument checks
  IF p_campaign_start IS NULL OR p_weeks IS NULL OR p_weeks < 1 OR p_weeks > 26 THEN
    RAISE EXCEPTION 'Invalid arguments: p_campaign_start is required and p_weeks must be 1 to 26'
      USING ERRCODE = '22023';
  END IF;

  -- Time zone: use the restaurant zone. Use America/Chicago if NULL or not valid.
  SELECT r.timezone INTO v_tz FROM restaurants r WHERE r.id = p_restaurant_id;
  IF v_tz IS NULL OR NOT EXISTS (SELECT 1 FROM pg_timezone_names z WHERE z.name = v_tz) THEN
    v_tz := 'America/Chicago';
  END IF;
  v_today := (now() AT TIME ZONE v_tz)::date;

  -- Guard 3: no future campaign start
  IF p_campaign_start > v_today THEN
    RAISE EXCEPTION 'p_campaign_start is in the future' USING ERRCODE = '22023';
  END IF;

  v_n := LEAST(p_weeks, (v_today - p_campaign_start) / 7);

  WITH
  -- Toast: allow-listed card rows with key parts
  toast_raw AS (
    SELECT tp.payment_date AS d,
           tp.amount::numeric AS amt,
           NULLIF(btrim(tp.raw_json->>'cardType'), '')     AS brand,
           NULLIF(btrim(tp.raw_json->>'first6Digits'), '') AS f6,
           NULLIF(btrim(tp.raw_json->>'last4Digits'), '')  AS l4
    FROM toast_payments tp
    WHERE tp.restaurant_id = p_restaurant_id
      AND tp.payment_status IN ('CAPTURED', 'AUTHORIZED')
      AND tp.amount > 0
  ),
  toast_stat AS (
    SELECT count(*) FILTER (WHERE (brand || '|' || l4) IS NOT NULL)            AS n_card,
           count(*) FILTER (WHERE (brand || '|' || f6 || '|' || l4) IS NOT NULL) AS n_f6
    FROM toast_raw
  ),
  toast_rows AS (
    SELECT tr.d, tr.amt, 'toast'::text AS src,
           CASE WHEN ts.n_card > 0 AND ts.n_f6 >= 0.95 * ts.n_card
                THEN tr.brand || '|' || tr.f6 || '|' || tr.l4
                ELSE tr.brand || '|' || tr.l4 END AS k,
           CASE WHEN ts.n_card > 0 AND ts.n_f6 >= 0.95 * ts.n_card THEN 3 ELSE 2 END AS qr
    FROM toast_raw tr CROSS JOIN toast_stat ts
  ),
  revel_rows AS (
    SELECT rp.payment_date AS d, rp.amount::numeric AS amt, 'revel'::text AS src,
           NULLIF(btrim(rp.raw_json->>'card_type'), '') || '|' ||
           NULLIF(btrim(rp.raw_json->>'last_4_cc_digits'), '') AS k,
           2 AS qr
    FROM revel_payments rp
    WHERE rp.restaurant_id = p_restaurant_id
      AND rp.payment_status IN ('Captured', 'Accepted')
      AND rp.amount > 0
  ),
  focus_rows AS (
    SELECT fp.business_date AS d, fp.amount::numeric AS amt, 'focus'::text AS src,
           NULLIF(btrim(fp.card_last4), '') AS k,
           1 AS qr
    FROM focus_payments fp
    WHERE fp.restaurant_id = p_restaurant_id
      AND fp.amount > 0
  ),
  square_rows AS (
    SELECT (sp.created_at AT TIME ZONE v_tz)::date AS d,
           sp.amount_money::numeric AS amt, 'square'::text AS src,
           NULLIF(btrim(sp.raw_json->'card_details'->'card'->>'fingerprint'), '') AS k,
           4 AS qr
    FROM square_payments sp
    WHERE sp.restaurant_id = p_restaurant_id
      AND sp.status = 'COMPLETED'
      AND sp.amount_money > 0
  ),
  all_rows AS (
    SELECT * FROM toast_rows
    UNION ALL SELECT * FROM revel_rows
    UNION ALL SELECT * FROM focus_rows
    UNION ALL SELECT * FROM square_rows
  ),
  rows_k AS (
    SELECT d, amt, src, k, qr FROM all_rows WHERE k IS NOT NULL AND d IS NOT NULL
  ),
  first_seen AS (
    SELECT k, min(d) AS fs FROM rows_k GROUP BY k
  ),
  meta AS (
    SELECT count(*) AS n_rows,
           min(d) AS history_start,
           count(DISTINCT src) AS n_src,
           min(src) AS one_src,
           min(qr) AS min_qr
    FROM rows_k
  ),
  weeks AS (
    SELECT g AS idx, p_campaign_start + 7 * g AS ws
    FROM generate_series(-p_weeks, v_n - 1) AS g
  ),
  wr AS (
    SELECT w.idx, w.ws, r.k, r.d, r.amt, (f.fs < w.ws) AS is_ret
    FROM weeks w
    JOIN rows_k r ON r.d >= w.ws AND r.d < w.ws + 7
    JOIN first_seen f ON f.k = r.k
  ),
  wagg AS (
    SELECT w.idx, w.ws,
           COALESCE(sum(x.amt) FILTER (WHERE x.is_ret), 0)     AS rs,
           COALESCE(sum(x.amt) FILTER (WHERE NOT x.is_ret), 0) AS ns,
           count(DISTINCT x.k || '|' || x.d::text) FILTER (WHERE x.is_ret) AS rv,
           count(DISTINCT x.k) FILTER (WHERE x.is_ret)     AS rc,
           count(DISTINCT x.k) FILTER (WHERE NOT x.is_ret) AS nc
    FROM weeks w LEFT JOIN wr x ON x.idx = w.idx
    GROUP BY w.idx, w.ws
  ),
  psum AS (
    SELECT p.period,
           COALESCE(sum(x.amt) FILTER (WHERE x.is_ret), 0) AS rs,
           count(DISTINCT x.k || '|' || x.d::text) FILTER (WHERE x.is_ret) AS rv,
           count(DISTINCT x.k) FILTER (WHERE x.is_ret)     AS rc,
           count(DISTINCT x.k) FILTER (WHERE NOT x.is_ret) AS nc
    FROM (VALUES ('before'), ('after')) AS p(period)
    LEFT JOIN wr x
      ON (p.period = 'before' AND x.idx < 0 AND x.idx >= -v_n)
      OR (p.period = 'after'  AND x.idx >= 0)
    GROUP BY p.period
  )
  SELECT CASE WHEN m.n_rows = 0 THEN
    jsonb_build_object(
      'source', 'none', 'match_quality', 'none', 'history_start', NULL,
      'weeks_compared', v_n, 'weeks', '[]'::jsonb, 'summary', NULL)
  ELSE
    jsonb_build_object(
      'source', CASE WHEN m.n_src > 1 THEN 'mixed' ELSE m.one_src END,
      'match_quality', CASE m.min_qr WHEN 1 THEN 'weak' WHEN 2 THEN 'fair'
                                     WHEN 3 THEN 'good' ELSE 'strong' END,
      'history_start', m.history_start,
      'weeks_compared', v_n,
      'weeks', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                  'week_start', a.ws,
                  'period', CASE WHEN a.idx < 0 THEN 'before' ELSE 'after' END,
                  'warmup', a.ws < m.history_start + 28,
                  'returning_spend', ROUND(a.rs, 2),
                  'new_spend', ROUND(a.ns, 2),
                  'returning_visits', a.rv,
                  'returning_cards', a.rc,
                  'new_cards', a.nc) ORDER BY a.idx), '[]'::jsonb)
                FROM wagg a),
      'summary', (SELECT jsonb_object_agg(s.period, jsonb_build_object(
                    'spend_per_week', ROUND(s.rs / NULLIF(v_n, 0), 2),
                    'visits_per_card', ROUND(s.rv::numeric / NULLIF(s.rc, 0), 2),
                    'avg_check', ROUND(s.rs / NULLIF(s.rv, 0), 2),
                    'returning_cards', s.rc,
                    'new_cards', s.nc))
                  FROM psum s))
  END
  INTO v_result
  FROM meta m;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_returning_guest_trends(UUID, DATE, INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_returning_guest_trends(UUID, DATE, INT) TO authenticated;

COMMENT ON FUNCTION public.get_returning_guest_trends(UUID, DATE, INT) IS
  'Returning card guests, before and after a campaign start. Owner and manager only. Returns no card digits.';
