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
