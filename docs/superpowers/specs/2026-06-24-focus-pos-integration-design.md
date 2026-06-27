# Focus POS Integration — Design

**Feature:** Pull Focus POS daily sales into EasyShiftHQ → `unified_sales` for P&L.
**Branch:** `feature/focus-pos-integration`
**Status:** Draft for approval (v2)

## Revision history

- **v1 (2026-06-24) — SUPERSEDED.** Targeted the FocusLink integrator datafeed
  JSON API (`focuslink.focuspos.com/v2/.../datafeed`). Abandoned: integrator
  credentials are effectively unobtainable for us.
- **v2 (2026-06-27) — THIS DOC.** Targets the Focus **SSRS "Revenue Center"
  report**, fetched as **HTML over an anonymous GET** and parsed. Chosen after
  live investigation (see §2). Same end state (`unified_sales` for P&L), very
  different data source.

## 1. Overview

Focus POS exposes a SQL Server Reporting Services (SSRS) **Revenue Center
Report** that returns a store's **daily sales aggregates**. The report server
(`mfprod-1.myfocuspos.com/ReportServer`) answers **anonymous HTTP GETs** — no
login, no cookies, no credentials — returning the report as HTML. We fetch one
business day at a time, parse the HTML, and normalize into `unified_sales`
(gross + offset rows), mirroring the Toast integration's downstream contract.

Because no auth is involved, this is a **plain `fetch` in a Deno edge function**
(no headless browser, no credential storage) on the same poll-based +
pg_cron architecture as Toast.

### Goals
- Connect a restaurant by capturing its **report URL** (which carries the store
  routing parameters) — pasted once into a setup form.
- Pull the Revenue Center report per business day; parse daily aggregates
  (per-item sales, tax, tips, discounts, refunds, payments-by-tender,
  sales-by-order-type).
- Normalize into `unified_sales` (`pos_system='focus'`) using the gross + offset
  model. Backfill ~90 days, then keep current via pg_cron.

### Non-goals (v1)
- Per-check / per-ticket granularity (the Revenue Center report is daily
  aggregate; the CheckViewer per-check path was evaluated and rejected as a
  1+2N stateful scrape).
- Menu, labor, or employee ingestion.
- Any write-back to Focus.

## 2. Background: what we verified (live)

| Question | Finding |
| --- | --- |
| **Report URL** | `GET https://mfprod-1.myfocuspos.com/ReportServer?/generalstorereports/revenuecenter&dbServer=<srv>&dbCatalog=<cat>&UserID=<uid>&StoreID=<sid>&rs:Command=Render&rs:Format=HTML4.0` |
| **Auth** | **None.** Anonymous GET (no cookies/credentials, tested from a clean environment) returns HTTP 200 + the full report HTML. The portal (`my.focuspos.com`) login is *not* required — its session cookie doesn't even reach the ReportServer host. |
| **Formats** | **HTML / HTML4.0 → 200** (work). **CSV / XML / EXCELOPENXML / ATOM → 503** (all structured exports are blocked server-side). So we must parse HTML. |
| **Parameters** | `StoreID` (required, per-store, e.g. 5-digit), **`Start Date` / `End Date`** (date range — confirmed present, enables per-day backfill), `Revenue Center` (multi-select brand filter, default = all), plus routing params `dbServer`, `dbCatalog`, `UserID` carried in the URL. |
| **Data** | Daily aggregates: per-item units/sales, Subtotal, Inclusive Tax, Subtotal Discounts, Net Sales, Food Tax, Total Tax, Total Sales, Paid In/Out, Gift Cards, **Retained Tips**, **Refunds**, Cash Rounding, Total Accountable, **payments by tender** (Cash/Visa/MC/…), **sales by order type** (Eat In/…). |

> **Exact URL names for the date parameters** (prompts are "Start Date"/"End
> Date"; the URL param names are expected to be `StartDate`/`EndDate`) are
> confirmed in the **first build task** by issuing one dated request and
> diffing the result. The URL-builder is an isolated module so this can't ripple.

## 3. Key decisions

1. **No credential storage.** Access is anonymous, so there is nothing to encrypt
   — the setup form captures **routing parameters**, not secrets. (The user
   initially expected a username/password form; the anonymous endpoint makes it
   unnecessary. The `_shared/encryption.ts` service is *not* used.)
2. **Capture-by-URL onboarding.** The operator pastes their full report URL
   (the one their browser shows when viewing the report). We parse out
   `baseUrl/host`, report path, `dbServer`, `dbCatalog`, `UserID`, `StoreID`.
   Robust to per-deployment differences (host could be `mfprod-2…`, catalog
   differs per brand, etc.).
3. **Daily-aggregate granularity.** `unified_sales` gets per-day rows
   (per-item sale rows + tax/tip/discount/refund offset rows), not per-check.
   Sufficient for P&L; documented trade-off (§13).
4. **Parse `rs:Format=HTML4.0`.** Static HTML (vs the HTML5 interactive viewer,
   which renders client-side into an iframe). All field access is isolated in
   one parser module + a **sanitized fixture** (no prod PII).

## 4. Architecture

```
Operator pastes report URL ─► focus-save-connection ─► focus_connections
                                  (parse routing params; SSRF-guard the host)
                                                 │
   pg_cron (6h) ─► focus-bulk-sync ──┐           │
   "Sync now"  ─► focus-sync-data ───┤           ▼
                                     ▼   _shared/focusReportClient.ts
                          buildReportUrl(conn, date) ─► anonymous GET (HTML4.0)
                                     ▼
                          _shared/focusReportParser.ts  (HTML → structured day)
                                     ▼
                          focus_daily_reports  (raw parsed JSON per store-day)
                                     ▼
   pg_cron (5m) ─► sync_all_focus_to_unified_sales() ─► sync_focus_to_unified_sales(rid[,start,end])
                                     ▼
                          unified_sales (pos_system='focus', gross + offsets) ─► existing P&L
```

Edge functions use the codebase **split pattern**: thin Deno `index.ts` +
pure `_shared/<name>Handler.ts` with injected deps (Vitest-coverable, keeps
SonarCloud new-code coverage ≥80%).

## 5. Data source detail

`focus_connections` stores the URL components; the client rebuilds the URL per
day, swapping in the date range and forcing `rs:Format=HTML4.0`:

```
{base}?{reportPath}&dbServer={db_server}&dbCatalog={db_catalog}
      &UserID={report_user_id}&StoreID={store_id}
      &StartDate={mm/dd/yyyy}&EndDate={mm/dd/yyyy}
      &rs:Command=Render&rs:Format=HTML4.0
```

**SSRF guard (critical):** the stored host MUST match an allow-list
(`*.myfocuspos.com`) before any fetch. A connection row is operator-supplied, so
without this guard a malicious value could point the edge function at an internal
address. Validated at save time **and** before every fetch.

## 6. Data model

New migration `supabase/migrations/<ts>_focus_integration.sql`.

### `focus_connections`
| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid PK | |
| `restaurant_id` | uuid NOT NULL | FK → `restaurants(id) ON DELETE CASCADE`; **UNIQUE** |
| `report_base_url` | text NOT NULL | scheme+host, e.g. `https://mfprod-1.myfocuspos.com` (CHECK: `*.myfocuspos.com`) |
| `report_path` | text NOT NULL | e.g. `/ReportServer?/generalstorereports/revenuecenter` |
| `db_server` | text | routing param |
| `db_catalog` | text | routing param (brand/tenant) |
| `report_user_id` | text | routing param (audit; optional) |
| `store_id` | text NOT NULL | per-store id |
| `revenue_center` | text | optional brand filter; default all |
| `last_sync_time` | timestamptz | incremental anchor |
| `initial_sync_done` | boolean DEFAULT false | |
| `sync_cursor` | integer DEFAULT 0 | days completed in backfill |
| `is_active` | boolean DEFAULT true | |
| `connection_status` | text DEFAULT 'pending' | CHECK in (pending,connected,error,disconnected) |
| `last_error` / `last_error_at` | text / timestamptz | |
| `created_at` / `updated_at` | timestamptz | |
| | | indexes: `restaurant_id`; partial `(last_sync_time ASC NULLS FIRST) WHERE is_active` |

No credential columns.

### `focus_daily_reports` (raw parsed per store-day; audit + reprocess)
`UNIQUE(restaurant_id, business_date, revenue_center)`. Columns: `business_date`
DATE, `revenue_center` text, `net_sales`, `total_tax`, `subtotal_discounts`,
`retained_tips`, `refunds`, `total_sales`, `total_payments` numeric,
`items_json` jsonb (per-item units/sales), `payments_json` jsonb (by tender),
`order_types_json` jsonb, `raw_totals_json` jsonb (full parsed snapshot),
`fetched_at` timestamptz. Index `(restaurant_id, business_date)`.

### RLS (both tables)
`SELECT` for any role in `user_restaurants`; a single `FOR ALL` policy for
`owner`/`manager`; edge functions write via the **service-role client**
(bypasses RLS). pgTAP pins the policies.

## 7. unified_sales normalization

RPCs mirror Toast (`pos_system='focus'`), `SECURITY DEFINER`,
`SET search_path = public`, `SET statement_timeout = '120s'`:

- `sync_focus_to_unified_sales(p_restaurant_id uuid)` and the
  `(…, p_start_date date, p_end_date date)` overload.
- `sync_all_focus_to_unified_sales()` — bounded `ORDER BY last_sync_time
  LIMIT 10` (5-min cron).

**Row model (gross + offset), per business day, from `focus_daily_reports`:**

| `item_type` | `adjustment_type` | Source | `external_order_id` / `external_item_id` | Amount |
| --- | --- | --- | --- | --- |
| `sale` | NULL | each item in `items_json` | `focus-{store}-{yyyymmdd}` / slug(item_name) | item sales (+) |
| `tax` | `tax` | `total_tax` | …`_tax` | + |
| `tip` | `tip` | `retained_tips` | …`_tip` | + |
| `discount` | `discount` | `subtotal_discounts` | …`_discount` | − |
| `refund` | NULL | `refunds` | …`_refund` | − |

`sale_date` = `business_date`. Same disciplines as Toast: pass-through allow-list
(`tax/tip/discount`), GUC trigger bypass (`app.skip_unified_sales_triggers`) then
batch categorize + per-date aggregate, `ON CONFLICT … DO UPDATE` preserving
`category_id`/`is_categorized`, stale-row cleanup when a day is re-fetched with
changed values. Payments-by-tender are kept in `focus_daily_reports` for
reconciliation (not written to `unified_sales`).

## 8. Edge functions

`supabase/config.toml`: four `verify_jwt = false` stanzas (each does its own auth).

| Function | Trigger | Auth | Purpose |
| --- | --- | --- | --- |
| `focus-save-connection` | user POST | JWT + owner/manager role | parse + validate (SSRF-guard) report URL, upsert `focus_connections` |
| `focus-test-connection` | user POST | same | anonymous fetch yesterday's report → `connection_status` |
| `focus-sync-data` | user POST | JWT (RLS read) + **service-role** writes | manual sync: cursor day (backfill) or last N days |
| `focus-bulk-sync` | **cron** | timing-safe `Bearer SUPABASE_SERVICE_ROLE_KEY` | round-robin sync of active connections |

**Shared modules:**
- `_shared/focusReportClient.ts` — `buildReportUrl(conn, startDate, endDate)`,
  `assertAllowedHost(url)` (SSRF), `fetchReportHtml(deps, url)` (injectable
  `fetch`, per-attempt `AbortSignal.timeout`, wall-clock budget guard).
- `_shared/focusReportParser.ts` — `parseRevenueCenterReport(html, businessDate)`
  → structured day object. **The single HTML-mapping module** (named extractors +
  an "ASSUMED MARKUP" comment block).

Security: cron gate is constant-time (lesson 2026-05-07); required envs read once
and fail-fast; 5xx returns generic, real error logged.

## 9. Sync orchestration

- **Backfill:** `initial_sync_done=false` → one business day per invocation,
  `sync_cursor` 0…`TARGET_DAYS` (90, configurable); `unified_sales` reconciled by
  the 5-min cron. `sync_cursor ≥ 90` → `initial_sync_done=true`.
- **Incremental:** re-fetch the last **2 business days** (late-posted adjustments);
  idempotent upserts dedupe on `(restaurant_id, business_date, revenue_center)`.
- **`focus-bulk-sync`:** `ORDER BY last_sync_time ASC NULLS FIRST LIMIT 5`,
  2s delay between restaurants, wall-clock budget guard. One ~90 KB GET + parse
  per store-day — comfortably inside edge CPU/wall limits.

## 10. Frontend

- **`src/hooks/useFocusConnection.tsx`** — React Query (`staleTime: 30000`,
  `enabled: !!restaurantId`, `refetchOnWindowFocus: false`, `maybeSingle()`).
  `saveConnection(reportUrl)`, `testConnection()`, `disconnect()`,
  `triggerManualSync()`. Both `functions.invoke` error paths tested.
- **`src/components/pos/FocusSetupWizard.tsx`** — Apple/Notion `Dialog` with its
  own `DialogTitle`/`DialogDescription`:
  1. **How to get your report URL** — short steps (open the Revenue Center report
     in Focus, copy the URL from the address bar) + `mailto`/help link.
  2. **Paste report URL** — one field; on submit we parse + show the detected
     Store ID / brand for confirmation, then `saveConnection` + `testConnection`.
     Partial-failure handled (saved but test failed → `status='error'`, inline
     error + retry).
  3. **Done** → "Sync now" / close (`onComplete`).
  Field has `id`/`htmlFor`; icons `aria-hidden`; `max-h-[80vh]`.
- **`src/components/FocusSync.tsx`** — reuses `SyncComponents.tsx`; one-day-per-call
  (no `nextPage`); backfill progress via `InitialSyncPendingAlert` `syncCursor`.
  Add `FOCUS_CONFIG: POSConfig` (+ `recentWindowLabel: 'last 2 business days'`).
- **Registration:** `Integrations.tsx` (entry + `useFocusConnection`),
  `IntegrationCard.tsx` (branch + `<FocusSetupWizard>`/`<FocusSync>`),
  `IntegrationLogo.tsx` (emoji fallback `🍦`/🖥️ — no missing-PNG broken image).

## 11. Security & fragility (must-read)

- **Anonymous endpoint = data exposure on Focus's side.** Anyone with a `StoreID`
  can read that store's sales unauthenticated. **We fetch only the `StoreID` a
  restaurant supplies for its own connection** — never enumerate. Surface this to
  the operator; recommend they report it to Focus/Shift4.
- **SSRF guard** (`*.myfocuspos.com` allow-list) on the stored host, at save and
  at fetch.
- **Fragility:** undocumented, unauthenticated, and Focus has already locked down
  the export formats — they could add auth or block this at any time. Build
  **defensively**: explicit `connection_status='error'` + `last_error` when the
  fetch fails or the parser can't find expected anchors; the sync never silently
  writes zeros. Treat the FocusLink API as the eventual migration target; isolate
  the source behind the client+parser modules so a future swap is contained.
- No prod PII (real store names/IDs/employee names/figures) in committed docs,
  fixtures, or tests — the test fixture is **synthetic** (lesson 2026-06-22).

## 12. Testing

| Layer | Tests |
| --- | --- |
| Unit (Vitest) | `focusReportParser` (synthetic HTML fixture → asserts per-item sales, tax, tip, discount, refund, payments, order types; malformed/empty-report guards), `focusReportClient` (URL build incl. date params, SSRF allow-list accept/reject, fetch error paths), `useFocusConnection` (both invoke error paths, URL-parse) |
| pgTAP | `sync_focus_to_unified_sales` (gross + offset rows, allow-list, stale cleanup, auth), `focus_connections`/`focus_daily_reports` RLS, idempotency on `(restaurant_id, business_date, revenue_center)` |
| Full gate | typecheck, lint, build, Sonar ≥80% (branch coverage on parser/url-builder) |

## 13. Decided trade-offs / out of scope

- **Daily aggregate, not per-check** — Revenue Center report granularity; adequate
  for P&L. Per-check would require the rejected CheckViewer 1+2N scrape.
- **Anonymous-fetch dependency** — accepted because integrator API creds are
  unobtainable; mitigated by defensive build + isolation for future migration.
- **5-min SQL cron** kept (with `LIMIT`); convert to pg_net if restaurant count
  grows.
- Menu/labor ingestion deferred.

## 14. Open questions / build-time validations

1. **Exact date param URL names** (`StartDate`/`EndDate` expected) — confirmed in
   build task 1 via one dated request; isolated in `buildReportUrl`.
2. **`Revenue Center` multi-select** — default to all revenue centers; confirm the
   URL encoding for "select all".
3. **Item-name stability** — `external_item_id` slug derived from item name; if
   Focus exposes an item code in the report, prefer it.
4. **Logo** — emoji fallback for v1; swap for brand art later.

## 15. File manifest

**New:** migration `_focus_integration.sql`; `_shared/focusReportClient.ts`,
`_shared/focusReportParser.ts`; edge fns `focus-save-connection`,
`focus-test-connection`, `focus-sync-data`, `focus-bulk-sync` (each `index.ts`
+ handler); `src/hooks/useFocusConnection.tsx`;
`src/components/pos/FocusSetupWizard.tsx`; `src/components/FocusSync.tsx`;
synthetic fixture + unit tests + pgTAP tests; cron migration.

**Modified:** `supabase/config.toml`; `src/pages/Integrations.tsx`;
`src/components/IntegrationCard.tsx`; `src/components/IntegrationLogo.tsx`;
`src/components/pos/SyncComponents.tsx` (`FOCUS_CONFIG` + `recentWindowLabel`);
Sonar/vitest excludes if any thin `index.ts` needs it.
