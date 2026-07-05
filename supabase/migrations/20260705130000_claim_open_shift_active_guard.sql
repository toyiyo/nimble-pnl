-- Close the claim_open_shift is_active hole.
--
-- Bug: get_open_shifts already filters `st.is_active = true` when computing
-- which slots are offered as "available shifts" (20260412145842 and
-- 20260626120000 both have this filter in template_days). But
-- claim_open_shift's template fetch — inside the advisory-locked section —
-- never checked is_active, so a hidden (soft-archived, is_active = false)
-- template could still be claimed via the RPC directly, even though the
-- planner UI and get_open_shifts both hide it.
--
-- Fix: recreate claim_open_shift from the latest definition in
-- 20260626120000_open_shift_coverage.sql verbatim, adding one guard branch
-- immediately after the existing "NOT FOUND -> 'Template not found'" check:
-- template found but is_active = false -> 'This shift is no longer
-- available'. Both branches return success:false and the inactive-branch
-- message is constant regardless of any other state (no cross-tenant
-- enumeration through message shape). No pre-lock cheap check is added —
-- the fetch stays inside pg_advisory_xact_lock to avoid reintroducing the
-- TOCTOU class of bug the coverage migration's header describes.
--
-- Same signature / SECURITY DEFINER / SET search_path / re-issued GRANT as
-- the version being replaced.

CREATE OR REPLACE FUNCTION public.claim_open_shift(
    p_restaurant_id UUID,
    p_template_id   UUID,
    p_shift_date    DATE,
    p_employee_id   UUID
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_tz                TEXT;
    v_template          RECORD;
    v_assigned_count    INT;
    v_pending_count     BIGINT;
    v_requires_approval BOOLEAN;
    v_claim_id          UUID;
    v_shift_id          UUID;
    v_shift_start       TIMESTAMPTZ;
    v_shift_end         TIMESTAMPTZ;
BEGIN
    -- Look up the restaurant timezone.
    -- Fallback is 'UTC' to match the TypeScript computeOpenShiftCount path.
    SELECT COALESCE(r.timezone, 'UTC') INTO v_tz
    FROM public.restaurants r WHERE r.id = p_restaurant_id;

    -- Acquire a per-slot advisory transaction lock before computing counts.
    -- This serializes concurrent claims for the same (template, date) pair so
    -- two transactions cannot both read the same v_assigned_count + v_pending_count
    -- and both pass the capacity guard.  The lock is released automatically at
    -- transaction end (no explicit unlock needed).
    --
    -- Key: hashtext(template_id || shift_date) fits in int4 advisory lock space.
    PERFORM pg_advisory_xact_lock(hashtext(p_template_id::text || p_shift_date::text));

    -- Fetch the template (after holding the slot lock).
    SELECT * INTO v_template
    FROM public.shift_templates
    WHERE id = p_template_id
      AND restaurant_id = p_restaurant_id;

    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'error', 'Template not found');
    END IF;

    -- Guard: a hidden (soft-archived) template must not be claimable, even
    -- though it was found by id+restaurant. Mirrors the is_active = true
    -- filter get_open_shifts already applies when offering slots, so the
    -- offer and the claim guard stay in agreement. The message is constant
    -- regardless of any other template/claim state (no enumeration signal).
    IF NOT v_template.is_active THEN
        RETURN json_build_object('success', false, 'error', 'This shift is no longer available');
    END IF;

    -- Verify day-of-week matches
    IF NOT (EXTRACT(DOW FROM p_shift_date)::int = ANY(v_template.days)) THEN
        RETURN json_build_object('success', false, 'error', 'Template does not apply to this day');
    END IF;

    -- Coverage-based assigned count (replaces exact time-window match).
    -- Uses the same sweep-line function as get_open_shifts so the offer and
    -- claim guard always agree — prevents double-claiming a covered slot.
    v_assigned_count := public.shift_slot_min_concurrent(
        p_restaurant_id,
        v_template.position,
        p_shift_date,
        v_template.start_time,
        v_template.end_time,
        v_tz
    );

    -- Count pending claims for this template+date
    SELECT COUNT(*) INTO v_pending_count
    FROM public.open_shift_claims
    WHERE shift_template_id = p_template_id
      AND shift_date = p_shift_date
      AND status = 'pending_approval';

    -- Capacity guard: reject if coverage + pending already fills the slot.
    -- GREATEST(1, capacity) mirrors the capacityFloor used in get_open_shifts.
    IF (v_assigned_count + v_pending_count) >= GREATEST(1, v_template.capacity) THEN
        RETURN json_build_object('success', false, 'error', 'No open spots available');
    END IF;

    -- Build shift timestamps from template times + shift date.
    -- Cast to timestamp (no tz) first, then interpret in restaurant timezone.
    v_shift_start := (p_shift_date || ' ' || v_template.start_time)::timestamp AT TIME ZONE v_tz;
    v_shift_end   := (p_shift_date || ' ' || v_template.end_time)::timestamp   AT TIME ZONE v_tz;

    -- Handle overnight shifts
    IF v_template.end_time <= v_template.start_time THEN
        v_shift_end := v_shift_end + interval '1 day';
    END IF;

    -- Check for schedule conflict with existing employee shifts
    IF EXISTS (
        SELECT 1 FROM public.shifts
        WHERE employee_id    = p_employee_id
          AND restaurant_id  = p_restaurant_id
          AND status        != 'cancelled'
          AND (start_time, end_time) OVERLAPS (v_shift_start, v_shift_end)
    ) THEN
        RETURN json_build_object('success', false, 'error', 'Schedule conflict with existing shift');
    END IF;

    -- Check approval setting
    SELECT COALESCE(require_shift_claim_approval, false) INTO v_requires_approval
    FROM public.staffing_settings
    WHERE restaurant_id = p_restaurant_id;

    IF v_requires_approval IS NULL THEN
        v_requires_approval := false;
    END IF;

    IF NOT v_requires_approval THEN
        -- Instant approval: create the shift and the claim
        INSERT INTO public.shifts (
            restaurant_id, employee_id, start_time, end_time,
            break_duration, position, status, source, is_published
        ) VALUES (
            p_restaurant_id, p_employee_id, v_shift_start, v_shift_end,
            v_template.break_duration, v_template.position, 'scheduled', 'template', true
        )
        RETURNING id INTO v_shift_id;

        INSERT INTO public.open_shift_claims (
            restaurant_id, shift_template_id, shift_date,
            claimed_by_employee_id, status, resulting_shift_id
        ) VALUES (
            p_restaurant_id, p_template_id, p_shift_date,
            p_employee_id, 'approved', v_shift_id
        )
        RETURNING id INTO v_claim_id;

        RETURN json_build_object(
            'success', true,
            'claim_id', v_claim_id,
            'shift_id', v_shift_id,
            'status', 'approved',
            'message', 'Shift claimed and added to your schedule'
        );
    ELSE
        -- Requires approval: just create the claim
        INSERT INTO public.open_shift_claims (
            restaurant_id, shift_template_id, shift_date,
            claimed_by_employee_id, status
        ) VALUES (
            p_restaurant_id, p_template_id, p_shift_date,
            p_employee_id, 'pending_approval'
        )
        RETURNING id INTO v_claim_id;

        RETURN json_build_object(
            'success', true,
            'claim_id', v_claim_id,
            'status', 'pending_approval',
            'message', 'Claim submitted for manager approval'
        );
    END IF;
END;
$$;

-- Re-issue EXECUTE so the privilege is self-contained in this migration file.
GRANT EXECUTE ON FUNCTION public.claim_open_shift(UUID, UUID, DATE, UUID) TO authenticated;
