-- =====================================================================
-- FOCUS POS — PIVOT TO THE FOCUSLINK API (Shift4)
--
-- The portal-login + SSRS-scrape access model is replaced by the FocusLink
-- JSON API: GET {base}/stores/{storeId}/datafeed?date=YYYY-MM-DD, HTTP Basic
-- auth (API key = username, API secret = password).
--
-- Credential model (confirmed with Shift4): ONE key/secret per restaurant
-- GROUP (covers all the group's stores), and a per-store identifier. So the
-- credentials live PER CONNECTION (secret AES-GCM encrypted via _shared/
-- encryption.ts), not as platform secrets.
--
-- Reuses: store_id (now the FocusLink store identifier — numeric storeKey or
-- restaurant GUID), and the whole sync/cron/unified_sales pipeline.
-- The legacy portal columns (report_*, username, password_encrypted) are kept
-- nullable for now and dropped in a later cleanup once no rows depend on them.
-- =====================================================================

ALTER TABLE public.focus_connections
  ADD COLUMN IF NOT EXISTS api_key              text,
  ADD COLUMN IF NOT EXISTS api_secret_encrypted text,
  ADD COLUMN IF NOT EXISTS mid                  text,
  ADD COLUMN IF NOT EXISTS environment          text NOT NULL DEFAULT 'production'
    CHECK (environment IN ('sandbox', 'production'));

-- Portal credentials are no longer required (FocusLink uses key/secret).
ALTER TABLE public.focus_connections ALTER COLUMN username           DROP NOT NULL;
ALTER TABLE public.focus_connections ALTER COLUMN password_encrypted DROP NOT NULL;

COMMENT ON COLUMN public.focus_connections.api_key IS
  'FocusLink API key (HTTP Basic username). One per restaurant group.';
COMMENT ON COLUMN public.focus_connections.api_secret_encrypted IS
  'FocusLink API secret, AES-GCM encrypted (HTTP Basic password).';
COMMENT ON COLUMN public.focus_connections.mid IS
  'Merchant ID — support/reconciliation only; not the datafeed path param.';
COMMENT ON COLUMN public.focus_connections.environment IS
  'FocusLink environment: sandbox | production (selects the API base URL).';
