# Focus POS Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pull Focus POS daily sales (Revenue Center SSRS report, fetched as HTML over an anonymous GET) into `unified_sales` for P&L, on the same poll + pg_cron architecture as Toast.

**Architecture:** Edge functions fetch the report HTML per business day from `mfprod-1.myfocuspos.com/ReportServer` (anonymous, SSRF-guarded), parse daily aggregates into `focus_daily_reports`, and a SECURITY DEFINER RPC normalizes them into `unified_sales` (gross + offset rows). No credentials are stored — the setup form captures the report URL. Mirrors Toast's downstream contract.

**Tech Stack:** Supabase (Postgres, RLS, Deno edge functions, pg_cron/pg_net), React 18 + React Query + shadcn/ui, Vitest + pgTAP.

**Spec:** `docs/superpowers/specs/2026-06-24-focus-pos-integration-design.md` (v2). Read §16 (review resolutions S1–S9, F1–F8) — they are binding.

**Reference (mirror these):** `supabase/functions/_shared/toastOrderProcessor.ts`, `supabase/migrations/20251116100100_toast_integration.sql`, `supabase/migrations/20260215200000_fix_toast_sync_timeout.sql`, `supabase/migrations/20260127000000_toast_sync_improvements.sql`, `src/hooks/useToastConnection.tsx`, `src/components/pos/ToastSetupWizard.tsx`, `src/components/pos/SyncComponents.tsx`, `src/pages/Integrations.tsx`, `src/components/IntegrationCard.tsx`, `src/components/IntegrationLogo.tsx`.

**Conventions:** Migrations are timestamped `YYYYMMDDHHMMSS_*.sql`; use a timestamp after the latest existing migration. pgTAP tests live in `supabase/tests/`, Vitest in `tests/unit/`. Amounts are dollars. Commit after every green step.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `supabase/migrations/<ts>_focus_integration.sql` | `focus_connections` + `focus_daily_reports` tables, constraints, indexes, RLS, `updated_at` trigger |
| `supabase/migrations/<ts2>_focus_unified_sales_sync.sql` | `sync_focus_to_unified_sales` (2 overloads) + `sync_all_focus_to_unified_sales` RPCs |
| `supabase/migrations/<ts3>_focus_cron.sql` | pg_cron jobs (bulk sync 6h, unified-sales 5m) |
| `src/lib/focusUrlParser.ts` | Pure client+server report-URL parser → routing params |
| `supabase/functions/_shared/focusReportClient.ts` | URL builder + SSRF guard + redirect-safe fetch |
| `supabase/functions/_shared/focusReportParser.ts` | HTML → structured day (discriminated result) |
| `supabase/functions/_shared/focusSyncHandler.ts` | fetch → parse → upsert `focus_daily_reports` |
| `supabase/functions/focus-save-connection/{index,}.ts` + `_shared/focusSaveConnectionHandler.ts` | save/validate connection |
| `supabase/functions/focus-test-connection/index.ts` + `_shared/focusTestConnectionHandler.ts` | connectivity test |
| `supabase/functions/focus-sync-data/index.ts` + `_shared/focusSyncDataHandler.ts` | manual sync (cursor/incremental) |
| `supabase/functions/focus-bulk-sync/index.ts` + `_shared/focusBulkSyncHandler.ts` | cron round-robin sync |
| `src/hooks/useFocusConnection.tsx` | React Query hook |
| `src/components/pos/FocusSetupWizard.tsx` | setup dialog (paste-URL) |
| `src/components/FocusSync.tsx` | sync dashboard |
| `tests/fixtures/focus-revenue-center-sample.html` | synthetic report fixture (NO real PII) |

Dependency order: Task 1 → 2 → 3 → 4 → 5 → 6 → (7,8,9,10) → 11 → 12 → 13 → 14. Tasks 7–10 depend on 3–6; 13 depends on 12; 14 depends on 13.

---

## Task 1: DB schema — focus_connections + focus_daily_reports

**Files:**
- Create: `supabase/migrations/<ts>_focus_integration.sql`
- Test: `supabase/tests/40_focus_schema_rls.sql`

- [ ] **Step 1: Write failing pgTAP test** `supabase/tests/40_focus_schema_rls.sql`

```sql
BEGIN;
SELECT plan(12);
-- tables exist
SELECT has_table('public','focus_connections','focus_connections exists');
SELECT has_table('public','focus_daily_reports','focus_daily_reports exists');
-- key columns
SELECT has_column('public','focus_connections','store_id','has store_id');
SELECT has_column('public','focus_connections','timezone','has timezone');
SELECT col_has_check('public','focus_connections','report_base_url','base_url has CHECK');
-- named unique constraint for ON CONFLICT (restaurant_id)
SELECT has_index('public','focus_connections','focus_connections_restaurant_key','unique restaurant_id');
SELECT has_index('public','focus_daily_reports','focus_daily_reports_unique','unique (rid,date,rc)');
-- RLS enabled
SELECT is(relrowsecurity,true,'RLS on focus_connections') FROM pg_class WHERE relname='focus_connections';
SELECT is(relrowsecurity,true,'RLS on focus_daily_reports') FROM pg_class WHERE relname='focus_daily_reports';
-- CHECK rejects non-https / non-myfocuspos host
SELECT throws_ok($$INSERT INTO focus_connections(restaurant_id,report_base_url,report_path,store_id) VALUES (gen_random_uuid(),'http://evil.com','/x','1')$$, NULL, NULL, 'rejects bad base_url');
-- CHECK accepts a valid host
SELECT lives_ok($$INSERT INTO focus_connections(restaurant_id,report_base_url,report_path,store_id) VALUES (gen_random_uuid(),'https://mfprod-1.myfocuspos.com','/ReportServer?/generalstorereports/revenuecenter','15312')$$, 'accepts valid');
SELECT col_is_pk('public','focus_connections','id','id is PK');
SELECT * FROM finish();
ROLLBACK;
```

- [ ] **Step 2: Run, verify it fails** — `npm run test:db` → FAIL (no such table).

- [ ] **Step 3: Write the migration.** Mirror `20251116100100_toast_integration.sql` structure (RLS policies, `updated_at` trigger function `set_focus_updated_at` with `SECURITY DEFINER SET search_path = public`). Key DDL:

```sql
CREATE TABLE public.focus_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  report_base_url text NOT NULL CHECK (report_base_url ~ '^https://([a-z0-9-]+\.)*myfocuspos\.com(/|$)'),
  report_path text NOT NULL,
  db_server text, db_catalog text, report_user_id text,
  store_id text NOT NULL,
  revenue_center text,
  timezone text NOT NULL DEFAULT 'America/Chicago',
  last_sync_time timestamptz,
  initial_sync_done boolean NOT NULL DEFAULT false,
  sync_cursor integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  connection_status text NOT NULL DEFAULT 'pending'
    CHECK (connection_status IN ('pending','connected','error','disconnected')),
  last_error text, last_error_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT focus_connections_restaurant_key UNIQUE (restaurant_id)
);
CREATE INDEX focus_connections_active_sync_idx
  ON public.focus_connections (last_sync_time ASC NULLS FIRST) WHERE is_active = true;

CREATE TABLE public.focus_daily_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  business_date date NOT NULL,
  revenue_center text NOT NULL DEFAULT '',
  net_sales numeric, total_tax numeric, subtotal_discounts numeric,
  retained_tips numeric, refunds numeric, total_sales numeric, total_payments numeric,
  items_json jsonb NOT NULL DEFAULT '[]', payments_json jsonb NOT NULL DEFAULT '[]',
  order_types_json jsonb NOT NULL DEFAULT '[]', raw_totals_json jsonb NOT NULL DEFAULT '{}',
  fetched_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT focus_daily_reports_unique UNIQUE (restaurant_id, business_date, revenue_center)
);
CREATE INDEX focus_daily_reports_rid_date_idx ON public.focus_daily_reports (restaurant_id, business_date);
```

RLS (both tables): enable RLS; `CREATE POLICY focus_conn_select FOR SELECT USING (restaurant_id IN (SELECT restaurant_id FROM user_restaurants WHERE user_id = auth.uid()));` and `CREATE POLICY focus_conn_all FOR ALL USING (restaurant_id IN (SELECT restaurant_id FROM user_restaurants WHERE user_id = auth.uid() AND role IN ('owner','manager')));` — and the analogous pair on `focus_daily_reports` (SELECT any role; FOR ALL owner/manager). Add `updated_at` BEFORE UPDATE trigger on `focus_connections`.

- [ ] **Step 4: Run, verify pass** — `npm run test:db` → 12 passed.
- [ ] **Step 5: Commit** — `git add supabase/migrations supabase/tests/40_focus_schema_rls.sql && git commit -m "feat(focus): focus_connections + focus_daily_reports schema + RLS"`

---

## Task 2: unified_sales sync RPCs

**Files:**
- Create: `supabase/migrations/<ts2>_focus_unified_sales_sync.sql`
- Test: `supabase/tests/41_focus_unified_sales_sync.sql`

Mirror `20260215200000_fix_toast_sync_timeout.sql`: `SECURITY DEFINER`, `SET search_path = public`, `SET statement_timeout = '120s'`, GUC bypass `app.skip_unified_sales_triggers`, batch categorize (`apply_rules_to_pos_sales` when `auth.uid() IS NOT NULL`), per-date `aggregate_unified_sales_to_daily`.

- [ ] **Step 1: Write failing pgTAP test** `supabase/tests/41_focus_unified_sales_sync.sql` — insert a `focus_connections` row + a `focus_daily_reports` row with `items_json = '[{"name":"Waffle","revenue_center":"Cold Stone","sales":1.79},{"name":"Like It","revenue_center":"Cold Stone","sales":5.84}]'`, `total_tax=1.76`, `retained_tips=3.82`, `subtotal_discounts=0`, `refunds=0`. Assert after `SELECT sync_focus_to_unified_sales(rid)`:
  - 2 `unified_sales` rows `item_type='sale'`, amounts 1.79 and 5.84, `pos_system='focus'`, `external_item_id` containing the revenue-center + item slug.
  - 1 `tax` row (`adjustment_type='tax'`, 1.76), 1 `tip` row (3.82). No discount/refund rows (zero).
  - **Orphan cleanup:** pre-seed a stale `unified_sales` row for the same date with `external_item_id='cold-stone_old-item'`; assert it is DELETEd after sync (not in current set).
  - **Categorization preserved:** pre-seed a sale row matching a current item with `is_categorized=true, category_id=<x>`; assert `category_id` unchanged after re-sync.
  - `throws_ok` for unauthorized (no membership) — mirror Toast test 17's auth assertion if the RPC enforces it; otherwise assert SECURITY DEFINER runs.

- [ ] **Step 2: Run, verify fail** — `npm run test:db` → FAIL.

- [ ] **Step 3: Write the RPC.** Core body (per restaurant; the `(rid,start,end)` overload filters `business_date` BETWEEN; the no-arg-range overload does all dates present):

```sql
CREATE OR REPLACE FUNCTION public.sync_focus_to_unified_sales(p_restaurant_id uuid, p_start_date date DEFAULT NULL, p_end_date date DEFAULT NULL)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public SET statement_timeout = '120s' AS $$
DECLARE v_count int := 0; v_date date;
BEGIN
  PERFORM set_config('app.skip_unified_sales_triggers','true', true);
  FOR v_date IN SELECT DISTINCT business_date FROM focus_daily_reports
      WHERE restaurant_id = p_restaurant_id
        AND (p_start_date IS NULL OR business_date >= p_start_date)
        AND (p_end_date   IS NULL OR business_date <= p_end_date)
  LOOP
    -- build current day's external_item_ids, DELETE orphans, then upsert sale + offset rows
    -- (sale rows from items_json; tax/tip/discount/refund offset rows from the totals columns)
    -- ON CONFLICT (restaurant_id,pos_system,external_order_id,external_item_id) WHERE parent_sale_id IS NULL
    --   DO UPDATE SET total_price=..., quantity=..., updated_at=now()  -- NOT category_id/is_categorized
    -- See design §7 for the exact row table.
  END LOOP;
  PERFORM set_config('app.skip_unified_sales_triggers','false', true);
  IF auth.uid() IS NOT NULL THEN PERFORM apply_rules_to_pos_sales(p_restaurant_id, 10000); END IF;
  -- aggregate each affected date
  RETURN v_count;
END $$;

CREATE OR REPLACE FUNCTION public.sync_all_focus_to_unified_sales()
RETURNS TABLE(restaurant_id uuid, rows_synced integer) LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE r record;
BEGIN
  FOR r IN SELECT fc.restaurant_id FROM focus_connections fc
           WHERE fc.is_active = true ORDER BY fc.last_sync_time ASC NULLS FIRST LIMIT 5
  LOOP
    restaurant_id := r.restaurant_id;
    rows_synced := sync_focus_to_unified_sales(r.restaurant_id, (now() - interval '25 hours')::date, now()::date);
    RETURN NEXT;
  END LOOP;
END $$;
```

Worker implements the row inserts per design §7 (sale rows per item; `tax`/`tip`/`discount`/`refund` offset rows; `external_item_id = slug(revenue_center)||'_'||slug(item_name)`; `external_order_id = 'focus-'||store_id||'-'||to_char(business_date,'YYYYMMDD')`). Grant EXECUTE to `authenticated`, `service_role`.

- [ ] **Step 4: Run, verify pass** — `npm run test:db`.
- [ ] **Step 5: Commit** — `git commit -m "feat(focus): sync_focus_to_unified_sales RPCs (gross + offset, orphan-delete)"`

---

## Task 3: focusUrlParser (client + server pure util)

**Files:** Create `src/lib/focusUrlParser.ts`; Test `tests/unit/focusUrlParser.test.ts`

- [ ] **Step 1: Failing Vitest** — assert `parseFocusReportUrl(url)` on the real-shaped URL `https://mfprod-1.myfocuspos.com/ReportServer?/generalstorereports/revenuecenter&dbServer=mfaz-rep-1&dbCatalog=KAHALA2&UserID=sample.user&StoreID=15312&rs:Command=render` returns `{ baseUrl:'https://mfprod-1.myfocuspos.com', reportPath:'/ReportServer?/generalstorereports/revenuecenter', dbServer:'mfaz-rep-1', dbCatalog:'KAHALA2', userId:'sample.user', storeId:'15312' }`. Assert `null` for `https://evil.com/...`, for `http://...myfocuspos.com` (non-https), and for a URL missing `StoreID`.
- [ ] **Step 2: Run → fail.**
- [ ] **Step 3: Implement.** Use `new URL()`. Validate `protocol==='https:'`, `username===''`, `password===''`, hostname matches `/^([a-z0-9-]+\.)*myfocuspos\.com$/`. The SSRS path is the part of the search starting with `/` (the report catalog path) — preserve `/ReportServer?<catalogPath>`; extract `dbServer/dbCatalog/UserID/StoreID` from query params (case-insensitive keys). Return `null` if `StoreID` absent.
- [ ] **Step 4: Run → pass.**
- [ ] **Step 5: Commit** — `git commit -m "feat(focus): report URL parser"`

---

## Task 4: focusReportClient (URL build + SSRF guard + redirect-safe fetch)

**Files:** Create `supabase/functions/_shared/focusReportClient.ts`; Test `tests/unit/focusReportClient.test.ts`

- [ ] **Step 1: Failing Vitest** — `buildReportUrl(conn,'06/27/2026','06/27/2026')` produces a URL containing `StartDate=06%2F27%2F2026`, `EndDate=...`, `rs:Command=Render`, `rs:Format=HTML4.0`, and the stored `StoreID/dbServer/dbCatalog`. `assertAllowedHost`: accepts `https://mfprod-1.myfocuspos.com/...`; throws for `http://`, for `https://user:pw@mfprod-1.myfocuspos.com`, for `https://evil.myfocuspos.com.attacker.com`. `fetchReportHtml({fetch:mock})` follows a same-host 302 (re-validated) but throws when the 302 `Location` is `http://169.254.169.254/`. Mock `fetch` returns `{status:302, headers:{get:(k)=>k==='location'?loc:null}}` then `{status:200,text:()=>html}`.
- [ ] **Step 2: Run → fail.**
- [ ] **Step 3: Implement.** `buildReportUrl` uses `new URL(reportPath, baseUrl)` then `searchParams.set(...)`; date format `MM/DD/YYYY`. `assertAllowedHost(u)` per design §5/S1. `fetchReportHtml(deps,url)` loops with `redirect:'manual'`, max 5 hops, `assertAllowedHost` on each `Location`, `AbortSignal.timeout(20000)` per hop, returns body text. Inject `deps.fetch`.
- [ ] **Step 4: Run → pass.** **Step 5: Commit** — `git commit -m "feat(focus): report client (url build + SSRF-safe fetch)"`

---

## Task 5: focusReportParser (HTML → structured day)

**Files:** Create `supabase/functions/_shared/focusReportParser.ts`; Create fixture `tests/fixtures/focus-revenue-center-sample.html` (SYNTHETIC — invent a "Sample Creamery" store, items like "Item A/B/C", round numbers; NO real names/IDs/figures per lesson 2026-06-22); Test `tests/unit/focusReportParser.test.ts`

- [ ] **Step 1: Build the synthetic fixture** mirroring the SSRS HTML4.0 table structure (a report `<table>` whose rows carry a label cell + numeric cells: per-item rows, then `Net Sales`, `Total Tax`, `Subtotal Discounts`, `Retained Tips`, `Refunds`, `Total Sales`, tender rows `Cash/Visa/MC`, order-type rows `Eat In`). Keep it small but structurally faithful.
- [ ] **Step 2: Failing Vitest** — `parseRevenueCenterReport(html,'2026-06-27')` returns `{ok:true, data:{ businessDate, items:[{name,units,sales,revenueCenter}], totals:{netSales,totalTax,subtotalDiscounts,retainedTips,refunds,totalSales,totalPayments}, payments:[{tender,amount}], orderTypes:[{type,amount}] }}`. Assert each parsed value matches the fixture. Assert an empty-report fixture → `{ok:false, reason:'empty'}`; a garbage string → `{ok:false, reason:'parse_error'}`.
- [ ] **Step 3: Run → fail.**
- [ ] **Step 4: Implement** using `deno-dom` (`import { DOMParser } from 'https://deno.land/x/deno_dom/deno-dom-wasm.ts'`) or a tolerant regex/row scanner over `<tr>/<td>`. Named extractors (`extractItems`, `extractTotalsRow(label)`, `extractTenders`, `extractOrderTypes`) + an "ASSUMED MARKUP" comment block. Detect empty (no item rows AND zero totals) vs parse_error (no recognizable report table).
- [ ] **Step 5: Run → pass.** **Step 6: Commit** — `git commit -m "feat(focus): revenue center HTML parser + synthetic fixture"`

---

## Task 6: focusSyncHandler (fetch → parse → upsert daily report)

**Files:** Create `supabase/functions/_shared/focusSyncHandler.ts`; Test `tests/unit/focusSyncHandler.test.ts`

- [ ] **Step 1: Failing Vitest** — `processReportDay(deps, conn, '2026-06-27')` with `deps={fetch, supabase}` (mocked): builds the URL, fetches, parses, and calls `supabase.from('focus_daily_reports').upsert(...)` with the parsed totals + jsonb arrays, conflict `restaurant_id,business_date,revenue_center`. On `{ok:false,reason:'parse_error'}` it returns `{status:'error'}` and does NOT upsert. On `empty` it upserts a zeroed row and returns `{status:'empty'}`.
- [ ] **Step 2: Run → fail.** **Step 3: Implement** (inject deps; reuse client + parser). **Step 4: Run → pass.** **Step 5: Commit** — `git commit -m "feat(focus): daily report sync handler"`

---

## Task 7: edge fn focus-save-connection

**Files:** Create `supabase/functions/_shared/focusSaveConnectionHandler.ts`, `supabase/functions/focus-save-connection/index.ts`; Modify `supabase/config.toml`; Test `tests/unit/focusSaveConnectionHandler.test.ts`

- [ ] **Step 1: Failing Vitest** — `handleSaveConnection(req, deps)` with a valid JWT (mock `userClient.auth.getUser` → user; role owner) and body `{restaurantId, reportUrl}`: parses+validates URL (reuse `parseFocusReportUrl`), rejects an invalid URL with 400, rejects a non-owner/manager with 403, rejects a host failing `assertAllowedHost` with 400, and on success upserts `focus_connections` via the **service-role client** (`deps.serviceClient`) returning 200. Mirror the Toast `toast-save-credentials` auth structure.
- [ ] **Step 2–4: fail → implement → pass.** index.ts thin (CORS, build deps, serve). Add `[functions.focus-save-connection]\nverify_jwt = false` to `config.toml`.
- [ ] **Step 5: Commit** — `git commit -m "feat(focus): focus-save-connection edge function"`

---

## Task 8: edge fn focus-test-connection

**Files:** Create `_shared/focusTestConnectionHandler.ts`, `focus-test-connection/index.ts`; Modify `config.toml`; Test `tests/unit/focusTestConnectionHandler.test.ts`

- [ ] **Step 1: Failing Vitest** — `handleTestConnection(req, deps)`: JWT+role check; fetch yesterday's report (in the connection's `timezone`); parser `ok:true` OR `reason:'empty'` → set `connection_status='connected'`; `parse_error`/HTTP-error → `connection_status='error'` + `last_error`. Returns the status. Uses service-role client for the status write.
- [ ] **Step 2–4: fail → implement → pass.** config.toml entry.
- [ ] **Step 5: Commit** — `git commit -m "feat(focus): focus-test-connection edge function"`

---

## Task 9: edge fn focus-sync-data (manual)

**Files:** Create `_shared/focusSyncDataHandler.ts`, `focus-sync-data/index.ts`; Modify `config.toml`; Test `tests/unit/focusSyncDataHandler.test.ts`

- [ ] **Step 1: Failing Vitest** — `handleSyncData(req, deps)`: JWT+role; loads connection (service client). If `initial_sync_done=false` → compute date = (today_in_tz − sync_cursor − 1), `processReportDay`, increment `sync_cursor`; at `sync_cursor>=90` set `initial_sync_done=true`. Else → process the last 2 business days. Update `last_sync_time`. Returns `{syncCursor, initialSyncDone, status}`. Assert cursor advances and the tz-correct date is requested.
- [ ] **Step 2–4: fail → implement → pass.** config.toml entry.
- [ ] **Step 5: Commit** — `git commit -m "feat(focus): focus-sync-data edge function"`

---

## Task 10: edge fn focus-bulk-sync (cron)

**Files:** Create `_shared/focusBulkSyncHandler.ts`, `focus-bulk-sync/index.ts`; Modify `config.toml`; Test `tests/unit/focusBulkSyncHandler.test.ts`

- [ ] **Step 1: Failing Vitest** — `handleBulkSync(req, deps)`: rejects a request without `Bearer <SERVICE_ROLE_KEY>` (timing-safe compare) → 401. With it: selects active connections `ORDER BY last_sync_time ASC NULLS FIRST LIMIT 5`, processes each (one cursor day if backfilling else last 2 days), 2s delay between (injectable `deps.sleep`), wall-clock budget guard (`deps.now`, break > 90s). Assert ≤5 processed and the Bearer gate.
- [ ] **Step 2–4: fail → implement → pass.** config.toml entry.
- [ ] **Step 5: Commit** — `git commit -m "feat(focus): focus-bulk-sync cron edge function"`

---

## Task 11: cron migration

**Files:** Create `supabase/migrations/<ts3>_focus_cron.sql`; Test `supabase/tests/42_focus_cron.sql`

- [ ] **Step 1: Failing pgTAP** — assert `cron.job` has rows named `focus-bulk-sync` and `focus-unified-sales-sync` (query `cron.job` by `jobname`).
- [ ] **Step 2: Run → fail.**
- [ ] **Step 3: Migration** — mirror `20260127000000_toast_sync_improvements.sql`: `cron.schedule('focus-bulk-sync','30 1,7,13,19 * * *', $$ SELECT net.http_post(url:=...||'/functions/v1/focus-bulk-sync', headers:=jsonb_build_object('Authorization','Bearer '||current_setting('app.settings.service_role_key')), body:='{}'::jsonb); $$);` (offset from Toast's `0 3,9,15,21`) and `cron.schedule('focus-unified-sales-sync','*/5 * * * *', $$ SELECT sync_all_focus_to_unified_sales(); $$);`. Guard with `cron.unschedule` if exists.
- [ ] **Step 4: Run → pass. Step 5: Commit** — `git commit -m "feat(focus): pg_cron schedules"`

---

## Task 12: useFocusConnection hook

**Files:** Create `src/hooks/useFocusConnection.tsx`; Test `tests/unit/useFocusConnection.test.tsx`

- [ ] **Step 1: Failing Vitest** (mirror `tests/unit/useToastConnection.test.tsx`): mock `@/integrations/supabase/client`. Test `saveConnection(restaurantId, reportUrl)` → invokes `focus-save-connection`; `testConnection`, `disconnect` (sets `is_active=false`), `triggerManualSync` → `focus-sync-data`. For each invoke, test **both** error paths: `mockRejectedValueOnce(new Error())` AND `mockResolvedValueOnce({data:null,error:{message:'500'}})` (lesson 2026-05-16). Assert the query uses `maybeSingle()` and an explicit column list.
- [ ] **Step 2: Run → fail.**
- [ ] **Step 3: Implement.** `useFocusConnection(restaurantId?: string|null)`. `useQuery({queryKey:['focus-connection',restaurantId], queryFn, enabled:!!restaurantId, staleTime:30000, refetchOnWindowFocus:false, refetchOnMount:true})`; queryFn selects explicit fields with `.maybeSingle()`. Mutations close over `restaurantId`. Both invoke-error shapes handled.
- [ ] **Step 4: Run → pass. Step 5: Commit** — `git commit -m "feat(focus): useFocusConnection hook"`

---

## Task 13: FocusSetupWizard + FocusSync + FOCUS_CONFIG

**Files:** Create `src/components/pos/FocusSetupWizard.tsx`, `src/components/FocusSync.tsx`; Modify `src/components/pos/SyncComponents.tsx`; Test `tests/unit/focusSetupWizard.test.tsx`

- [ ] **Step 1: SyncComponents changes (TDD light).** Add optional `recentWindowLabel?: string` to `POSConfig`; update the two hardcoded `'25 hours'` strings (`getSyncDescription`, `SyncModeSelector`) to `config.recentWindowLabel ?? 'last 25 hours'`. Export `FOCUS_CONFIG = {name:'Focus POS', dataLabel:'daily reports', dataLabelSingular:'daily report', syncInterval:'6 hours', recentWindowLabel:'last 2 business days'}`. Run existing `SyncComponents` consumers' tests → still green.
- [ ] **Step 2: Failing Vitest for the wizard** — renders step 1 (instructions + informational `Alert`); entering an invalid URL and clicking Verify shows an inline error with `aria-invalid` on the input; a valid URL advances to a confirmation sub-state showing detected `storeId`/`dbCatalog`; "Save & Connect" calls `saveConnection` then `testConnection`; a failed test keeps step 2 with the URL retained (does not reach Done). Use `getByRole`/`getByLabelText`.
- [ ] **Step 3: Run → fail.**
- [ ] **Step 4: Implement** per design §10 + F1–F8: own `DialogContent`+`DialogHeader`+`DialogTitle`+`DialogDescription`; URL `<input id="focus-report-url">`+`<Label htmlFor>`; client preview via `parseFocusReportUrl`; `aria-invalid`+`aria-describedby`; sticky footer; CLAUDE.md tokens/typography. `FocusSync.tsx`: early-return not-connected guard; reuse `SyncComponents` with `FOCUS_CONFIG`; backfill progress via `InitialSyncPendingAlert` `syncCursor`; one-day-per-call (no `nextPage`).
- [ ] **Step 5: Run → pass. Step 6: Commit** — `git commit -m "feat(focus): setup wizard + sync dashboard + FOCUS_CONFIG"`

---

## Task 14: Register the provider

**Files:** Modify `src/pages/Integrations.tsx`, `src/components/IntegrationCard.tsx`, `src/components/IntegrationLogo.tsx`

- [ ] **Step 1:** `IntegrationLogo.tsx` — add `emojiMap['focus-pos'] = '🍦'`.
- [ ] **Step 2:** `Integrations.tsx` — `const focus = useFocusConnection(selectedRestaurant?.restaurant_id || null)`; add `{ id:'focus-pos', name:'Focus POS', description:'Sync daily sales from Focus POS', category:'POS', connected: focus.isConnected }` to the `integrations` array; **add `focus.isConnected` to the `useMemo` dependency array**.
- [ ] **Step 3:** `IntegrationCard.tsx` — add the 8 Toast-parity touch points (F6): `const [showFocusSetup,setShowFocusSetup]=useState(false)`; `const focusConnection=useFocusConnection(restaurantId)`; `const isFocusIntegration = integration.id==='focus-pos'`; branches in `getActuallyConnected`, `getActuallyConnecting`, `handleConnect` (→ `setShowFocusSetup(true)`), `handleDisconnect` (→ `focusConnection.disconnect(restaurantId)`); render `<FocusSync restaurantId={restaurantId} />` in the connected branch under `isFocusIntegration`; render `<Dialog open={showFocusSetup} onOpenChange={setShowFocusSetup}><FocusSetupWizard .../></Dialog>`.
- [ ] **Step 4: Verify** — `npm run test && npm run typecheck && npm run lint && npm run build` all green.
- [ ] **Step 5: Commit** — `git commit -m "feat(focus): register Focus POS in integrations UI"`

---

## Self-review notes (author)

- **Spec coverage:** Tasks map to design §5–§10 and resolutions S1–S9 / F1–F8. SSRF (S1) → Task 4; rename/orphan (S2) → Task 2 test + RPC; service-role writes (S3) → Tasks 7–10; timezone (S4) → Tasks 1,8,9; cron LIMIT 5 (S5) → Tasks 2,10,11; handler auth (S6) → Tasks 7,8; named unique (S7) → Task 1; parser result union (S9) → Task 5. Frontend F1–F8 → Tasks 12–14.
- **Build-time validations (design §14):** confirm exact `StartDate`/`EndDate` URL param names in Task 4 (one dated request) and the "select all" revenue-center encoding; prefer a stable item code in Task 5 if present. Isolated in client/parser modules.
- **No real PII** in the Task 5 fixture or any test (lesson 2026-06-22).
