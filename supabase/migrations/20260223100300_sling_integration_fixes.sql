-- =====================================================
-- Sling integration fixes (CodeRabbit feedback)
-- 1. Drop redundant index (duplicate of UNIQUE constraint)
-- 2. Replace custom trigger function with generic one
-- 3. Restrict RPC grant to service_role only
-- =====================================================

-- 1. Drop redundant index (same columns as eim_restaurant_integration_external_key UNIQUE)
DROP INDEX IF EXISTS public.idx_employee_integration_mappings_lookup;

-- 2. Replace custom update_sling_updated_at() with generic update_updated_at_column()
-- Drop old triggers
DROP TRIGGER IF EXISTS update_sling_connections_updated_at ON public.sling_connections;
DROP TRIGGER IF EXISTS update_sling_users_updated_at ON public.sling_users;
DROP TRIGGER IF EXISTS update_sling_shifts_updated_at ON public.sling_shifts;
DROP TRIGGER IF EXISTS update_sling_timesheets_updated_at ON public.sling_timesheets;
DROP TRIGGER IF EXISTS update_employee_integration_mappings_updated_at ON public.employee_integration_mappings;

-- Drop custom function
DROP FUNCTION IF EXISTS update_sling_updated_at();

-- Recreate triggers with generic function
CREATE TRIGGER update_sling_connections_updated_at
  BEFORE UPDATE ON public.sling_connections
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_sling_users_updated_at
  BEFORE UPDATE ON public.sling_users
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_sling_shifts_updated_at
  BEFORE UPDATE ON public.sling_shifts
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_sling_timesheets_updated_at
  BEFORE UPDATE ON public.sling_timesheets
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_employee_integration_mappings_updated_at
  BEFORE UPDATE ON public.employee_integration_mappings
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- 3. Revoke RPC execute from authenticated, keep only service_role
REVOKE EXECUTE ON FUNCTION public.sync_sling_to_shifts_and_punches(UUID, DATE, DATE) FROM authenticated;
