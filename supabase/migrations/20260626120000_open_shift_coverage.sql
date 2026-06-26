-- Coverage-based open-shift calculation.
--
-- Replaces exact time-window matching with a sweep-line concurrent-minimum:
-- a slot is staffed only when, at every minute of its [W0,W1] window, at
-- least `capacity` distinct same-position employees are present.
--
-- This migration creates:
--   public.shift_slot_min_concurrent(restaurant_id, position, date, w_start, w_end, tz)
--     → integer  (STABLE SECURITY DEFINER, minimum concurrent headcount)
--
-- Tasks 4 and 5 (get_open_shifts rewrite, claim_open_shift guard) are
-- appended in this same file per the approved design.

-- STABLE is correct: the function is read-only and CURRENT_DATE is stable
-- per statement. Do not add NOW() calls.

CREATE OR REPLACE FUNCTION public.shift_slot_min_concurrent(
  p_restaurant_id uuid,
  p_position      text,
  p_date          date,
  p_start         time,
  p_end           time,
  p_tz            text
)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  -- Algorithm: sweep-line over minute-breakpoints seeded with {W0, W1} so
  -- that an empty shift set still yields the full-window n=0 interval.
  --
  -- win: window bounds in minutes from p_date midnight (local).
  --   ws = EXTRACT(EPOCH FROM p_start)/60 (minutes since PG epoch is not used;
  --   we use the local HH:MM→minute offset directly via EXTRACT on the time).
  --
  -- Overnight window: when p_end <= p_start, add 1440 to we.
  -- Overnight shift: when shift's local de <= ds, add 1440 to de.
  --
  -- COUNT(DISTINCT employee_id) per sub-interval gives dedup for free
  -- (one person with two overlapping shifts still counts as 1).

  WITH win AS (
    SELECT
      (EXTRACT(HOUR FROM p_start) * 60 + EXTRACT(MINUTE FROM p_start))::int AS ws,
      CASE
        WHEN p_end <= p_start
          THEN (EXTRACT(HOUR FROM p_end) * 60 + EXTRACT(MINUTE FROM p_end))::int + 1440
        ELSE (EXTRACT(HOUR FROM p_end) * 60 + EXTRACT(MINUTE FROM p_end))::int
      END AS we
  ),
  -- Candidate shifts: same restaurant + position + non-cancelled + overlap with p_date local.
  -- Convert UTC timestamps to local minutes-from-p_date-midnight via AT TIME ZONE.
  cand AS (
    SELECT
      s.employee_id,
      (EXTRACT(EPOCH FROM (
        (s.start_time AT TIME ZONE p_tz) - p_date::timestamp
      )) / 60)::int AS ds,
      (EXTRACT(EPOCH FROM (
        (s.end_time AT TIME ZONE p_tz) - p_date::timestamp
      )) / 60)::int AS de
    FROM public.shifts s
    WHERE s.restaurant_id = p_restaurant_id
      AND s.position      = p_position
      AND s.status       <> 'cancelled'
      -- Date filter: shift's local start date must equal p_date.
      -- (v1 limitation: shifts whose local start is p_date-1 but bleed into
      --  p_date's early window are not counted. No such data today.)
      AND (s.start_time AT TIME ZONE p_tz)::date = p_date
  ),
  -- Normalize overnight shifts: add 1440 to de when de <= ds.
  norm AS (
    SELECT
      employee_id,
      ds AS sm_start,
      CASE WHEN de <= ds THEN de + 1440 ELSE de END AS sm_end
    FROM cand
  ),
  -- Clip each shift to [ws, we].
  clip AS (
    SELECT
      n.employee_id,
      GREATEST(w.ws, n.sm_start) AS cs,
      LEAST(w.we, n.sm_end)      AS ce
    FROM norm n, win w
    WHERE n.sm_start < w.we   -- shift starts before window ends
      AND w.ws < n.sm_end     -- window starts before shift ends
  ),
  -- Breakpoints: seed with {ws, we} so empty shift set still produces the
  -- full-window n=0 interval; add clip start/end for each candidate.
  bp AS (
    SELECT ws AS b FROM win
    UNION SELECT we FROM win
    UNION SELECT cs FROM clip
    UNION SELECT ce FROM clip
  ),
  -- Ordered distinct breakpoints.
  ordered_bp AS (
    SELECT DISTINCT b FROM bp ORDER BY b
  ),
  -- Sub-intervals between consecutive breakpoints.
  seg AS (
    SELECT
      b                              AS seg_start,
      LEAD(b) OVER (ORDER BY b)     AS seg_end
    FROM ordered_bp
  ),
  -- For each sub-interval fully inside [ws, we], count distinct employees present.
  cnt AS (
    SELECT
      (
        SELECT COUNT(DISTINCT c.employee_id)
        FROM clip c
        WHERE c.cs <= s.seg_start
          AND c.ce  > s.seg_start
      )::int AS n
    FROM seg s, win w
    WHERE s.seg_end IS NOT NULL
      AND s.seg_end  > s.seg_start
      AND s.seg_start >= w.ws
      AND s.seg_start  < w.we
  )
  -- Minimum concurrent headcount across all sub-intervals.
  -- COALESCE handles the case where there are no sub-intervals (degenerate window).
  SELECT COALESCE(MIN(n), 0)::int FROM cnt;
$$;

GRANT EXECUTE ON FUNCTION public.shift_slot_min_concurrent(uuid, text, date, time, time, text) TO authenticated;

-- ============================================================================
-- Rewrite get_open_shifts to use coverage-based min-concurrent headcount.
--
-- Replaces the old `assigned` CTE (exact time-window match) with a
-- CROSS JOIN LATERAL calling shift_slot_min_concurrent, which sweeps every
-- minute in the template window and takes the minimum concurrent distinct-
-- employee count. A fill-in with a different start/end time now correctly
-- reduces open_spots instead of being ignored.
--
-- Preserved from the previous version:
--   * STABLE SECURITY DEFINER SET search_path = public
--   * open_shifts_enabled gate (early-return if disabled)
--   * published_dates future filter (CURRENT_DATE and forward)
--   * capacity > 0 template guard
--   * per-(template, date) result rows with the same column names/order
--   * pending_claims subtraction (conservative: safe direction)
--   * ORDER BY pub_date, tmpl_start
--   * GRANT EXECUTE
--
-- open_spots = GREATEST(1, capacity) - minConcurrent - pending_claims
-- Both GREATEST(1,capacity) and minConcurrent are INT; pending_claims is
-- BIGINT from COUNT(); the result is cast to BIGINT to match the declared
-- return type.
--
-- STABLE is correct: the function is read-only; CURRENT_DATE is stable per
-- statement. Do not add NOW() calls.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_open_shifts(
    p_restaurant_id UUID,
    p_week_start DATE,
    p_week_end DATE
)
RETURNS TABLE (
    template_id UUID,
    template_name TEXT,
    shift_date DATE,
    start_time TIME,
    end_time TIME,
    "position" TEXT,
    area TEXT,
    "capacity" INT,
    assigned_count BIGINT,
    pending_claims BIGINT,
    open_spots BIGINT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_tz TEXT;
BEGIN
    -- Look up the restaurant timezone
    SELECT COALESCE(r.timezone, 'America/Chicago') INTO v_tz
    FROM public.restaurants r WHERE r.id = p_restaurant_id;

    -- Check if open shifts are enabled for this restaurant
    IF NOT EXISTS (
        SELECT 1 FROM public.staffing_settings
        WHERE restaurant_id = p_restaurant_id
          AND open_shifts_enabled = true
    ) THEN
        RETURN;
    END IF;

    RETURN QUERY
    WITH published_dates AS (
        -- All dates in published schedule weeks, today and forward only
        SELECT DISTINCT d::date AS pub_date
        FROM public.schedule_publications sp,
             generate_series(
                 GREATEST(sp.week_start_date, p_week_start),
                 LEAST(sp.week_end_date, p_week_end),
                 '1 day'::interval
             ) AS d
        WHERE sp.restaurant_id = p_restaurant_id
          AND sp.week_start_date <= p_week_end
          AND sp.week_end_date >= p_week_start
          AND d::date >= CURRENT_DATE  -- Only today and future dates
    ),
    template_days AS (
        SELECT
            st.id          AS tmpl_id,
            st.name        AS tmpl_name,
            pd.pub_date,
            st.start_time  AS tmpl_start,
            st.end_time    AS tmpl_end,
            st.position    AS tmpl_position,
            st.area        AS tmpl_area,
            st.capacity    AS tmpl_capacity
        FROM public.shift_templates st
        CROSS JOIN published_dates pd
        WHERE st.restaurant_id = p_restaurant_id
          AND st.is_active = true
          AND st.capacity > 0          -- include single-person crews
          AND EXTRACT(DOW FROM pd.pub_date)::int = ANY(st.days)
    ),
    -- pending_claims: open_shift_claims awaiting manager approval
    pending AS (
        SELECT
            osc.shift_template_id,
            osc.shift_date,
            COUNT(osc.id) AS cnt
        FROM public.open_shift_claims osc
        WHERE osc.restaurant_id = p_restaurant_id
          AND osc.status = 'pending_approval'
        GROUP BY osc.shift_template_id, osc.shift_date
    )
    SELECT
        td.tmpl_id,
        td.tmpl_name,
        td.pub_date,
        td.tmpl_start,
        td.tmpl_end,
        td.tmpl_position,
        td.tmpl_area,
        td.tmpl_capacity,
        mc.minc::bigint                                      AS assigned_count,
        COALESCE(p.cnt, 0)                                   AS pending_claims,
        (GREATEST(1, td.tmpl_capacity) - mc.minc - COALESCE(p.cnt, 0))::bigint AS open_spots
    FROM template_days td
    CROSS JOIN LATERAL (
        SELECT public.shift_slot_min_concurrent(
            p_restaurant_id,
            td.tmpl_position,
            td.pub_date,
            td.tmpl_start,
            td.tmpl_end,
            v_tz
        ) AS minc
    ) mc
    LEFT JOIN pending p ON p.shift_template_id = td.tmpl_id AND p.shift_date = td.pub_date
    WHERE (GREATEST(1, td.tmpl_capacity) - mc.minc - COALESCE(p.cnt, 0)) > 0
    ORDER BY td.pub_date, td.tmpl_start;
END;
$$;

-- Re-issue EXECUTE so the privilege is self-contained in this migration file.
GRANT EXECUTE ON FUNCTION public.get_open_shifts(UUID, DATE, DATE) TO authenticated;
