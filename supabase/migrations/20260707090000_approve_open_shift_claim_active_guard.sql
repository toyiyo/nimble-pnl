-- Close the approve_open_shift_claim is_active hole.
--
-- Bug: claim_open_shift (20260705130000_claim_open_shift_active_guard.sql)
-- already rejects new claims on a hidden (is_active = false) template. But a
-- claim can still be sitting in 'pending_approval' from before the template
-- was hidden (approval-required restaurants: claim_open_shift inserts the
-- claim without creating a shift). approve_open_shift_claim fetches the
-- template by id and creates a shift without checking is_active, so a
-- manager can approve a hidden template's pending claim and create a new
-- assignment even though the template was removed from availability.
--
-- Fix: recreate approve_open_shift_claim from the latest definition in
-- 20260413001912_fix_shift_claim_timezone.sql verbatim, adding one guard
-- branch immediately after the existing "NOT FOUND -> 'Template not found'"
-- check: template found but is_active = false -> 'This shift is no longer
-- available'. Same constant-message convention as the claim_open_shift guard
-- (no cross-tenant enumeration through message shape). The claim itself is
-- left in 'pending_approval' (not auto-rejected) so a manager can still see
-- it and the employee can be told out-of-band; only the shift-creating
-- approval path is blocked.
--
-- Same signature / SECURITY DEFINER as the version being replaced. (The
-- original definition has no SET search_path or explicit GRANT, so none are
-- added here to avoid an unrelated behavior change.)

CREATE OR REPLACE FUNCTION public.approve_open_shift_claim(
    p_claim_id UUID,
    p_reviewer_note TEXT DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
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

    -- Guard: a hidden (soft-archived) template must not be approvable into a
    -- shift, even though the pending claim references it by id. Mirrors the
    -- is_active guard claim_open_shift already applies to new claims, so a
    -- template hidden after a claim was submitted can't still result in a
    -- new assignment. The message is constant regardless of any other
    -- state (no enumeration signal).
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

    -- Update the claim
    UPDATE public.open_shift_claims
    SET status = 'approved',
        resulting_shift_id = v_shift_id,
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
