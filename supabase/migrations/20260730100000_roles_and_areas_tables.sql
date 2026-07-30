-- ============================================================================
-- Migration: roles / role_areas / role_flags / area_catalog
--
-- Task 1 of the "data-driven roles built from areas" design
-- (docs/superpowers/specs/2026-07-29-roles-and-areas-design.md). Schema only —
-- no data is seeded here beyond the fixed area_catalog reference rows, no
-- existing table is touched, and user_has_capability keeps its current
-- behavior (rewritten in Task 5). The app runs unchanged after this migration.
--
-- roles(id, restaurant_id NULL, name, description, flavor, builtin, created_at)
--   restaurant_id IS NULL means a global builtin (one seeded set shared by
--   every restaurant); a real restaurant_id means a restaurant-owned custom
--   role. created_at is timestamptz, not timestamp — see the design's TZ note
--   (two recent incidents in this repo, c675d566 and 34172f80, were
--   timezone off-by-ones from getting this wrong on a new table).
--
-- role_areas(role_id, area_key, level) / role_flags(role_id, flag)
--   Children of roles. Neither carries its own restaurant_id, so RLS on both
--   joins back through roles for tenant scope.
--
-- area_catalog(area_key, band, sort_order, max_level_collaborator)
--   The ten areas' vocabulary, band grouping, and the level a collaborator-
--   flavored role can be capped to. A table rather than a CHECK constraint so
--   the enforcement trigger below and the eventual UI read the same source
--   and cannot drift. max_level_collaborator IS NULL means the area is
--   ungrantable to a collaborator role at any level (Team & Access — see the
--   privilege-escalation note on the cap trigger).
--
-- Invariants enforced here, and why each needs a trigger rather than RLS:
--   - Builtin rows (roles.builtin = true, and role_areas/role_flags whose
--     parent is builtin) reject UPDATE/DELETE. RLS is bypassed by the
--     service-role key (this codebase's edge functions routinely use it) and
--     by any SECURITY DEFINER function owned by the table owner, so the
--     invariant has to live in a BEFORE trigger to hold regardless of who is
--     writing.
--   - A custom role cannot be named (case-insensitively) after a builtin's
--     name, so the role picker never shows two entries called "Owner" that
--     mean different things. Enforced in a trigger, not just the UI, per the
--     [2026-07-09] label-collision lesson cited in the design.
--   - A collaborator-flavored, non-builtin role cannot be granted an area
--     above area_catalog.max_level_collaborator, and Team & Access cannot be
--     granted at any level to such a role. This is the guard that stops a
--     collaborator role from being handed manage:collaborators and then
--     minting itself a new role with every area — trivial escalation to
--     owner. It has to be a trigger, not a UI-only disabled control, because
--     the UI is not the only writer (a future edge function or the copy-role
--     RPC in a later task could otherwise slip past it).
--
-- All four trigger functions are SECURITY DEFINER SET search_path = public:
-- they look up the parent role's builtin/flavor to decide whether to allow
-- the write, and that lookup must be authoritative regardless of whether the
-- calling role's own RLS visibility would otherwise show it that row. This
-- mirrors user_has_capability's existing SECURITY DEFINER SET search_path =
-- public signature in this codebase.
-- ============================================================================

-- ============================================================================
-- 1. area_catalog — reference data, created and seeded first since the
--    role_areas cap trigger (added below) reads it.
-- ============================================================================
CREATE TABLE public.area_catalog (
  area_key TEXT PRIMARY KEY,
  band TEXT NOT NULL,
  sort_order INT NOT NULL,
  max_level_collaborator TEXT NULL CHECK (max_level_collaborator IN ('view', 'manage'))
);

COMMENT ON TABLE public.area_catalog IS
  'The ten areas a role can be granted, their band grouping for the editor UI, '
  'and the level a collaborator-flavored custom role can be capped to. '
  'NULL max_level_collaborator means the area cannot be granted to a '
  'collaborator role at any level (Team & Access). Drives both the '
  'role_areas_enforce_collaborator_cap trigger and the role editor UI from '
  'the same source so the two cannot drift.';

INSERT INTO public.area_catalog (area_key, band, sort_order, max_level_collaborator) VALUES
  ('reports',    'Operations',      1, 'view'),
  ('sales',      'Operations',      2, 'view'),
  ('inventory',  'Operations',      3, 'manage'),
  ('recipes',    'Operations',      4, 'manage'),
  ('scheduling', 'Operations',      5, 'manage'),
  ('books',      'Money',           6, 'manage'),
  ('payroll',    'Money',           7, 'view'),
  ('employees',  'People & admin',  8, 'manage'),
  ('team',       'People & admin',  9, NULL),
  ('settings',   'People & admin', 10, 'view');

ALTER TABLE public.area_catalog ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view the area catalog"
  ON public.area_catalog FOR SELECT
  USING (auth.uid() IS NOT NULL);

GRANT SELECT ON public.area_catalog TO authenticated;
GRANT ALL    ON public.area_catalog TO service_role;

-- ============================================================================
-- 2. roles
-- ============================================================================
CREATE TABLE public.roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  flavor TEXT NOT NULL CHECK (flavor IN ('platform', 'collaborator')),
  builtin BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.roles IS
  'A named, restaurant-scoped (or global builtin, restaurant_id IS NULL) role. '
  'Composed of the area grants in role_areas and the sensitive-data switches '
  'in role_flags. Builtin rows are immutable (see roles_block_builtin_mutation '
  'trigger) and seeded in a later migration.';

COMMENT ON COLUMN public.roles.restaurant_id IS
  'NULL means a global builtin shared by every restaurant. A real restaurant_id '
  'means a restaurant-owned custom role.';

COMMENT ON COLUMN public.roles.flavor IS
  'platform | collaborator. A subset of the existing four-way AccessGroup '
  'union in src/lib/permissions/types.ts — reuses two of its members, does '
  'not reuse the type itself.';

CREATE INDEX idx_roles_restaurant_id ON public.roles (restaurant_id);

-- Uniqueness must cover builtin-vs-custom collisions separately: a restaurant
-- creating a custom role named "Owner" does not violate either index below
-- (they differ in restaurant_id), so the case-insensitive name collision with
-- a builtin is caught by the roles_reject_builtin_name_collision trigger
-- instead, not by these indexes.
CREATE UNIQUE INDEX uq_roles_restaurant_name_ci
  ON public.roles (restaurant_id, lower(name))
  WHERE restaurant_id IS NOT NULL;

CREATE UNIQUE INDEX uq_roles_global_name_ci
  ON public.roles (lower(name))
  WHERE restaurant_id IS NULL;

ALTER TABLE public.roles ENABLE ROW LEVEL SECURITY;

-- Read: any member of the restaurant, plus global builtins (readable by any
-- authenticated user — there is no tenant secret in a global reference row).
CREATE POLICY "Members can view roles"
  ON public.roles FOR SELECT
  USING (
    (restaurant_id IS NULL AND auth.uid() IS NOT NULL)
    OR EXISTS (
      SELECT 1 FROM public.user_restaurants ur
      WHERE ur.restaurant_id = roles.restaurant_id
        AND ur.user_id = auth.uid()
    )
  );

-- Write: manage:collaborators holders only, and only into their own
-- restaurant — restaurant_id IS NOT NULL excludes builtins from this policy
-- entirely (they are written by migrations under the service role / postgres,
-- which bypasses RLS; the trigger below is the actual invariant, not this
-- clause — see the migration header).
CREATE POLICY "manage:collaborators holders can insert roles"
  ON public.roles FOR INSERT
  WITH CHECK (
    restaurant_id IS NOT NULL
    AND public.user_has_capability(restaurant_id, 'manage:collaborators')
  );

CREATE POLICY "manage:collaborators holders can update roles"
  ON public.roles FOR UPDATE
  USING (
    restaurant_id IS NOT NULL
    AND public.user_has_capability(restaurant_id, 'manage:collaborators')
  )
  WITH CHECK (
    restaurant_id IS NOT NULL
    AND public.user_has_capability(restaurant_id, 'manage:collaborators')
  );

CREATE POLICY "manage:collaborators holders can delete roles"
  ON public.roles FOR DELETE
  USING (
    restaurant_id IS NOT NULL
    AND public.user_has_capability(restaurant_id, 'manage:collaborators')
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.roles TO authenticated;
GRANT ALL ON public.roles TO service_role;

-- ============================================================================
-- 3. role_areas
-- ============================================================================
CREATE TABLE public.role_areas (
  role_id UUID NOT NULL REFERENCES public.roles(id) ON DELETE CASCADE,
  area_key TEXT NOT NULL REFERENCES public.area_catalog(area_key),
  level TEXT NOT NULL CHECK (level IN ('view', 'manage')),
  PRIMARY KEY (role_id, area_key)
);

COMMENT ON TABLE public.role_areas IS
  'Per-role area grants. The (role_id, area_key) primary key doubles as the '
  'composite index user_has_capability needs, role_id leading, so the '
  'rewritten capability check (Task 5) does not degrade to a sequential scan.';

ALTER TABLE public.role_areas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view role areas"
  ON public.role_areas FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.roles r
      WHERE r.id = role_areas.role_id
        AND (
          (r.restaurant_id IS NULL AND auth.uid() IS NOT NULL)
          OR EXISTS (
            SELECT 1 FROM public.user_restaurants ur
            WHERE ur.restaurant_id = r.restaurant_id
              AND ur.user_id = auth.uid()
          )
        )
    )
  );

CREATE POLICY "manage:collaborators holders can insert role areas"
  ON public.role_areas FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.roles r
      WHERE r.id = role_areas.role_id
        AND r.restaurant_id IS NOT NULL
        AND public.user_has_capability(r.restaurant_id, 'manage:collaborators')
    )
  );

CREATE POLICY "manage:collaborators holders can update role areas"
  ON public.role_areas FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.roles r
      WHERE r.id = role_areas.role_id
        AND r.restaurant_id IS NOT NULL
        AND public.user_has_capability(r.restaurant_id, 'manage:collaborators')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.roles r
      WHERE r.id = role_areas.role_id
        AND r.restaurant_id IS NOT NULL
        AND public.user_has_capability(r.restaurant_id, 'manage:collaborators')
    )
  );

CREATE POLICY "manage:collaborators holders can delete role areas"
  ON public.role_areas FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.roles r
      WHERE r.id = role_areas.role_id
        AND r.restaurant_id IS NOT NULL
        AND public.user_has_capability(r.restaurant_id, 'manage:collaborators')
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.role_areas TO authenticated;
GRANT ALL ON public.role_areas TO service_role;

-- ============================================================================
-- 4. role_flags
-- ============================================================================
CREATE TABLE public.role_flags (
  role_id UUID NOT NULL REFERENCES public.roles(id) ON DELETE CASCADE,
  flag TEXT NOT NULL CHECK (flag IN ('view:costs', 'view:pay_rates', 'view:employee_pii')),
  PRIMARY KEY (role_id, flag)
);

COMMENT ON TABLE public.role_flags IS
  'The three cross-cutting sensitive-data switches (view:costs, '
  'view:pay_rates, view:employee_pii), applied inside whatever areas a role '
  'is already granted. The (role_id, flag) primary key doubles as the '
  'composite index user_has_capability needs, role_id leading.';

ALTER TABLE public.role_flags ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view role flags"
  ON public.role_flags FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.roles r
      WHERE r.id = role_flags.role_id
        AND (
          (r.restaurant_id IS NULL AND auth.uid() IS NOT NULL)
          OR EXISTS (
            SELECT 1 FROM public.user_restaurants ur
            WHERE ur.restaurant_id = r.restaurant_id
              AND ur.user_id = auth.uid()
          )
        )
    )
  );

CREATE POLICY "manage:collaborators holders can insert role flags"
  ON public.role_flags FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.roles r
      WHERE r.id = role_flags.role_id
        AND r.restaurant_id IS NOT NULL
        AND public.user_has_capability(r.restaurant_id, 'manage:collaborators')
    )
  );

CREATE POLICY "manage:collaborators holders can update role flags"
  ON public.role_flags FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.roles r
      WHERE r.id = role_flags.role_id
        AND r.restaurant_id IS NOT NULL
        AND public.user_has_capability(r.restaurant_id, 'manage:collaborators')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.roles r
      WHERE r.id = role_flags.role_id
        AND r.restaurant_id IS NOT NULL
        AND public.user_has_capability(r.restaurant_id, 'manage:collaborators')
    )
  );

CREATE POLICY "manage:collaborators holders can delete role flags"
  ON public.role_flags FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.roles r
      WHERE r.id = role_flags.role_id
        AND r.restaurant_id IS NOT NULL
        AND public.user_has_capability(r.restaurant_id, 'manage:collaborators')
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.role_flags TO authenticated;
GRANT ALL ON public.role_flags TO service_role;

-- ============================================================================
-- 5. Trigger: block mutation of builtin roles.
--
-- RLS cannot carry this invariant alone: it is bypassed by the service-role
-- key (used routinely by this codebase's edge functions) and by any
-- SECURITY DEFINER function owned by the table owner. So this is a BEFORE
-- trigger, which fires regardless of who is writing or whether RLS applies.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.roles_block_builtin_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.builtin THEN
    RAISE EXCEPTION 'builtin roles cannot be updated or deleted (role_id=%)', OLD.id
      USING ERRCODE = '42501';
  END IF;
  RETURN OLD;
END;
$$;

COMMENT ON FUNCTION public.roles_block_builtin_mutation IS
  'Rejects UPDATE/DELETE of a builtin role row. Fires regardless of RLS, so it '
  'holds even for the service-role key and SECURITY DEFINER callers.';

CREATE TRIGGER roles_block_builtin_mutation
  BEFORE UPDATE OR DELETE ON public.roles
  FOR EACH ROW
  EXECUTE FUNCTION public.roles_block_builtin_mutation();

-- Same invariant for the two child tables: a row whose parent role is builtin
-- rejects UPDATE/DELETE too. Both tables have a role_id column pointing at
-- roles, so one shared function serves both.
CREATE OR REPLACE FUNCTION public.block_builtin_role_child_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_builtin BOOLEAN;
BEGIN
  SELECT builtin INTO v_builtin FROM public.roles WHERE id = OLD.role_id;

  IF v_builtin THEN
    RAISE EXCEPTION '% rows for a builtin role cannot be updated or deleted (role_id=%)',
      TG_TABLE_NAME, OLD.role_id
      USING ERRCODE = '42501';
  END IF;

  RETURN OLD;
END;
$$;

COMMENT ON FUNCTION public.block_builtin_role_child_mutation IS
  'Rejects UPDATE/DELETE of a role_areas or role_flags row whose parent role '
  'is builtin. Looks up the parent as SECURITY DEFINER so the check is '
  'authoritative regardless of the caller''s own RLS visibility into roles.';

CREATE TRIGGER role_areas_block_builtin_mutation
  BEFORE UPDATE OR DELETE ON public.role_areas
  FOR EACH ROW
  EXECUTE FUNCTION public.block_builtin_role_child_mutation();

CREATE TRIGGER role_flags_block_builtin_mutation
  BEFORE UPDATE OR DELETE ON public.role_flags
  FOR EACH ROW
  EXECUTE FUNCTION public.block_builtin_role_child_mutation();

-- ============================================================================
-- 6. Trigger: reject a custom role name that case-insensitively collides
-- with a builtin's name (the [2026-07-09] label-collision lesson). Builtin
-- rows themselves are exempt (NOT NEW.builtin short-circuits), since they are
-- the rows being collided with, not the ones colliding.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.roles_reject_builtin_name_collision()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT NEW.builtin AND EXISTS (
    SELECT 1 FROM public.roles b
    WHERE b.builtin = true
      AND lower(b.name) = lower(NEW.name)
  ) THEN
    RAISE EXCEPTION
      'a custom role cannot be named "%": that name is reserved by a built-in role',
      NEW.name
      USING ERRCODE = '23505';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.roles_reject_builtin_name_collision IS
  'Rejects a non-builtin role whose name case-insensitively matches an '
  'existing builtin''s name, so the role picker never shows two entries '
  'named e.g. "Owner" meaning different things.';

CREATE TRIGGER roles_reject_builtin_name_collision
  BEFORE INSERT OR UPDATE ON public.roles
  FOR EACH ROW
  EXECUTE FUNCTION public.roles_reject_builtin_name_collision();

-- ============================================================================
-- 7. Trigger: enforce area_catalog.max_level_collaborator for non-builtin,
-- collaborator-flavored roles. This is the privilege-escalation guard: without
-- it, a collaborator role could be granted manage:collaborators (via Team &
-- Access) and its holder could then mint itself a new role with every area.
-- Builtin roles are seeded before this trigger applies and are exempt by
-- builtin = true (owner legitimately holds Team & Access at manage).
-- Platform-flavored custom roles are also exempt from the cap in this phase
-- (the design defers platform custom roles; the cap only ever applies to
-- flavor = 'collaborator').
-- ============================================================================
CREATE OR REPLACE FUNCTION public.role_areas_enforce_collaborator_cap()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_flavor TEXT;
  v_builtin BOOLEAN;
  v_max_level TEXT;
BEGIN
  SELECT flavor, builtin INTO v_flavor, v_builtin
  FROM public.roles
  WHERE id = NEW.role_id;

  IF v_builtin THEN
    RETURN NEW;
  END IF;

  IF v_flavor = 'collaborator' THEN
    SELECT max_level_collaborator INTO v_max_level
    FROM public.area_catalog
    WHERE area_key = NEW.area_key;

    IF v_max_level IS NULL THEN
      RAISE EXCEPTION 'area "%" cannot be granted to a collaborator role', NEW.area_key
        USING ERRCODE = '42501';
    END IF;

    IF v_max_level = 'view' AND NEW.level = 'manage' THEN
      RAISE EXCEPTION 'area "%" is capped at view for collaborator roles', NEW.area_key
        USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.role_areas_enforce_collaborator_cap IS
  'Privilege-escalation guard: a non-builtin, collaborator-flavored role '
  'cannot be granted an area above area_catalog.max_level_collaborator, and '
  'cannot be granted Team & Access (NULL cap) at any level. Enforced here '
  'rather than only in the UI because the UI is not the only writer.';

CREATE TRIGGER role_areas_enforce_collaborator_cap
  BEFORE INSERT OR UPDATE ON public.role_areas
  FOR EACH ROW
  EXECUTE FUNCTION public.role_areas_enforce_collaborator_cap();
