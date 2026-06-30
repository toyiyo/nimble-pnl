-- =====================================================================
-- FOCUS POS — POSTGRES HTTP TRANSPORT
--
-- Why this exists: Focus's legacy Azure/IIS servers reset Deno's (rustls)
-- TLS handshake, so Supabase Edge Functions (Deno) cannot fetch from Focus.
-- curl / Node / Python / Postgres-libcurl (OpenSSL) all connect fine. So the
-- edge functions delegate ONLY the socket to Postgres via the `http`
-- extension (libcurl), keeping all login/parse logic in Deno.
--
-- Schema portability (IMPORTANT): the `http` (pgsql-http) extension can already
-- be installed in DIFFERENT schemas across environments — production has it in
-- `public`, while a fresh Supabase project / preview branch installs it in
-- `extensions`. `http` is NOT relocatable (pg_extension.extrelocatable = false),
-- so we cannot move it. Hard-coding `extensions.http(...)` therefore worked on
-- fresh installs but silently failed on production. We instead DISCOVER the
-- http schema at migration time and qualify every http object with it.
--
-- Security:
--   * focus_http_request is SECURITY DEFINER + SSRF-guarded (https + *.myfocuspos.com).
--   * Callable by service_role ONLY (the edge functions); never anon/authenticated.
--   * The raw http* extension functions are revoked from PUBLIC/anon/authenticated
--     (in whatever schema they live) so they can't be used as a generic SSRF
--     primitive — only this guarded wrapper (running as definer) can reach them.
-- =====================================================================

-- Ensure http is available. WITH SCHEMA extensions only takes effect on a FRESH
-- install (it's a no-op when http already exists, e.g. production's public.http);
-- the real schema is discovered below regardless of where it lives.
CREATE EXTENSION IF NOT EXISTS http WITH SCHEMA extensions;

DO $migration$
DECLARE
  v_schema text;
  r        record;
BEGIN
  -- Discover where http actually lives (public on prod, extensions on fresh installs).
  SELECT n.nspname INTO v_schema
  FROM pg_extension e
  JOIN pg_namespace n ON n.oid = e.extnamespace
  WHERE e.extname = 'http';

  IF v_schema IS NULL THEN
    RAISE EXCEPTION 'focus_http_request migration: the http extension is not installed';
  END IF;

  -- Lock down the raw http* functions in their REAL schema so they can't be used
  -- as a generic SSRF primitive by anon/authenticated. The SECURITY DEFINER
  -- wrapper below still works because it runs as the (privileged) definer.
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = v_schema AND p.proname LIKE 'http%'
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.sig);
  END LOOP;

  -- Create the SSRF-guarded transport, qualifying every http object with the
  -- discovered schema (%1$I) so it resolves whether http is in public or
  -- extensions. Explicit qualification (not search_path lookup) keeps this
  -- SECURITY DEFINER function safe from search_path shadowing.
  EXECUTE format($ddl$
    CREATE OR REPLACE FUNCTION public.focus_http_request(
      p_url     text,
      p_method  text  DEFAULT 'GET',
      p_headers jsonb DEFAULT '{}'::jsonb,
      p_body    text  DEFAULT NULL
    ) RETURNS jsonb
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public, %1$I, pg_temp
    AS $fn$
    DECLARE
      v_headers %1$I.http_header[] := ARRAY[]::%1$I.http_header[];
      v_ctype   text := NULL;
      v_key     text;
      v_val     text;
      v_resp    %1$I.http_response;
      v_out     jsonb := '[]'::jsonb;
      h         %1$I.http_header;
    BEGIN
      -- SSRF guard: https only. Two Focus hosts are reachable — the PORTAL
      -- (my.focuspos.com, domain focuspos.com) for login/store-list/discovery,
      -- and the REPORT servers (mf*.myfocuspos.com, domain myfocuspos.com).
      -- These are DIFFERENT registrable domains, so both must be allow-listed:
      -- the exact portal host + the *.myfocuspos.com report wildcard. No userinfo.
      IF p_url !~* '^https://(my\.focuspos\.com|([a-z0-9-]+\.)*myfocuspos\.com)([/?#].*)?$' THEN
        RAISE EXCEPTION 'focus_http_request: refused url (allowed: https my.focuspos.com or *.myfocuspos.com): %%', p_url;
      END IF;

      -- Build request headers; route Content-Type into the request content_type slot.
      FOR v_key, v_val IN SELECT key, value FROM jsonb_each_text(coalesce(p_headers, '{}'::jsonb)) LOOP
        IF lower(v_key) = 'content-type' THEN
          v_ctype := v_val;
        ELSE
          v_headers := v_headers || ROW(v_key, v_val)::%1$I.http_header;
        END IF;
      END LOOP;

      -- Bound the request time. NOTE: pgsql-http (1.6) ALWAYS follows redirects
      -- and exposes neither CURLOPT_FOLLOWLOCATION nor CURLOPT_MAXREDIRS, so we
      -- cannot turn it off. That is acceptable: pgsql-http still returns the
      -- INTERMEDIATE Set-Cookie + Location headers from the redirect chain, which
      -- is all the Deno login/cookie-jar logic needs (it detects auth via the
      -- AuthCookie/MyMenu Set-Cookie). The bounded timeout caps any redirect loop,
      -- and the initial-URL SSRF guard above still gates the first hop.
      PERFORM %1$I.http_set_curlopt('CURLOPT_TIMEOUT', '25');

      v_resp := %1$I.http(
        ROW(
          upper(p_method)::%1$I.http_method,
          p_url,
          v_headers,
          v_ctype,
          p_body
        )::%1$I.http_request
      );

      PERFORM %1$I.http_reset_curlopt();

      IF v_resp.headers IS NOT NULL THEN
        FOREACH h IN ARRAY v_resp.headers LOOP
          v_out := v_out || jsonb_build_object('field', h.field, 'value', h.value);
        END LOOP;
      END IF;

      RETURN jsonb_build_object('status', v_resp.status, 'headers', v_out, 'body', v_resp.content);
    END;
    $fn$;
  $ddl$, v_schema);
END
$migration$;

-- service_role only (the edge functions); never end users.
REVOKE ALL ON FUNCTION public.focus_http_request(text, text, jsonb, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.focus_http_request(text, text, jsonb, text) TO service_role;

COMMENT ON FUNCTION public.focus_http_request(text, text, jsonb, text) IS
  'SSRF-guarded libcurl transport for Focus POS edge functions (Deno rustls cannot reach Focus IIS). service_role only.';
