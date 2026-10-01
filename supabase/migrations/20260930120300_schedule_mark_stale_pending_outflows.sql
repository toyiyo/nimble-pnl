-- ============================================================================
-- Schedule the mark-stale-pending-outflows cron job.
--
-- Design: docs/superpowers/specs/2026-09-30-stale-pending-outflows-design.md
--         section 3.3.
--
-- Runs public.mark_stale_pending_outflows() daily at 06:15 UTC. The function
-- body does not change here; it already exists from migration
-- 20251107172140. This migration only adds the cron schedule and locks down
-- the grants: no client ever calls this function, so only postgres and
-- service_role may execute it.
-- ============================================================================

REVOKE EXECUTE ON FUNCTION public.mark_stale_pending_outflows() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_stale_pending_outflows() TO postgres, service_role;

DO $$
BEGIN
  PERFORM cron.unschedule('mark-stale-pending-outflows');
EXCEPTION
  WHEN OTHERS THEN
    -- The job does not exist yet (first run of this migration).
    NULL;
END $$;

SELECT cron.schedule(
  'mark-stale-pending-outflows',
  '15 6 * * *',
  $$SELECT public.mark_stale_pending_outflows();$$
);
