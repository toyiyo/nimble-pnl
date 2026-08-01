-- ============================================================================
-- Close the role_id self-escalation hole this branch opened.
--
-- 20260730120000 added user_restaurants.role_id, and 20260730140000 made
-- user_has_capability() prefer it over the legacy `role` text column. The
-- pre-existing RESTRICTIVE guard "Prevent self-escalation to privileged roles"
-- (20260702170000) was never updated to match, so it constrains only `role`.
--
-- That leaves role_id as an unguarded parallel channel to exactly the
-- privileges the guard exists to deny. A staff member of restaurant R could
-- run, through any authenticated Supabase client:
--
--     UPDATE user_restaurants SET role_id = '<Owner builtin>'
--     WHERE user_id = auth.uid() AND restaurant_id = 'R';
--
--   - the permissive "Owners can manage restaurant associations" policy passes
--     (user_id = auth.uid());
--   - the RESTRICTIVE guard passes, because `role` is untouched and still
--     satisfies its role IN ('staff','kiosk') allowlist;
--   - the user_restaurants_sync_role_id trigger no-ops, because it only
--     derives role_id when `role` itself changed;
--   - the FK is trivially satisfiable: the builtin ids are fixed constants and
--     every builtin row is world-readable to authenticated users by design
--     ("Members can view roles", restaurant_id IS NULL).
--
-- Every later user_has_capability() call then resolves through the Owner
-- builtin's areas while the UI still shows the member as Staff.
--
-- The fix keeps the guard's existing shape and adds the symmetric constraint
-- on role_id: a non-owner may only end up with a role_id that is the builtin
-- for the (already allowlisted) role they hold, or NULL. Assigning any other
-- role_id -- a privileged builtin, or a custom collaborator role -- continues
-- to require is_restaurant_owner(), which is exactly the rule `role` has
-- always been under. WITH CHECK cannot see OLD, so this is expressed as a
-- constraint on the resulting row rather than as "role_id must not change".
--
-- Not addressed here, because this branch does not change it either way: the
-- permissive INSERT policy on user_restaurants already lets a user insert
-- their own membership row with role = 'owner'. role_id adds no reach there
-- that `role` did not already have. Called out in the PR description.
--
-- Found by the Phase 7a security reviewer.
-- ============================================================================

DROP POLICY IF EXISTS "Prevent self-escalation to privileged roles" ON public.user_restaurants;

CREATE POLICY "Prevent self-escalation to privileged roles"
ON public.user_restaurants
AS RESTRICTIVE
FOR UPDATE
USING (true)
WITH CHECK (
  -- Restaurant owners may assign any role.
  public.is_restaurant_owner(restaurant_id, auth.uid())
  OR (
    -- Everyone else may only end up with a non-privileged role...
    role IN ('staff', 'kiosk')
    -- ...and a role_id that agrees with it. builtin_role_id_for() returns
    -- NULL for collaborator_custom and for anything unrecognized, so a custom
    -- role can never satisfy this branch.
    AND (role_id IS NULL OR role_id = public.builtin_role_id_for(role))
  )
);

COMMENT ON POLICY "Prevent self-escalation to privileged roles" ON public.user_restaurants IS
'RESTRICTIVE guard: unless the writer owns the restaurant, an UPDATE may only leave the row holding a non-privileged role AND a role_id consistent with it. Both columns must be constrained -- user_has_capability() prefers role_id, so guarding role alone leaves a silent escalation path. accept-invitation writes memberships with the service-role key (bypasses RLS), so invitation acceptance is unaffected.';
