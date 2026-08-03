-- ============================================================================
-- assign_membership_role — close the flavor/builtin gap in the custom-role
-- branch (Rule 6).
--
-- CREATE OR REPLACE, not an edit of 20260802110000_assign_membership_role.sql:
-- that migration is already applied, so the fix ships as its own migration.
--
-- The bug: Rule 6's custom-role branch verified only that p_role_id belongs
-- to the caller's restaurant. It never checked roles.builtin = false or
-- roles.flavor = 'collaborator', unlike the sibling invite-acceptance guard
-- (20260730210000_invitation_role_id_must_agree_with_role.sql), which checks
-- both. If any restaurant-scoped, platform-flavored role existed, an
-- owner/manager could call
--   assign_membership_role(membership, 'collaborator_custom', platform_role_id)
-- and it would succeed, writing that role_id onto the membership.
-- user_has_capability() resolves from role_id, and
-- role_areas_enforce_collaborator_cap explicitly exempts platform-flavored
-- roles from the collaborator cap (see its comment in
-- 20260730100000_roles_and_areas_tables.sql: "Platform-flavored custom roles
-- are also exempt from the cap in this phase") — so this would bypass the
-- caps a collaborator_custom assignment is supposed to inherit.
--
-- Today the RLS INSERT policy on public.roles pins flavor = 'collaborator'
-- AND builtin = false for client-issued rows, so no such role is reachable
-- through the normal UI. This closes the gap anyway: a service-role write or
-- the deferred "platform custom roles" phase would otherwise hit it, and the
-- check costs nothing on the path that is already safe.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.assign_membership_role(
  p_membership_id UUID,
  p_role          TEXT,
  p_role_id       UUID DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_restaurant_id      UUID;
  v_target_user_id     UUID;
  v_current_role       TEXT;
  v_caller_role        TEXT;
  v_owner_count        INT;
  v_role_restaurant_id UUID;
  v_role_builtin       BOOLEAN;
  v_role_flavor        TEXT;
  v_role_found         BOOLEAN;
BEGIN
  -- Rule 1: the membership must exist, and ITS restaurant_id is authoritative.
  -- Restaurant scope is never taken from client input.
  --
  -- FOR UPDATE, because every rule below authorizes against v_current_role and
  -- the write lands much later in the same transaction. Read unlocked, that is
  -- a check-then-act race: a manager reads the target as 'staff', an owner
  -- concurrently promotes that target to 'owner', and the manager's UPDATE then
  -- demotes a fresh owner because Rule 5a was evaluated against the stale role.
  -- Holding the row makes the authorization valid through the write. Mirrors
  -- the lock the last-owner count already takes below.
  SELECT restaurant_id, user_id, role
    INTO v_restaurant_id, v_target_user_id, v_current_role
  FROM public.user_restaurants
  WHERE id = p_membership_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Membership not found'
      USING ERRCODE = '42501';
  END IF;

  -- Rule 2: never self-target. Self-escalation is exactly what the RESTRICTIVE
  -- policy protects against, and no UI surface needs it.
  IF v_target_user_id = auth.uid() THEN
    RAISE EXCEPTION 'You cannot change your own role'
      USING ERRCODE = '42501';
  END IF;

  -- Rule 3: resolve the caller's role IN THAT RESTAURANT. A caller with no
  -- membership row is denied on its own named path, distinct from a matrix
  -- miss -- this is where an unauthenticated or cross-tenant caller lands, so
  -- it must deny explicitly rather than fall through a lookup returning NULL.
  SELECT role INTO v_caller_role
  FROM public.user_restaurants
  WHERE restaurant_id = v_restaurant_id
    AND user_id = auth.uid();

  IF NOT FOUND THEN
    RAISE EXCEPTION 'You are not a member of this restaurant'
      USING ERRCODE = '42501';
  END IF;

  -- Rule 4 (second direction): the matrix cannot express "may not be moved
  -- OUT of kiosk", so it is its own rule. Converting a shared device
  -- credential into a person's account is not a role change.
  IF v_current_role = 'kiosk' THEN
    RAISE EXCEPTION 'A kiosk is a shared device credential and cannot be given a person''s role'
      USING ERRCODE = '42501';
  END IF;

  -- Rule 5a: only an owner may change a member who is currently an owner.
  -- Without this a manager could demote the owner, since 'staff' sits in the
  -- manager's matrix row.
  IF v_current_role = 'owner' AND v_caller_role <> 'owner' THEN
    RAISE EXCEPTION 'Only an owner can change an owner''s role'
      USING ERRCODE = '42501';
  END IF;

  -- Rule 5b: the last owner cannot be demoted, or the restaurant orphans
  -- itself. LOCK BEFORE COUNTING: counted without the lock this is a
  -- check-then-act race -- with two owners, two concurrent demotions each
  -- read count = 2, each pass, and both commit, leaving zero owners. That is
  -- precisely the orphaning this rule exists to prevent, so the rule is only
  -- real with the lock.
  IF v_current_role = 'owner' AND p_role <> 'owner' THEN
    SELECT count(*) INTO v_owner_count
    FROM (
      SELECT 1
      FROM public.user_restaurants
      WHERE restaurant_id = v_restaurant_id
        AND role = 'owner'
      FOR UPDATE
    ) AS locked_owners;

    IF v_owner_count <= 1 THEN
      RAISE EXCEPTION 'This is the last owner. Promote someone else to owner first.'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  -- Rule 6: custom role, or builtin -- never ambiguously both.
  IF p_role = 'collaborator_custom' THEN
    IF p_role_id IS NULL THEN
      RAISE EXCEPTION 'A custom role requires a role id'
        USING ERRCODE = '42501';
    END IF;

    IF NOT public.can_invite_custom_role(v_caller_role) THEN
      RAISE EXCEPTION 'Your role cannot assign custom roles'
        USING ERRCODE = '42501';
    END IF;

    -- Must belong to THIS restaurant: never a global builtin
    -- (restaurant_id IS NULL), never another tenant's. Must also be a
    -- non-builtin, collaborator-flavored row: a platform-flavored or builtin
    -- role_id is not what 'collaborator_custom' means, and role_areas'
    -- collaborator cap is explicitly not enforced against platform-flavored
    -- roles (20260730100000_roles_and_areas_tables.sql), so accepting one
    -- here would let it ride in uncapped. Mirrors the same three-way check
    -- in 20260730210000_invitation_role_id_must_agree_with_role.sql.
    SELECT restaurant_id, builtin, flavor, true
      INTO v_role_restaurant_id, v_role_builtin, v_role_flavor, v_role_found
    FROM public.roles
    WHERE id = p_role_id;

    IF NOT FOUND
       OR v_role_restaurant_id IS DISTINCT FROM v_restaurant_id
       OR v_role_builtin IS NOT FALSE
       OR v_role_flavor IS DISTINCT FROM 'collaborator' THEN
      RAISE EXCEPTION 'That role does not belong to this restaurant'
        USING ERRCODE = '42501';
    END IF;
  ELSE
    -- Passing a role_id alongside a builtin role is a caller error, not a
    -- silent preference: the two would disagree about what was granted.
    IF p_role_id IS NOT NULL THEN
      RAISE EXCEPTION 'A builtin role cannot carry a role id'
        USING ERRCODE = '42501';
    END IF;

    IF NOT (p_role = ANY (COALESCE(public.invitable_roles(v_caller_role), ARRAY[]::TEXT[]))) THEN
      RAISE EXCEPTION 'Your role cannot assign that role'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  -- Rule 7: both columns together, per the path
  -- 20260730170000_invitation_role_id_and_membership_role_sync.sql:62 names.
  -- Builtins get their role_id written EXPLICITLY rather than left to the sync
  -- trigger, which fires only when role changes and role_id does not. Writing
  -- both means the caller always wins, and the row is never a
  -- collaborator_custom with a NULL role_id -- the zero-capability state.
  UPDATE public.user_restaurants
  SET role    = p_role,
      role_id = COALESCE(p_role_id, public.builtin_role_id_for(p_role))
  WHERE id = p_membership_id;
END;
$$;

COMMENT ON FUNCTION public.assign_membership_role IS
'Changes an existing member''s role, enforcing the invite matrix for the caller''s role in that restaurant. Raises 42501 on every denial rather than filtering: a SECURITY DEFINER function returning zero rows would reproduce the silent no-op this replaces (a manager''s bare UPDATE on user_restaurants matches no PERMISSIVE policy branch, affects zero rows, and raises nothing). Writes role and role_id together so a custom-role membership can never land with a NULL role_id. The collaborator_custom branch requires role_id to be a non-builtin, collaborator-flavored row owned by the caller''s restaurant, mirroring 20260730210000_invitation_role_id_must_agree_with_role.sql.';

-- CREATE OR REPLACE preserves existing grants, but restated for the same
-- reason the original migration states it: explicit, not incidental. The anon
-- revoke is not redundant with the PUBLIC one -- see 20260802110000.
REVOKE EXECUTE ON FUNCTION public.assign_membership_role(uuid, text, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.assign_membership_role(uuid, text, uuid) FROM anon;
GRANT  EXECUTE ON FUNCTION public.assign_membership_role(uuid, text, uuid) TO authenticated;
