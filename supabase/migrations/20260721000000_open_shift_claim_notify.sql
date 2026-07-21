-- ============================================================================
-- Open Shift Claims: persist reviewer note + notify claimant on approve/reject
-- ============================================================================

-- A) reviewer_note column (nullable, no default; table is small & net-new — no lock concern)
ALTER TABLE public.open_shift_claims
    ADD COLUMN IF NOT EXISTS reviewer_note TEXT;

-- B) approve_open_shift_claim — verbatim copy of 20260707090000 body + reviewer_note.
--    NOTE: CREATE OR REPLACE does NOT preserve SECURITY DEFINER — it MUST be
--    re-declared below or the function silently reverts to SECURITY INVOKER and
--    the definer-rights INSERT/UPDATE break under RLS. Do not remove it.
CREATE OR REPLACE FUNCTION public.approve_open_shift_claim(
    p_claim_id UUID,
    p_reviewer_note TEXT DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
-- Pin search_path so unqualified built-ins (now(), etc.) can't be resolved through a
-- caller-controlled path — standard definer-rights hardening; also clears Supabase's
-- mutable-search-path advisor lint. All table refs below are already public-qualified.
SET search_path = public, pg_temp
AS $$
DECLARE
    v_tz TEXT;
    v_claim RECORD;
    v_template RECORD;
    v_shift_id UUID;
    v_shift_start TIMESTAMPTZ;
    v_shift_end TIMESTAMPTZ;
BEGIN
    -- Lock the claim
    SELECT * INTO v_claim
    FROM public.open_shift_claims
    WHERE id = p_claim_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'error', 'Claim not found');
    END IF;

    IF v_claim.status != 'pending_approval' THEN
        RETURN json_build_object('success', false, 'error', 'Claim is not pending approval');
    END IF;

    -- Look up the restaurant timezone (after fetching the claim to get restaurant_id)
    SELECT COALESCE(r.timezone, 'America/Chicago') INTO v_tz
    FROM public.restaurants r WHERE r.id = v_claim.restaurant_id;

    -- Get the template
    SELECT * INTO v_template
    FROM public.shift_templates
    WHERE id = v_claim.shift_template_id;

    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'error', 'Template not found');
    END IF;

    -- Guard: a hidden (soft-archived) template must not be approvable into a shift.
    IF NOT v_template.is_active THEN
        RETURN json_build_object('success', false, 'error', 'This shift is no longer available');
    END IF;

    -- Build shift timestamps — cast to timestamp (no tz) first, then interpret in restaurant timezone
    v_shift_start := (v_claim.shift_date || ' ' || v_template.start_time)::timestamp AT TIME ZONE v_tz;
    v_shift_end := (v_claim.shift_date || ' ' || v_template.end_time)::timestamp AT TIME ZONE v_tz;

    IF v_template.end_time <= v_template.start_time THEN
        v_shift_end := v_shift_end + interval '1 day';
    END IF;

    -- Create the shift
    INSERT INTO public.shifts (
        restaurant_id, employee_id, start_time, end_time,
        break_duration, position, status, source, is_published
    ) VALUES (
        v_claim.restaurant_id, v_claim.claimed_by_employee_id,
        v_shift_start, v_shift_end,
        v_template.break_duration, v_template.position, 'scheduled', 'template', true
    )
    RETURNING id INTO v_shift_id;

    -- Update the claim (now persists reviewer_note)
    UPDATE public.open_shift_claims
    SET status = 'approved',
        resulting_shift_id = v_shift_id,
        reviewer_note = p_reviewer_note,
        reviewed_by = auth.uid(),
        reviewed_at = now()
    WHERE id = p_claim_id;

    RETURN json_build_object(
        'success', true,
        'shift_id', v_shift_id,
        'message', 'Claim approved and shift created'
    );
END;
$$;

-- C) reject_open_shift_claim — verbatim copy + reviewer_note. Same SECURITY DEFINER caveat.
CREATE OR REPLACE FUNCTION public.reject_open_shift_claim(
    p_claim_id UUID,
    p_reviewer_note TEXT DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
-- Pin search_path (see approve_open_shift_claim above) — definer-rights hardening.
SET search_path = public, pg_temp
AS $$
DECLARE
    v_claim RECORD;
BEGIN
    SELECT * INTO v_claim
    FROM public.open_shift_claims
    WHERE id = p_claim_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'error', 'Claim not found');
    END IF;

    IF v_claim.status != 'pending_approval' THEN
        RETURN json_build_object('success', false, 'error', 'Claim is not pending approval');
    END IF;

    UPDATE public.open_shift_claims
    SET status = 'rejected',
        reviewer_note = p_reviewer_note,
        reviewed_by = auth.uid(),
        reviewed_at = now()
    WHERE id = p_claim_id;

    RETURN json_build_object(
        'success', true,
        'message', 'Claim rejected'
    );
END;
$$;

-- D) Extend notification_channel_settings type catalog with open_shift_claim_reviewed.
--    A CHECK constraint can't be ALTERed in place; drop + re-add. The re-add takes a
--    brief ACCESS EXCLUSIVE lock + full-table revalidation — fine here (table is
--    restaurants × ~16 types, low thousands of rows).
ALTER TABLE public.notification_channel_settings
    DROP CONSTRAINT IF EXISTS notification_channel_settings_type_check;

ALTER TABLE public.notification_channel_settings
    ADD CONSTRAINT notification_channel_settings_type_check
    CHECK (notification_type IN (
      'schedule_published',
      'shift_created',
      'shift_modified',
      'shift_deleted',
      'open_shifts_broadcast',
      'shift_trade_created',
      'shift_trade_accepted',
      'shift_trade_approved',
      'shift_trade_rejected',
      'shift_trade_cancelled',
      'time_off_requested',
      'time_off_approved',
      'time_off_rejected',
      'pin_reset',
      'availability_reminder',
      'open_shift_claim_reviewed'
    ));

-- E) Keep the catalog-count doc comment in sync (was "15 catalog keys").
COMMENT ON COLUMN public.notification_channel_settings.notification_type IS
  'One of the 16 catalog keys in src/lib/notificationTypes.ts — kept in sync with the CHECK constraint above. (team_invite is excluded: a transactional invite email is always sent, not admin-toggleable.)';
