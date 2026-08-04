-- Cascading shift-template hour changes to the shifts generated from them.
--
-- Editing a template used to write one row. Shifts linked by
-- shifts.shift_template_id kept their old times forever, and the divergence
-- was invisible until someone showed up an hour early.
--
-- A blind cascade is not the fix either, so this function re-derives four
-- buckets server-side and only moves two of them: shifts whose restaurant-local
-- time-of-day still equals the template's CURRENT stored times, plus the
-- drifted shifts the manager explicitly opted into. Past and locked shifts are
-- never touched.
--
-- See docs/superpowers/specs/2026-08-03-template-hours-cascade-design.md.

-- ---------------------------------------------------------------------------
-- Batch key for Undo
-- ---------------------------------------------------------------------------
--
-- schedule_change_logs had nothing that groups the rows of one bulk write.
-- changed_at looks like a batch key (NOW() is transaction_timestamp(), so it is
-- identical across a transaction) but is not one: nothing stops another writer
-- from logging in the same transaction, and the table has no shift_template_id
-- to scope a revert by.
--
-- Nullable with no default, so every existing row and every existing writer --
-- including the log_shift_change trigger -- is unaffected.
ALTER TABLE public.schedule_change_logs
  ADD COLUMN IF NOT EXISTS cascade_batch_id UUID;

-- PARTIAL. The column is NULL for nearly every row, so the predicate keeps the
-- index small and keeps the write cost off the common logging path.
--
-- Deliberately not CONCURRENTLY. schedule_change_logs is written on most
-- scheduling actions, so a long SHARE lock would matter -- but the predicate
-- matches zero rows at creation time (brand-new, unbackfilled column), so the
-- build is effectively instantaneous regardless of table size. That keeps both
-- statements in one migration file, which CREATE INDEX CONCURRENTLY forbids.
CREATE INDEX IF NOT EXISTS idx_schedule_change_logs_cascade_batch
  ON public.schedule_change_logs (cascade_batch_id)
  WHERE cascade_batch_id IS NOT NULL;

COMMENT ON COLUMN public.schedule_change_logs.cascade_batch_id IS
  'Groups the audit rows written by one update_shift_template_with_cascade '
  'call so undo_template_hours_cascade can revert exactly that batch. NULL for '
  'every other writer, including the log_shift_change trigger.';

-- ---------------------------------------------------------------------------
-- update_shift_template_with_cascade
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_shift_template_with_cascade(
  p_template_id       UUID,
  p_restaurant_id     UUID,
  p_name              TEXT,
  p_position          TEXT,
  p_area              TEXT,
  p_days              INTEGER[],
  p_break_duration    INTEGER,
  p_capacity          INTEGER,
  p_start_time        TIME,
  p_end_time          TIME,
  p_cascade           BOOLEAN,
  p_drifted_shift_ids UUID[]
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tz            TEXT;
  v_old_start     TIME;
  v_old_end       TIME;
  v_batch_id      UUID := gen_random_uuid();
  v_updated_count INTEGER := 0;
  v_published_ids UUID[] := '{}';
  v_skipped_count INTEGER := 0;
  v_drift_ids     UUID[] := COALESCE(p_drifted_shift_ids, '{}'::UUID[]);
BEGIN
  -- The capability check, not a hardcoded role array: this is exactly what the
  -- shifts UPDATE policy and the schedule_change_logs INSERT policy require
  -- (20260730150000_rewrite_collaborator_policies.sql). Hardcoding
  -- ('owner','manager') would silently strip access from operations_manager and
  -- the collaborator roles.
  IF NOT public.user_has_capability(p_restaurant_id, 'edit:scheduling') THEN
    RAISE EXCEPTION 'Not authorized to edit scheduling for restaurant %', p_restaurant_id
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- The guard above proves only that the caller may edit scheduling AT THE
  -- RESTAURANT THEY NAMED. It says nothing about whether p_template_id or the
  -- ids in p_drifted_shift_ids belong to that restaurant, and this function
  -- bypasses RLS. Every statement below therefore also filters on
  -- restaurant_id = p_restaurant_id. Starting here: a template id from another
  -- tenant finds no row and the call becomes a no-op.
  SELECT t.start_time, t.end_time
    INTO v_old_start, v_old_end
  FROM public.shift_templates t
  WHERE t.id = p_template_id
    AND t.restaurant_id = p_restaurant_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'batch_id', NULL, 'updated_count', 0,
      'published_shift_ids', to_jsonb('{}'::UUID[]), 'skipped_count', 0
    );
  END IF;

  SELECT r.timezone INTO v_tz
  FROM public.restaurants r
  WHERE r.id = p_restaurant_id;

  -- 'America/Chicago', NOT the 'UTC' the six sibling scheduling functions use.
  -- restaurants.timezone is nullable, and the client's safeTz falls back to
  -- America/Chicago (src/lib/restaurantClock.ts:13,77). Falling back to UTC
  -- here would put the dialog's preview and this function's re-derived buckets
  -- in different hours for a null-timezone restaurant, manufacturing exactly
  -- the drift false-positives this feature exists to avoid. Retiming the other
  -- six to match is a follow-up with its own blast radius.
  v_tz := COALESCE(NULLIF(v_tz, ''), 'America/Chicago');
  BEGIN
    PERFORM now() AT TIME ZONE v_tz;
  EXCEPTION WHEN invalid_parameter_value THEN
    v_tz := 'America/Chicago';
  END;

  UPDATE public.shift_templates t
  SET name           = p_name,
      position       = p_position,
      area           = p_area,
      days           = p_days,
      break_duration = p_break_duration,
      capacity       = p_capacity,
      start_time     = p_start_time,
      end_time       = p_end_time,
      updated_at     = now()
  WHERE t.id = p_template_id
    AND t.restaurant_id = p_restaurant_id;

  IF p_cascade THEN
    -- Opted-in ids are re-validated, never trusted. Counted BEFORE the UPDATE
    -- so the predicate sees the same rows the cascade will.
    SELECT count(*)::int INTO v_skipped_count
    FROM unnest(v_drift_ids) AS req(id)
    WHERE NOT EXISTS (
      SELECT 1 FROM public.shifts s
      WHERE s.id = req.id
        AND s.restaurant_id     = p_restaurant_id
        AND s.shift_template_id = p_template_id
        AND s.start_time > now()
        AND s.locked = false
    );

    -- One statement: all row locks acquired in one go (lock-deadlock-prevention)
    -- and the transaction stays in milliseconds (lock-short-transactions).
    --
    -- `target` reads the pre-UPDATE snapshot, so its to_jsonb(s.*) is the OLD
    -- row -- that is before_data. The new instants are RECONSTRUCTED from each
    -- shift's own restaurant-local date rather than offset by an interval:
    -- interval arithmetic preserves elapsed duration across a DST boundary,
    -- which is the opposite of what a manager typing "10:00" means.
    WITH target AS (
      SELECT
        s.id,
        s.employee_id,
        to_jsonb(s.*) AS before_data,
        (((s.start_time AT TIME ZONE v_tz)::date || ' ' || p_start_time)::timestamp
          AT TIME ZONE v_tz) AS new_start,
        CASE
          WHEN p_end_time <= p_start_time THEN
            ((((s.start_time AT TIME ZONE v_tz)::date + 1) || ' ' || p_end_time)::timestamp
              AT TIME ZONE v_tz)
          ELSE
            (((s.start_time AT TIME ZONE v_tz)::date || ' ' || p_end_time)::timestamp
              AT TIME ZONE v_tz)
        END AS new_end
      FROM public.shifts s
      WHERE s.restaurant_id     = p_restaurant_id
        AND s.shift_template_id = p_template_id
        AND s.start_time > now()          -- Past: payroll has seen these
        AND s.locked = false              -- Locked: the flag means hands off
        AND (
          -- Moves with template: local time-of-day still equals the OLD times
          (    (s.start_time AT TIME ZONE v_tz)::time = v_old_start
           AND (s.end_time   AT TIME ZONE v_tz)::time = v_old_end)
          -- Your call: only the ids the manager explicitly opted into
          OR s.id = ANY(v_drift_ids)
        )
    ),
    updated AS (
      UPDATE public.shifts s
      SET start_time = t.new_start,
          end_time   = t.new_end,
          updated_at = now()
      FROM target t
      WHERE s.id = t.id
        AND s.restaurant_id = p_restaurant_id
      RETURNING s.id, s.employee_id, s.is_published,
                t.before_data, to_jsonb(s.*) AS after_data
    ),
    logged AS (
      -- A data-modifying CTE runs exactly once and to completion whether or not
      -- the primary query reads it, so this INSERT is not dead.
      INSERT INTO public.schedule_change_logs (
        restaurant_id, shift_id, employee_id, change_type, changed_by,
        before_data, after_data, reason, cascade_batch_id
      )
      SELECT p_restaurant_id, u.id, u.employee_id, 'updated', auth.uid(),
             u.before_data, u.after_data, 'Template hours cascade', v_batch_id
      FROM updated u
      RETURNING 1
    )
    -- Counts from RETURNING, not GET DIAGNOSTICS: once the UPDATE feeds a CTE,
    -- GET DIAGNOSTICS reports the ENCLOSING statement's row count.
    SELECT count(*)::int,
           COALESCE(array_agg(id) FILTER (WHERE is_published), '{}')
      INTO v_updated_count, v_published_ids
    FROM updated;
  END IF;

  RETURN jsonb_build_object(
    -- NULL when nothing moved, so the client knows not to offer Undo.
    'batch_id',            CASE WHEN v_updated_count > 0 THEN v_batch_id ELSE NULL END,
    'updated_count',       v_updated_count,
    'published_shift_ids', to_jsonb(v_published_ids),
    'skipped_count',       v_skipped_count
  );
END;
$$;

REVOKE ALL ON FUNCTION public.update_shift_template_with_cascade(UUID, UUID, TEXT, TEXT, TEXT, INTEGER[], INTEGER, INTEGER, TIME, TIME, BOOLEAN, UUID[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_shift_template_with_cascade(UUID, UUID, TEXT, TEXT, TEXT, INTEGER[], INTEGER, INTEGER, TIME, TIME, BOOLEAN, UUID[]) TO authenticated, service_role;

COMMENT ON FUNCTION public.update_shift_template_with_cascade(UUID, UUID, TEXT, TEXT, TEXT, INTEGER[], INTEGER, INTEGER, TIME, TIME, BOOLEAN, UUID[]) IS
  'Updates a shift template and, when p_cascade, retimes the future unlocked '
  'shifts whose restaurant-local hours still match the template''s previous '
  'hours, plus any drifted shifts named in p_drifted_shift_ids (re-validated '
  'server-side). Past and locked shifts are never touched. Tags its audit rows '
  'with a cascade_batch_id so undo_template_hours_cascade can revert the batch.';

-- ---------------------------------------------------------------------------
-- undo_template_hours_cascade
-- ---------------------------------------------------------------------------
--
-- The cascade is reversible, which is why the dialog needs no acknowledgement
-- checkbox. Two skip conditions are reported separately rather than lumped
-- together, because they mean different things to the manager reading the toast.
CREATE OR REPLACE FUNCTION public.undo_template_hours_cascade(
  p_batch_id      UUID,
  p_restaurant_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_restored_count      INTEGER := 0;
  v_changed_since_count INTEGER := 0;
  v_deleted_count       INTEGER := 0;
BEGIN
  IF NOT public.user_has_capability(p_restaurant_id, 'edit:scheduling') THEN
    RAISE EXCEPTION 'Not authorized to edit scheduling for restaurant %', p_restaurant_id
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- LOAD-BEARING. Every predicate below scopes with plain `cascade_batch_id =
  -- p_batch_id`, not IS NOT DISTINCT FROM -- equality is what lets the
  -- planner use idx_schedule_change_logs_cascade_batch_id, a partial index
  -- WHERE cascade_batch_id IS NOT NULL that an IS NOT DISTINCT FROM probe
  -- cannot use (confirmed via EXPLAIN: that operator forced a full scan of
  -- schedule_change_logs). Untagged rows -- including the ones
  -- log_shift_change writes with cascade_batch_id NULL -- must stay invisible
  -- to the revert; plain `=` already guarantees that on its own, since NULL
  -- never equals anything, so a NULL cascade_batch_id can never satisfy
  -- `= p_batch_id` regardless of what p_batch_id holds. The early return
  -- below is a separate guard, not a substitute for that: it stops a caller
  -- from treating "no batch" as a valid revert target instead of silently
  -- running three queries that would each match zero rows.
  IF p_batch_id IS NULL THEN
    RETURN jsonb_build_object(
      'restored_count', 0, 'changed_since_count', 0, 'deleted_count', 0
    );
  END IF;

  -- Deleted since. schedule_change_logs.shift_id is NOT a foreign key --
  -- 20260617120000_fix_schedule_change_logs_delete_fk.sql:38-44 dropped the
  -- constraint precisely so a 'deleted' audit row keeps the id of a shift that
  -- no longer exists. So `shift_id IS NULL` never fires and NOT EXISTS is the
  -- only correct probe.
  SELECT count(*)::int INTO v_deleted_count
  FROM public.schedule_change_logs l
  WHERE l.cascade_batch_id = p_batch_id
    AND l.restaurant_id = p_restaurant_id
    AND NOT EXISTS (SELECT 1 FROM public.shifts s WHERE s.id = l.shift_id);

  -- Changed since: the row still exists but its times no longer match what the
  -- cascade wrote, so someone edited it in between. Blindly restoring would
  -- destroy a newer, deliberate edit.
  SELECT count(*)::int INTO v_changed_since_count
  FROM public.schedule_change_logs l
  JOIN public.shifts s
    ON s.id = l.shift_id
   AND s.restaurant_id = p_restaurant_id
  WHERE l.cascade_batch_id = p_batch_id
    AND l.restaurant_id = p_restaurant_id
    AND (   s.start_time IS DISTINCT FROM (l.after_data->>'start_time')::timestamptz
         OR s.end_time   IS DISTINCT FROM (l.after_data->>'end_time')::timestamptz);

  WITH reverted AS (
    UPDATE public.shifts s
    SET start_time = (l.before_data->>'start_time')::timestamptz,
        end_time   = (l.before_data->>'end_time')::timestamptz,
        updated_at = now()
    FROM public.schedule_change_logs l
    WHERE l.cascade_batch_id = p_batch_id
      AND l.restaurant_id = p_restaurant_id
      AND s.id = l.shift_id
      AND s.restaurant_id = p_restaurant_id
      AND s.start_time IS NOT DISTINCT FROM (l.after_data->>'start_time')::timestamptz
      AND s.end_time   IS NOT DISTINCT FROM (l.after_data->>'end_time')::timestamptz
    RETURNING s.id, s.employee_id,
              l.after_data  AS undone_after,
              l.before_data AS undone_before
  ),
  logged AS (
    -- cascade_batch_id stays NULL on the undo's own rows. Tagging them with
    -- p_batch_id would make a second Undo click try to revert the revert.
    -- As written, a second click finds the original rows, sees current !=
    -- after_data, and reports them as changed-since -- safe, and honest.
    INSERT INTO public.schedule_change_logs (
      restaurant_id, shift_id, employee_id, change_type, changed_by,
      before_data, after_data, reason, cascade_batch_id
    )
    SELECT p_restaurant_id, r.id, r.employee_id, 'updated', auth.uid(),
           r.undone_after, r.undone_before, 'Undo template hours cascade', NULL
    FROM reverted r
    RETURNING 1
  )
  SELECT count(*)::int INTO v_restored_count FROM reverted;

  RETURN jsonb_build_object(
    'restored_count',      v_restored_count,
    'changed_since_count', v_changed_since_count,
    'deleted_count',       v_deleted_count
  );
END;
$$;

REVOKE ALL ON FUNCTION public.undo_template_hours_cascade(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.undo_template_hours_cascade(UUID, UUID) TO authenticated, service_role;

COMMENT ON FUNCTION public.undo_template_hours_cascade(UUID, UUID) IS
  'Reverts the shifts moved by one update_shift_template_with_cascade call, '
  'identified by cascade_batch_id, restoring each from its logged before_data. '
  'Skips shifts edited or deleted since the cascade and reports those counts '
  'separately.';
