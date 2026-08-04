-- ============================================================================
-- role_member_counts: how many of a restaurant's members hold each role.
--
-- The roles list counted memberships by `role_id` alone. That undercounts,
-- because `role_id` is not populated on every row and is not meant to be:
-- 20260730170000 states plainly that "an INSERT that omits role_id must keep
-- leaving it NULL", and the sync trigger it installs fires on UPDATE only.
-- The backfill ran once, at migration time. So any membership written since
-- by a code path that sets the legacy `role` string alone has role_id IS NULL
-- and was invisible to the count.
--
-- The consequence was not merely a wrong badge. The role editor shows
-- "N people have this role. Saving changes what they can reach the next time
-- they load a page." as a *warning*, and falls back to "nobody is assigned
-- yet" at zero. An undercount there tells an owner it is safe to narrow a
-- role when it is not.
--
-- Resolving the legacy string is done here rather than in the client because
-- builtin_role_id_for is documented as the "single source of the mapping",
-- read by both the backfill and the sync trigger. A third copy in TypeScript
-- would be the copy that drifts.
--
-- SECURITY INVOKER: the caller counts only the user_restaurants rows its own
-- RLS policies already let it read, which is exactly what the client-side
-- SELECT this replaces could see. A DEFINER version would turn a per-role
-- headcount into a cross-tenant oracle.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.role_member_counts(p_restaurant_id UUID)
RETURNS TABLE (role_id UUID, member_count BIGINT)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT resolved.role_id, COUNT(*)::BIGINT
  FROM (
    SELECT COALESCE(ur.role_id, public.builtin_role_id_for(ur.role)) AS role_id
    FROM public.user_restaurants ur
    WHERE ur.restaurant_id = p_restaurant_id
  ) AS resolved
  -- Dropped rather than bucketed: builtin_role_id_for returns NULL for
  -- 'collaborator_custom' and for any unrecognised string, and a membership
  -- that resolves to no role has no card to be counted on.
  WHERE resolved.role_id IS NOT NULL
  GROUP BY resolved.role_id;
$$;

COMMENT ON FUNCTION public.role_member_counts IS
'Per-role membership counts for one restaurant, resolving user_restaurants.role_id and falling back to builtin_role_id_for(role) so memberships that predate the role_id backfill are still counted. SECURITY INVOKER: counts only rows the caller can already read.';

GRANT EXECUTE ON FUNCTION public.role_member_counts(UUID) TO authenticated;
