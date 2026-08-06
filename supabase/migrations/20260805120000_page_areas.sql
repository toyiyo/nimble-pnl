-- ============================================================================
-- Migration: re-cut area_catalog along the sidebar — one area per page
--
-- Design: docs/superpowers/specs/2026-08-05-permissions-menu-mirror-design.md
--
-- The ordering below is forced, not preferred — see spec §4.0. Two facts:
--   1. role_areas_block_builtin_mutation is BEFORE UPDATE OR DELETE with no
--      migration exemption (20260730100000_roles_and_areas_tables.sql:419-465).
--      It does NOT cover INSERT, so only removing the old `books` rows needs
--      the guard down.
--   2. role_areas.area_key REFERENCES area_catalog(area_key) with no
--      ON DELETE clause (:229), therefore RESTRICT.
-- ============================================================================

ALTER TABLE public.role_areas DISABLE TRIGGER role_areas_block_builtin_mutation;
