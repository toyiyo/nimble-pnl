-- Retraction notifications.
--
-- Unpublishing a live week told nobody. Employees who had already been emailed
-- "New Schedule Published" kept believing a schedule that no longer existed.
--
-- The audience cannot be reconstructed after the fact: unpublish_schedule flips
-- is_published to false on every affected row, erasing the very thing that says
-- who was on the published version. And it must not be passed in by the client
-- either -- an edge function that mails whichever employee_ids the caller hands
-- it is an open relay. So it is captured inside this transaction, from the
-- UPDATE's own RETURNING, and the notifier derives everything from that.

CREATE TABLE IF NOT EXISTS public.schedule_retractions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id   UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  publication_id  UUID REFERENCES public.schedule_publications(id) ON DELETE SET NULL,
  week_start_date DATE NOT NULL,
  week_end_date   DATE NOT NULL,
  -- Audience snapshot, captured before the is_published flip is observable.
  employee_ids    UUID[] NOT NULL DEFAULT '{}',
  shift_count     INTEGER NOT NULL DEFAULT 0,
  reason          TEXT,
  retracted_by    UUID REFERENCES auth.users(id),
  retracted_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Idempotency latch, claimed by the notifier before it sends.
  notified_at     TIMESTAMPTZ
);

-- Matches the notifier's lookup exactly: unnotified rows for a week, newest
-- first. Retractions accumulate per week across publish/retract cycles.
CREATE INDEX IF NOT EXISTS idx_schedule_retractions_lookup
  ON public.schedule_retractions (restaurant_id, week_start_date, retracted_at DESC)
  WHERE notified_at IS NULL;

-- schedule_publications only carries single-column indexes on restaurant_id and
-- week_start_date, but every lookup added here -- useWeekScheduleStatus, the
-- isRepublish probe, and unpublish_schedule's own -- filters on the pair and
-- takes the newest row. One composite serves all three.
CREATE INDEX IF NOT EXISTS idx_schedule_publications_week_lookup
  ON public.schedule_publications (restaurant_id, week_start_date, published_at DESC);

ALTER TABLE public.schedule_retractions ENABLE ROW LEVEL SECURITY;

-- SELECT only, mirroring schedule_publications. Every write comes from the
-- SECURITY DEFINER RPC below or from the notifier's service-role client, both
-- of which bypass RLS. There is deliberately no UPDATE policy: a client-writable
-- notified_at or employee_ids would let a manager forge who gets mailed, or
-- suppress a retraction notice entirely. See the pgTAP test that pins this.
DROP POLICY IF EXISTS "Users can view schedule retractions for their restaurants"
  ON public.schedule_retractions;
CREATE POLICY "Users can view schedule retractions for their restaurants"
  ON public.schedule_retractions FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.user_restaurants ur
      WHERE ur.restaurant_id = schedule_retractions.restaurant_id
        AND ur.user_id = auth.uid()
    )
  );

-- Default privileges in this database grant no DML on new public tables, so the
-- SELECT policy above is inert without this grant. The omissions are the point:
-- no INSERT/UPDATE/DELETE for authenticated, so a client cannot rewrite the
-- audience or pre-claim notified_at even if a policy is later added by mistake.
-- The RPC writes as the function owner and does not need a grant; the notifier
-- reads and claims rows with the service-role key and does.
GRANT SELECT ON public.schedule_retractions TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.schedule_retractions TO service_role;

COMMENT ON TABLE public.schedule_retractions IS
  'One row per unpublish of a previously-published week. employee_ids is an '
  'audience snapshot captured inside unpublish_schedule''s transaction, before '
  'the is_published flip erases it. notified_at is an idempotency latch the '
  'notify-schedule-unpublished function claims before sending.';

COMMENT ON COLUMN public.schedule_retractions.employee_ids IS
  'Employees who had published shifts in the retracted version. Never supplied '
  'by a caller -- derived from the UPDATE''s RETURNING clause.';

-- Recreated with the audience capture. RETURNS INTEGER is unchanged on purpose:
-- CREATE OR REPLACE cannot alter a return type, and a DROP/recreate risks a
-- later-merged migration silently reverting this one. SECURITY DEFINER and
-- search_path are restated because CREATE OR REPLACE resets them if omitted.
CREATE OR REPLACE FUNCTION public.unpublish_schedule(
  p_restaurant_id UUID,
  p_week_start DATE,
  p_week_end DATE,
  p_reason TEXT DEFAULT NULL
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_shift_count INTEGER;
  v_employee_ids UUID[];
  v_publication_id UUID;
  v_tz TEXT;
BEGIN
  -- Same authorization guard as publish_schedule; see the comment there.
  -- Unpublishing another tenant's week is the more damaging direction of the
  -- two: it clears is_published/locked and silently retracts a live schedule.
  IF NOT public.user_has_restaurant_access(p_restaurant_id, false) THEN
    RAISE EXCEPTION 'Not authorized to unpublish schedules for restaurant %', p_restaurant_id
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Same resolution as publish_schedule; see the comment there.
  SELECT r.timezone INTO v_tz
  FROM public.restaurants r
  WHERE r.id = p_restaurant_id;

  v_tz := COALESCE(NULLIF(v_tz, ''), 'UTC');

  BEGIN
    PERFORM now() AT TIME ZONE v_tz;
  EXCEPTION WHEN invalid_parameter_value THEN
    v_tz := 'UTC';
  END;

  -- The count and the audience both come from the UPDATE's RETURNING rather
  -- than from GET DIAGNOSTICS. Once this UPDATE feeds a CTE, GET DIAGNOSTICS
  -- would report the *enclosing* statement's row count, so a 63-shift unpublish
  -- would return 1 and the manager's toast would read "1 shift".
  --
  -- array_agg over zero rows yields NULL, not '{}', hence the COALESCE.
  -- shifts.employee_id is NOT NULL today, so the FILTER is defensive rather
  -- than load-bearing: employee_ids is NOT NULL as an array but would happily
  -- store a NULL *element*, and the notifier would then look up an employee
  -- that does not exist.
  WITH updated_shifts AS (
    UPDATE public.shifts s
    SET
      is_published = false,
      locked = false,
      published_at = NULL,
      published_by = NULL
    WHERE s.restaurant_id = p_restaurant_id
      AND (s.start_time AT TIME ZONE v_tz)::date >= p_week_start
      AND (s.start_time AT TIME ZONE v_tz)::date <= p_week_end
      AND s.is_published = true
    RETURNING s.employee_id
  )
  SELECT
    count(*)::int,
    COALESCE(array_agg(DISTINCT employee_id) FILTER (WHERE employee_id IS NOT NULL), '{}')
  INTO v_shift_count, v_employee_ids
  FROM updated_shifts;

  -- Unpublishing a week with nothing currently published is routine (a
  -- double-tap, or a week already retracted). Recording an empty retraction
  -- would leave the notifier a row with no audience to special-case.
  IF v_shift_count > 0 THEN
    -- Republishing appends, so a week can have several publication rows; the
    -- latest one is what employees were last told about.
    SELECT sp.id INTO v_publication_id
    FROM public.schedule_publications sp
    WHERE sp.restaurant_id = p_restaurant_id
      AND sp.week_start_date = p_week_start
    ORDER BY sp.published_at DESC
    LIMIT 1;

    INSERT INTO public.schedule_retractions (
      restaurant_id,
      publication_id,
      week_start_date,
      week_end_date,
      employee_ids,
      shift_count,
      reason,
      retracted_by
    ) VALUES (
      p_restaurant_id,
      v_publication_id,
      p_week_start,
      p_week_end,
      v_employee_ids,
      v_shift_count,
      p_reason,
      auth.uid()
    );
  END IF;

  -- Log the unpublish action
  INSERT INTO public.schedule_change_logs (
    restaurant_id,
    change_type,
    changed_by,
    reason
  ) VALUES (
    p_restaurant_id,
    'unpublished',
    auth.uid(),
    COALESCE(p_reason, 'Schedule unpublished for date range: ' || p_week_start || ' to ' || p_week_end)
  );

  RETURN v_shift_count;
END;
$$;

-- CREATE OR REPLACE preserves the existing ACL, but restate it so the grant
-- posture is visible in this migration rather than only in the earlier one.
REVOKE ALL ON FUNCTION public.unpublish_schedule(UUID, DATE, DATE, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.unpublish_schedule(UUID, DATE, DATE, TEXT) TO authenticated, service_role;

COMMENT ON FUNCTION public.unpublish_schedule(UUID, DATE, DATE, TEXT) IS
  'Unpublishes shifts in a date range (for corrections only). Uses the same '
  'restaurant-local date bucketing as publish_schedule, and records a '
  'schedule_retractions row snapshotting who had published shifts, so the '
  'retraction can be announced after the is_published flip has erased it.';
