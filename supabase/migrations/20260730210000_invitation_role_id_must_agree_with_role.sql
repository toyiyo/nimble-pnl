-- ============================================================================
-- Migration: invitations.role_id must agree with invitations.role
--
-- Fixes a privilege-escalation path introduced by this branch and found in
-- review of PR #683.
--
-- WHAT WAS WRONG
--
-- 20260730170000 added invitations_validate_role_id() and its own header
-- described it as the "same shape as the check send-team-invitation already
-- performs". It was not. The edge function
-- (supabase/functions/send-team-invitation/index.ts:100-213) enforces four
-- things about a role_id:
--
--   1. role_id is present if and only if role = 'collaborator_custom'
--   2. the referenced role is not builtin
--   3. its flavor is 'collaborator'
--   4. its restaurant_id is the inviting restaurant
--
-- The trigger mirrored only (4). That gap matters because the edge function
-- is not the only writer: "Restaurant owners and managers can manage
-- invitations" (20260702170000) is FOR ALL with no WITH CHECK, so Postgres
-- reuses its USING expression for INSERT, and that expression tests the
-- caller's rights over `restaurant_id` alone. An owner, manager or
-- operations_manager can therefore write an invitation row straight from the
-- client through PostgREST.
--
-- The escalation, concretely: a *manager* inserts
--
--   role    = 'staff'
--   role_id = 'b0000000-0000-0000-0000-000000000001'   -- the Owner builtin
--
-- The Owner builtin is global (restaurant_id IS NULL), so the tenancy check
-- passes it. accept-invitation copies invitation.role_id onto the new
-- user_restaurants row verbatim (accept-invitation/index.ts:131), and
-- user_has_capability() dispatches to the areas branch whenever role_id IS
-- NOT NULL (20260730140000:70-84) -- it never re-reads the role string. The
-- invitee lands with every Owner capability, including manage:subscription,
-- which is itself a direct role_id comparison against that exact UUID
-- (20260730140000:27-29). Team Members displays them as "Staff".
--
-- This is an escalation *above the inviter's own level*, which is what makes
-- it more than a lateral move: a manager cannot grant themselves
-- manage:subscription, but they can mint it for an email they control.
--
-- WHAT THIS MIGRATION ENFORCES
--
-- The invariant is coherence, not "custom-only": role and role_id must name
-- the same role.
--
--   * builtin role_id      -> must equal builtin_role_id_for(NEW.role), the
--                             mapping 20260730170000 calls the single source.
--   * non-builtin role_id  -> the invitation must be a custom-role invite
--                             (role = 'collaborator_custom'), and the role
--                             must be collaborator-flavored and owned by the
--                             inviting restaurant.
--
-- Coherence rather than a literal transcription of the edge function's
-- rule 1, for two reasons. It keeps the allowance 20260730170000 deliberately
-- made -- and invitation_role_id_test.sql asserts -- that a builtin invite may
-- carry the matching builtin's id, so the moment anything starts populating
-- role_id on that path it does not break. And it is the same invariant
-- user_restaurants_sync_role_id already enforces for memberships, through the
-- same builtin_role_id_for() mapping, so the two triggers now say one thing
-- instead of two. Either rule closes the escalation; this one closes it
-- without narrowing what a legitimate invite may say.
--
-- Note that role = 'collaborator_custom' paired with a *builtin* role_id is
-- rejected by the builtin branch, because builtin_role_id_for() returns NULL
-- for 'collaborator_custom'. That is exactly the "a manager naming the Owner
-- builtin" case the edge function's own comment calls out.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.invitations_validate_role_id()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role_restaurant_id UUID;
  v_builtin BOOLEAN;
  v_flavor TEXT;
  v_found BOOLEAN;
BEGIN
  IF NEW.role_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT restaurant_id, builtin, flavor
    INTO v_role_restaurant_id, v_builtin, v_flavor
  FROM public.roles
  WHERE id = NEW.role_id;
  v_found := FOUND;

  -- A missing role is the FK's problem, not ours -- it rejects the same
  -- statement. Returning here keeps the error the client sees as the accurate
  -- one rather than masking it with an authorization message.
  IF NOT v_found THEN
    RETURN NEW;
  END IF;

  -- --------------------------------------------------------------------------
  -- Builtin: the id must name the same role the legacy string does. Anything
  -- else is a membership whose role and capabilities disagree.
  -- --------------------------------------------------------------------------
  IF v_builtin THEN
    IF NEW.role_id IS DISTINCT FROM public.builtin_role_id_for(NEW.role) THEN
      RAISE EXCEPTION
        'invitation role_id % does not match the invited role %',
        NEW.role_id, NEW.role
        USING ERRCODE = '42501';
    END IF;

    RETURN NEW;
  END IF;

  -- --------------------------------------------------------------------------
  -- Non-builtin: a tenant role, grantable only through a custom-role invite.
  -- --------------------------------------------------------------------------
  IF NEW.role IS DISTINCT FROM 'collaborator_custom' THEN
    RAISE EXCEPTION
      'invitation role_id % is a custom role, so role must be collaborator_custom, not %',
      NEW.role_id, NEW.role
      USING ERRCODE = '42501';
  END IF;

  -- flavor is checked for the same reason the RLS write policies pin it:
  -- area_catalog's per-area cap -- the guard that stops a custom role from
  -- holding Team & Access -- only applies to collaborator-flavored roles.
  IF v_flavor IS DISTINCT FROM 'collaborator' THEN
    RAISE EXCEPTION
      'invitation role_id % is not a collaborator role', NEW.role_id
      USING ERRCODE = '42501';
  END IF;

  -- A per-restaurant role is invitable only by the restaurant that owns it.
  -- A non-builtin row with restaurant_id IS NULL is not a shape the write
  -- policies admit; IS DISTINCT FROM rejects it too, which is the safe way
  -- round.
  IF v_role_restaurant_id IS DISTINCT FROM NEW.restaurant_id THEN
    RAISE EXCEPTION
      'invitation role_id % belongs to another restaurant', NEW.role_id
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.invitations_validate_role_id IS
'Rejects an invitation whose role_id disagrees with its role. A builtin role_id must equal builtin_role_id_for(role); a non-builtin role_id requires role = ''collaborator_custom'' and must be a collaborator-flavored role owned by the inviting restaurant. Without the agreement check, an owner/manager/operations_manager could insert role=''staff'' with the Owner builtin''s id straight through the FOR-ALL invitations policy, and accept-invitation would copy it onto the membership where user_has_capability() prefers role_id -- granting Owner capabilities to a member displayed as Staff. Mirrors send-team-invitation''s checks at a level no client writer can skip.';
