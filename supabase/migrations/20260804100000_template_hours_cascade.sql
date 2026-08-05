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
-- Deliberately not CONCURRENTLY, and the cost is a table scan under a SHARE
-- lock -- not zero. The all-NULL predicate keeps the resulting index tiny, but
-- a partial build still reads every row to evaluate the predicate, so writers
-- to schedule_change_logs block for the length of that scan. Accepted here:
-- CONCURRENTLY cannot run inside a transaction block and Supabase wraps each
-- migration in one, so using it would mean splitting this into a separate
-- out-of-band deploy step for an index the two functions below cannot work
-- without. The scan is sequential over an append-only audit table with no
-- index to build entries from, which is the cheap shape of this operation.
-- If schedule_change_logs ever grows past the point where a seq scan's
-- duration is an outage, move this statement to its own concurrent
-- pre-deploy migration and drop the IF NOT EXISTS here.
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
  v_tz                TEXT;
  v_old_start         TIME;
  v_old_end           TIME;
  v_batch_id          UUID := gen_random_uuid();
  v_updated_count     INTEGER := 0;
  v_published_shifts  JSONB := '[]'::jsonb;
  v_skipped_count     INTEGER := 0;
  v_drift_ids         UUID[] := COALESCE(p_drifted_shift_ids, '{}'::UUID[]);
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
  -- FOR UPDATE: this function reads the old hours here and UPDATEs the same
  -- template row below. Without the lock, two concurrent cascades on one
  -- template can both derive the same stale v_old_start/v_old_end, and the
  -- second to commit retimes its shifts against hours the template no longer
  -- has -- exactly the template/shift divergence this feature exists to
  -- eliminate.
  SELECT t.start_time, t.end_time
    INTO v_old_start, v_old_end
  FROM public.shift_templates t
  WHERE t.id = p_template_id
    AND t.restaurant_id = p_restaurant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'batch_id', NULL, 'updated_count', 0,
      'published_shifts', '[]'::jsonb, 'skipped_count', 0
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
    -- `target` produces before_data, and FOR UPDATE is what makes it true.
    -- Without the lock this CTE reads the statement's snapshot, so a concurrent
    -- writer that edited a shift between the snapshot and the UPDATE would have
    -- its edit overwritten AND logged as if it never existed -- Undo would then
    -- restore the snapshot, not that edit. Under READ COMMITTED, FOR UPDATE
    -- waits out the other writer, re-evaluates this WHERE against the row
    -- version it actually locked, and drops rows that no longer qualify. So
    -- to_jsonb(s.*) below is the row as it stands the instant we own it, and
    -- prev_start/prev_end (which the notification email renders as "Previous
    -- Start") describe what the employee was actually looking at.
    --
    -- MATERIALIZED is not decoration: it pins the lock-then-read to happen once
    -- and in full before the UPDATE reads this CTE, rather than leaving that to
    -- the planner's inlining choice.
    --
    -- Deliberately does NOT precompute the new instants: see the UPDATE's SET
    -- clause for why they come from the UPDATE's own row reference.
    WITH target AS MATERIALIZED (
      SELECT
        s.id,
        s.employee_id,
        s.start_time AS prev_start,
        s.end_time   AS prev_end,
        s.position   AS prev_position,
        to_jsonb(s.*) AS before_data
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
      FOR UPDATE
    ),
    updated AS (
      UPDATE public.shifts s
      -- RECONSTRUCTED from each shift's own restaurant-local date rather than
      -- offset by an interval: interval arithmetic preserves elapsed duration
      -- across a DST boundary, which is the opposite of what a manager typing
      -- "10:00" means.
      --
      -- Derived from `s`, not from `t`. In an UPDATE ... FROM, the SET
      -- expressions see the row version this statement locked, so
      -- `s.start_time` is unambiguously the current one. This matters because
      -- the guards below re-check only ::time, locked, and start_time > now()
      -- -- none of them pins the DATE, so a concurrent writer that moved this
      -- shift to a different day while keeping the same local time-of-day
      -- passes every one of them. `target`'s FOR UPDATE now makes t agree with
      -- s here, but the date belongs to the row being written, and saying so
      -- in the SET clause keeps this correct without depending on that.
      SET start_time = (((s.start_time AT TIME ZONE v_tz)::date || ' ' || p_start_time)::timestamp
                          AT TIME ZONE v_tz),
          end_time   = CASE
            WHEN p_end_time <= p_start_time THEN
              ((((s.start_time AT TIME ZONE v_tz)::date + 1) || ' ' || p_end_time)::timestamp
                AT TIME ZONE v_tz)
            ELSE
              (((s.start_time AT TIME ZONE v_tz)::date || ' ' || p_end_time)::timestamp
                AT TIME ZONE v_tz)
          END,
          updated_at = now()
      FROM target t
      -- Re-checks the same classification guards target already applied to
      -- s, not just s.id/s.restaurant_id. Under READ COMMITTED, if another
      -- transaction modified this row between the snapshot and this UPDATE,
      -- the UPDATE blocks and then re-evaluates its WHERE against the NEW row
      -- version -- so without repeating the guards a shift another writer
      -- moved into the past, locked, or hand-edited away from v_old_start/end
      -- would still get stomped. The drift-ids arm is preserved verbatim: a
      -- drifted opt-in row by definition fails the time-match arm, so
      -- dropping it would silently stop cascading every hand-edited shift the
      -- manager checked.
      --
      -- Belt and braces now that `target` locks: the rows are already ours by
      -- the time this runs, so these can no longer fail from a concurrent
      -- writer. Kept because they are the only thing standing between a future
      -- edit to `target` and a silent stomp.
      WHERE s.id = t.id
        AND s.restaurant_id = p_restaurant_id
        AND s.start_time > now()
        AND s.locked = false
        AND (
          (    (s.start_time AT TIME ZONE v_tz)::time = v_old_start
           AND (s.end_time   AT TIME ZONE v_tz)::time = v_old_end)
          OR s.id = ANY(v_drift_ids)
        )
      RETURNING s.id, s.employee_id, s.is_published,
                t.before_data, to_jsonb(s.*) AS after_data,
                t.prev_start, t.prev_end, t.prev_position
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
    --
    -- to_jsonb(prev_start) on the typed timestamptz column, not
    -- before_data->>'start_time': ->> yields Postgres' space-separated text
    -- rendering, while to_jsonb of a timestamptz yields ISO-8601 with a T,
    -- which is what the edge function's formatDateTime can parse.
    SELECT count(*)::int,
           COALESCE(
             jsonb_agg(
               jsonb_build_object(
                 'id', id,
                 'previous_start_time', to_jsonb(prev_start),
                 'previous_end_time',   to_jsonb(prev_end),
                 'previous_position',   prev_position
               )
             ) FILTER (WHERE is_published),
             '[]'::jsonb
           )
      INTO v_updated_count, v_published_shifts
    FROM updated;
  END IF;

  RETURN jsonb_build_object(
    -- NULL when nothing moved, so the client knows not to offer Undo.
    'batch_id',         CASE WHEN v_updated_count > 0 THEN v_batch_id ELSE NULL END,
    'updated_count',    v_updated_count,
    'published_shifts', v_published_shifts,
    'skipped_count',    v_skipped_count
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
  v_protected_count     INTEGER := 0;
BEGIN
  IF NOT public.user_has_capability(p_restaurant_id, 'edit:scheduling') THEN
    RAISE EXCEPTION 'Not authorized to edit scheduling for restaurant %', p_restaurant_id
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- LOAD-BEARING. Every predicate below scopes with plain `cascade_batch_id =
  -- p_batch_id`, not IS NOT DISTINCT FROM -- equality is what lets the
  -- planner use idx_schedule_change_logs_cascade_batch, a partial index
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
      'restored_count', 0, 'changed_since_count', 0, 'deleted_count', 0,
      'protected_count', 0
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
    AND NOT EXISTS (
      SELECT 1 FROM public.shifts s
      WHERE s.id = l.shift_id
        AND s.restaurant_id = p_restaurant_id
    );

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

  -- Protected since: the row still holds exactly what the cascade wrote, so it
  -- WOULD be restored -- but it has become locked, or its start has crossed
  -- into the past, since the cascade ran. The cascade refuses both (line ~190:
  -- `locked` means hands off; past shifts are payroll-visible), and Undo has to
  -- refuse them for the same reasons or the flag and the payroll boundary mean
  -- nothing the moment a toast is on screen. Counted separately so the toast
  -- can say why these did not come back instead of quietly folding them into
  -- restored_count.
  SELECT count(*)::int INTO v_protected_count
  FROM public.schedule_change_logs l
  JOIN public.shifts s
    ON s.id = l.shift_id
   AND s.restaurant_id = p_restaurant_id
  WHERE l.cascade_batch_id = p_batch_id
    AND l.restaurant_id = p_restaurant_id
    AND s.start_time IS NOT DISTINCT FROM (l.after_data->>'start_time')::timestamptz
    AND s.end_time   IS NOT DISTINCT FROM (l.after_data->>'end_time')::timestamptz
    AND (s.locked OR s.start_time <= now());

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
      -- Same two guards the cascade UPDATE applies. Without them Undo is a
      -- privileged writer that the `locked` flag and the past-shift boundary
      -- do not bind -- it would rewrite a shift the manager locked after the
      -- cascade, and one that payroll can already see. v_protected_count above
      -- counts exactly the rows these two lines exclude.
      AND s.locked = false
      AND s.start_time > now()
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
    'deleted_count',       v_deleted_count,
    'protected_count',     v_protected_count
  );
END;
$$;

REVOKE ALL ON FUNCTION public.undo_template_hours_cascade(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.undo_template_hours_cascade(UUID, UUID) TO authenticated, service_role;

COMMENT ON FUNCTION public.undo_template_hours_cascade(UUID, UUID) IS
  'Reverts the shifts moved by one update_shift_template_with_cascade call, '
  'identified by cascade_batch_id, restoring each from its logged before_data. '
  'Skips shifts edited, deleted, locked, or started since the cascade and '
  'reports each of those counts separately.';
