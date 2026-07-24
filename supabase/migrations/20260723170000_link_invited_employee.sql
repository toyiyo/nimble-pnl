-- link_invited_employee: service-role-only RPC that links an accountless
-- employee record (employees.user_id IS NULL) to the account created/joined
-- at invite-accept time.
--
-- Design: docs/superpowers/specs/2026-07-23-accountless-employee-invites-design.md #4
--
-- Unlike link_employee_to_user (client-callable, authorized via auth.uid()
-- against the caller's own membership), this function has NO in-function
-- caller check. It is reachable only through the REVOKE/GRANT boundary
-- below: PUBLIC/anon/authenticated are stripped of EXECUTE and only
-- service_role holds it. That is safe here because the only caller is the
-- accept-invitation edge function, which runs under the service-role key
-- AFTER it has already validated the invitation token server-side — by the
-- time this RPC runs, "which employee (if any) should this new account link
-- to" has already been decided by the invitation row, not by the caller's
-- say-so. Verified against migration history: no later migration issues a
-- blanket `GRANT EXECUTE ON ALL FUNCTIONS ...` that would re-open this.
--
-- Concurrency: a single signed-in user can in principle race two accept
-- calls (e.g. duplicate tab, retried request). PERFORM
-- pg_advisory_xact_lock(hashtext(user), hashtext(restaurant)) serializes
-- resolution+guard+update per (user, restaurant) pair so two concurrent
-- calls for the same user can't both pass the "not already linked" guard
-- and each attach a different employee row to the same user_id.
--
-- No schema change: the (user_id, restaurant_id) uniqueness this function
-- enforces is a code-level guard, not a DB constraint (the partial UNIQUE
-- index is deliberately deferred per the design doc's decision — it could
-- fail at deploy time against pre-existing duplicate rows in prod).

CREATE OR REPLACE FUNCTION public.link_invited_employee(
  p_user_id       UUID,
  p_restaurant_id UUID,
  p_employee_id   UUID DEFAULT NULL,
  p_email         TEXT DEFAULT NULL
)
RETURNS TABLE (
  linked      BOOLEAN,
  reason      TEXT,
  employee_id UUID
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_target        RECORD;
  v_other_owned   UUID;
  v_rows_updated  INTEGER;
  v_post_user_id  UUID;
BEGIN
  -- Serialize per (user, restaurant): two concurrent calls for the same user
  -- must not both pass the "not already linked" guard against different
  -- target rows and each attach their own row to the same user_id.
  PERFORM pg_advisory_xact_lock(
    hashtext(p_user_id::text),
    hashtext(p_restaurant_id::text)
  );

  -- Resolve the target row: active, in this restaurant, matched by explicit
  -- p_employee_id if given, else by p_email (trim + lower equality -- never
  -- ILIKE, whose _/% are wildcards and _ is valid in email local-parts).
  -- Deliberately NOT restricted by current ownership here -- a row that's
  -- already linked to someone else must still be FOUND so it can be
  -- reported as 'conflict' below, rather than indistinguishable from
  -- 'no_match' (which would hide a real double-booking from the caller).
  -- A single query is used (rather than two separate SELECT INTOs gated by
  -- IF) so v_target/FOUND are always set by exactly one query -- an
  -- untaken IF branch would leave FOUND holding whatever the PRIOR
  -- statement (the advisory lock PERFORM) set it to, which could either
  -- skip resolution entirely or leave v_target unassigned.
  SELECT e.* INTO v_target
  FROM public.employees e
  WHERE e.restaurant_id = p_restaurant_id
    AND e.status = 'active'
    AND (
      (p_employee_id IS NOT NULL AND e.id = p_employee_id)
      OR (p_employee_id IS NULL AND p_email IS NOT NULL AND lower(trim(e.email)) = lower(trim(p_email)))
    )
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, 'no_match'::TEXT, NULL::UUID;
    RETURN;
  END IF;

  -- Idempotency: the resolved target is already this user's row.
  IF v_target.user_id = p_user_id THEN
    RETURN QUERY SELECT TRUE, 'already_linked'::TEXT, v_target.id;
    RETURN;
  END IF;

  -- Guard: this user already owns a DIFFERENT employee row in this
  -- restaurant. useCurrentEmployee resolves the signed-in user's employee
  -- row with .single() on (user_id, restaurant_id); a second row sharing
  -- this user_id makes that query return multiple rows, which the hook
  -- treats as "no employee" -- silently breaking clock-in/schedule views.
  SELECT e.id INTO v_other_owned
  FROM public.employees e
  WHERE e.user_id = p_user_id
    AND e.restaurant_id = p_restaurant_id
    AND e.id <> v_target.id
  LIMIT 1;

  IF FOUND THEN
    RETURN QUERY SELECT FALSE, 'user_already_linked'::TEXT, NULL::UUID;
    RETURN;
  END IF;

  -- The resolved target itself is already claimed by someone else entirely
  -- (not p_user_id, not unclaimed): a genuine conflict, reported directly.
  IF v_target.user_id IS NOT NULL THEN
    RETURN QUERY SELECT FALSE, 'conflict'::TEXT, NULL::UUID;
    RETURN;
  END IF;

  UPDATE public.employees
  SET user_id = p_user_id, updated_at = NOW()
  WHERE id = v_target.id
    AND user_id IS NULL; -- guard against a concurrent link racing this call

  GET DIAGNOSTICS v_rows_updated = ROW_COUNT;

  IF v_rows_updated = 0 THEN
    -- Lost a race despite the advisory lock (e.g. a direct UPDATE bypassing
    -- this RPC). Re-read and mirror the idempotency contract.
    SELECT user_id INTO v_post_user_id FROM public.employees WHERE id = v_target.id;
    IF v_post_user_id = p_user_id THEN
      RETURN QUERY SELECT TRUE, 'already_linked'::TEXT, v_target.id;
    ELSE
      RETURN QUERY SELECT FALSE, 'conflict'::TEXT, NULL::UUID;
    END IF;
    RETURN;
  END IF;

  RETURN QUERY SELECT TRUE, 'linked'::TEXT, v_target.id;
END;
$$;

-- Least privilege: only the accept-invitation edge function (service_role)
-- may call this. No client role should ever resolve/link on its own say-so.
REVOKE ALL ON FUNCTION public.link_invited_employee(UUID, UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.link_invited_employee(UUID, UUID, UUID, TEXT) TO service_role;

COMMENT ON FUNCTION public.link_invited_employee IS
  'Links an accountless employee record (user_id IS NULL) to the account '
  'that just accepted an invitation, for any invitable role. Resolves the '
  'target by employee_id if given, else by trimmed/lowercased email, among '
  'active employees in the given restaurant -- regardless of current '
  'ownership, so a row already linked to someone else is reported as '
  '''conflict'' rather than indistinguishable from ''no_match''. Serializes '
  'per (user_id, restaurant_id) via pg_advisory_xact_lock and refuses to '
  'attach a second employee row to a user who already owns one in the '
  'restaurant (''user_already_linked''). Re-resolving to the same user is '
  'idempotent (''already_linked''). SECURITY DEFINER with no in-function '
  'caller check by design: EXECUTE is revoked from PUBLIC/anon/authenticated '
  'and granted only to service_role, so the sole caller is accept-invitation '
  'after it has already validated the invitation token. Returns (linked, '
  'reason, employee_id) with reason in (linked, already_linked, no_match, '
  'user_already_linked, conflict).';

-- Non-unique partial index for the now-hot "accountless active employees in
-- this restaurant" predicate -- hit by useAccountlessEmployees, this
-- function's resolution, and send-team-invitation's server-side
-- employee_id derivation. Safe/additive, unlike the deferred *unique*
-- index (see design doc decision) which could fail at deploy time against
-- pre-existing duplicate rows.
CREATE INDEX IF NOT EXISTS idx_employees_accountless
  ON public.employees (restaurant_id)
  WHERE user_id IS NULL AND status = 'active';
