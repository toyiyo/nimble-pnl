# Progress: Focus POS integration

## Current Phase
Phase 2: Brainstorm — DESIGN PIVOT in progress (data source changed)

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

### Next: Task 8 — focus-test-connection edge function
