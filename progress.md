# Progress: Focus POS integration

## Current Phase
Phase 6: Simplify — COMPLETE (commit be8b6011)

## DECISION LOG (latest first)
- 2026-06-27: Data source PIVOT. FocusLink integrator API abandoned (creds ~impossible to get).
  NEW approach = OPTION 2: SSRS HTML-render + parse of Focus reports.
  - Reports live on SSRS ReportServer: https://mfprod-1.myfocuspos.com/ReportServer
  - Report path /generalstorereports/revenuecenter; params dbServer=mfaz-rep-1, dbCatalog=KAHALA2,
    UserID=<login>, StoreID=<store>, rs:Command=Render. StoreID is REQUIRED (e.g. 15312).
  - FINDING: ALL structured exports BLOCKED (CSV/XML/EXCELOPENXML/ATOM all => HTTP 503).
    Only HTML render works (200). HTML parses cleanly (Revenue Center report = daily aggregates:
    net sales, tax, tips, refunds, discounts, payments-by-tender, sales-by-item, sales-by-order-type).
  - AUTH: ReportServer has NO JS-visible auth cookie (only RSExecutionSession + App Insights ai_*).
    Likely Windows Integrated (NTLM/Negotiate) or HttpOnly SSO. Portal (my.focuspos.com) is forms-auth
    (ASP.NET_SessionId + MyMenu blob). Auth bridge portal->ReportServer NOT yet understood.
  - Credentials: per-restaurant portal username/password via a FORM (like other integrations),
    stored ENCRYPTED (reuse _shared/encryption.ts, AES-GCM). Back to Toast-style per-restaurant creds.

## RESOLVED: edge-function path viable (anonymous access)
## (was OPEN BLOCKER)
- Does portal forms-login (username/password -> cookie) yield the report HTML over plain HTTP
  (=> can run in a Deno EDGE FUNCTION), OR is a HEADLESS BROWSER worker (Playwright) required to
  satisfy the ReportServer Windows/SSO auth (=> NEW infra, not edge functions)?
- Need the LOGIN request (Copy as cURL of sign-in POST on my.focuspos.com) to determine this and to
  build re-authentication (captured session expires).

## Superseded
- docs/superpowers/specs/2026-06-24-focus-pos-integration-design.md (FocusLink JSON API) — to be REWRITTEN.

## Done
- Worktree feature/focus-pos-integration; npm install; chore commit untracked progress.md.
- Portal recon: CheckViewer 1+2N drilldown mapped (rejected); SSRS report path found (chosen).

## Git
- PR: not yet created. No code written.

## 2026-06-27 BREAKTHROUGH: ReportServer is ANONYMOUS (no creds needed)
- Tested report URL with NO cookies / NO auth (clean curl): HTTP 200 + full Revenue Center HTML
  (98KB, real data). No 401, no WWW-Authenticate, no login form, no Set-Cookie. => SSRS ReportServer
  serves report HTML to ANY caller that knows the path + StoreID. Portal login NOT required.
- CONSEQUENCES (architecture simplifies drastically):
  * NO password storage. Form collects only report ROUTING params, not credentials.
  * Plain Deno fetch in an EDGE FUNCTION (no headless browser, no worker, no VIEWSTATE, no session).
  * Report URL params: path /generalstorereports/revenuecenter, dbServer=mfaz-rep-1,
    dbCatalog=KAHALA2 (brand/tenant), UserID (audit, likely optional), StoreID (per-restaurant),
    rs:Command=Render (HTML only; CSV/XML/Excel/ATOM still 503). Dates default to today; sync passes
    explicit Start/End date params (names TBD at build).
  * Best onboarding UX: operator pastes their report URL -> we parse StoreID/dbServer/dbCatalog/UserID.
- CAVEATS:
  * SECURITY (Focus side): anyone with a StoreID can read that store's sales -> real vuln in Focus.
    We pull ONLY the StoreID a restaurant authorizes. Worth reporting to Focus/Shift4.
  * FRAGILITY: undocumented unauth endpoint Focus tried to lock down (blocked exports). They could add
    auth / block it anytime -> integration breaks. Pragmatic given creds are unobtainable, not stable.
- Login.aspx forms-auth flow captured (NOT needed now that access is anonymous). Password was pasted in
  chat in plaintext -> advised user to ROTATE it.

## 2026-06-27 Phase 2/2.5/3 COMPLETE — awaiting plan approval to launch build
- Design doc v2 rewritten + committed (3c7d57a6); design review folded S1-S9/F1-F8 (4b7eae2d).
- Plan committed (6c948787): 14 TDD tasks.

## Phase 4 Build Progress

### Task 1 DONE — commit 3b4a6767
- Migration: supabase/migrations/20260627120000_focus_integration.sql
  - focus_connections: PK, FK→restaurants, report_base_url CHECK (SSRF guard S1),
    named UNIQUE focus_connections_restaurant_key (S7), timezone column (S4),
    connection_status CHECK, is_active/sync_cursor/initial_sync_done, updated_at trigger.
  - focus_daily_reports: UNIQUE(restaurant_id,business_date,revenue_center),
    items_json/payments_json/order_types_json/raw_totals_json jsonb columns.
  - RLS: SELECT (any member) + FOR ALL (owner/manager) on both tables.
  - Partial index on focus_connections(last_sync_time) WHERE is_active=true (S5).
- pgTAP test: supabase/tests/40_focus_schema_rls.sql (12 tests, all green).
- Full suite: 1386/1386 tests passing.

### Task 2 DONE — commit 4189f7d8
- Migration: supabase/migrations/20260627130000_focus_unified_sales_sync.sql
  - focus_slug(text) — IMMUTABLE slug helper for deterministic external_item_id.
  - _sync_focus_to_unified_sales_impl(uuid, date, date) — shared SECURITY DEFINER
    body: GUC trigger bypass (app.skip_unified_sales_triggers), per-date loop,
    orphan DELETE (items no longer in items_json), item UPSERT (category_id/is_categorized
    preserved), tax/tip/discount/refund offset rows (zero-value rows skipped+cleaned),
    batch categorize (auth.uid() IS NOT NULL guard), batch aggregate.
  - sync_focus_to_unified_sales(uuid) — all-dates overload with auth check.
  - sync_focus_to_unified_sales(uuid, date, date) — date-range overload.
  - sync_all_focus_to_unified_sales() → TABLE — cron wrapper, LIMIT 5 round-robin,
    last 2 business days, EXCEPTION handler per restaurant.
  - GRANTs to authenticated + service_role.
- pgTAP test: supabase/tests/41_focus_unified_sales_sync.sql (15 tests, all green).
  Covers: function signatures, sale rows (count + amounts), tax/tip offsets,
  zero-value guards (no discount/refund rows), pos_system='focus', external_order_id
  pattern, orphan cleanup, categorization preservation, auth rejection, sync_all result.

### Task 3 DONE — commit 166bd22e
- src/lib/focusUrlParser.ts: parseFocusReportUrl() — pure TS (no browser/Deno deps),
  https-only, no-userinfo, /^([a-z0-9-]+\.)*myfocuspos\.com$/i allowlist,
  requires StoreID, case-insensitive param keys, extracts baseUrl/reportPath/
  dbServer/dbCatalog/userId/storeId from SSRS unconventional URL shape.
- tests/unit/focusUrlParser.test.ts: 16 Vitest cases covering happy path
  (real URL, alt subdomain, optional params absent, case-insensitive keys),
  SSRF/security rejections (evil.com, http://, subdomain attack,
  embedded username+password, username-only, file://, javascript:),
  missing StoreID (absent, empty string, non-URL), reportPath extraction
  (catalog segment preserved, Focus-generated params stripped).
- Full suite: 355 test files / 4642 tests all green. typecheck clean.

### Task 4 DONE — commit 173c2ae6
- supabase/functions/_shared/focusReportClient.ts:
  - FocusConnection interface (reportBaseUrl, reportPath, dbServer, dbCatalog,
    reportUserId, storeId, revenueCenter) — mirrors focus_connections DB columns.
  - FetchDeps interface (injectable fetch for testability without real network).
  - assertAllowedHost(urlString): SSRF guard — https-only, no embedded credentials,
    tight ^([a-z0-9-]+\.)*myfocuspos\.com$ host allow-list; throws for any violation.
  - buildReportUrl(conn, startDate, endDate): constructs full SSRS URL with
    StartDate/EndDate (MM/DD/YYYY), rs:Command=Render, rs:Format=HTML4.0, StoreID,
    optional dbServer/dbCatalog/UserID/RevenueCenter. Handles ?-bearing reportPath
    (splits on first "?" to isolate pathname vs catalog segment).
  - fetchReportHtml(deps, url): redirect:'manual' loop, max 5 hops, per-hop
    AbortSignal.timeout(20s), assertAllowedHost on each Location header (blocks
    SSRF via redirects to 169.254.169.254 or non-myfocuspos.com hosts).
- tests/unit/focusReportClient.test.ts: 25 Vitest tests (all green):
  - buildReportUrl: StartDate/EndDate encoding, rs:Command/Format, StoreID/dbServer/
    dbCatalog inclusion, base URL host, optional field handling, UserID omit-when-empty,
    date ranges.
  - assertAllowedHost: accepts valid myfocuspos.com + subdomains; throws for http://,
    evil.com, subdomain injection, embedded credentials, file://.
  - fetchReportHtml: 200 direct, same-host 302 followed + re-validated, SSRF-blocked
    302 to 169.254.x.x and evil.com, hop limit (≤6 calls), missing Location header,
    503 error, network error propagation.
- Full suite: 356 files / 4667 tests all green. typecheck clean.

### Task 5 DONE — commit 39aa3aea
- supabase/functions/_shared/focusReportParser.ts:
  - ParsedItem / ParsedTotals / ParsedPayment / ParsedOrderType / ParsedDay interfaces (exported).
  - ParseResult discriminated union: {ok:true,data:ParsedDay} | {ok:false,reason:'empty'|'parse_error'} (design §16 S9).
  - parseRevenueCenterReport(html, businessDate, domParser?): state-machine over all <tr> elements.
    State: before_items → items → summary → payments → order_types.
    Anchors: RE_ITEMS_HEADER (/revenue center/i), SUMMARY_LABELS map, RE_PAYMENTS_HEADER, RE_ORDER_TYPES_HEADER.
    Revenue-center name row: col[1] and col[2] both empty in items section.
    parseMoney(): strips $, commas, whitespace; returns 0 for empty/NaN.
    Optional DOMParser injection (Deno: pass deno_dom instance; tests: globalThis.DOMParser via jsdom).
    No imports — runs identically in Deno and Node/jsdom.
  - empty detection: foundStructure=true but no items + all totals zero.
  - parse_error: no recognizable structure (allRows.length===0 or foundStructure never set).
- tests/fixtures/focus-revenue-center-sample.html:
  - 100% synthetic "Sample Creamery" store (store #99999, fictional).
  - 8 items: Dine-In (Scoop Single 20×$59.80, Scoop Double 15×$67.50, Waffle Cone 8×$28.00,
    Sundae Classic 5×$37.50, Hot Fudge Topping 3×$6.00) + Drive-Through (Shake Vanilla 12×$65.40,
    Shake Chocolate 9×$49.05, Cup Small 22×$44.00).
  - Totals: netSales=$340.00, totalTax=$28.00, subtotalDiscounts=$17.25, retainedTips=$45.50,
    refunds=$0.00, totalSales=$368.00.
  - Payments: Cash $95.20, Visa $152.50, Mastercard $80.30, Gift Card $40.00.
  - Order types: Eat In $198.80, Take Out $114.60, Drive-Through $54.60.
  - No real PII (lesson 2026-06-22).
- tests/unit/focusReportParser.test.ts: 29 Vitest tests all green.
  Happy path: item count/names/units/sales/revenueCenter, all 6 totals, 4 payments, 3 order types,
  businessDate pass-through. Error cases: garbage string, empty string, empty-report fixture,
  no-table HTML, discriminated union shape (ok:true has data, ok:false has reason).

### Task 6 DONE — commit 434c371f
- supabase/functions/_shared/focusSyncHandler.ts:
  - SyncDeps interface (injectable fetch, supabase, restaurantId) for Vitest coverage.
  - SyncResult discriminated union: {status:'ok'} | {status:'empty'} | {status:'error', error?}.
  - isoToMmDdYyyy(iso): converts 'YYYY-MM-DD' to 'MM/DD/YYYY' for SSRS URL params.
  - processReportDay(deps, conn, businessDate):
    1. buildReportUrl(conn, formattedDate, formattedDate) — single-day range.
    2. fetchReportHtml (SSRF-guarded, redirect-safe).
    3. parseRevenueCenterReport (discriminated result).
    4. Branching on parse result:
       - ok:true  → upserts full payload (all totals + jsonb arrays); {status:'ok'}.
       - reason:'empty' → upserts zeroed row (all zeros, empty arrays); {status:'empty'}.
       - reason:'parse_error' → skips upsert; {status:'error'}.
    5. ON CONFLICT target: 'restaurant_id,business_date,revenue_center'.
    6. Supabase upsert errors → {status:'error', error: message}.
    7. Top-level try/catch for fetch/unexpected errors → {status:'error', error: message}.
- tests/unit/focusSyncHandler.test.ts: 22 Vitest tests all green.
  Happy path: status:'ok', from('focus_daily_reports'), correct restaurant_id/business_date,
  net_sales/total_tax/retained_tips numerics, items_json/payments_json/order_types_json arrays,
  raw_totals_json object, onConflict columns. URL format: StartDate=06%2F27%2F2026.
  Empty path: status:'empty', upsert called once with zeroed row.
  Parse-error path: status:'error', upsert NOT called.
  Supabase error: status:'error', error message surfaced.
  Network error: status:'error'.
- Full suite: 358 files / 4718 tests green. typecheck clean.

### Task 7 DONE — commit 4490ce31
- supabase/functions/_shared/focusSaveConnectionHandler.ts:
  - UserClient / ServiceClient / SaveConnectionDeps interfaces (injectable for Vitest).
  - handleSaveConnection(req, deps): 401 when Authorization header absent; 401 when
    getUser() returns null; 400 when restaurantId/reportUrl missing; 403 when user
    lacks owner/manager membership in user_restaurants; 400 when parseFocusReportUrl
    returns null (invalid URL, non-https, non-myfocuspos.com, missing StoreID); 500 on
    upsert error; 200 + {success:true} on success.
  - Upsert payload: restaurant_id, report_base_url, report_path, store_id, db_server,
    db_catalog, report_user_id, is_active, connection_status='pending', updated_at.
  - Uses service-role client for all writes (review S3: RLS bypass).
  - onConflict('restaurant_id') — named unique constraint from Task 1 migration.
- supabase/functions/focus-save-connection/index.ts: thin CORS wrapper (verify_jwt=false
  pattern matching toast-save-credentials); builds userClient (with caller JWT) +
  serviceClient (service role key); delegates to handler.
- supabase/config.toml: [functions.focus-save-connection] verify_jwt = false.
- tests/unit/focusSaveConnectionHandler.test.ts: 24 Vitest tests all green.
  Missing auth header (401), bad JWT (401), missing restaurantId (400 + error matches
  /restaurantId/i), missing reportUrl (400 + /reportUrl/i), staff role (403), no
  membership (403), not-a-url (400 + /invalid|url/i), evil.com (400), http:// (400),
  no StoreID (400). Happy path (owner): 200, {success:true}, from('focus_connections'),
  report_base_url, report_path contains /ReportServer, store_id='15312', db_server,
  db_catalog, report_user_id, restaurant_id, connection_status='pending',
  onConflict('restaurant_id'). Manager role also 200. Upsert error → 500.
- Full suite: 359 files / 4742 tests green. typecheck clean.

### Task 8 DONE — commit bcc236b8
- supabase/functions/_shared/focusTestConnectionHandler.ts:
  - UserClient / ServiceClient / TestConnectionDeps interfaces (injectable for Vitest).
  - yesterdayInTz(tz, now): computes yesterday as 'YYYY-MM-DD' in the connection's IANA
    timezone via Intl.DateTimeFormat (en-CA locale → 'YYYY-MM-DD' direct), then subtracts
    one day using setUTCDate (review S4: tz-correct date prevents UTC-midnight off-by-one).
  - handleTestConnection(req, deps):
    1. 401 when Authorization header absent.
    2. 401 when getUser() returns null.
    3. 400 when restaurantId missing.
    4. 403 when user is not owner/manager in user_restaurants (review S6).
    5. 404 when no active focus_connections row for the restaurant.
    6. Builds FocusConnection from the DB row.
    7. Computes yesterday in connection.timezone; calls buildReportUrl (single-day range).
    8. fetchReportHtml (SSRF-guarded, redirect-safe).
    9. parseRevenueCenterReport (discriminated result): ok/empty → 'connected';
       parse_error → 'error' (review S9).
    10. Writes connection_status/last_error/last_error_at via service-role client (review S3).
    11. Returns 200 { success, status, error? } for both connected and error outcomes.
- supabase/functions/focus-test-connection/index.ts: thin CORS wrapper (verify_jwt=false
  pattern matching focus-save-connection); builds userClient + serviceClient + passes
  globalThis.fetch; delegates to handler.
- supabase/config.toml: [functions.focus-test-connection] verify_jwt = false.
- tests/unit/focusTestConnectionHandler.test.ts: 17 Vitest tests all green.
  Missing auth header (401), bad JWT (401), missing restaurantId (400 + /restaurantId/i),
  staff role (403), no membership (403), no connection (404). Happy path: 200 + {success:true,
  status:'connected'}, update called with connection_status='connected'/null errors, eq('id').
  Empty report (ok:false, reason:'empty'): also sets 'connected'. Parse error: {success:false,
  status:'error'}, last_error string truthy, last_error_at string. HTTP 503: {success:false,
  status:'error'}. Service-role client for write (S3). Timezone: 2026-06-27T02:00:00Z +
  America/Chicago → StartDate=06%2F25%2F2026 (yesterday in Chicago = June 25);
  2026-06-27T23:00:00Z + America/New_York → 06%2F26%2F2026. Manager role also 200.
- Full suite: 360 files / 4759 tests green. typecheck clean.

### Task 9 DONE — commit 35aaa00b
- supabase/functions/_shared/focusSyncDataHandler.ts:
  - UserClient / ServiceClient / SyncDataDeps interfaces (injectable for Vitest).
  - todayInTz(tz, now): returns today's calendar date ('YYYY-MM-DD') in the given IANA
    timezone via Intl.DateTimeFormat with en-CA locale (review S4: prevents UTC-midnight
    off-by-one across the 90-day backfill, not just incremental).
  - subtractDays(isoDate, days): subtracts calendar days using noon UTC anchor to avoid
    DST edge cases.
  - handleSyncData(req, deps):
    1. 401 when Authorization header absent.
    2. 401 when getUser() returns null.
    3. 400 when restaurantId missing (/restaurantId/i error).
    4. 403 when user is not owner/manager in user_restaurants (review S6).
    5. 404 when no active focus_connections row for the restaurant.
    6. Builds FocusConnection from the DB row.
    7. Backfill path (initial_sync_done=false): target = today_in_tz − cursor − 1;
       calls processReportDay; increments sync_cursor; sets initial_sync_done=true
       when cursor reaches 90 (TARGET_DAYS).
    8. Incremental path (initial_sync_done=true): processes yesterday + day-before
       (last 2 business days) in parallel; surfaces worst status (error > empty > ok).
    9. Writes sync_cursor/initial_sync_done/last_sync_time via service-role client
       (review S3).
    10. Returns 200 { syncCursor, initialSyncDone, status }.
- supabase/functions/focus-sync-data/index.ts: thin CORS wrapper (verify_jwt=false
  pattern matching focus-save-connection and focus-test-connection); builds
  userClient (with caller JWT) + serviceClient (service role key) + passes
  globalThis.fetch; delegates to handler.
- supabase/config.toml: [functions.focus-sync-data] verify_jwt = false.
- tests/unit/focusSyncDataHandler.test.ts: 25 Vitest tests all green.
  Missing auth header (401), bad JWT (401), missing restaurantId (400 + /restaurantId/i),
  staff role (403), no membership (403), no connection (404).
  Backfill path (cursor=5, now=June 27 Chicago): 200, syncCursor=6,
  initialSyncDone=false, status='ok', URL contains StartDate=06%2F21%2F2026 (June 27
  − 5 − 1 = June 21), update payload has sync_cursor=6 + last_sync_time string.
  Backfill completion (cursor=89→90): syncCursor=90, initialSyncDone=true, DB payload
  has initial_sync_done=true + sync_cursor=90. Incremental path (cursor=90): 200,
  initialSyncDone=true, 2 fetch calls, URLs contain 06/26/2026 and 06/25/2026.
  Timezone backfill (02:00 UTC + America/Chicago = June 26 local → target = June 25).
  S3 service-role write asserted (updateMock called once). Manager role 200. HTTP 503
  fetch → status='error' (still 200).
- Full suite: 361 files / 4784 tests green. typecheck clean.

### Task 10 DONE — commit a6fce117
- supabase/functions/_shared/focusBulkSyncHandler.ts:
  - BulkSyncDeps interface (injectable serviceClient, fetch, sleep, now, serviceRoleKey).
  - timingSafeEqual(a, b): constant-time string comparison for the Bearer gate
    (lesson 2026-05-07); checks length first then XOR-accumulates char codes.
  - recentBusinessDays(tz, now): returns yesterday + day-before as ISO strings
    in the connection's IANA timezone (en-CA locale, design S4).
  - backfillDate(tz, now, cursor): today_in_tz − cursor − 1 (design review S4).
  - processConnection(row, deps): builds FocusConnection + SyncDeps; backfill path
    (initial_sync_done=false) calls processReportDay once for cursor day; incremental
    path (initial_sync_done=true) calls processReportDay for yesterday + day-before
    in parallel; returns { newSyncCursor, newInitialSyncDone }.
  - handleBulkSync(req, deps):
    1. Bearer gate — timing-safe compare; 401 when absent or wrong.
    2. SELECT focus_connections WHERE is_active ORDER BY last_sync_time ASC NULLS FIRST LIMIT 5.
    3. For each connection: budget check (90s, skipped for i=0); sleep(2000ms) between (i>0);
       processConnection → UPDATE focus_connections; per-connection exception → errors[].
    4. Returns 200 { processed, errors, elapsedMs }.
- supabase/functions/focus-bulk-sync/index.ts: thin CORS wrapper (verify_jwt=false);
  passes globalThis.fetch, Date.now, setTimeout-based sleep,
  SUPABASE_SERVICE_ROLE_KEY as serviceRoleKey.
- supabase/config.toml: [functions.focus-bulk-sync] verify_jwt = false.
- tests/unit/focusBulkSyncHandler.test.ts: 20 Vitest tests all green.
  Bearer gate: 401 for absent header, wrong key, missing prefix.
  Happy path: 200, { processed, errors, elapsedMs }, processed=1, errors=[].
  Query shape: LIMIT 5, ORDER BY last_sync_time ASC NULLS FIRST, is_active filter.
  Incremental path: 2 fetch calls (2 recent business days in parallel).
  Backfill path: 1 fetch call, sync_cursor 5→6 in DB update.
  Sleep: 2000ms between restaurants (called once for 2 connections); no sleep for 1.
  Budget: stops at restaurant 2 when 90s exceeded after restaurant 1 completes.
  Empty list: 200 processed=0 errors=[]. Per-connection error (DB update throws):
  continues, processed=2, errors=[...'DB write failure'..].
  LIMIT test: limitMock always called with 5.
- Full suite: 362 files / 4804 tests all green. typecheck clean.

### Task 11 DONE — commit 01c18d07
- Migration: supabase/migrations/20260627140000_focus_cron.sql
  - CREATE EXTENSION IF NOT EXISTS pg_cron (idempotent).
  - CREATE EXTENSION IF NOT EXISTS pg_net (idempotent).
  - GRANT USAGE ON SCHEMA cron TO postgres.
  - focus-bulk-sync: SELECT-EXISTS unschedule guard + cron.schedule('focus-bulk-sync',
    '30 1,7,13,19 * * *', net.http_post to focus-bulk-sync edge fn with service_role_key Bearer).
    Schedule offset: Toast runs at 0 0,2,4,...,22 (even hours on the hour);
    Shift4 at 0 1,3,...,23 (odd hours); Focus at :30 of 1,7,13,19 (every 6h, clear offset).
  - focus-unified-sales-sync: SELECT-EXISTS unschedule guard + cron.schedule(
    'focus-unified-sales-sync', '*/5 * * * *', SELECT sync_all_focus_to_unified_sales()).
    Safety net: keeps unified_sales current between 6-hour bulk sync runs.
- pgTAP test: supabase/tests/42_focus_cron.sql (4 tests, all green):
  - Test 1: cron job 'focus-bulk-sync' exists in cron.job.
  - Test 2: cron job 'focus-unified-sales-sync' exists in cron.job.
  - Test 3: focus-bulk-sync schedule = '30 1,7,13,19 * * *'.
  - Test 4: focus-unified-sales-sync schedule = '*/5 * * * *'.
- Vitest: 362 files / 4804 tests still green (unchanged from Task 10).

### Task 12 DONE — commit 4c44a257
- src/hooks/useFocusConnection.tsx:
  - FocusConnection type (mirrors focus_connections DB columns, no select('*')).
  - FOCUS_CONNECTION_COLUMNS explicit column list (design F8).
  - useQuery: queryKey ['focus-connection', restaurantId], maybeSingle() (never
    throws PGRST116), staleTime:30000, enabled:!!restaurantId,
    refetchOnWindowFocus:false, refetchOnMount:true.
  - saveConnection(restaurantId, reportUrl) → invokes focus-save-connection;
    both error shapes handled (lesson 2026-05-16).
  - testConnection(restaurantId) → invokes focus-test-connection; both error shapes.
  - disconnect(restaurantId) → useMutation sets is_active=false on focus_connections
    (JWT client; RLS FOR ALL owner/manager policy covers this path).
  - triggerManualSync(restaurantId) → invokes focus-sync-data; both error shapes.
  - Returns {isConnected, connection, loading, error, saveConnection, testConnection,
    disconnect, triggerManualSync}.
- tests/unit/useFocusConnection.test.tsx: 17 Vitest tests all green.
  Query: disabled when no restaurantId; maybeSingle() called; explicit column list
  asserted (not '*', contains id/store_id/connection_status/is_active);
  returns connection + isConnected:true on data; throws on non-PGRST116 DB error.
  saveConnection: invoke called with correct fn name + body; error shape 1 (rejection)
  throws; error shape 2 ({data:null,error:{message}}) throws.
  testConnection: invoke called; both error shapes throw.
  disconnect: update called with {is_active:false}; error shape 1 (direct error)
  throws; error shape 2 (thrown rejection) throws.
  triggerManualSync: invoke called with focus-sync-data; both error shapes throw.
- Full suite: 363 files / 4821 tests green. typecheck clean.

### Task 13 DONE — commit 84122f69
- src/components/pos/SyncComponents.tsx:
  - POSConfig: added optional `recentWindowLabel?: string` field (design F5).
  - getSyncDescription: uses `config.recentWindowLabel ?? 'last 25 hours'` (backport).
  - SyncModeSelector: same substitution in the description text.
  - FOCUS_CONFIG exported: {name:'Focus POS', dataLabel:'daily reports',
    dataLabelSingular:'daily report', syncInterval:'6 hours',
    recentWindowLabel:'last 2 business days'}.
- src/components/pos/FocusSetupWizard.tsx:
  - Apple/Notion Dialog (DialogContent + DialogTitle + DialogDescription — F1).
  - 3-step flow: instructions → url-entry → url-confirmed → done.
  - Step 1: informational non-alarming Alert (no password, Store ID caveat,
    Focus/Shift4 mailto link — F8).
  - Step 2a (url-entry): Input id="focus-report-url", Label htmlFor (F2),
    aria-invalid + aria-describedby on validation failure (F2).
  - Step 2b (url-confirmed): client-side parseFocusReportUrl preview shows
    storeId + dbCatalog (F4); "Save & Connect" button.
  - handleSaveAndConnect: calls saveConnection then testConnection; partial
    failure (testConnection rejects) → stays on step 2b, shows inline error +
    Retry button (F3); never advances to Done on failure.
  - Sticky footer (F7), max-h-[80vh] (F7).
  - StepIndicator with aria-current="step" (F8).
- src/components/FocusSync.tsx:
  - Early-return not-connected guard (F7: never reads connection.initial_sync_done
    on null).
  - Passes syncCursor to InitialSyncPendingAlert for backfill progress display.
  - One-day-per-call (no nextPage loop — Focus sync model).
  - Uses FOCUS_CONFIG throughout.
- tests/unit/focusSetupWizard.test.tsx: 19 Vitest tests all green.
  SyncComponents (4): FOCUS_CONFIG shape, recentWindowLabel used/fallback in
  SyncModeSelector and SyncButton.
  FocusSetupWizard (11): step 1 heading + informational Alert, Get Started button,
  step 2a navigation, aria-invalid on invalid URL, confirmation shows storeId/brand,
  saveConnection+testConnection called on Save & Connect, partial-failure re-entry
  (URL retained, error shown, not on Done step), success advances to Done step,
  DialogTitle h2, step indicator aria-current.
  FocusSync (3): not-connected guard (no Sync Now button), sync dashboard when
  connected, InitialSyncPendingAlert with syncCursor=42 shows "42 of 90".
- Full suite: 364 files / 4840 tests all green. typecheck clean.

### Task 14 DONE — commit 28c51fc7
- src/components/IntegrationLogo.tsx: emojiMap['focus-pos'] = '🍦' (design F6, no missing-PNG 🔌 fallback).
- src/pages/Integrations.tsx: import useFocusConnection; const { isConnected: focusConnected } =
  useFocusConnection(selectedRestaurant?.restaurant_id || null); focus-pos entry added to integrations
  array (Point of Sale category, 'Sync daily sales from Focus POS'); focusConnected added to useMemo deps.
- src/components/IntegrationCard.tsx: all 8 Toast-parity touch points (F6):
  1. showFocusSetup state + import FocusSetupWizard.
  2. focusConnection = useFocusConnection(restaurantId) hook call.
  3. isFocusIntegration = integration.id === 'focus-pos'.
  4. getActuallyConnected: isFocusIntegration → focusConnection.isConnected.
  5. getActuallyConnecting: isFocusIntegration → focusConnection.loading.
  6. handleConnect: isFocusIntegration → setShowFocusSetup(true).
  7. handleDisconnect: isFocusIntegration → focusConnection.disconnect(restaurantId).
  8. Connected branch: <FocusSync restaurantId={restaurantId} /> rendered.
  9. Dialog: <Dialog open={showFocusSetup}><FocusSetupWizard …/></Dialog> rendered.
- src/hooks/useFocusConnection.tsx: both `.from('focus_connections' as any)` casts use the
  same pattern as useSlingConnection.ts (table not yet in generated types).
- tests/unit/focusPosRegistration.test.tsx: 12 Vitest tests — IntegrationLogo emoji, Integrations
  renders Focus POS + calls hook, IntegrationCard 8 touch points (a–h) all green.
- Full suite: 365 files / 4852 tests green. typecheck clean. build clean.
  Lint: +2 no-explicit-any (same kind as pre-existing sling pattern; 1501 total vs 1499 baseline).

## Phase 6 Simplify COMPLETE — commit be8b6011

Simplifications applied (behavior unchanged, all 4852 tests still green):

1. **FOCUS_ALLOWED_ROLES** extracted to `focusReportClient.ts` — removed 3 local
   `ALLOWED_ROLES = new Set(['owner', 'manager'])` copies from save/test/sync handlers.
2. **isoToMmDdYyyy** extracted to `focusReportClient.ts` — removed 2 local copies
   (focusSyncHandler + focusTestConnectionHandler). Both handlers import it from client.
3. **todayInTz, subtractDays, recentBusinessDays** extracted to `focusReportClient.ts` —
   removed 2 local copies (focusSyncDataHandler + focusBulkSyncHandler).
4. **FocusConnectionRow (shared routing fields) + rowToFocusConnection** added to
   `focusReportClient.ts` — removed 3 identical 7-line copy-paste mapping blocks.
   Local row types now extend the shared interface with handler-specific fields only.
5. **STRIP_PARAMS_LOWER** (dead code in focusUrlParser.ts) — defined but never read;
   removed cleanly (tests still green because behavior is the same).
6. **FocusSetupWizard Back button** — two identical `<button>Back</button>` elements
   (one for url-entry step, one for url-confirmed) collapsed into a single element
   with conditional handler logic.
7. **focusSyncDataHandler incremental "worst status"** — removed unreachable
   `else { status = 'ok'; }` branch (default is already 'ok'); added clarifying comment.
8. **Sync Now / Done button** — removed pointless `() => { onComplete(); }` wrapper,
   passing `onComplete` directly as `onClick`.

## Phase 4 Build COMPLETE — All 14 tasks done

## Phase 5 UI Review COMPLETE — commit eab1aeb0

Reviewed all changed UI files (FocusSetupWizard.tsx, FocusSync.tsx, IntegrationCard.tsx,
IntegrationLogo.tsx, SyncComponents.tsx, Integrations.tsx) against CLAUDE.md Apple/Notion guidelines.

Findings:
- FocusSetupWizard.tsx: LARGELY COMPLIANT. Correct dialog structure (DialogContent/Header/Title/
  Description), semantic tokens throughout, border-border/40, bg-muted/30, rounded-xl, correct button
  typography (h-9 px-4 text-[13px]), aria-invalid/aria-describedby on inputs, aria-current="step".
  VIOLATION FIXED: Both URL inputs used text-[13px] with a conflicting text-xs (which computes to 12px);
  corrected to text-[14px] (CLAUDE.md spec for inputs) and removed redundant text-xs.
- FocusSync.tsx: COMPLIANT. Early-return guard for not-connected state. Reuses SyncComponents.
- SyncComponents.tsx: Shared file. Pre-existing green/emerald direct-color violations (bg-green-100
  text-green-700, text-green-600 in ConnectionStatus/SyncResults) existed on main before this PR; not
  introduced by focus branch changes (only FOCUS_CONFIG + recentWindowLabel additions). Not fixed here
  to avoid unrelated scope creep.
- IntegrationCard.tsx: Shared file. Pre-existing emerald direct-color violations (border-emerald-500/20,
  bg-emerald-500/10, text-emerald-700) existed on main before this PR; focus branch only added the
  isFocusIntegration branches which follow the same patterns. Not fixed to avoid unrelated scope creep.
- IntegrationLogo.tsx, Integrations.tsx: No new violations introduced.

One commit: eab1aeb0 style(focus): fix input typography to match CLAUDE.md text-[14px] spec

## Phase 7a Codex Adversarial Review COMPLETE

Codex (gpt-5.5) ran against full branch diff vs main. Output: dev-tools/codex-review-output.md.

Finding (severity=major):
- file: supabase/functions/_shared/focusSyncHandler.ts line 112
- processReportDay uses the first parsed item's revenueCenter as the DB row's revenue_center for
  an all-centers report. Items from subsequent revenue centers are stored under the wrong key,
  causing mis-keyed external_item_ids in sync_focus_to_unified_sales. If two centers sell an item
  with the same name, the second center's row silently overwrites the first in unified_sales,
  dropping sales data. This only matters when conn.revenueCenter is empty (all-centers fetch);
  per-center fetches (conn.revenueCenter set) are unaffected.

## Phase 7c CodeRabbit iteration 1 COMPLETE — commit 963e367d

1 actionable finding fixed: `.onConflict()` chained method → `upsert(payload, { onConflict })` options object.
Affected: focusSyncHandler.ts + focusSaveConnectionHandler.ts + 4 test mock factories.
All 4852 tests green.

Skipped (not actionable / pre-existing patterns):
- focus_connections FOR ALL policy: same as Toast (noted in 7b, comment in migration)
- focus_daily_reports FOR ALL policy: same pattern; service role handles all writes
- JSONB CHECK constraints: minor hardening, would need new ALTER migration
- sync_cursor BETWEEN 0 AND 90: minor hardening, code already guards this

## Phase 7c CodeRabbit iteration 2 COMPLETE — commit c8d23617

6 actionable findings fixed:

**Security (critical):**
- REVOKE default PUBLIC/anon EXECUTE on SECURITY DEFINER RPCs in new migration
  20260627150000_focus_sync_hardening.sql — impl + sync_all now service_role-only.

**Data integrity (major):**
- Offset row IDs (tax/tip/discount/refund) now include revenue_center slug prefix
  so rows from different revenue centers for the same store/date don't overwrite.
- Aggregation drives from focus_daily_reports (not synced_at >= v_sync_start) —
  covers delete-only syncs that left no updated synced_at rows.

**Stability (major):**
- sync_all_focus_to_unified_sales updates last_sync_time after each successful
  sync so the round-robin ORDER BY advances past the same 5 restaurants.

**Frontend (major):**
- refetchOnWindowFocus: false → true in useFocusConnection.
- saveConnection/testConnection/triggerManualSync use useMutation + onSettled
  for cache invalidation on both success and failure paths.

**Docs (minor):**
- Design doc LIMIT 10 → LIMIT 5 (aligned with code).

New pgTAP test file: supabase/tests/43_focus_sync_hardening.sql (7 tests).
All 4852 Vitest tests green, typecheck clean.

## Phase 7b Fold Findings COMPLETE — commit df287ddd

10 critical/major actionable findings fixed (6 reviewers: security, performance, maintainability,
sound-logic, ocr-rules, codex). All 4852 tests pass, typecheck clean.

### Fixes applied

**Security:**
- focusSaveConnectionHandler: generic 500 message (was leaking raw upsertError.message)
- focusBulkSyncHandler: timingSafeEqual now iterates max(a,b) length — old early-exit
  on length mismatch allowed token-length inference via timing
- focusTestConnectionHandler + focusSyncDataHandler: .eq('is_active', true) boolean
  (was string 'true' — could return zero rows under strict PostgREST coercion)

**Correctness (data integrity):**
- focusSyncHandler: revenue_center key always uses conn.revenueCenter ('' for all-centers)
  instead of data.items[0].revenueCenter — fixes non-deterministic ON CONFLICT key that
  could create duplicate rows or drop sales from unified_sales
- sync_all_focus_to_unified_sales SQL: end date now yesterday UTC instead of CURRENT_DATE —
  prevents partial-day data for restaurants in negative UTC offsets

**Logic / UX:**
- focusBulkSyncHandler: processed counts only succeeded restaurants (not attempted)
- FocusSync catch block: uses local totalDays not stale React state totalDaysSynced
- FocusSync: loading skeleton + error Alert before happy path (CLAUDE.md Always Handle States)
- IntegrationCard getConnectionDateLabel: Focus branch shows real last_sync_time
- useFocusConnection: explanatory comments on both `as any` casts

### Skipped (not actionable bugs / approved design / style)
- N+1 INSERT loop in SQL (performance/major): set-based rewrite is a significant SQL
  refactor; deferred — current throughput (one restaurant, daily reports) is not a hot path
- FocusSync custom date range not wired (maintainability/major): design doc does not specify
  date-range mode for Focus (one-day-per-call model); leaving UI as informational-only is
  consistent with design
- useFocusConnection hook called unconditionally in IntegrationCard (performance/major):
  React Query deduplicates network requests; this is a pre-existing pattern matching Toast/Sling
- RLS focus_conn_all WITH CHECK gap (security/major): pre-existing pattern from Toast migration;
  service-role handles all writes; flagged in code comment in migration
- supabase/config.toml missing final newline (minor): style
- import order in useFocusConnection.tsx (minor): style — CodeRabbit will flag in 7c
