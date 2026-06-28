-- =====================================================================
-- FOCUS POS — POSTGRES HTTP TRANSPORT
--
-- Why this exists: Focus's legacy Azure/IIS servers reset Deno's (rustls)
-- TLS handshake, so Supabase Edge Functions (Deno) cannot fetch from Focus.
-- curl / Node / Python / Postgres-libcurl (OpenSSL) all connect fine. So the
-- edge functions delegate ONLY the socket to Postgres via the `http`
-- extension (libcurl), keeping all login/parse logic in Deno.
--
-- Security:
--   * focus_http_request is SECURITY DEFINER + SSRF-guarded (https + *.myfocuspos.com).
--   * Callable by service_role ONLY (the edge functions); never anon/authenticated.
--   * The raw http* extension functions are revoked from PUBLIC/anon/authenticated
--     so they can't be used as a generic SSRF primitive — only this guarded
--     wrapper (running as definer) can reach them.
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS http WITH SCHEMA extensions;

-- Lock down the raw http* functions: only the definer of focus_http_request
-- (and superusers) may use libcurl directly.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'extensions' AND p.proname LIKE 'http%'
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.sig);
  END LOOP;
END $$;

-- ─────────────────────────────────────────────────────────────────────
-- focus_http_request — SSRF-guarded HTTP transport for the Focus edge fns.
--   Returns jsonb { status int, headers [{field,value}...], body text }.
--   Does NOT follow redirects (so a 302 + Set-Cookie is surfaced to the
--   caller, which manages the cookie jar in Deno). Bounded timeout.
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.focus_http_request(
  p_url     text,
  p_method  text  DEFAULT 'GET',
  p_headers jsonb DEFAULT '{}'::jsonb,
  p_body    text  DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_headers extensions.http_header[] := ARRAY[]::extensions.http_header[];
  v_ctype   text := NULL;
  v_key     text;
  v_val     text;
  v_resp    extensions.http_response;
  v_out     jsonb := '[]'::jsonb;
  h         extensions.http_header;
BEGIN
  -- SSRF guard: https only, host must be (sub.)myfocuspos.com (no userinfo).
  IF p_url !~* '^https://([a-z0-9-]+\.)*myfocuspos\.com([/?#].*)?$' THEN
    RAISE EXCEPTION 'focus_http_request: refused url (must be https *.myfocuspos.com): %', p_url;
  END IF;

  -- Build request headers; route Content-Type into the request content_type slot.
  FOR v_key, v_val IN SELECT key, value FROM jsonb_each_text(coalesce(p_headers, '{}'::jsonb)) LOOP
    IF lower(v_key) = 'content-type' THEN
      v_ctype := v_val;
    ELSE
      v_headers := v_headers || ROW(v_key, v_val)::extensions.http_header;
    END IF;
  END LOOP;

  -- Capture redirects (don't follow) + bound the request time.
  PERFORM extensions.http_set_curlopt('CURLOPT_FOLLOWLOCATION', '0');
  PERFORM extensions.http_set_curlopt('CURLOPT_TIMEOUT', '25');

  v_resp := extensions.http(
    ROW(
      upper(p_method)::extensions.http_method,
      p_url,
      v_headers,
      v_ctype,
      p_body
    )::extensions.http_request
  );

  PERFORM extensions.http_reset_curlopt();

  IF v_resp.headers IS NOT NULL THEN
    FOREACH h IN ARRAY v_resp.headers LOOP
      v_out := v_out || jsonb_build_object('field', h.field, 'value', h.value);
    END LOOP;
  END IF;

  RETURN jsonb_build_object('status', v_resp.status, 'headers', v_out, 'body', v_resp.content);
END;
$$;

-- service_role only (the edge functions); never end users.
REVOKE ALL ON FUNCTION public.focus_http_request(text, text, jsonb, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.focus_http_request(text, text, jsonb, text) TO service_role;

COMMENT ON FUNCTION public.focus_http_request(text, text, jsonb, text) IS
  'SSRF-guarded libcurl transport for Focus POS edge functions (Deno rustls cannot reach Focus IIS). service_role only.';
