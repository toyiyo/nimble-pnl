-- Fix: Remove GRANT to authenticated on get_restaurant_by_gusto_company
-- This function is only called by Edge Functions with service_role
REVOKE EXECUTE ON FUNCTION public.get_restaurant_by_gusto_company(TEXT) FROM authenticated;

-- Fix: Make restaurant_id NOT NULL on gusto_webhook_events
-- Orphaned events without restaurant_id break multi-tenancy RLS
DELETE FROM public.gusto_webhook_events WHERE restaurant_id IS NULL;

ALTER TABLE public.gusto_webhook_events
  ALTER COLUMN restaurant_id SET NOT NULL;
