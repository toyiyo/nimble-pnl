# Focus POS Integration — Design

**Date:** 2026-06-24
**Author:** Claude (Opus 4.8) via `/dev`
**Status:** Draft for approval
**Branch:** `feature/focus-pos-integration`

## 1. Overview

Add a **Focus POS** integration that pulls a restaurant's daily sales (checks,
line items, payments) into EasyShiftHQ and normalizes them into `unified_sales`
for P&L — mirroring the existing **Toast** integration. Focus POS (a **Shift4**
product) offers **no webhooks**, so this is a **poll-based** integration using
the same day-by-day backfill + scheduled-sync architecture as Toast.

### Goals

- Connect a restaurant to Focus by entering its **storeKey** (after an onboarding
  email to Focus/Shift4 support).
- Pull sales via the FocusLink **datafeed** endpoint, one business day per call.
- Persist raw Focus data in `focus_*` tables and normalize into `unified_sales`
  using the same **gross + offset** model as Toast (tax/tip/discount/void/refund).
- Backfill 90 days on first connect, then keep current via a pg_cron bulk sync.

### Non-goals (v1)

- Menu catalog ingestion (`/pos/menus`) — fast-follow.
- Labor / employee / timecard ingestion from the datafeed — overlaps with existing
  scheduling/labor systems; out of scope.
- Pushing orders **into** Focus (`POST /pos/orders/send`) — not needed.
- Live sandbox verification — deferred until integrator credentials are obtained
  (build + test against mocks now).

## 2. Background: the Focus POS / FocusLink API

Confirmed from Focus/Shift4 help docs (help.focusca.com) and the public API surface:

| Aspect | Detail |
| --- | --- |
| **Pull endpoint** | `GET {baseUrl}/stores/{storeKey}/datafeed?date=YYYY-MM-DD` |
| **Granularity** | **One business day per call.** No date range, no pagination — each call returns the full day's database extract. |
| **Format** | JSON or XML, same fields. We use **JSON** (`Accept: application/json`) — native Deno parsing. |
| **Base URL (prod)** | `https://focuslink.focuspos.com/v2` |
| **Base URL (sandbox)** | Separate URL issued at certification (env-configured). |
| **Auth** | **HTTP Basic Auth.** Integrator **API Key** = username, **API Secret** = password. (HMAC auth is deprecated.) |
| **Integrator license** | **One** API Key/Secret held by EasyShiftHQ, valid across all enrolled stores. |
| **storeKey** | 4–6 digit identifier, **unique per restaurant**. |
| **Datafeed contents** | config, menu, employee/labor, **sales (checks + item details + payments)**, summaries. We consume only the **sales** sections. |
| **Webhooks** | None — poll only. |

**Unknown:** the exact field-level JSON shape of the datafeed (checks/items/
payments property names) lives in a download we can't reach without a license.
See §10 for how we isolate this risk.

## 3. Key decisions

From the brainstorming Q&A:

1. **Credentials — platform-level.** The integrator **API Key/Secret** are stored
   as **Supabase edge-function secrets** (`FOCUS_API_KEY`, `FOCUS_API_SECRET`),
   not per restaurant. A `focus_connections` row holds only the per-restaurant
   **storeKey**, **MID** (merchant id, for support/reconciliation), and
   **environment** (sandbox/production). **No per-restaurant encrypted secret** —
   simpler than Toast, and matches Focus's documented "one integrator license,
   many storeKeys" model.

2. **Scope — sales only.** Checks → `focus_orders`/`focus_order_items`/
   `focus_payments` → `unified_sales`. Exact P&L parity with Toast.

3. **Testing — mocks now.** Build the full integration with unit + pgTAP tests
   against a **mock datafeed JSON fixture**. Field extraction is isolated in one
   module so the real schema can be slotted in later with no structural change.

4. **Onboarding copy.** The setup wizard instructs the operator to email
   **fcesupport@shift4.com** with **Name, MID, Contact, and "EasyShiftHQ"** as the
   integration, then enter the returned **storeKey** (+ MID, environment) into the
   per-location form.

> **Credential-model note for reviewer:** the per-restaurant form collects the
> **storeKey** (the operator's per-location credential) and **MID**; the Basic-Auth
> API Key/Secret remain platform secrets. If it turns out Shift4 issues a distinct
> API key/secret *per merchant*, we'd add an optional encrypted per-connection
> override (falling back to the platform secret). v1 assumes the documented
> single-integrator-license model. Flagged for confirmation.

## 4. Architecture

```
Restaurant operator
   │  (enters storeKey + MID + environment)
   ▼
FocusSetupWizard ──► focus-save-connection ──► focus_connections
                          │
                          ▼
                     focus-test-connection ──► GET /datafeed?date=<yesterday>  (Basic Auth, platform creds)
                                                    │ 200 ⇒ connection_status='connected'
   pg_cron (6h) ──► focus-bulk-sync ──┐
   user "Sync now" ──► focus-sync-data ┤
                                       ▼
                         _shared/focusDatafeed.ts   (build URL + Basic Auth header, fetch one day JSON)
                                       ▼
                         _shared/focusOrderProcessor.ts   (extract checks/items/payments → upsert focus_* tables)
                                       ▼
                         focus_orders / focus_order_items / focus_payments
                                       ▼
   pg_cron (5min) ──► sync_all_focus_to_unified_sales() ──► sync_focus_to_unified_sales(rid[,start,end])
                                       ▼
                                  unified_sales   (pos_system='focus', gross + offsets)
                                       ▼
                               existing P&L / dashboards (unchanged)
```

All edge functions follow the codebase's **split pattern**: a thin Deno `index.ts`
(env reads, `createClient`, `serve`) + a pure `_shared/<name>Handler.ts` with
injected deps, so Vitest covers the logic and SonarCloud new-code coverage stays
≥80% (per lessons 2026-05-07).

## 5. Data model

New migration `supabase/migrations/<ts>_focus_integration.sql`. Tables mirror the
Toast shape (shape is stable even though Focus field *names* differ).

### `focus_connections`
| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid PK | `gen_random_uuid()` |
| `restaurant_id` | uuid NOT NULL | FK → `restaurants(id) ON DELETE CASCADE` |
| `store_key` | text NOT NULL | 4–6 digit, stored as text (preserve leading zeros) |
| `mid` | text | merchant id, optional, for support |
| `environment` | text NOT NULL DEFAULT `'production'` | CHECK in (`sandbox`,`production`) |
| `last_sync_time` | timestamptz | incremental window anchor |
| `initial_sync_done` | boolean DEFAULT false | true once 90-day backfill completes |
| `sync_cursor` | integer DEFAULT 0 | days completed in initial backfill |
| `is_active` | boolean DEFAULT true | |
| `connection_status` | text DEFAULT `'pending'` | CHECK in (`pending`,`connected`,`error`,`disconnected`) |
| `last_error` / `last_error_at` | text / timestamptz | |
| `created_at` / `updated_at` | timestamptz | `updated_at` via trigger |
| | | **UNIQUE(restaurant_id)**; indexes on `restaurant_id`, partial `is_active` |

No `sync_page` column — a datafeed call returns a whole day in one document, so the
cursor is just **days completed** (simpler than Toast's order pagination).

### `focus_orders` (check headers)
`UNIQUE(restaurant_id, focus_check_guid)`. Columns: `focus_check_guid`, `store_key`,
`order_date` DATE, `order_time` TIME, `business_date` INTEGER (yyyymmdd),
`total_amount`, `tax_amount`, `tip_amount`, `discount_amount`,
`service_charge_amount`, `payment_status`, `order_type`, `dining_option`,
`raw_json` JSONB, timestamps.

### `focus_order_items`
`UNIQUE(restaurant_id, focus_item_guid, focus_check_guid)`. Columns: `name`,
`quantity`, `unit_price` (gross), `total_price` (net), `discount_amount` DEFAULT 0,
`is_voided` boolean DEFAULT false, `sales_category`, `raw_json` JSONB.

### `focus_payments`
`UNIQUE(restaurant_id, focus_payment_guid, focus_check_guid)`. Columns: `amount`,
`tip_amount`, `payment_type`, `payment_status`, `payment_date` DATE,
`refund_amount` DEFAULT 0, `refund_status`, `raw_json` JSONB. Index on
`(restaurant_id, payment_date)`.

**Amounts are stored as received (dollars).** A field-mapping comment block in the
processor documents the assumed currency unit; if the real feed is in cents, the
single extraction module is the only thing that changes.

### RLS
`SELECT` for any role in `user_restaurants` for the `restaurant_id`, plus a single
`FOR ALL` policy for `owner`/`manager` (INSERT/UPDATE/DELETE). Edge functions use the
**service-role client** for all write-backs (bypasses RLS). pgTAP pins the policies.
**See R1/R9 in §17** for the exact policy shape and the user-client/service-client
split that prevents the upsert-blocked-by-missing-UPDATE-policy footgun.

## 6. `unified_sales` normalization

New RPCs (mirroring Toast, `pos_system='focus'`):

- `sync_focus_to_unified_sales(p_restaurant_id uuid) → integer`
- `sync_focus_to_unified_sales(p_restaurant_id uuid, p_start_date date, p_end_date date) → integer`
- `sync_all_focus_to_unified_sales() → table(restaurant_id uuid, orders_synced integer)` (5-min cron)

**Row model (gross + offset), identical contract to Toast:**

| `item_type` | `adjustment_type` | Source | Amount |
| --- | --- | --- | --- |
| `sale` | NULL | non-voided items | gross line total (positive) |
| `discount` | `discount` | items w/ `discount_amount > 0` | `-discount_amount` |
| `discount` | `void` | voided items | `-unit_price` |
| `tax` | `tax` | order `tax_amount ≠ 0` | positive |
| `tip` | `tip` | payments `tip_amount ≠ 0`, not denied/voided | positive |
| `refund` | NULL | payments w/ refund | negative |

Discipline carried over from lessons:
- **Pass-through allow-list** (lesson 2026-05-03): only `tax/tip/discount/void`
  adjustment types are written; downstream P&L aggregations already allow-list these.
- **GUC trigger bypass** `app.skip_unified_sales_triggers='true'` during bulk
  upserts, then batch-categorize + per-date aggregation (lesson 2026-02-15 / Toast
  `20260215200000`). `statement_timeout` raised on the function.
- **`ON CONFLICT … DO UPDATE`** preserves `category_id`/`is_categorized`.
- **Stale-row cleanup** before upserts: delete sale/tax/discount/tip rows that no
  longer apply (item later voided, tax dropped to 0, payment voided).

## 7. Edge functions

`supabase/config.toml`: each gets `verify_jwt = false` and does its **own** auth.

| Function | Trigger | Auth | Purpose |
| --- | --- | --- | --- |
| `focus-save-connection` | user POST | JWT → `getUser()` + `owner/manager` role check | upsert storeKey/MID/environment |
| `focus-test-connection` | user POST | same | one datafeed call (yesterday) → set `connection_status` |
| `focus-sync-data` | user POST | same (RLS-checked read + service-role row fetch) | manual sync: initial cursor day or incremental |
| `focus-bulk-sync` | **cron** | **constant-time `Bearer SUPABASE_SERVICE_ROLE_KEY`** check | round-robin sync of active connections |

**Security (lessons 2026-05-07):** `focus-bulk-sync` is cron-only → it enforces a
timing-safe service-role Bearer comparison (it is *not* open just because
`verify_jwt=false`). All required envs (`FOCUS_API_KEY`, `FOCUS_API_SECRET`,
base URLs) are read once into consts and **fail fast (500)** if missing — no silent
production fallbacks.

**Shared modules:**
- `_shared/focusDatafeed.ts` — `buildDatafeedUrl(env, storeKey, date)`,
  `basicAuthHeader(key, secret)`, `fetchDatafeed(deps, …)` (injectable `fetch` +
  per-attempt `AbortSignal.timeout`, with a wall-clock budget guard around any
  multi-day loop, per lesson 2026-05-17).
- `_shared/focusOrderProcessor.ts` — `processDatafeed(supabase, datafeed,
  restaurantId, storeKey, { skipUnifiedSalesSync })`. **The single field-mapping
  module.** Extracts checks/items/payments via small named helpers
  (`extractChecks`, `extractItems`, `extractPayments`) with a documented
  assumed-field-path comment block.

## 8. Sync orchestration

- **Initial backfill:** `initial_sync_done=false` → process **one business day per
  invocation**, advancing `sync_cursor` from 0…90 (`TARGET_DAYS=90`,
  configurable). `skipUnifiedSalesSync=true` during backfill; `unified_sales` is
  reconciled by the 5-min cron. At `sync_cursor ≥ 90` → `initial_sync_done=true`.
- **Incremental:** `initial_sync_done=true` → re-fetch the last **2 business days**
  (today + yesterday) to catch late-closed checks; idempotent upserts dedupe.
- **`focus-bulk-sync` cron loop:** `ORDER BY last_sync_time ASC NULLS FIRST LIMIT 5`
  (round-robin), 2s delay between restaurants, one day (initial) or two days
  (incremental) per restaurant per run, wall-clock budget guard so the function
  always returns a structured response within the edge limit.

## 9. Frontend

- **`src/hooks/useFocusConnection.tsx`** — React Query hook (`staleTime: 30000`),
  `enabled: !!restaurantId`. Exposes `isConnected`, `connection`,
  `saveConnection(storeKey, mid, environment)`, `testConnection()`, `disconnect()`,
  `triggerManualSync(opts?)`. Each `supabase.functions.invoke` call is tested for
  both transport-reject and resolved-`{error}` paths (lesson 2026-05-16).
- **`src/components/pos/FocusSetupWizard.tsx`** — Apple/Notion-styled `Dialog`:
  1. **Get credentials** — instructions to email **fcesupport@shift4.com** (Name,
     MID, Contact, "EasyShiftHQ").
  2. **Enter store details** — `storeKey` (required), `mid`, `environment`
     (sandbox/production) → `saveConnection()` + `testConnection()`.
  3. **Done** — success + link to "Sync now".
  Three-state rendering, `aria-label`s, semantic tokens, `DialogDescription` for
  `aria-describedby`.
- **`src/components/FocusSync.tsx`** — reuses shared `SyncComponents.tsx`; add
  `FOCUS_CONFIG: POSConfig = { name: 'Focus POS', dataLabel: 'orders',
  dataLabelSingular: 'order', syncInterval: '6 hours' }`.
- **Registration** (the distributed provider registry):
  `src/pages/Integrations.tsx` (add `focus-pos` entry + `useFocusConnection`),
  `src/components/IntegrationCard.tsx` (branches + `<FocusSetupWizard>`/`<FocusSync>`),
  `src/components/IntegrationLogo.tsx` (logo/emoji).

## 10. Mocking & the unknown JSON schema

The datafeed's exact field names are unknown until we have a license, so:

1. **`tests/fixtures/focus-datafeed-sample.json`** — a documented, plausible
   one-day datafeed (a few checks, items, payments, including a void, a discount,
   a tip, and a refund) used by all processor/RPC tests.
2. **All field access is confined to `_shared/focusOrderProcessor.ts`**, behind
   named extractor helpers + an "ASSUMED FIELD PATHS" comment block. Table schemas
   and the `unified_sales` RPC are **shape-stable** and never need to change when
   the real schema arrives — only the extractor body does.
3. The processor tolerates missing/None sections (config/menu/labor) and never
   throws on absent optional fields.
4. The fetch **query date** (`?date=`) is passed to the processor as the
   authoritative business date (R3), and a stable **per-line** item key is derived
   even if `focus_item_guid` turns out to be a reused menu-catalog id (R12). The
   fixture includes both a unique-per-line and a reused-GUID case.

## 11. Configuration & secrets

- `supabase/config.toml`: add `[functions.focus-*] verify_jwt = false` (×4).
- New edge secrets: `FOCUS_API_KEY`, `FOCUS_API_SECRET`,
  `FOCUS_BASE_URL_PRODUCTION` (default `https://focuslink.focuspos.com/v2`),
  `FOCUS_BASE_URL_SANDBOX`.
- New pg_cron jobs (pg_cron + pg_net), schedules **offset from Toast** to spread
  load: `focus-bulk-sync` every 6h, `focus-unified-sales-sync` every 5 min.
- `sonar-project.properties` / `vitest.config.ts` excludes stay aligned
  (lesson 2026-05-16) for any new thin `index.ts` entry files.

## 12. Testing strategy

| Layer | Tests |
| --- | --- |
| Unit (Vitest) | `focusOrderProcessor` (fixture → asserts upserts incl. void/discount/tip/refund; multi-check fixture per lesson 2026-06-22), `focusDatafeed` (URL build + Basic Auth header + env fail-fast), `useFocusConnection` (both invoke error paths) |
| pgTAP | `sync_focus_to_unified_sales` (gross + offset rows, pass-through allow-list, stale cleanup, auth), `focus_connections` RLS, signature/idempotency |
| Build/typecheck/lint | full Phase-8 gate |

Branch coverage: count branches in any toast-style string composition and write
≥2 assertions/branch (lesson 2026-06-19) to keep SonarCloud ≥80%.

## 13. Security

- No per-restaurant secrets stored; platform Basic-Auth creds live only in edge env.
- Cron function gated by timing-safe service-role compare.
- `restaurant_id`-scoped RLS on all `focus_*` tables; every RPC `restaurant_id`-scoped.
- 5xx returns are generic; real errors logged server-side (lesson 2026-04-22).
- No prod PII (real names/MIDs/storeKeys/UUIDs) in committed docs, fixtures, or
  tests — placeholders only (`store-1234`, "Sample Restaurant") (lesson 2026-06-22).

## 14. Decided trade-offs / out of scope

- **One integrator license** assumed (see §3 note). Per-merchant secret override
  is a documented future extension, not built now.
- **90-day backfill = 90 calls/store**, one day per invocation — slower than Toast's
  order pagination but simpler and within CPU limits. Acceptable.
- **Menu/labor ingestion** deferred.
- **No live verification** until sandbox creds exist; mock-driven build.

## 15. File manifest

**New:** migration `_focus_integration.sql`; `_shared/focusDatafeed.ts`,
`_shared/focusOrderProcessor.ts`; edge fns `focus-save-connection`,
`focus-test-connection`, `focus-sync-data`, `focus-bulk-sync` (each
`index.ts` + handler); `src/hooks/useFocusConnection.tsx`;
`src/components/pos/FocusSetupWizard.tsx`; `src/components/FocusSync.tsx`;
fixtures + unit tests + pgTAP tests; `public/logos/focus.png` (placeholder).

**Modified:** `supabase/config.toml`; `src/pages/Integrations.tsx`;
`src/components/IntegrationCard.tsx`; `src/components/IntegrationLogo.tsx`;
`src/components/pos/SyncComponents.tsx` (`FOCUS_CONFIG`); cron migration; Sonar/vitest excludes if needed.

## 16. Open questions

1. **Per-merchant secret?** Confirm Shift4 issues a single integrator key/secret
   (platform env) vs. per-merchant credentials (would need the encrypted-override
   path). Default: platform env (§3).
2. **storeKey format** — confirm always numeric 4–6 digits (stored as text either way).
3. **Logo asset** — v1 uses an **emoji fallback** (🖥️) in `IntegrationLogo` (no
   image file → no broken `<img>`); swap to a real `focus.png` when brand art is
   provided. (Resolved per design review — see §17.)

## 17. Design-review resolutions (Phase 2.5)

Both the Supabase and Frontend design reviewers ran against this doc. Accepted
refinements (folded into the contract the plan implements):

### Database / RLS / RPC (Supabase reviewer)

- **R1 (critical) — RLS as a single `FOR ALL` policy + service-role write-backs.**
  `focus_connections` gets a `FOR SELECT` policy (any role in `user_restaurants`)
  **and** a single `FOR ALL` policy for `owner`/`manager` (covering
  INSERT/UPDATE/DELETE) — never split INSERT/SELECT without UPDATE, or upserts and
  the frontend `disconnect` (sets `is_active=false`) break. **All edge-function
  write-backs** (`connection_status`, `last_sync_time`, `sync_cursor`,
  `initial_sync_done`, `last_error`) go through the **service-role client**
  (RLS-bypassing), exactly like the Toast functions — so `focus-test-connection`'s
  status update never depends on the caller's UPDATE grant. The `FOR ALL` policy
  exists for direct frontend writes (disconnect). Same `FOR SELECT`/`FOR ALL` pair
  on `focus_orders`/`focus_order_items`/`focus_payments` (SELECT any role; writes
  service-role only). pgTAP pins all policies.
- **R2 (critical) — bound the 5-min aggregation cron.**
  `sync_all_focus_to_unified_sales()` loops `WHERE is_active … ORDER BY
  last_sync_time ASC NULLS FIRST LIMIT 10` (the Toast equivalent lacks this LIMIT —
  we fix the latent bug here rather than copy it).
- **R3 (major) — authoritative business date from the query param.**
  `processDatafeed(... , businessDate)` receives the **`?date=YYYY-MM-DD` value used
  to fetch the day** as a first-class argument and uses it as `business_date`
  (yyyymmdd int) and `order_date` DATE — never a UTC-converted timestamp inside the
  JSON (avoids the Toast `closedDate.toISOString()` midnight-drift class of bug).
  Time-of-day, if needed, comes from the payload but the **date** is the query day.
- **R4 (major) — composite item identity in `unified_sales`.**
  `external_item_id` for sale/discount/void rows is `focus_check_guid || '_' ||
  focus_item_guid` (+ the `_discount`/`_void` suffixes), so a void/stale-cleanup
  DELETE can never match the same menu item on a different check. Stale-cleanup
  joins on the composite, not the bare item GUID.
- **R5 (major) — RPC hardening.** Both `sync_focus_to_unified_sales` overloads and
  `sync_all_focus_to_unified_sales` are `SECURITY DEFINER` with
  `SET search_path = public` and `SET statement_timeout = '120s'`. The
  `set_updated_at` trigger function likewise pins `SET search_path = public`.
- **R6 (major) — refund reads the first-class column.** The `refund` rows come from
  `focus_payments WHERE refund_amount > 0` (negative amount), not from `raw_json`.
- **R7 (major/minor) — indexes.** Add: partial `(last_sync_time ASC NULLS FIRST)
  WHERE is_active` (round-robin sort), `(restaurant_id, order_date DESC)` on
  `focus_orders`, `(restaurant_id, payment_date)` and `(restaurant_id,
  payment_status)` on `focus_payments`.
- **R8 (minor) — schema hardening.** `is_voided boolean NOT NULL DEFAULT false`
  (NULL would dodge the `= true` cleanup filter). `mid` gets a `COMMENT` documenting
  the expected numeric format (no hard CHECK — operators paste varied formats).
- **R9 (minor) — two clients in `focus-sync-data`.** `userClient` (JWT) for the
  auth/role check + RLS-scoped connection read; `serviceClient` for **all** writes
  to `focus_*`. Listed explicitly so the implementer doesn't write through the JWT
  client (which only has SELECT).
- **R10 (minor) — config.toml.** Four explicit named stanzas:
  `[functions.focus-save-connection]`, `[functions.focus-test-connection]`,
  `[functions.focus-sync-data]`, `[functions.focus-bulk-sync]`, each
  `verify_jwt = false`.
- **R11 (trade-off) — 5-min cron stays SQL-level** (like Toast) with the LIMIT from
  R2. If restaurant count grows enough to pressure DB connections, convert it to a
  pg_net HTTP call to a `focus-aggregate` edge function (noted, not built in v1).

### Unknown-schema note (folded into §10)

- **R12 — `focus_item_guid` may be a menu-catalog id, not a per-line id.** If the
  feed reuses one GUID for the same menu item across checks, the per-item unique
  key must include a line sequence (`focus_line_number`) — the fixture covers both
  shapes, and `external_item_id` already composites the check GUID (R4) so
  normalization is safe either way. The processor extracts a stable per-line key.

### Frontend / hook / a11y (Frontend reviewer)

- **R13 (critical) — hook threads `restaurantId`.** `useFocusConnection(restaurantId?:
  string | null)`; every mutation (`saveConnection`, `testConnection`, `disconnect`,
  `triggerManualSync`) closes over that `restaurantId`. Query: `enabled:
  !!restaurantId`, `staleTime: 30000`, `refetchOnWindowFocus: false`,
  `refetchOnMount: true`; `maybeSingle()` read (avoids PGRST116). Instantiated
  unconditionally in `IntegrationCard` like the other providers — the `enabled`
  guard is the protection (we do **not** refactor the pre-existing all-providers
  pattern; out of scope).
- **R14 (critical) — wizard owns its dialog a11y.** `FocusSetupWizard` renders
  `DialogHeader > DialogTitle + DialogDescription` itself (Radix wires
  `aria-describedby`) — it does **not** delegate the accessible name to a `Card`
  subtitle (the gap present in `ToastSetupWizard`). Every input has `id` +
  `<Label htmlFor>` (`store-key`, `mid`, `environment`). `max-h-[80vh]` per CLAUDE.md.
- **R15 (major) — environment control.** A labeled shadcn `RadioGroup` with two
  options (Production default, Sandbox). Selecting **Sandbox** shows the amber
  warning panel (`bg-amber-500/10 border-amber-500/20`) so an operator can't
  silently point a live location at the test feed.
- **R16 (major) — partial-failure flow.** Step 2 runs `saveConnection()` then
  `testConnection()` under one `loading` boolean. If save succeeds but test fails:
  the row persists with `connection_status='error'`, the user stays on step 2, and
  a destructive inline error + toast explains the failure with a retry. Success
  advances to step 3.
- **R17 (major) — `FocusSync` is one-day-per-call, not paginated.** It must **not**
  copy `ToastSync.executeSyncLoop`'s `nextPage` cursor (Focus has no page cursor).
  Manual "Sync now" calls `focus-sync-data` once (advances `sync_cursor` by a day,
  or re-fetches the last 2 business days when `initial_sync_done`). Initial-backfill
  progress is shown via `InitialSyncPendingAlert`'s existing `syncCursor` prop
  (days completed / 90), not an order count.
- **R18 (major) — `POSConfig.recentWindowLabel`.** Add an optional
  `recentWindowLabel?: string` to `POSConfig`; `getSyncDescription` in
  `SyncComponents.tsx` uses it instead of the hardcoded "last 25 hours" string.
  `FOCUS_CONFIG = { name: 'Focus POS', dataLabel: 'orders', dataLabelSingular:
  'order', syncInterval: '6 hours', recentWindowLabel: 'last 2 business days' }`.
  Toast/Shift4/Sling keep current copy (label optional, defaults to existing text).
- **R19 (major/minor) — logo + alt text.** v1 adds `'focus-pos': '🖥️'` to
  `IntegrationLogo`'s `emojiMap` (no image map entry → no broken `<img>`). Give
  `IntegrationLogo` a small id→display-name lookup (or `altText` prop) so the image
  path, when a real `focus.png` lands, renders `alt="Focus POS logo"` not
  `alt="focus-pos logo"`.
- **R20 (minor) — registration completeness.** `Integrations.tsx` imports/calls
  `useFocusConnection` at page level and feeds `isConnected` into the `focus-pos`
  registry entry's `connected:` field; `IntegrationCard` renders `<FocusSync>` in
  the connected branch (`isFocusIntegration`) and `<FocusSetupWizard>` in a
  `Dialog` toggled by `showFocusSetup`; step-3 "Sync now" / "Go to dashboard"
  calls `onComplete()` (closes the dialog) — it does not navigate away mid-dialog.
- **R21 (minor) — mailto + icon a11y.** The support address is
  `<a href="mailto:fcesupport@shift4.com">`; any decorative `ExternalLink`/`Mail`
  icon gets `aria-hidden="true"`.
