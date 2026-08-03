-- ============================================================================
-- assign_membership_role — change an existing member's role.
--
-- See docs/superpowers/specs/2026-08-02-role-assignment-design.md.
--
-- Why this is a SECURITY DEFINER RPC and not a client UPDATE: the PERMISSIVE
-- policy on user_restaurants ("Owners can manage restaurant associations")
-- has USING (user_id = auth.uid() OR is_restaurant_owner(...)). A manager
-- updating another member's row matches neither branch, so zero rows match --
-- and Postgres raises no error for a row RLS filtered away. TeamMembers.tsx
-- checks only { error } and then fires a success toast, so a manager changing
-- anyone's role today sees "Member role updated successfully" while nothing
-- changed. This function therefore RAISES on every denial; returning zero
-- rows would reproduce the exact bug it exists to kill.
--
-- The cost is a third copy of the invite matrix (TS, Deno, now SQL).
-- tests/unit/inviteMatrixMirror.test.ts parses all three and pins them
-- together.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- The invite matrix, mirroring INVITABLE_ROLES in
-- src/lib/permissions/invitations.ts and the Deno copy in
-- supabase/functions/send-team-invitation/index.ts.
--
-- Rows with no targets (chef, staff, kiosk, every collaborator role) are
-- omitted rather than listed empty: a missing row returns NULL, and the
-- caller treats NULL as "assign nothing", which is the same default-deny the
-- TS matrix gets from an empty array. 'kiosk' appears in no row's targets --
-- a kiosk is a shared device credential, not a person.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.invitable_roles(p_inviter TEXT)
RETURNS TEXT[]
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT m.targets
  FROM (VALUES
    ('owner', ARRAY['owner','manager','operations_manager','chef','staff',
                    'collaborator_accountant','collaborator_inventory',
                    'collaborator_chef','collaborator_operations_manager']),
    ('manager', ARRAY['manager','operations_manager','chef','staff',
                      'collaborator_accountant','collaborator_inventory',
                      'collaborator_chef','collaborator_operations_manager']),
    ('operations_manager', ARRAY['staff'])
  ) AS m(inviter, targets)
  WHERE m.inviter = p_inviter;
$$;

COMMENT ON FUNCTION public.invitable_roles IS
'Target roles an inviter role may assign. Third copy of the invite matrix (TS: src/lib/permissions/invitations.ts, Deno: send-team-invitation). Returns NULL for a role with no row, which callers must treat as deny. Pinned to the other two by tests/unit/inviteMatrixMirror.test.ts.';

-- Mirrors CUSTOM_ROLE_INVITERS (src/lib/permissions/invitations.ts:49).
CREATE OR REPLACE FUNCTION public.can_invite_custom_role(p_inviter TEXT)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT p_inviter = ANY (ARRAY['owner','manager']);
$$;

COMMENT ON FUNCTION public.can_invite_custom_role IS
'Whether an inviter role may assign a custom role. Mirrors CUSTOM_ROLE_INVITERS in src/lib/permissions/invitations.ts and send-team-invitation.';

-- ----------------------------------------------------------------------------
-- assign_membership_role — the write path.
-- ----------------------------------------------------------------------------
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
  v_role_found         BOOLEAN;
BEGIN
  -- Rule 1: the membership must exist, and ITS restaurant_id is authoritative.
  -- Restaurant scope is never taken from client input.
  SELECT restaurant_id, user_id, role
    INTO v_restaurant_id, v_target_user_id, v_current_role
  FROM public.user_restaurants
  WHERE id = p_membership_id;

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
    -- (restaurant_id IS NULL), never another tenant's.
    SELECT restaurant_id, true INTO v_role_restaurant_id, v_role_found
    FROM public.roles
    WHERE id = p_role_id;

    IF NOT FOUND OR v_role_restaurant_id IS DISTINCT FROM v_restaurant_id THEN
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
'Changes an existing member''s role, enforcing the invite matrix for the caller''s role in that restaurant. Raises 42501 on every denial rather than filtering: a SECURITY DEFINER function returning zero rows would reproduce the silent no-op this replaces (a manager''s bare UPDATE on user_restaurants matches no PERMISSIVE policy branch, affects zero rows, and raises nothing). Writes role and role_id together so a custom-role membership can never land with a NULL role_id.';

-- Explicit, not incidental. copy_role_to_restaurants -- the function this one
-- is modelled on -- grants EXECUTE to authenticated but never revokes the
-- default PUBLIC grant, and fails closed only because its internal check keys
-- off auth.uid(), which is NULL for anon. A role-administration RPC that
-- raises rather than filters should not rely on that.
--
-- anon is revoked by name as well as via PUBLIC, and the two are not
-- redundant. Some Supabase images carry `ALTER DEFAULT PRIVILEGES ... GRANT
-- EXECUTE ON FUNCTIONS TO anon` for the migrating role, which lands a DIRECT
-- anon grant at CREATE time -- one that REVOKE ... FROM PUBLIC cannot touch.
-- Whether that default ACL is present varies by CLI version, so relying on
-- the PUBLIC revoke alone makes the grant environment-dependent.
REVOKE EXECUTE ON FUNCTION public.assign_membership_role(uuid, text, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.assign_membership_role(uuid, text, uuid) FROM anon;
GRANT  EXECUTE ON FUNCTION public.assign_membership_role(uuid, text, uuid) TO authenticated;
