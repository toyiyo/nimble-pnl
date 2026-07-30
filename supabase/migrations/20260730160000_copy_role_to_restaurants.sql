-- ============================================================================
-- Migration: copy_role_to_restaurants
--
-- Sub-task 9h of the "data-driven roles built from areas" design
-- (docs/superpowers/specs/2026-07-29-roles-and-areas-design.md), pulled
-- forward ahead of the rest of task 9 so task 8d's useRoles.ts hook has a
-- real RPC for its copy mutation. See the design doc's "Copy role to other
-- restaurants" section for the full rationale; this comment restates only
-- what a future reader of this file needs.
--
-- copy_role_to_restaurants(p_role_id, p_target_restaurant_ids) clones a
-- custom role's roles/role_areas/role_flags rows into each target
-- restaurant, after checking the caller holds manage:collaborators IN THAT
-- TARGET *and* in the source restaurant. SECURITY DEFINER bypasses RLS on
-- roles/role_areas/role_flags entirely for this code path -- reads as well
-- as writes -- so the in-body capability checks are not defense in depth,
-- they are the *only* gate. Per the design the target check must run for
-- every target before any INSERT happens for any target, not interleaved
-- with them. That is why the function below has two passes over
-- p_target_restaurant_ids: an authorization pass first (raises and touches
-- no table if any target fails), then a copy pass (which can still skip an
-- individual target on a name collision -- that is a reported outcome, not
-- an authorization failure, so it does not roll back the targets that
-- succeeded).
--
-- A builtin role cannot be the copy source: builtins are global
-- (restaurant_id IS NULL) and already available in every restaurant, so
-- there is nothing restaurant-scoped to clone, and the clone would
-- immediately collide with roles_reject_builtin_name_collision (Task 1)
-- since it must share the builtin's name to mean the same thing.
--
-- Name collisions are resolved by reporting the colliding target back
-- (restaurant_id + name) in the returned JSON, not by silently suffixing --
-- per the [2026-07-09] label-collision lesson cited throughout this design,
-- an ambiguous role name is worse than a failed copy.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.copy_role_to_restaurants(
  p_role_id UUID,
  p_target_restaurant_ids UUID[]
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role RECORD;
  v_target_id UUID;
  v_new_role_id UUID;
  v_copied UUID[] := '{}';
  v_collisions JSONB := '[]'::jsonb;
BEGIN
  SELECT * INTO v_role FROM public.roles WHERE id = p_role_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'role % not found', p_role_id
      USING ERRCODE = '42704';
  END IF;

  IF v_role.builtin THEN
    RAISE EXCEPTION 'builtin roles cannot be copied (role_id=%)', p_role_id
      USING ERRCODE = '42501';
  END IF;

  -- The SOURCE needs a gate too, and for the same reason the targets do:
  -- SECURITY DEFINER bypasses RLS on the SELECT above just as it bypasses the
  -- write policies below, so without this check any caller who administers
  -- *some* restaurant could name another tenant's role_id and clone that
  -- role's name, description, areas and flags into their own restaurant --
  -- reading a restaurant they have no membership in, by writing. The design
  -- doc's "Copy role to other restaurants" section reasons only about the
  -- target because the UI only ever offers roles the caller already
  -- administers; the RPC is callable directly, so it enforces that here.
  IF NOT public.user_has_capability(v_role.restaurant_id, 'manage:collaborators') THEN
    RAISE EXCEPTION 'missing manage:collaborators in the source restaurant for role %', p_role_id
      USING ERRCODE = '42501';
  END IF;

  IF p_target_restaurant_ids IS NULL OR array_length(p_target_restaurant_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'p_target_restaurant_ids must contain at least one restaurant'
      USING ERRCODE = '22023';
  END IF;

  -- ==========================================================================
  -- Authorization pass, first and alone: every target must check out before
  -- any INSERT anywhere. A caller authorized for target 1 of 2 but not
  -- target 2 gets zero inserts, not a partial copy into target 1.
  -- ==========================================================================
  FOREACH v_target_id IN ARRAY p_target_restaurant_ids LOOP
    IF NOT public.user_has_capability(v_target_id, 'manage:collaborators') THEN
      RAISE EXCEPTION 'missing manage:collaborators in target restaurant %', v_target_id
        USING ERRCODE = '42501';
    END IF;
  END LOOP;

  -- ==========================================================================
  -- Copy pass. Every target is now authorized; a name collision here is a
  -- reported outcome for that one target, not a reason to abort the others.
  -- ==========================================================================
  FOREACH v_target_id IN ARRAY p_target_restaurant_ids LOOP
    IF EXISTS (
      SELECT 1 FROM public.roles r
      WHERE r.restaurant_id = v_target_id
        AND lower(r.name) = lower(v_role.name)
    ) THEN
      v_collisions := v_collisions || jsonb_build_object(
        'restaurant_id', v_target_id,
        'name', v_role.name
      );
      CONTINUE;
    END IF;

    INSERT INTO public.roles (restaurant_id, name, description, flavor, builtin)
    VALUES (v_target_id, v_role.name, v_role.description, v_role.flavor, false)
    RETURNING id INTO v_new_role_id;

    INSERT INTO public.role_areas (role_id, area_key, level)
    SELECT v_new_role_id, ra.area_key, ra.level
    FROM public.role_areas ra
    WHERE ra.role_id = p_role_id;

    INSERT INTO public.role_flags (role_id, flag)
    SELECT v_new_role_id, rf.flag
    FROM public.role_flags rf
    WHERE rf.role_id = p_role_id;

    v_copied := array_append(v_copied, v_target_id);
  END LOOP;

  RETURN jsonb_build_object(
    'copied', to_jsonb(v_copied),
    'name_collisions', v_collisions
  );
END;
$$;

COMMENT ON FUNCTION public.copy_role_to_restaurants IS
  'Clones a custom role (roles + role_areas + role_flags) into each target '
  'restaurant, after checking manage:collaborators in that target and in '
  'the source restaurant -- the only gate, since SECURITY DEFINER bypasses '
  'RLS on these three tables entirely for this code path, reads included. '
  'Every target is authorized before any '
  'target is written. A per-target name collision is reported back in the '
  'returned JSON (name_collisions) rather than silently suffixed; the '
  'colliding target simply gets no new row. Builtin roles cannot be copied.';

GRANT EXECUTE ON FUNCTION public.copy_role_to_restaurants(UUID, UUID[]) TO authenticated;
