-- ============================================================================
-- Migration: replace_role_grants
--
-- Follow-up to task 8d. Saving an edited role used to be four separate
-- round-trips from the browser: DELETE role_areas, DELETE role_flags, INSERT
-- role_areas, INSERT role_flags. Each is its own transaction, so a failure
-- after the deletes -- a dropped connection, a cap-trigger rejection on one
-- of the new grants, a closed laptop -- left the role with zero areas and
-- zero flags. That is fail-closed rather than an escalation, but everyone
-- assigned that role loses access until an administrator notices and saves
-- again, and nothing in the UI says what happened.
--
-- replace_role_grants(p_role_id, p_areas, p_flags) does the same four
-- statements inside one function body, so they share one transaction: if any
-- INSERT raises, the DELETEs roll back with it and the role keeps the grants
-- it had.
--
-- SECURITY INVOKER (the default, stated explicitly here because the
-- neighbouring copy_role_to_restaurants is DEFINER and the contrast matters).
-- Every gate that guards the four statements when the client issues them
-- separately still applies, unchanged, because the caller's own privileges
-- are what the body runs with:
--   - the role_areas / role_flags RLS policies still require
--     manage:collaborators in the owning restaurant, on both the DELETEs and
--     the INSERTs;
--   - role_areas_block_builtin_mutation still rejects deleting a builtin
--     role's grants;
--   - role_areas_enforce_collaborator_cap still rejects an area the
--     collaborator cap forbids (Team & Access at any level, a view-capped
--     area at manage).
-- There is deliberately no capability check in the body: adding one would
-- imply the RLS policies are not the gate, and a DEFINER version would make
-- that true. This function grants nothing its caller did not already have.
--
-- One consequence worth stating: an unauthorized caller passing empty
-- p_areas/p_flags gets a silent no-op rather than an error, because RLS
-- filters a DELETE instead of raising on it. No rows change and no privilege
-- is gained, so that is the correct outcome, not a hole.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.replace_role_grants(
  p_role_id UUID,
  p_areas JSONB,
  p_flags TEXT[]
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  -- jsonb_array_length would raise 22023 on a non-array anyway; raising here
  -- names the parameter, which the generic message does not.
  IF p_areas IS NOT NULL AND jsonb_typeof(p_areas) <> 'array' THEN
    RAISE EXCEPTION 'p_areas must be a JSON array of {area_key, level} objects'
      USING ERRCODE = '22023';
  END IF;

  -- Delete-then-insert rather than upsert: ungranting an area has to remove
  -- its row, and an upsert-only update would silently leave the old grant in
  -- place. Safe to do wholesale here in a way it was not from the client,
  -- because the inserts below are in the same transaction.
  DELETE FROM public.role_areas WHERE role_id = p_role_id;
  DELETE FROM public.role_flags WHERE role_id = p_role_id;

  IF p_areas IS NOT NULL AND jsonb_array_length(p_areas) > 0 THEN
    INSERT INTO public.role_areas (role_id, area_key, level)
    SELECT p_role_id, a->>'area_key', a->>'level'
    FROM jsonb_array_elements(p_areas) AS a;
  END IF;

  IF p_flags IS NOT NULL AND array_length(p_flags, 1) IS NOT NULL THEN
    INSERT INTO public.role_flags (role_id, flag)
    SELECT p_role_id, f
    FROM unnest(p_flags) AS f;
  END IF;
END;
$$;

COMMENT ON FUNCTION public.replace_role_grants IS
  'Replaces a role''s entire set of area grants and sensitive-data flags in '
  'one transaction, so a rejected or failed insert rolls the deletes back '
  'instead of leaving the role empty. SECURITY INVOKER: the role_areas / '
  'role_flags RLS policies, the builtin-mutation block and the collaborator '
  'area cap all still apply to the caller exactly as they do when the client '
  'issues the four statements separately.';

GRANT EXECUTE ON FUNCTION public.replace_role_grants(UUID, JSONB, TEXT[]) TO authenticated;
