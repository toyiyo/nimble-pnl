-- pgTAP: focus_http_request transport RPC (Postgres libcurl) + SSRF guard.
-- The SSRF guard rejects bad URLs BEFORE any network call, so these tests
-- never touch the network.
BEGIN;
SELECT plan(7);

-- http extension is enabled (the transport depends on libcurl).
SELECT ok(
  EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'http'),
  'http extension is installed'
);

-- The transport function exists with the expected signature.
SELECT has_function(
  'public', 'focus_http_request', ARRAY['text', 'text', 'jsonb', 'text'],
  'focus_http_request(text,text,jsonb,text) exists'
);

-- SSRF guard: reject a non-myfocuspos host (raises before any fetch).
SELECT throws_ok(
  $$ SELECT public.focus_http_request('https://evil.com/x', 'GET') $$,
  NULL, NULL, 'rejects non-myfocuspos host'
);

-- SSRF guard: reject non-https.
SELECT throws_ok(
  $$ SELECT public.focus_http_request('http://my.focuspos.com/x', 'GET') $$,
  NULL, NULL, 'rejects non-https scheme'
);

-- SSRF guard: reject a lookalike host (suffix attack).
SELECT throws_ok(
  $$ SELECT public.focus_http_request('https://evil.myfocuspos.com.attacker.com/x', 'GET') $$,
  NULL, NULL, 'rejects lookalike host'
);

-- Least privilege: only service_role may execute it.
SELECT ok(
  has_function_privilege('service_role', 'public.focus_http_request(text,text,jsonb,text)', 'EXECUTE'),
  'service_role can execute focus_http_request'
);
SELECT ok(
  NOT has_function_privilege('authenticated', 'public.focus_http_request(text,text,jsonb,text)', 'EXECUTE'),
  'authenticated cannot execute focus_http_request'
);

SELECT * FROM finish();
ROLLBACK;
