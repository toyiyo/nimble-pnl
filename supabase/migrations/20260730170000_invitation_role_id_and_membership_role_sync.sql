-- ============================================================================
-- Migration: invitations.role_id + user_restaurants role/role_id sync
--
-- Sub-task 9f (backend half) of the "data-driven roles built from areas"
-- design (docs/superpowers/specs/2026-07-29-roles-and-areas-design.md).
--
-- This migration is NOT in the approved plan. It was added because sub-task
-- 9f could not be built without it, and the reason is worth recording in
-- full so the next reader does not "simplify" it back out.
--
-- The design (design:490-492) and plan (plan:278-284) both specify that the
-- collaborator invite mutation must "send both the 'collaborator_custom'
-- literal and role_id". Neither says where that role_id is stored, and
-- nothing in the schema could hold it:
--
--   * `invitations` has no role_id column (its CREATE TABLE is
--     20250915233731; the only later ALTERs add hashed_token and
--     employee_id).
--   * `accept-invitation` (supabase/functions/accept-invitation/index.ts:110)
--     inserts `user_id`, `restaurant_id` and `role` into `user_restaurants`
--     and nothing else, for every role.
--   * A membership with role='collaborator_custom' and role_id IS NULL
--     resolves through the legacy role-literal CASE in
--     user_has_capability() (20260730140000:84), where 'collaborator_custom'
--     appears in no IN-list.
--
-- So without this column the whole feature is inert: an owner could build a
-- custom role in the new editor, invite someone to it, watch the invite send
-- and accept successfully -- and the invitee would land with no
-- capabilities at all. Custom roles would be creatable but unassignable.
--
-- ---------------------------------------------------------------------------
-- 2. The sync trigger is a security fix, not tidiness
-- ---------------------------------------------------------------------------
--
-- Task 5 made role_id take *precedence* over role: user_has_capability()
-- reads both, and dispatches to the area-driven branch whenever role_id IS
-- NOT NULL (20260730140000:70-84). The legacy `role` text column is only
-- consulted when role_id is NULL.
--
-- Meanwhile `TeamMembers.updateMemberRole`
-- (src/components/TeamMembers.tsx:112-133) changes a member's role by
-- writing the `role` text column alone -- it predates role_id and knows
-- nothing about it. On this branch, demoting an owner to staff through that
-- UI would leave role_id pointing at the Owner builtin. The member would
-- display as "Staff" and keep every owner capability, including
-- manage:subscription and edit:settings.
--
-- Fixing the one call site would close today's hole and leave the next
-- writer to rediscover it, so the invariant is enforced in the database
-- where every writer is subject to it -- service-role edge functions
-- included.
--
-- Trigger rule, in full:
--
--   IF the role text changed AND role_id was not itself changed by the same
--   statement THEN derive role_id from the new role string.
--
-- Consequences, each deliberate:
--   * owner -> staff with role_id untouched  => role_id moves to the
--     Employee builtin. The escalation is closed.
--   * role and role_id set together          => the caller wins, untouched.
--     This is the custom-role assignment path.
--   * -> 'collaborator_custom' with no id    => role_id becomes NULL, not
--     the previous role's id. NULL routes through the legacy CASE, which
--     grants collaborator_custom nothing. Fails closed.
--   * role_id changed alone, role unchanged  => untouched.
--
-- ---------------------------------------------------------------------------
-- 3. Why UPDATE-only
-- ---------------------------------------------------------------------------
--
-- An INSERT that omits role_id must keep leaving it NULL. That is the
-- legacy-fallback path Task 3 established and
-- supabase/tests/user_restaurants_role_id_test.sql asserts directly ("before
-- backfill, none of the ten fixture memberships have a role_id yet"). Making
-- INSERT auto-fill would silently migrate every newly created membership --
-- including the owner row written at restaurant creation -- onto the
-- area-driven path as a side effect of a migration about invitations. That
-- may well be the right end state, but it is a separate, deliberate step.
--
-- ---------------------------------------------------------------------------
-- 4. FK behaviour
-- ---------------------------------------------------------------------------
--
-- invitations.role_id uses the default NO ACTION, matching
-- user_restaurants.role_id (20260730120000). Deleting a custom role that a
-- pending invitation still points at therefore fails loudly rather than
-- silently converting that invitation into a zero-capability one -- the same
-- [2026-07-09] label-collision reasoning cited throughout this design: a
-- failed operation beats an ambiguous success.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- The legacy-role-string -> builtin-role-id map, extracted so the backfill
-- and the trigger share one copy. The ten pairs are unchanged from
-- 20260730120000_add_user_restaurants_role_id.sql.
--
-- Returns NULL for any string with no builtin row -- 'collaborator_custom'
-- and anything unrecognized -- which is what makes the trigger fail closed.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.builtin_role_id_for(p_role TEXT)
RETURNS UUID
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT m.builtin_role_id
  FROM (VALUES
    ('owner',                           'b0000000-0000-0000-0000-000000000001'::uuid),
    ('manager',                         'b0000000-0000-0000-0000-000000000002'::uuid),
    ('operations_manager',              'b0000000-0000-0000-0000-000000000003'::uuid),
    ('chef',                            'b0000000-0000-0000-0000-000000000004'::uuid),
    ('staff',                           'b0000000-0000-0000-0000-000000000005'::uuid),
    ('kiosk',                           'b0000000-0000-0000-0000-000000000006'::uuid),
    ('collaborator_accountant',         'b0000000-0000-0000-0000-000000000007'::uuid),
    ('collaborator_inventory',          'b0000000-0000-0000-0000-000000000008'::uuid),
    ('collaborator_chef',               'b0000000-0000-0000-0000-000000000009'::uuid),
    ('collaborator_operations_manager', 'b0000000-0000-0000-0000-00000000000a'::uuid)
  ) AS m(legacy_role, builtin_role_id)
  WHERE m.legacy_role = p_role;
$$;

COMMENT ON FUNCTION public.builtin_role_id_for IS
'Maps a legacy user_restaurants.role string to its seeded builtin roles.id. Returns NULL for collaborator_custom and for any unrecognized string, so callers that derive a role_id from a role string fail closed. Single source of the mapping: both backfill_user_restaurants_role_id() and the user_restaurants role/role_id sync trigger read it.';

-- Rewritten to read the shared map instead of carrying its own copy.
-- Behaviour is unchanged: still idempotent, still guarded by
-- `WHERE role_id IS NULL`, so it never clobbers an explicitly set role_id.
CREATE OR REPLACE FUNCTION public.backfill_user_restaurants_role_id()
RETURNS void
LANGUAGE sql
AS $$
  UPDATE public.user_restaurants ur
  SET role_id = public.builtin_role_id_for(ur.role)
  WHERE ur.role_id IS NULL
    AND public.builtin_role_id_for(ur.role) IS NOT NULL;
$$;

-- ----------------------------------------------------------------------------
-- invitations.role_id -- the carrier for a custom-role invite.
-- ----------------------------------------------------------------------------
ALTER TABLE public.invitations
  ADD COLUMN role_id UUID REFERENCES public.roles(id);

COMMENT ON COLUMN public.invitations.role_id IS
'The roles.id this invitation grants, for invitations to a custom role (role = ''collaborator_custom''). NULL for every builtin-role invitation, which continues to be resolved from the role text column alone. accept-invitation copies this straight onto the new user_restaurants row; send-team-invitation is what authorizes it (the role must be a global builtin or belong to the inviting restaurant).';

-- ----------------------------------------------------------------------------
-- The role/role_id sync trigger.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.user_restaurants_sync_role_id()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- Only a *role* change with no accompanying role_id write is derived. An
  -- UPDATE that sets both is the caller stating its intent explicitly (the
  -- custom-role assignment path) and is left exactly as written.
  IF NEW.role IS DISTINCT FROM OLD.role
     AND NEW.role_id IS NOT DISTINCT FROM OLD.role_id THEN
    NEW.role_id := public.builtin_role_id_for(NEW.role);
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.user_restaurants_sync_role_id IS
'Keeps user_restaurants.role_id consistent with the legacy role column on UPDATE. Since user_has_capability() prefers role_id over role, a role change written through the role column alone would otherwise leave the old role''s capabilities in force -- see the migration header for the demote-an-owner case. Derives NULL for collaborator_custom and unrecognized strings, so the failure mode is no capabilities rather than the previous role''s.';

CREATE TRIGGER user_restaurants_sync_role_id
  BEFORE UPDATE ON public.user_restaurants
  FOR EACH ROW
  EXECUTE FUNCTION public.user_restaurants_sync_role_id();

-- ----------------------------------------------------------------------------
-- Database-level guard for invitations.role_id.
--
-- The column comment above says send-team-invitation is what authorizes the
-- role_id, and it does -- but it is not the only writer. "Restaurant owners
-- and managers can manage invitations" is a FOR ALL policy with no WITH CHECK
-- (20260702170000_add_operations_manager_role.sql), so its USING expression is
-- reused for INSERT: an owner or manager can write an invitation row straight
-- from the client with any role_id they can name, including one belonging to a
-- restaurant they have nothing to do with. accept-invitation then copies it
-- onto the new user_restaurants row verbatim.
--
-- The blast radius is bounded -- every tenant role is collaborator-flavored
-- and capped by area_catalog, so a foreign role grants no more than a local
-- one could -- but it cross-links two tenants through a FK that nothing
-- cascades, so restaurant B can end up unable to delete a role because
-- restaurant A's membership points at it. Same shape as the check
-- send-team-invitation already performs; enforced here so it holds for every
-- writer.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.invitations_validate_role_id()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role_restaurant_id UUID;
  v_found BOOLEAN;
BEGIN
  IF NEW.role_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT restaurant_id INTO v_role_restaurant_id
  FROM public.roles
  WHERE id = NEW.role_id;
  v_found := FOUND;

  -- A missing role is the FK's problem, not ours -- it rejects the same
  -- statement. Returning here keeps the error the client sees as the accurate
  -- one rather than masking it with an authorization message.
  IF NOT v_found THEN
    RETURN NEW;
  END IF;

  -- A global builtin (restaurant_id IS NULL) is invitable by anyone; a
  -- per-restaurant role only by the restaurant that owns it.
  IF v_role_restaurant_id IS NOT NULL
     AND v_role_restaurant_id IS DISTINCT FROM NEW.restaurant_id THEN
    RAISE EXCEPTION
      'invitation role_id % belongs to another restaurant', NEW.role_id
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.invitations_validate_role_id IS
'Rejects an invitation whose role_id is a per-restaurant role belonging to a different restaurant than the invitation. Global builtins (restaurant_id IS NULL) are always allowed. Mirrors the check send-team-invitation performs, at a level no client writer can skip.';

CREATE TRIGGER invitations_validate_role_id
  BEFORE INSERT OR UPDATE ON public.invitations
  FOR EACH ROW
  EXECUTE FUNCTION public.invitations_validate_role_id();
