-- ============================================================================
-- The `returning_guests` area.
--
-- One area for each sidebar page. The page is view-only, so it has no manage
-- tier. No builtin role gets a role_areas row. Only owner and manager reach
-- the page, and the RPC checks that role itself.
-- Design: docs/superpowers/specs/2026-11-12-returning-guests-design.md 4.7
-- ============================================================================

INSERT INTO public.area_catalog (area_key, ui_group, band, sort_order, max_level_collaborator)
VALUES ('returning_guests', 'Main', 'Main', 6, 'view')
ON CONFLICT (area_key) DO NOTHING;
