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

### Next: Task 2 — unified_sales sync RPCs (supabase/tests/41_focus_unified_sales_sync.sql)
