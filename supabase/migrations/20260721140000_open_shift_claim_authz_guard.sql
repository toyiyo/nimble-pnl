-- ============================================================================
-- Authorization guards for the open-shift-claim RPC family.
--
-- Design: docs/superpowers/specs/2026-07-21-open-shift-claim-authz-design.md
--
-- Four SECURITY DEFINER RPCs (get_open_shifts, claim_open_shift,
-- approve_open_shift_claim, reject_open_shift_claim) performed NO authorization
-- check on the caller. SECURITY DEFINER bypasses RLS, so auth.uid() was used
-- only to *record* an actor, never to *gate* the action. This allowed:
--   1. self-approval bypass (a claimer approving their own pending claim),
--   2. cross-tenant approve/reject of another restaurant's claim by id,
--   3. employee impersonation / cross-tenant claim via a client-supplied
--      p_employee_id, and
--   4. a cross-tenant read of another restaurant's open-shift availability.
--
-- This migration re-creates each function from its CURRENT-MAIN body and adds
-- the missing guard. Provenance of each body re-created here (important —
-- these functions were rewritten several times just before this landed, so
-- the guard is layered on the latest body to avoid reverting that work):
--   * get_open_shifts / claim_open_shift — 20260720120000_shift_fill_by_assignment.sql
--       (per-template shift_template_assigned_count counting + shift_template_id
--       FK stamp on the claimed shift).
--   * reject_open_shift_claim — 20260721000000_open_shift_claim_notify.sql
--       (reviewer_note persistence).
--   * approve_open_shift_claim — 20260721130000_stamp_template_id_on_approve.sql
--       (reviewer_note persistence + shift_template_id FK stamp).
-- Each body is otherwise carried verbatim; only the authorization guard (and,
-- for approve/reject, the folding of that guard into the locking SELECT) is
-- added. Timestamp 20260721140000 sorts after all of the above so this file's
-- definitions win on a clean reset.
--
-- Role sets:
--   * approve/reject — owner/manager/operations_manager, exact parity with the
--     deployed managers_review_claims (UPDATE) / managers_view_restaurant_claims
--     (SELECT) RLS policies, both widened to include operations_manager by
--     20260702170000_add_operations_manager_role.sql. Narrowing to owner/manager
--     would strip an existing privilege (a regression) and desync the read and
--     write audiences.
--   * get_open_shifts — internal team (user_is_internal_team: owner/manager/
--     operations_manager/chef/staff) OR a linked employee (employees.user_id =
--     auth.uid()); employees need to see open shifts to claim them and are not
--     guaranteed a user_restaurants row.
--   * claim_open_shift — the caller must own the employee row they claim for, in
--     the target restaurant (mirrors the employees_insert_own_claims INSERT RLS).
-- ============================================================================

-- ============================================================================
-- 1) get_open_shifts — membership guard (silent empty return; no enumeration
--    signal — same shape as the existing open_shifts_enabled=false branch).
--    Body: 20260720120000_shift_fill_by_assignment.sql, guard added at the top.
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
    -- Authorization guard: caller must belong to the restaurant, either as
    -- internal team (owner/manager/operations_manager/chef/staff) or as a
    -- linked employee. Silent empty return — no enumeration signal.
    IF NOT (
        public.user_is_internal_team(p_restaurant_id)
        OR EXISTS (
            SELECT 1 FROM public.employees e
            WHERE e.user_id = auth.uid()
              AND e.restaurant_id = p_restaurant_id
        )
    ) THEN
        RETURN;
    END IF;

    -- Look up the restaurant timezone.
    -- Fallback is 'UTC' to match the TypeScript computeOpenShiftCount path.
    SELECT COALESCE(r.timezone, 'UTC') INTO v_tz
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
        ac.assigned::bigint                                  AS assigned_count,
        COALESCE(p.cnt, 0)                                   AS pending_claims,
        (GREATEST(1, td.tmpl_capacity) - ac.assigned - COALESCE(p.cnt, 0))::bigint AS open_spots
    FROM template_days td
    CROSS JOIN LATERAL (
        SELECT public.shift_template_assigned_count(
            p_restaurant_id,
            td.tmpl_id,
            td.pub_date,
            v_tz
        ) AS assigned
    ) ac
    LEFT JOIN pending p ON p.shift_template_id = td.tmpl_id AND p.shift_date = td.pub_date
    WHERE (GREATEST(1, td.tmpl_capacity) - ac.assigned - COALESCE(p.cnt, 0)) > 0
    ORDER BY td.pub_date, td.tmpl_start;
END;
$$;

-- ============================================================================
-- 2) claim_open_shift — caller-owns-employee-row guard (constant 'Not
--    authorized' message; no enumeration of employees/restaurants). The guard
--    is the first statement in the body, before the advisory lock, so an
--    unauthorized caller never contends for the per-slot lock.
--    Body: 20260720120000_shift_fill_by_assignment.sql, guard added at the top.
-- ============================================================================
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
    -- Authorization guard: the caller must own the employee row they are
    -- claiming for, and that employee row must belong to the target
    -- restaurant. Mirrors the employees_insert_own_claims INSERT RLS policy on
    -- open_shift_claims. Constant message regardless of which half failed
    -- (unknown employee id vs. different restaurant vs. different owner) — no
    -- enumeration of employees/restaurants.
    IF NOT EXISTS (
        SELECT 1 FROM public.employees e
        WHERE e.id = p_employee_id
          AND e.user_id = auth.uid()
          AND e.restaurant_id = p_restaurant_id
    ) THEN
        RETURN json_build_object('success', false, 'error', 'Not authorized');
    END IF;

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

    -- Per-template distinct-employee count: replaces the whole-floor
    -- position+time sweep so the guard agrees with get_open_shifts
    -- on a per-template basis, not a per-position-window basis -- prevents
    -- double-claiming a slot that's actually still open on this template.
    v_assigned_count := public.shift_template_assigned_count(
        p_restaurant_id,
        p_template_id,
        p_shift_date,
        v_tz
    );

    -- Count pending claims for this template+date
    SELECT COUNT(*) INTO v_pending_count
    FROM public.open_shift_claims
    WHERE shift_template_id = p_template_id
      AND shift_date = p_shift_date
      AND status = 'pending_approval';

    -- Capacity guard: reject if assigned + pending already fills the slot.
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
        -- Instant approval: create the shift (stamp shift_template_id
        -- so the shift is FK-linked to the template it was claimed from) and
        -- the claim.
        INSERT INTO public.shifts (
            restaurant_id, employee_id, shift_template_id, start_time, end_time,
            break_duration, position, status, source, is_published
        ) VALUES (
            p_restaurant_id, p_employee_id, p_template_id, v_shift_start, v_shift_end,
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

-- ============================================================================
-- 3) approve_open_shift_claim — manager-audience guard, folded into the
--    locking SELECT so an unauthorized/cross-tenant caller's row never matches
--    and FOR UPDATE never acquires the lock (avoids a lock-contention window).
--    not-found and not-authorized collapse into one generic message (no
--    enumeration signal). Body: 20260721130000_stamp_template_id_on_approve.sql
--    (reviewer_note persistence + shift_template_id FK stamp + UTC fallback).
-- ============================================================================
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
    -- Lock the claim — the authorization predicate is folded into the WHERE
    -- clause so an unauthorized/cross-tenant caller's row never matches and
    -- FOR UPDATE never acquires a lock on it. The claim must exist AND the
    -- caller must be an owner/manager/operations_manager of the claim's
    -- restaurant (exact parity with the managers_review_claims RLS policy).
    -- NOT FOUND collapses both "no such claim" and "not your restaurant" into
    -- one generic message so a cross-tenant caller can't distinguish the two
    -- (no enumeration signal).
    SELECT * INTO v_claim
    FROM public.open_shift_claims
    WHERE id = p_claim_id
      AND public.user_has_role(restaurant_id, ARRAY['owner', 'manager', 'operations_manager'])
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'error', 'Claim not found or not authorized');
    END IF;

    IF v_claim.status != 'pending_approval' THEN
        RETURN json_build_object('success', false, 'error', 'Claim is not pending approval');
    END IF;

    -- Look up the restaurant timezone (after fetching the claim to get restaurant_id).
    -- Fallback is 'UTC' to match get_open_shifts / claim_open_shift (and the
    -- TypeScript computeOpenShiftCount path) so the offer, the claim guard, and
    -- the approved shift all agree on the wall-clock when timezone IS NULL.
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

-- ============================================================================
-- 4) reject_open_shift_claim — same folded manager-audience guard + generic
--    message as approve. Body: 20260721000000_open_shift_claim_notify.sql
--    (reviewer_note persistence).
-- ============================================================================
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
    -- Lock the claim — authorization predicate folded into the WHERE clause
    -- (see approve_open_shift_claim above for the full rationale). Owner/
    -- manager/operations_manager of the claim's restaurant only; not-found and
    -- not-authorized collapse into one generic message (no enumeration signal).
    SELECT * INTO v_claim
    FROM public.open_shift_claims
    WHERE id = p_claim_id
      AND public.user_has_role(restaurant_id, ARRAY['owner', 'manager', 'operations_manager'])
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'error', 'Claim not found or not authorized');
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

-- Re-issue EXECUTE on all four functions for idempotency — so this migration
-- file is self-contained regardless of prior grant history.
GRANT EXECUTE ON FUNCTION public.get_open_shifts(UUID, DATE, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION public.claim_open_shift(UUID, UUID, DATE, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_open_shift_claim(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reject_open_shift_claim(UUID, TEXT) TO authenticated;
