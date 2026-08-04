-- ============================================================================
-- Migration: rewrite the 37-table collaborator policy set to call
-- user_has_capability() instead of enumerating role literals
--
-- Task 6 of the "data-driven roles built from areas" design
-- (docs/superpowers/specs/2026-07-29-roles-and-areas-design.md). RED test:
-- supabase/tests/collaborator_custom_rls_test.sql (26 assertions, 24/26
-- passing before this migration — the 2 failing assertions are the
-- tip_pool_settings SELECT/UPDATE pair this migration flips to GREEN).
--
-- Audit (confirmed independently against pg_policies on a fresh local db):
-- 50 policies across 20 tables carry a collaborator_* role literal. Three
-- shapes:
--   Shape A {owner, manager, operations_manager, collaborator_operations_manager}
--     — 46 policies / 16 tables: open_shift_claims, receipt_imports,
--     schedule_change_logs, schedule_publications, shift_templates, shifts,
--     staffing_settings, time_off_requests, tip_contribution_pools,
--     tip_disputes, tip_payouts, tip_pool_allocations, tip_pool_settings,
--     tip_server_earnings, tip_split_items, tip_splits.
--   Shape B {owner, manager, collaborator_accountant}
--     — 3 policies / 3 tables: assets, asset_photos, asset_depreciation_schedule.
--   Shape C {owner, manager, operations_manager, collaborator_operations_manager, kiosk}
--     — 1 policy / 1 table: time_punches (INSERT only).
--
-- Mapping (each WRITE/READ grant maps to a capability the role actually
-- holds today, per user_has_capability's area+level map in
-- 20260730140000_user_has_capability_from_areas.sql — never to wherever a
-- sibling role happened to appear in the old policy):
--   - edit:scheduling: open_shift_claims, schedule_change_logs,
--     schedule_publications, shift_templates, shifts, staffing_settings,
--     time_off_requests. All four legacy roles that could reach any policy
--     on these tables (SELECT or WRITE) held edit:scheduling uniformly, so
--     every rewritten policy on these 7 tables uses edit:scheduling
--     regardless of command.
--   - view:tips (SELECT) / edit:tips (INSERT/UPDATE/DELETE): the eight
--     tip_* tables — tip_contribution_pools, tip_disputes, tip_payouts,
--     tip_pool_allocations, tip_pool_settings, tip_server_earnings,
--     tip_split_items, tip_splits.
--   - edit:assets: the three Shape-B asset tables (single ALL policy each —
--     the pre-existing, unconditional SELECT policy on each table already
--     covers read access for any restaurant member, so the ALL policy only
--     ever gated writes in practice).
--   - Shape C (time_punches INSERT): user_has_capability(..., 'edit:time_punches')
--     OR an explicit `role = 'kiosk'` literal, kept deliberately. Kiosk has
--     zero role_areas rows by design (see Task 2's seed migration comment),
--     so no capability call can express its access — this is intentional,
--     not a missed conversion.
--
-- EXCEPTION, deliberately NOT converted here: receipt_imports (3 policies,
-- part of Shape A's 46). See "A fourth drift, deliberately not closed here:
-- receipt_imports" in the design doc. The capability named for the feature,
-- edit:receipt_import, resolves through inventory:manage and also covers
-- chef/collaborator_inventory — mapping to it would reverse a deliberate
-- security fix (20251006212711...sql:79, "SECURITY FIX ... Restrict receipt
-- imports to owners and managers") and instantly widen every Chef's access
-- in production, since Task 3's backfill already gave them a role_id. None
-- of the five capabilities whose legacy role list happens to match exactly
-- (edit:scheduling, view:tips, edit:tips, view:time_punches,
-- edit:time_punches) may be substituted either — mapping to "wherever a
-- sibling role happened to appear" is exactly what the design's [2026-07-09]
-- lesson forbids. Left on role literals, untouched, each with a one-line
-- comment below naming this section. Custom roles cannot reach
-- receipt_imports as a result — fail-closed and intended.
--
-- receipt_imports is NOT rewritten anywhere in this file — no DROP POLICY /
-- CREATE POLICY statements touch it. Its three policies are exactly as
-- created in 20260723120000_add_collaborator_operations_manager_role.sql.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Scheduling domain — capability: edit:scheduling
-- ----------------------------------------------------------------------------

-- open_shift_claims.managers_view_restaurant_claims: requires edit:scheduling
DROP POLICY IF EXISTS "managers_view_restaurant_claims" ON public.open_shift_claims;
CREATE POLICY "managers_view_restaurant_claims"
ON public.open_shift_claims FOR SELECT
USING (
  user_has_capability(restaurant_id, 'edit:scheduling')
);

-- open_shift_claims.managers_review_claims: requires edit:scheduling
DROP POLICY IF EXISTS "managers_review_claims" ON public.open_shift_claims;
CREATE POLICY "managers_review_claims"
ON public.open_shift_claims FOR UPDATE
USING (
  user_has_capability(restaurant_id, 'edit:scheduling')
);

-- schedule_change_logs."Managers can create change logs": requires edit:scheduling
DROP POLICY IF EXISTS "Managers can create change logs" ON public.schedule_change_logs;
CREATE POLICY "Managers can create change logs"
ON public.schedule_change_logs FOR INSERT
WITH CHECK (
  user_has_capability(restaurant_id, 'edit:scheduling')
);

-- schedule_publications."Managers can create schedule publications": requires edit:scheduling
DROP POLICY IF EXISTS "Managers can create schedule publications" ON public.schedule_publications;
CREATE POLICY "Managers can create schedule publications"
ON public.schedule_publications FOR INSERT
WITH CHECK (
  user_has_capability(restaurant_id, 'edit:scheduling')
);

-- shift_templates."Users can create shift templates for their restaurants": requires edit:scheduling
DROP POLICY IF EXISTS "Users can create shift templates for their restaurants" ON public.shift_templates;
CREATE POLICY "Users can create shift templates for their restaurants"
  ON public.shift_templates FOR INSERT
  WITH CHECK (
    user_has_capability(restaurant_id, 'edit:scheduling')
  );

-- shift_templates."Users can update shift templates for their restaurants": requires edit:scheduling
DROP POLICY IF EXISTS "Users can update shift templates for their restaurants" ON public.shift_templates;
CREATE POLICY "Users can update shift templates for their restaurants"
  ON public.shift_templates FOR UPDATE
  USING (
    user_has_capability(restaurant_id, 'edit:scheduling')
  );

-- shift_templates."Users can delete shift templates for their restaurants": requires edit:scheduling
DROP POLICY IF EXISTS "Users can delete shift templates for their restaurants" ON public.shift_templates;
CREATE POLICY "Users can delete shift templates for their restaurants"
  ON public.shift_templates FOR DELETE
  USING (
    user_has_capability(restaurant_id, 'edit:scheduling')
  );

-- shifts."Users can create shifts for their restaurants": requires edit:scheduling
DROP POLICY IF EXISTS "Users can create shifts for their restaurants" ON public.shifts;
CREATE POLICY "Users can create shifts for their restaurants"
  ON public.shifts FOR INSERT
  WITH CHECK (
    user_has_capability(restaurant_id, 'edit:scheduling')
  );

-- shifts."Users can update shifts for their restaurants": requires edit:scheduling
DROP POLICY IF EXISTS "Users can update shifts for their restaurants" ON public.shifts;
CREATE POLICY "Users can update shifts for their restaurants"
  ON public.shifts FOR UPDATE
  USING (
    user_has_capability(restaurant_id, 'edit:scheduling')
  );

-- shifts."Users can delete shifts for their restaurants": requires edit:scheduling
DROP POLICY IF EXISTS "Users can delete shifts for their restaurants" ON public.shifts;
CREATE POLICY "Users can delete shifts for their restaurants"
  ON public.shifts FOR DELETE
  USING (
    user_has_capability(restaurant_id, 'edit:scheduling')
  );

-- staffing_settings."Owners and managers can manage staffing settings": requires edit:scheduling
DROP POLICY IF EXISTS "Owners and managers can manage staffing settings" ON public.staffing_settings;
CREATE POLICY "Owners and managers can manage staffing settings"
ON public.staffing_settings FOR ALL
USING (
  user_has_capability(restaurant_id, 'edit:scheduling')
);

-- time_off_requests."Users can create time off requests for their restaurants": requires edit:scheduling
-- (manager-scoped policy only — the employee self-service policies from
-- 20251123100100 are untouched, they never checked a role literal)
DROP POLICY IF EXISTS "Users can create time off requests for their restaurants" ON public.time_off_requests;
CREATE POLICY "Users can create time off requests for their restaurants"
  ON public.time_off_requests FOR INSERT
  WITH CHECK (
    user_has_capability(restaurant_id, 'edit:scheduling')
  );

-- time_off_requests."Users can update time off requests for their restaurants": requires edit:scheduling
DROP POLICY IF EXISTS "Users can update time off requests for their restaurants" ON public.time_off_requests;
CREATE POLICY "Users can update time off requests for their restaurants"
  ON public.time_off_requests FOR UPDATE
  USING (
    user_has_capability(restaurant_id, 'edit:scheduling')
  );

-- time_off_requests."Users can delete time off requests for their restaurants": requires edit:scheduling
DROP POLICY IF EXISTS "Users can delete time off requests for their restaurants" ON public.time_off_requests;
CREATE POLICY "Users can delete time off requests for their restaurants"
  ON public.time_off_requests FOR DELETE
  USING (
    user_has_capability(restaurant_id, 'edit:scheduling')
  );

-- ----------------------------------------------------------------------------
-- Tips domain — capability: view:tips (SELECT) / edit:tips (INSERT/UPDATE/DELETE)
-- ----------------------------------------------------------------------------

-- tip_contribution_pools."Managers can view tip contribution pools": requires view:tips
DROP POLICY IF EXISTS "Managers can view tip contribution pools" ON public.tip_contribution_pools;
CREATE POLICY "Managers can view tip contribution pools"
ON public.tip_contribution_pools FOR SELECT
USING (
  user_has_capability(restaurant_id, 'view:tips')
);

-- tip_contribution_pools."Managers can insert tip contribution pools": requires edit:tips
DROP POLICY IF EXISTS "Managers can insert tip contribution pools" ON public.tip_contribution_pools;
CREATE POLICY "Managers can insert tip contribution pools"
ON public.tip_contribution_pools FOR INSERT
WITH CHECK (
  user_has_capability(restaurant_id, 'edit:tips')
);

-- tip_contribution_pools."Managers can update tip contribution pools": requires edit:tips
DROP POLICY IF EXISTS "Managers can update tip contribution pools" ON public.tip_contribution_pools;
CREATE POLICY "Managers can update tip contribution pools"
ON public.tip_contribution_pools FOR UPDATE
USING (
  user_has_capability(restaurant_id, 'edit:tips')
);

-- tip_contribution_pools."Managers can delete tip contribution pools": requires edit:tips
DROP POLICY IF EXISTS "Managers can delete tip contribution pools" ON public.tip_contribution_pools;
CREATE POLICY "Managers can delete tip contribution pools"
ON public.tip_contribution_pools FOR DELETE
USING (
  user_has_capability(restaurant_id, 'edit:tips')
);

-- tip_disputes."Managers can view tip disputes": requires view:tips
DROP POLICY IF EXISTS "Managers can view tip disputes" ON public.tip_disputes;
CREATE POLICY "Managers can view tip disputes"
ON public.tip_disputes FOR SELECT
USING (
  user_has_capability(restaurant_id, 'view:tips')
);

-- tip_disputes."Managers can update tip disputes": requires edit:tips
DROP POLICY IF EXISTS "Managers can update tip disputes" ON public.tip_disputes;
CREATE POLICY "Managers can update tip disputes"
ON public.tip_disputes FOR UPDATE
USING (
  user_has_capability(restaurant_id, 'edit:tips')
);

-- tip_payouts."Managers can view tip payouts": requires view:tips
DROP POLICY IF EXISTS "Managers can view tip payouts" ON public.tip_payouts;
CREATE POLICY "Managers can view tip payouts"
ON public.tip_payouts FOR SELECT
USING (
  user_has_capability(restaurant_id, 'view:tips')
);

-- tip_payouts."Managers can insert tip payouts": requires edit:tips
DROP POLICY IF EXISTS "Managers can insert tip payouts" ON public.tip_payouts;
CREATE POLICY "Managers can insert tip payouts"
ON public.tip_payouts FOR INSERT
WITH CHECK (
  user_has_capability(restaurant_id, 'edit:tips')
);

-- tip_payouts."Managers can update tip payouts": requires edit:tips
DROP POLICY IF EXISTS "Managers can update tip payouts" ON public.tip_payouts;
CREATE POLICY "Managers can update tip payouts"
ON public.tip_payouts FOR UPDATE
USING (
  user_has_capability(restaurant_id, 'edit:tips')
);

-- tip_payouts."Managers can delete tip payouts": requires edit:tips
DROP POLICY IF EXISTS "Managers can delete tip payouts" ON public.tip_payouts;
CREATE POLICY "Managers can delete tip payouts"
ON public.tip_payouts FOR DELETE
USING (
  user_has_capability(restaurant_id, 'edit:tips')
);

-- tip_pool_settings."Managers can view tip pool settings": requires view:tips
DROP POLICY IF EXISTS "Managers can view tip pool settings" ON public.tip_pool_settings;
CREATE POLICY "Managers can view tip pool settings"
ON public.tip_pool_settings
FOR SELECT
USING (
  user_has_capability(restaurant_id, 'view:tips')
);

-- tip_pool_settings."Managers can insert tip pool settings": requires edit:tips
DROP POLICY IF EXISTS "Managers can insert tip pool settings" ON public.tip_pool_settings;
CREATE POLICY "Managers can insert tip pool settings"
ON public.tip_pool_settings
FOR INSERT
WITH CHECK (
  user_has_capability(restaurant_id, 'edit:tips')
);

-- tip_pool_settings."Managers can update tip pool settings": requires edit:tips
DROP POLICY IF EXISTS "Managers can update tip pool settings" ON public.tip_pool_settings;
CREATE POLICY "Managers can update tip pool settings"
ON public.tip_pool_settings
FOR UPDATE
USING (
  user_has_capability(restaurant_id, 'edit:tips')
);

-- tip_splits."Managers can view tip splits": requires view:tips
DROP POLICY IF EXISTS "Managers can view tip splits" ON public.tip_splits;
CREATE POLICY "Managers can view tip splits"
ON public.tip_splits FOR SELECT
USING (
  user_has_capability(restaurant_id, 'view:tips')
);

-- tip_splits."Managers can insert tip splits": requires edit:tips
DROP POLICY IF EXISTS "Managers can insert tip splits" ON public.tip_splits;
CREATE POLICY "Managers can insert tip splits"
ON public.tip_splits FOR INSERT
WITH CHECK (
  user_has_capability(restaurant_id, 'edit:tips')
);

-- tip_splits."Managers can update tip splits": requires edit:tips
DROP POLICY IF EXISTS "Managers can update tip splits" ON public.tip_splits;
CREATE POLICY "Managers can update tip splits"
ON public.tip_splits FOR UPDATE
USING (
  user_has_capability(restaurant_id, 'edit:tips')
);

-- tip_splits."Managers can delete tip splits": requires edit:tips
DROP POLICY IF EXISTS "Managers can delete tip splits" ON public.tip_splits;
CREATE POLICY "Managers can delete tip splits"
ON public.tip_splits FOR DELETE
USING (
  user_has_capability(restaurant_id, 'edit:tips')
);

-- The remaining three tip_* tables (tip_pool_allocations, tip_server_earnings,
-- tip_split_items) have no restaurant_id column of their own — restaurant_id
-- is resolved via their tip_split_id -> tip_splits join, same as the
-- pre-existing policies being replaced below.

-- tip_pool_allocations."Managers can view tip pool allocations": requires view:tips
DROP POLICY IF EXISTS "Managers can view tip pool allocations" ON public.tip_pool_allocations;
CREATE POLICY "Managers can view tip pool allocations"
ON public.tip_pool_allocations FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM tip_splits ts
    WHERE ts.id = tip_pool_allocations.tip_split_id
      AND user_has_capability(ts.restaurant_id, 'view:tips')
  )
);

-- tip_pool_allocations."Managers can insert tip pool allocations": requires edit:tips
DROP POLICY IF EXISTS "Managers can insert tip pool allocations" ON public.tip_pool_allocations;
CREATE POLICY "Managers can insert tip pool allocations"
ON public.tip_pool_allocations FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM tip_splits ts
    WHERE ts.id = tip_pool_allocations.tip_split_id
      AND user_has_capability(ts.restaurant_id, 'edit:tips')
  )
);

-- tip_pool_allocations."Managers can update tip pool allocations": requires edit:tips
DROP POLICY IF EXISTS "Managers can update tip pool allocations" ON public.tip_pool_allocations;
CREATE POLICY "Managers can update tip pool allocations"
ON public.tip_pool_allocations FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM tip_splits ts
    WHERE ts.id = tip_pool_allocations.tip_split_id
      AND user_has_capability(ts.restaurant_id, 'edit:tips')
  )
);

-- tip_pool_allocations."Managers can delete tip pool allocations": requires edit:tips
DROP POLICY IF EXISTS "Managers can delete tip pool allocations" ON public.tip_pool_allocations;
CREATE POLICY "Managers can delete tip pool allocations"
ON public.tip_pool_allocations FOR DELETE
USING (
  EXISTS (
    SELECT 1 FROM tip_splits ts
    WHERE ts.id = tip_pool_allocations.tip_split_id
      AND user_has_capability(ts.restaurant_id, 'edit:tips')
  )
);

-- tip_server_earnings."Managers can view tip server earnings": requires view:tips
DROP POLICY IF EXISTS "Managers can view tip server earnings" ON public.tip_server_earnings;
CREATE POLICY "Managers can view tip server earnings"
ON public.tip_server_earnings FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM tip_splits ts
    WHERE ts.id = tip_server_earnings.tip_split_id
      AND user_has_capability(ts.restaurant_id, 'view:tips')
  )
);

-- tip_server_earnings."Managers can insert tip server earnings": requires edit:tips
DROP POLICY IF EXISTS "Managers can insert tip server earnings" ON public.tip_server_earnings;
CREATE POLICY "Managers can insert tip server earnings"
ON public.tip_server_earnings FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM tip_splits ts
    WHERE ts.id = tip_server_earnings.tip_split_id
      AND user_has_capability(ts.restaurant_id, 'edit:tips')
  )
);

-- tip_server_earnings."Managers can update tip server earnings": requires edit:tips
DROP POLICY IF EXISTS "Managers can update tip server earnings" ON public.tip_server_earnings;
CREATE POLICY "Managers can update tip server earnings"
ON public.tip_server_earnings FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM tip_splits ts
    WHERE ts.id = tip_server_earnings.tip_split_id
      AND user_has_capability(ts.restaurant_id, 'edit:tips')
  )
);

-- tip_server_earnings."Managers can delete tip server earnings": requires edit:tips
DROP POLICY IF EXISTS "Managers can delete tip server earnings" ON public.tip_server_earnings;
CREATE POLICY "Managers can delete tip server earnings"
ON public.tip_server_earnings FOR DELETE
USING (
  EXISTS (
    SELECT 1 FROM tip_splits ts
    WHERE ts.id = tip_server_earnings.tip_split_id
      AND user_has_capability(ts.restaurant_id, 'edit:tips')
  )
);

-- tip_split_items."Managers can view tip split items": requires view:tips
DROP POLICY IF EXISTS "Managers can view tip split items" ON public.tip_split_items;
CREATE POLICY "Managers can view tip split items"
ON public.tip_split_items FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM tip_splits ts
    WHERE ts.id = tip_split_items.tip_split_id
      AND user_has_capability(ts.restaurant_id, 'view:tips')
  )
);

-- tip_split_items."Managers can insert tip split items": requires edit:tips
DROP POLICY IF EXISTS "Managers can insert tip split items" ON public.tip_split_items;
CREATE POLICY "Managers can insert tip split items"
ON public.tip_split_items FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM tip_splits ts
    WHERE ts.id = tip_split_items.tip_split_id
      AND user_has_capability(ts.restaurant_id, 'edit:tips')
  )
);

-- tip_split_items."Managers can update tip split items": requires edit:tips
DROP POLICY IF EXISTS "Managers can update tip split items" ON public.tip_split_items;
CREATE POLICY "Managers can update tip split items"
ON public.tip_split_items FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM tip_splits ts
    WHERE ts.id = tip_split_items.tip_split_id
      AND user_has_capability(ts.restaurant_id, 'edit:tips')
  )
);

-- tip_split_items."Managers can delete tip split items": requires edit:tips
DROP POLICY IF EXISTS "Managers can delete tip split items" ON public.tip_split_items;
CREATE POLICY "Managers can delete tip split items"
ON public.tip_split_items FOR DELETE
USING (
  EXISTS (
    SELECT 1 FROM tip_splits ts
    WHERE ts.id = tip_split_items.tip_split_id
      AND user_has_capability(ts.restaurant_id, 'edit:tips')
  )
);

-- ----------------------------------------------------------------------------
-- Assets domain (Shape B) — capability: edit:assets
--
-- Each table's pre-existing, unconditional SELECT policy ("Users can view
-- ... for their restaurants" — any restaurant member, no role check) is left
-- untouched; only the single ALL policy per table (which gated writes in
-- practice) is rewritten.
-- ----------------------------------------------------------------------------

-- assets."Owners managers and accountants can manage assets": requires edit:assets
DROP POLICY IF EXISTS "Owners managers and accountants can manage assets" ON public.assets;
CREATE POLICY "Owners managers and accountants can manage assets"
ON public.assets FOR ALL
USING (
  user_has_capability(restaurant_id, 'edit:assets')
);

-- asset_photos."Owners managers and accountants can manage asset photos": requires edit:assets
DROP POLICY IF EXISTS "Owners managers and accountants can manage asset photos" ON public.asset_photos;
CREATE POLICY "Owners managers and accountants can manage asset photos"
ON public.asset_photos FOR ALL
USING (
  user_has_capability(restaurant_id, 'edit:assets')
);

-- asset_depreciation_schedule."Owners managers and accountants can manage depreciation": requires edit:assets
DROP POLICY IF EXISTS "Owners managers and accountants can manage depreciation" ON public.asset_depreciation_schedule;
CREATE POLICY "Owners managers and accountants can manage depreciation"
ON public.asset_depreciation_schedule FOR ALL
USING (
  user_has_capability(restaurant_id, 'edit:assets')
);

-- ----------------------------------------------------------------------------
-- time_punches (Shape C) — capability: edit:time_punches, PLUS a deliberate
-- `role = 'kiosk'` literal.
--
-- Kiosk deliberately has zero role_areas rows (see Task 2's seed migration
-- comment) so no capability call can express its access — this OR-branch is
-- intentional, not a missed conversion.
-- ----------------------------------------------------------------------------

-- time_punches."Managers can create time punches for employees": requires
-- edit:time_punches OR the literal kiosk role (kiosk has no area grants and
-- can never satisfy a capability check by design).
DROP POLICY IF EXISTS "Managers can create time punches for employees" ON public.time_punches;
CREATE POLICY "Managers can create time punches for employees"
ON public.time_punches FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.user_restaurants ur
    WHERE ur.restaurant_id = time_punches.restaurant_id
      AND ur.user_id = auth.uid()
      AND (
        user_has_capability(ur.restaurant_id, 'edit:time_punches')
        OR ur.role = 'kiosk'
      )
  )
);

-- ============================================================================
-- receipt_imports: deliberately NOT converted. See this migration's header
-- and the design doc's "A fourth drift, deliberately not closed here:
-- receipt_imports" section. No DROP POLICY / CREATE POLICY statements for
-- this table appear anywhere in this migration — the three policies below
-- are exactly as created in
-- 20260723120000_add_collaborator_operations_manager_role.sql, left on role
-- literals pending a product decision:
--   - "Owners and managers can view receipt imports" (SELECT)
--   - "Owners and managers can create receipt imports" (INSERT)
--   - "Owners and managers can update receipt imports" (UPDATE)
-- ============================================================================
