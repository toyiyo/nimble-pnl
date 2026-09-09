-- Invitee-facing pending invitations: a signed-in invitee can list their
-- pending invitations (with the restaurant name) and accept one without
-- the emailed token.
--
-- Design: docs/superpowers/specs/2026-09-08-invite-owner-account-leak-design.md
--
-- Why an RPC and not a direct table query: RLS already lets the invitee
-- SELECT their own pending rows ("Users can view invitations sent to
-- their email", 20251220025830), but the invitee cannot read
-- `restaurants.name` (membership-gated SELECT, 20250915210020), and a
-- direct SELECT would expose the `token` column (a SHA-256 hash). The
-- RPC joins the name, hides the token, and keeps the accept
-- authorization server-side.
--
-- Authorization model of accept_my_invitation: the caller's
-- auth.email() must equal the invitation email (both sides lowercased —
-- historical rows carried mixed case, see 20251220025830). The emailed
-- token protects the link in transit; the email match is the real
-- authorization, exactly as in the accept-invitation edge function
-- (supabase/functions/accept-invitation/index.ts:104-106).
--
-- Writer registry (user_restaurants INSERT writers): this migration adds
-- `accept_my_invitation` as a writer, next to
-- `create_restaurant_with_owner`, the `accept-invitation` edge function,
-- `scim-v2`, and `create-kiosk-service-account`
-- (supabase/functions/create-kiosk-service-account/index.ts:129-136).
-- The RESTRICTIVE INSERT guard (20260808100000) does not apply: the
-- function is SECURITY DEFINER, owned by postgres, and the table does
-- not set FORCE ROW LEVEL SECURITY.

-- 1) List the caller's pending invitations.
CREATE OR REPLACE FUNCTION public.get_my_pending_invitations()
RETURNS TABLE (
  invitation_id uuid,
  restaurant_name text,
  role text,
  expires_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT i.id, r.name, i.role, i.expires_at
  FROM public.invitations i
  JOIN public.restaurants r ON r.id = i.restaurant_id
  WHERE auth.email() IS NOT NULL
    AND lower(i.email) = lower(auth.email())
    AND i.status = 'pending'
    AND i.expires_at > now()
  ORDER BY i.expires_at ASC;
$$;

-- 2) Accept one invitation without the emailed token.
CREATE OR REPLACE FUNCTION public.accept_my_invitation(p_invitation_id uuid)
RETURNS TABLE (
  accepted boolean,
  restaurant_id uuid,
  restaurant_name text,
  reason text
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_email text := auth.email();
  v_inv   RECORD;
  v_rname text;
BEGIN
  -- A session without an email claim fails closed with a clear reason.
  IF v_uid IS NULL OR v_email IS NULL THEN
    RETURN QUERY SELECT false, NULL::uuid, NULL::text, 'no_email'::text;
    RETURN;
  END IF;

  -- Serialize per (user, invitation). The token path
  -- (accept-invitation edge function) takes no lock; the
  -- unique_violation handler below absorbs that cross-path race.
  PERFORM pg_advisory_xact_lock(
    hashtext(v_uid::text),
    hashtext(p_invitation_id::text)
  );

  -- FOR UPDATE: the advisory lock serializes accept callers only, not the
  -- owner-side writers (cancel, delete, re-invite through PostgREST). The
  -- row lock makes the pending check and the accept one atomic unit — a
  -- cancel that commits first turns this call into not_found, and a
  -- cancel that arrives later waits and then applies after the accept.
  SELECT i.id, i.restaurant_id, i.email, i.role, i.role_id, i.employee_id
  INTO v_inv
  FROM public.invitations i
  WHERE i.id = p_invitation_id
    AND i.status = 'pending'
    AND i.expires_at > now()
    AND lower(i.email) = lower(v_email)
  FOR UPDATE;

  -- One undifferentiated reason for "no such row", "expired",
  -- "cancelled", and "not your invitation", so the RPC is not a probe
  -- oracle for other tenants' invitation ids.
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, NULL::uuid, NULL::text, 'not_found'::text;
    RETURN;
  END IF;

  SELECT r.name INTO v_rname
  FROM public.restaurants r
  WHERE r.id = v_inv.restaurant_id;

  -- Membership. The unique_violation handler keeps a concurrent accept
  -- through the token path idempotent instead of an error —
  -- user_restaurants has UNIQUE(user_id, restaurant_id)
  -- (20250915210020). role_id is NULL for every builtin invitation and
  -- set only for collaborator_custom, same as the edge function
  -- (supabase/functions/accept-invitation/index.ts:117-137).
  -- A handler block is used instead of ON CONFLICT because the conflict
  -- column list would collide with the restaurant_id output parameter
  -- under plpgsql variable substitution.
  BEGIN
    INSERT INTO public.user_restaurants (user_id, restaurant_id, role, role_id)
    SELECT v_uid, v_inv.restaurant_id, v_inv.role, v_inv.role_id
    WHERE NOT EXISTS (
      SELECT 1 FROM public.user_restaurants ur
      WHERE ur.user_id = v_uid
        AND ur.restaurant_id = v_inv.restaurant_id
    );
  EXCEPTION WHEN unique_violation THEN
    NULL; -- already a member via a concurrent accept
  END;

  -- Link an accountless employee record. Non-fatal: an error here must
  -- not roll back the membership insert. The privilege check passes
  -- because postgres owns both functions and an owner keeps implicit
  -- EXECUTE; the service-role-only grant on link_invited_employee
  -- stays intact for direct callers.
  BEGIN
    PERFORM public.link_invited_employee(
      v_uid,
      v_inv.restaurant_id,
      v_inv.employee_id,
      v_inv.email
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'accept_my_invitation: link_invited_employee failed: %', SQLERRM;
  END;

  -- Delete old accepted rows first: UNIQUE(restaurant_id, email, status)
  -- (20250915233731) would otherwise reject the status flip on a
  -- re-invite. Mirror of accept-invitation
  -- (supabase/functions/accept-invitation/index.ts:166-183).
  -- d.id <> p_invitation_id: a concurrent token-path accept can flip
  -- THIS row to accepted between the SELECT above and here; without the
  -- exclusion the delete would remove the row it is about to update and
  -- lose the accepted_at/accepted_by audit record.
  DELETE FROM public.invitations d
  WHERE d.restaurant_id = v_inv.restaurant_id
    AND d.email = v_inv.email
    AND d.status = 'accepted'
    AND d.id <> p_invitation_id;

  UPDATE public.invitations u
  SET status      = 'accepted',
      accepted_at = now(),
      accepted_by = v_uid,
      updated_at  = now()
  WHERE u.id = p_invitation_id;

  RETURN QUERY SELECT true, v_inv.restaurant_id, v_rname, NULL::text;
END;
$$;

-- 3) Grants. Definer functions default to PUBLIC EXECUTE; close that.
REVOKE ALL ON FUNCTION public.get_my_pending_invitations() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_pending_invitations() TO authenticated;

REVOKE ALL ON FUNCTION public.accept_my_invitation(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_my_invitation(uuid) TO authenticated;

-- 4) Index for the new lookup. The existing unique index leads with
-- restaurant_id and cannot serve a lower(email) probe.
CREATE INDEX IF NOT EXISTS idx_invitations_lower_email_pending
ON public.invitations (lower(email))
WHERE status = 'pending';

-- 5) Register the second caller of link_invited_employee. The function
-- body and grants stay unchanged; only the caller documentation grows.
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
  'and granted only to service_role. Two callers, both after the invitation '
  'row has decided the link target: the accept-invitation edge function '
  '(service_role, after token validation) and accept_my_invitation '
  '(owner-privilege call from inside a postgres-owned SECURITY DEFINER '
  'function, after the auth.email() match; 20260908230000). Returns '
  '(linked, reason, employee_id) with reason in (linked, already_linked, '
  'no_match, user_already_linked, conflict).';

COMMENT ON FUNCTION public.get_my_pending_invitations IS
  'Lists the caller''s pending, unexpired invitations with the restaurant '
  'name. SECURITY DEFINER because the invitee cannot read '
  'restaurants.name under RLS and must never see the token column. '
  'Scoped by lower(auth.email()); returns nothing without an email claim.';

COMMENT ON FUNCTION public.accept_my_invitation IS
  'Token-free invitation accept for a signed-in invitee. Authorized by '
  'the lower(auth.email()) match against invitations.email. Inserts the '
  'membership (idempotent under a unique_violation handler), links an '
  'accountless employee (non-fatal), and marks the invitation accepted. '
  'Returns one undifferentiated ''not_found'' reason so invitation ids '
  'cannot be probed.';
