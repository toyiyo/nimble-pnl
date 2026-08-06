-- Undo restores the template's own hours, not just the shifts (Bug 1).
--
-- update_shift_template_with_cascade writes the template's new hours and, when
-- p_cascade, retimes the matching shifts in the same statement. But
-- undo_template_hours_cascade only ever reverted the SHIFTS -- the template
-- itself stayed on the cascade's new hours forever. After an undo, the
-- template and its shifts disagreed about what the template's hours were, and
-- every later cascade measured "does this shift still match the template"
-- against a baseline the shifts no longer shared with. See
-- docs/superpowers/specs/2026-08-05-template-cascade-undo-fix-design.md.

-- ---------------------------------------------------------------------------
-- Part A: batch-header table
-- ---------------------------------------------------------------------------
--
-- Why a table and not columns on shift_templates: one row per historical batch is
-- exactly what Undo needs, and columns could only ever hold the latest one.
-- Why not a shift_id-less row in schedule_change_logs: the "deleted since" probe in
-- undo_template_hours_cascade is a NOT EXISTS against shifts, so a shift-less row
-- would be miscounted as a deleted shift.
CREATE TABLE IF NOT EXISTS public.template_hours_cascade_batches (
  id                UUID PRIMARY KEY,
  restaurant_id     UUID NOT NULL REFERENCES public.restaurants(id)     ON DELETE CASCADE,
  shift_template_id UUID NOT NULL REFERENCES public.shift_templates(id) ON DELETE CASCADE,
  before_start_time TIME NOT NULL,
  before_end_time   TIME NOT NULL,
  after_start_time  TIME NOT NULL,
  after_end_time    TIME NOT NULL,
  changed_by        UUID,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.template_hours_cascade_batches IS
  'One row per update_shift_template_with_cascade call that actually moved shifts, '
  'keyed by the same batch id that tags the run''s schedule_change_logs rows. Records '
  'the template''s own before/after hours so undo_template_hours_cascade can restore '
  'them alongside the shifts. Written and read only by those two SECURITY DEFINER '
  'functions; no client has any privilege on it.';

-- No policies. Both writers are SECURITY DEFINER and bypass RLS; every other caller
-- gets zero rows. The REVOKE is belt and braces and keeps the table off PostgREST.
ALTER TABLE public.template_hours_cascade_batches ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.template_hours_cascade_batches FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.template_hours_cascade_batches TO service_role;

-- ---------------------------------------------------------------------------
-- Part B: update_shift_template_with_cascade -- write the batch header
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

    -- Only when shifts actually moved: that is precisely when the RETURN below
    -- hands back a non-NULL batch_id and the client offers Undo. A header for a
    -- batch that moved nothing would be an unreachable row.
    IF v_updated_count > 0 THEN
      INSERT INTO public.template_hours_cascade_batches (
        id, restaurant_id, shift_template_id,
        before_start_time, before_end_time, after_start_time, after_end_time, changed_by
      )
      VALUES (
        v_batch_id, p_restaurant_id, p_template_id,
        -- v_old_start/v_old_end were captured at the FOR UPDATE read above, before
        -- this function's own UPDATE overwrote the template row.
        v_old_start, v_old_end, p_start_time, p_end_time, auth.uid()
      );
    END IF;
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
  'with a cascade_batch_id so undo_template_hours_cascade can revert the batch, '
  'and writes a template_hours_cascade_batches header (when shifts actually '
  'moved) recording the template''s own before/after hours for that revert.';

-- ---------------------------------------------------------------------------
-- Part C: undo_template_hours_cascade -- restore the template's own hours
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
  v_template_id            UUID;
  v_before_start           TIME;
  v_before_end              TIME;
  v_after_start             TIME;
  v_after_end               TIME;
  v_cur_start               TIME;
  v_cur_end                 TIME;
  -- Explicitly false, not plpgsql's NULL default: the legacy-batch path and the
  -- p_batch_id IS NULL early return both fall through without assigning these,
  -- and a null in the returned JSONB would diverge from what the client types.
  v_template_restored      BOOLEAN := false;
  v_template_changed_since BOOLEAN := false;
  v_template_slot_conflict BOOLEAN := false;
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
      'protected_count', 0, 'template_restored', false,
      'template_changed_since', false, 'template_slot_conflict', false
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

  -- Restore the template's own hours. Without this the template keeps the hours
  -- the cascade wrote while its shifts go back to the old ones, and every later
  -- edit measures those shifts against a baseline they no longer share -- which
  -- classifies them as drifted forever. That desync is the bug this migration exists
  -- to fix.
  --
  -- Placed BEFORE the shifts UPDATE so this function acquires shift_templates then
  -- shifts, the same order update_shift_template_with_cascade uses (its FOR UPDATE
  -- on the template precedes the `target` CTE's FOR UPDATE on the shifts). Consistent
  -- lock ordering is what keeps a concurrent cascade and undo from deadlocking.
  SELECT b.shift_template_id, b.before_start_time, b.before_end_time,
         b.after_start_time,  b.after_end_time
    INTO v_template_id, v_before_start, v_before_end, v_after_start, v_after_end
  FROM public.template_hours_cascade_batches b
  WHERE b.id = p_batch_id
    AND b.restaurant_id = p_restaurant_id;

  -- No header: a batch from before this migration. Revert the shifts as before and
  -- leave both flags false. Not an error.
  IF FOUND THEN
    SELECT t.start_time, t.end_time
      INTO v_cur_start, v_cur_end
    FROM public.shift_templates t
    WHERE t.id = v_template_id
      AND t.restaurant_id = p_restaurant_id
    FOR UPDATE;

    IF FOUND THEN
      -- The same "still holds exactly what the cascade wrote" guard the shift revert
      -- applies below. Plain `=` rather than IS NOT DISTINCT FROM because
      -- shift_templates.start_time/end_time are TIME NOT NULL, unlike the shift
      -- columns. If a manager edited the template's hours after the cascade, that is
      -- a newer deliberate decision and Undo declines rather than destroying it.
      IF v_cur_start = v_after_start AND v_cur_end = v_after_end THEN
        -- Subtransaction, deliberately. uq_shift_templates_active_slot is unique on
        -- (restaurant_id, position, start_time, end_time, days, coalesce(area,''))
        -- WHERE is_active -- so the cascade FREED this template's original slot, and
        -- another manager may have created an active template in it since. Restoring
        -- would then raise 23505, and without this block that error propagates out of
        -- the function and aborts the whole transaction: none of the shifts get
        -- reverted and the manager sees a raw constraint error instead of the Undo
        -- they asked for. A BEGIN/EXCEPTION block rolls back only its own work, so
        -- the shift revert below still runs and the template is reported as skipped --
        -- the same "decline safely and say so" contract as template_changed_since.
        BEGIN
          UPDATE public.shift_templates
          SET start_time = v_before_start,
              end_time   = v_before_end,
              updated_at = now()
          WHERE id = v_template_id
            AND restaurant_id = p_restaurant_id;
          v_template_restored := true;
        EXCEPTION WHEN unique_violation THEN
          -- Distinct from template_changed_since: nobody touched THIS template, so
          -- telling the manager its hours changed would send them to look at the
          -- wrong record. Something else now occupies the slot.
          v_template_slot_conflict := true;
        END;
      ELSE
        v_template_changed_since := true;
      END IF;
    END IF;
  END IF;

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
    'protected_count',     v_protected_count,
    'template_restored',      v_template_restored,
    'template_changed_since', v_template_changed_since,
    'template_slot_conflict', v_template_slot_conflict
  );
END;
$$;

REVOKE ALL ON FUNCTION public.undo_template_hours_cascade(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.undo_template_hours_cascade(UUID, UUID) TO authenticated, service_role;

COMMENT ON FUNCTION public.undo_template_hours_cascade(UUID, UUID) IS
  'Reverts the shifts moved by one update_shift_template_with_cascade call, '
  'identified by cascade_batch_id, restoring each from its logged before_data, '
  'and restores the template''s own hours from the batch header when the '
  'template still holds exactly what that cascade wrote. Skips shifts edited, '
  'deleted, locked, or started since the cascade and reports each of those '
  'counts separately, plus template_restored/template_changed_since/'
  'template_slot_conflict for the template itself -- the last when another active '
  'template has taken the freed uq_shift_templates_active_slot, which is skipped '
  'rather than aborting the shift revert. Batches from before this migration have '
  'no header row and all three template flags come back false.';
