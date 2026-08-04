-- ============================================================================
-- Migration: Admit 'collaborator_custom' into user_restaurants.role
--
-- Task 4/9 of the roles-and-areas plan (docs/superpowers/plans/
-- 2026-07-29-roles-and-areas-plan.md). A membership on a data-driven custom
-- role stores the literal 'collaborator_custom' in the legacy `role` column
-- and points the new `role_id` (added in 20260730120000) at the custom
-- `roles` row. The legacy string keeps every existing policy's meaning: all
-- 224 policies that compare `role` against literals never match
-- 'collaborator_custom', so a custom role is denied by default on every
-- table this design does not explicitly touch (see the design doc's "Why
-- custom roles are fail-closed by construction").
--
-- No behavior changes here beyond widening the CHECK — user_has_capability,
-- RLS policies, and the TypeScript layer are unaffected until later tasks.
-- Coverage: this literal is exercised by task 5's
-- supabase/tests/user_has_capability_areas_test.sql and task 6's
-- supabase/tests/collaborator_custom_rls_test.sql, per the plan's explicit
-- decision not to add a separate test file for this task.
-- ============================================================================

ALTER TABLE public.user_restaurants
  DROP CONSTRAINT IF EXISTS user_restaurants_role_check;

ALTER TABLE public.user_restaurants
  ADD CONSTRAINT user_restaurants_role_check
  CHECK (role IN (
    'owner', 'manager', 'operations_manager', 'chef', 'staff', 'kiosk',
    'collaborator_accountant', 'collaborator_inventory', 'collaborator_chef',
    'collaborator_operations_manager', 'collaborator_custom'
  ));
