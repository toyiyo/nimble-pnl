-- ============================================================================
-- Migration: a name collision in copy_role_to_restaurants stays per-target
--
-- Found in review of PR #683, in code this branch introduced.
--
-- WHAT WAS WRONG
--
-- 20260730160000 documents -- in its header, in its inline comments and in the
-- function's own COMMENT -- that a name collision is "a reported outcome, not
-- an authorization failure, so it does not roll back the targets that
-- succeeded". Its copy pass implemented that with a pre-check:
--
--   IF EXISTS (SELECT 1 FROM roles WHERE restaurant_id = target
--                AND lower(name) = lower(source.name)) THEN ... CONTINUE;
--   INSERT INTO roles ...
--
-- The EXISTS and the INSERT are two statements, and uq_roles_restaurant_name_ci
-- (20260730100000:155) is what actually enforces the rule. A concurrent insert
-- of the same name into the same target -- another admin creating the role by
-- hand, or the same owner copying from two tabs -- lands between them, the
-- INSERT raises unique_violation, and with no handler that error propagates
-- out of the function and aborts the whole transaction. Every target already
-- copied is rolled back, and the caller gets a raw Postgres message instead of
-- the name_collisions array the contract promises. The window is small; the
-- blast radius is the entire multi-restaurant copy, which is the operation
-- most likely to be run against many targets at once.
--
-- WHAT THIS MIGRATION CHANGES
--
-- The three inserts for one target now run inside a BEGIN ... EXCEPTION block,
-- which gives that target its own subtransaction. unique_violation there rolls
-- back only that target's rows and records the same name_collisions entry the
-- pre-check would have, so the loop continues and the promise holds however
-- the collision is discovered.
--
-- The pre-check is kept rather than replaced by the handler alone. It is the
-- common path by a wide margin -- the collision that matters is a role the
-- target already has, not one created microseconds ago -- and a subtransaction
-- per target is not free. The handler is the backstop for the race the
-- pre-check cannot close, which is the only thing a pre-check of this shape
-- can ever be.
--
-- Only the copy pass changes. The authorization pass, the source and builtin
-- gates, and the returned shape are all as 20260730160000 left them.
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
  -- reading a restaurant they have no membership in, by writing.
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
  -- reported outcome for that one target, not a reason to abort the others --
  -- whether it is seen by the pre-check or raised by
  -- uq_roles_restaurant_name_ci under a concurrent insert.
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

    -- One subtransaction per target: unique_violation rolls back this target's
    -- roles/role_areas/role_flags rows and nothing else. Without it, a name
    -- that appeared between the EXISTS above and the INSERT below would abort
    -- every target, including the ones already copied.
    BEGIN
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
    EXCEPTION
      WHEN unique_violation THEN
        -- Same outcome the pre-check produces, reached the other way. Reported
        -- rather than suffixed, per the [2026-07-09] label-collision lesson:
        -- an ambiguous role name is worse than a failed copy.
        v_collisions := v_collisions || jsonb_build_object(
          'restaurant_id', v_target_id,
          'name', v_role.name
        );
    END;
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
  'colliding target simply gets no new row. Each target is copied in its own '
  'subtransaction, so a collision raised by uq_roles_restaurant_name_ci under '
  'a concurrent insert is reported the same way instead of aborting the '
  'targets already copied. Builtin roles cannot be copied.';

GRANT EXECUTE ON FUNCTION public.copy_role_to_restaurants(UUID, UUID[]) TO authenticated;
