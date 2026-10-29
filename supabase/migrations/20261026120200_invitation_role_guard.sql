-- ============================================================================
-- Migration: invitation role guard
--
-- Design: docs/superpowers/specs/2026-10-26-invitation-role-guard-design.md
--
-- WHAT WAS WRONG
--
-- 1. "Restaurant owners and managers can manage invitations" (20260702170000)
--    is FOR ALL with no WITH CHECK. Postgres uses its USING clause for new
--    rows, and that clause checks only the caller's membership. A manager
--    can INSERT role = 'owner' through PostgREST.
-- 2. No check looks at invitations.role. invitations_validate_role_id
--    returns at once when role_id IS NULL (20260730210000).
-- 3. "Users can accept their own invitations" (20251220025830) does not
--    limit the columns of the UPDATE. The invitee can change role, token,
--    email or restaurant_id before the accept.
-- 4. accept-invitation and accept_my_invitation copy invitation.role into
--    user_restaurants and do not check the inviter.
--
-- WHAT THIS MIGRATION DOES
--
-- 1. inviter_may_invite / caller_may_invite: the invite rule, built on the
--    SQL matrix invitable_roles + can_invite_custom_role (20260802110000).
-- 2. Trigger invitations_enforce_invitable_role: a browser session
--    (anon / authenticated) can write only a role that it may invite, and
--    only with invited_by = auth.uid(). The service role, postgres, and
--    SECURITY DEFINER code skip the check. send-team-invitation checks the
--    same matrix before its service-role INSERT.
-- 3. The FOR ALL policy becomes INSERT, UPDATE and DELETE policies, each
--    with the clauses that Postgres allows for that command.
-- 4. A browser session cannot UPDATE invitations at all. A browser INSERT
--    gets a random token that the browser never sees.
-- 5. accept_my_invitation refuses a row whose inviter may not invite its
--    role. get_my_pending_invitations hides such a row.
--
-- The matrix: a manager may invite a manager but not an owner. This is the
-- rule in src/lib/permissions/invitations.ts (INVITABLE_ROLES).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. The invite rule.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.inviter_may_invite(
  p_inviter       uuid,
  p_restaurant_id uuid,
  p_role          text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_restaurants ur
    WHERE ur.user_id = p_inviter
      AND ur.restaurant_id = p_restaurant_id
      AND (
        (p_role = 'collaborator_custom' AND public.can_invite_custom_role(ur.role))
        OR p_role = ANY (COALESCE(public.invitable_roles(ur.role), ARRAY[]::text[]))
      )
  );
$$;

COMMENT ON FUNCTION public.inviter_may_invite IS
'Whether p_inviter, by their membership role in p_restaurant_id, may invite p_role. Uses invitable_roles and can_invite_custom_role, the SQL copy of the invite matrix. No membership returns false. EXECUTE is for service_role only: the result tells about the role of any user.';

REVOKE ALL ON FUNCTION public.inviter_may_invite(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.inviter_may_invite(uuid, uuid, text) TO service_role;

CREATE OR REPLACE FUNCTION public.caller_may_invite(
  p_restaurant_id uuid,
  p_role          text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT auth.uid() IS NOT NULL
     AND public.inviter_may_invite(auth.uid(), p_restaurant_id, p_role);
$$;

COMMENT ON FUNCTION public.caller_may_invite IS
'Whether the caller (auth.uid()) may invite p_role to p_restaurant_id. Tells the caller only about their own rights. Used by the invitations_enforce_invitable_role trigger.';

REVOKE ALL ON FUNCTION public.caller_may_invite(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.caller_may_invite(uuid, text) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 2. The trigger.
--
-- SECURITY INVOKER on purpose: current_user must be the real caller. In a
-- SECURITY DEFINER function current_user is the function owner, and the
-- check could not tell a browser session from the service role.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.invitations_enforce_invitable_role()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Only browser sessions are checked. service_role (send-team-invitation,
  -- accept-invitation), postgres (migrations, SECURITY DEFINER functions)
  -- and other server roles do their own checks.
  IF current_user NOT IN ('anon', 'authenticated') THEN
    RETURN NEW;
  END IF;

  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'An invitation needs a signed-in inviter'
      USING ERRCODE = '42501';
  END IF;

  -- accept-invitation checks the role of invited_by. A forged invited_by
  -- would make that check use the wrong inviter.
  IF NEW.invited_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'invited_by must be the signed-in user'
      USING ERRCODE = '42501';
  END IF;

  IF NOT public.caller_may_invite(NEW.restaurant_id, NEW.role) THEN
    RAISE EXCEPTION 'Your role cannot invite the role %', NEW.role
      USING ERRCODE = '42501';
  END IF;

  -- The token is the accept secret. signup-with-invitation and
  -- accept-invitation trust whoever knows it, so a browser must not choose
  -- it. Replace it with a random hash that nobody holds. Only
  -- send-team-invitation (service role) issues a usable token.
  IF TG_OP = 'INSERT' THEN
    NEW.token := encode(
      sha256(convert_to(gen_random_uuid()::text || gen_random_uuid()::text, 'UTF8')),
      'hex');
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.invitations_enforce_invitable_role IS
'BEFORE INSERT OR UPDATE OF role, restaurant_id, invited_by on invitations. For anon/authenticated callers: rejects a NULL auth.uid(), an invited_by other than auth.uid(), and a role that caller_may_invite refuses, and replaces the token of an INSERT with a random hash. Server roles (service_role, postgres) skip the check.';

DROP TRIGGER IF EXISTS invitations_enforce_invitable_role ON public.invitations;
CREATE TRIGGER invitations_enforce_invitable_role
  BEFORE INSERT OR UPDATE OF role, restaurant_id, invited_by ON public.invitations
  FOR EACH ROW
  EXECUTE FUNCTION public.invitations_enforce_invitable_role();

-- ----------------------------------------------------------------------------
-- 3. Policies. SELECT stays on "Restaurant owners and managers can view
-- invitations (no tokens)" (20260702170000), which has the same condition.
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Restaurant owners and managers can manage invitations" ON public.invitations;
DROP POLICY IF EXISTS "Restaurant owners and managers can create invitations" ON public.invitations;
DROP POLICY IF EXISTS "Restaurant owners and managers can update invitations" ON public.invitations;
DROP POLICY IF EXISTS "Restaurant owners and managers can delete invitations" ON public.invitations;

CREATE POLICY "Restaurant owners and managers can create invitations"
ON public.invitations
FOR INSERT
TO authenticated
WITH CHECK (
  invited_by = auth.uid()
  AND EXISTS (
    SELECT 1 FROM public.user_restaurants ur
    WHERE ur.restaurant_id = invitations.restaurant_id
      AND ur.user_id = auth.uid()
      AND ur.role IN ('owner', 'manager', 'operations_manager')
  )
);

CREATE POLICY "Restaurant owners and managers can update invitations"
ON public.invitations
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.user_restaurants ur
    WHERE ur.restaurant_id = invitations.restaurant_id
      AND ur.user_id = auth.uid()
      AND ur.role IN ('owner', 'manager', 'operations_manager')
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.user_restaurants ur
    WHERE ur.restaurant_id = invitations.restaurant_id
      AND ur.user_id = auth.uid()
      AND ur.role IN ('owner', 'manager', 'operations_manager')
  )
);

CREATE POLICY "Restaurant owners and managers can delete invitations"
ON public.invitations
FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.user_restaurants ur
    WHERE ur.restaurant_id = invitations.restaurant_id
      AND ur.user_id = auth.uid()
      AND ur.role IN ('owner', 'manager', 'operations_manager')
  )
);

-- ----------------------------------------------------------------------------
-- 4. Grants. A browser session cannot UPDATE invitations.
--
-- The app sends no UPDATE on invitations from the browser: it reads and
-- deletes only (src/components/TeamInvitations.tsx, src/hooks/useCollaborators.ts).
-- The invitee accepts through accept_my_invitation or accept-invitation,
-- which run as postgres and the service role. A column grant on status is
-- not safe: a manager could set a cancelled or accepted owner invitation
-- back to 'pending', and the trigger does not fire for status.
--
-- This also closes the invitee path of "Users can accept their own
-- invitations", which limits rows but not columns. The UPDATE policies stay
-- as a second layer for a future grant.
-- ----------------------------------------------------------------------------
REVOKE INSERT, UPDATE ON public.invitations FROM anon;
REVOKE UPDATE ON public.invitations FROM authenticated;

-- ----------------------------------------------------------------------------
-- 5. Accept paths. Same bodies as 20260908230000, plus the inviter check.
-- ----------------------------------------------------------------------------
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
    -- Hide a row that accept_my_invitation would refuse.
    AND public.inviter_may_invite(i.invited_by, i.restaurant_id, i.role)
  ORDER BY i.expires_at ASC;
$$;

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
  SELECT i.id, i.restaurant_id, i.email, i.role, i.role_id, i.employee_id,
         i.invited_by
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

  -- The inviter must still hold a role that may invite this role
  -- (20261026120200). This refuses a row that a manager forged before the
  -- invitation_role_guard trigger existed, and a row whose inviter lost
  -- the right after the send. Same undifferentiated reason as above.
  IF NOT public.inviter_may_invite(v_inv.invited_by, v_inv.restaurant_id, v_inv.role) THEN
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

-- CREATE OR REPLACE keeps the grants; restate them so this file is the
-- full record.
REVOKE ALL ON FUNCTION public.get_my_pending_invitations() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_pending_invitations() TO authenticated;

REVOKE ALL ON FUNCTION public.accept_my_invitation(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_my_invitation(uuid) TO authenticated;
