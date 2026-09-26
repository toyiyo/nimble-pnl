-- Bank reauth notices cron dispatcher.
--
-- The bank-reauth-notices cron job used to call the edge function directly
-- from the cron command. This migration replaces that with a dispatcher
-- function, the same pattern as dispatch_shift_trade_reminders() in
-- 20260925120000_shift_trade_reminders.sql. Unschedule and reschedule the
-- job so this migration can run again.

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

CREATE OR REPLACE FUNCTION public.dispatch_bank_reauth_notices()
RETURNS bigint
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  c_url CONSTANT text := 'https://ncdujvdgqtaunuyigflp.supabase.co';
  v_key text := NULLIF(current_setting('app.settings.service_role_key', true), '');
BEGIN
  IF v_key IS NULL THEN
    BEGIN
      SELECT decrypted_secret INTO v_key
      FROM vault.decrypted_secrets
      WHERE name = 'supabase_service_role_key'
      LIMIT 1;
    EXCEPTION WHEN OTHERS THEN
      -- No Vault access or no Vault extension: treat as no key.
      v_key := NULL;
    END;
  END IF;

  IF v_key IS NULL OR v_key = '' THEN
    RETURN NULL;
  END IF;

  RETURN net.http_post(
    url := c_url || '/functions/v1/bank-reauth-notices',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_key
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
END;
$$;

COMMENT ON FUNCTION public.dispatch_bank_reauth_notices() IS
  'Posts to the bank-reauth-notices edge function at the constant project '
  'URL. Returns NULL and sends nothing when no service role key exists.';

REVOKE EXECUTE ON FUNCTION public.dispatch_bank_reauth_notices() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dispatch_bank_reauth_notices() TO service_role;

DO $$
BEGIN
  PERFORM cron.unschedule('bank-reauth-notices');
EXCEPTION
  WHEN OTHERS THEN
    -- The job does not exist yet, or was already unscheduled.
    NULL;
END $$;

SELECT cron.schedule(
  'bank-reauth-notices',
  '0 9 * * *',
  $$SELECT public.dispatch_bank_reauth_notices();$$
);
