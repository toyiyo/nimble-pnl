-- Re-apply the shift_template_id FK stamp on approve_open_shift_claim's shift
-- INSERT, on top of 20260721000000_open_shift_claim_notify.sql.
--
-- Migration-collision fix: this PR's 20260720120000_shift_fill_by_assignment.sql
-- added the FK stamp to approve_open_shift_claim, but PR #627
-- (20260721000000_open_shift_claim_notify.sql) landed on main afterward and
-- recreated approve_open_shift_claim from the pre-stamp body (to add
-- reviewer_note persistence + search_path hardening), silently reverting the
-- stamp. Because 20260721000000 sorts after 20260720120000, its version wins on
-- a clean reset. This migration recreates approve_open_shift_claim as
-- 20260721000000's body PLUS the FK stamp so BOTH changes coexist.
--
-- Why the stamp matters: fill-by-assignment counts shifts assigned to a
-- template by shift_template_id (get_open_shifts / claim_open_shift /
-- shift_template_assigned_count). A claimed shift created without the FK falls
-- through the legacy exact-time fallback and, if its hours don't exactly match
-- the template, never counts toward the slot — allowing a double-claim of an
-- already-filled slot. Stamping the FK keeps the offer and the claim guard in
-- agreement.
--
-- Body is otherwise a verbatim copy of 20260721000000's approve_open_shift_claim
-- (reviewer_note persistence, is_active guard, restaurant-tz shift build,
-- SECURITY DEFINER, SET search_path). Only the INSERT INTO public.shifts gains
-- the shift_template_id column + value.

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

    -- Look up the restaurant timezone (after fetching the claim to get restaurant_id).
    -- Fallback is 'UTC' to match get_open_shifts / claim_open_shift (and the
    -- TypeScript computeOpenShiftCount path) so the offer, the claim guard, and
    -- the approved shift all agree on the wall-clock when timezone IS NULL.
    -- (Reviewer: prior approve body fell back to 'America/Chicago', diverging.)
    SELECT COALESCE(r.timezone, 'UTC') INTO v_tz
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

    -- Create the shift (stamp shift_template_id so the shift is FK-linked to the
    -- template it was approved from — required by fill-by-assignment counting).
    INSERT INTO public.shifts (
        restaurant_id, employee_id, shift_template_id, start_time, end_time,
        break_duration, position, status, source, is_published
    ) VALUES (
        v_claim.restaurant_id, v_claim.claimed_by_employee_id, v_claim.shift_template_id,
        v_shift_start, v_shift_end,
        v_template.break_duration, v_template.position, 'scheduled', 'template', true
    )
    RETURNING id INTO v_shift_id;

    -- Update the claim (persists reviewer_note)
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
