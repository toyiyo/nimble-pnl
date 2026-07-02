# Focus POS (Shift4) Transaction Integration — Design

**Author:** Claude (Opus 4.8) via `/dev`
**Date:** 2026-07-01
**Branch:** `feat/focus-focuslink-datafeed`

## 1. Goal

Pull **item-level transactions** (checks → items → payments) from the real Focus POS
API into `unified_sales`, mirroring the Toast integration, so P&L / inventory /
recipes get order-level detail (not just daily aggregates).

This supersedes the earlier SSRS-scrape (#557) and the FocusLink-guess work: Shift4
confirmed the real API is the **Focus POS API** at `pos-api.focuspos.com`.

## 2. The API (verified end-to-end with live credentials)

| | |
| --- | --- |
| **Base URL** | `https://pos-api.focuspos.com` (production). Sandbox is a separate host issued at certification (env: `FOCUS_API_SANDBOX_URL`). |
| **Auth** | HTTP Basic — API **Key** = username, API **Secret** = password. Per restaurant **group**; stored per-connection, secret AES-GCM encrypted. |
| **Restaurant id** | A **GUID** (UUID) sent in the `focuspos-restaurant-id` **header**. Discovered via `GET /api/restaurants` → `items[].restaurant_guid`. Stored in `focus_connections.store_id`. |
| **Transactions** | Lynk "Legacy Datafeed": `POST /api/lynk/sync` body `{"pos_request":{"header":{"category":"LegacyDatafeed","type":"Request","request_id":"<uniq>"},"payload":{"business_date":"MM/DD/YYYY"}}}` + the GUID header → returns `pos_response…payload.blob_url` (a time-limited Azure SAS URL) → download that XML → parse. `/api/lynk/sync` returns the `blob_url` synchronously; async status polling (if ever needed) also goes to `/api/lynk/sync` with `category:"Status"`. |
| **Transport** | Deno's **native fetch** reaches `pos-api.focuspos.com` and `*.blob.core.windows.net` fine — **no** pgsql-http transport (that was only needed for the legacy IIS portal). |

The daily datafeed XML (`<DailyData>`) has a large `Configuration`/`Menuitems`
section plus `<Checks>` → `<Check>` (transactions) and `<DeleteRecord>` (voids).
Parsed shape is already implemented + validated (see §5).

## 3. Data model (Toast-style)

Reuses `focus_connections` (already migrated: `api_key`, `api_secret_encrypted`,
`store_id`=GUID, `mid`, `environment`). Adds three transaction tables:

**`focus_orders`** — one row per check.
`id`, `restaurant_id` FK, `business_date` date, `focus_check_id` text (CheckRecord/ID —
sequential per day), `opened_at_local`/`closed_at_local` text, `order_type_id`,
`revenue_center_id`, `guests` int, `total` numeric, `discount_total` numeric,
`taxable_sales` numeric, `created_at`, `updated_at`.
**UNIQUE (restaurant_id, business_date, focus_check_id).**

**`focus_order_items`** — line items (priced items + modifiers; **kitchen-comment
PII lines are skipped by the sync**, never stored).
`id`, `restaurant_id`, `business_date`, `focus_check_id`, `item_key` text,
`record_number` text (→ menu config), `item_code` text, `name` text,
`report_group_id` text (category), `price` numeric NULL, `parent_key` text,
`is_modifier` bool, `discount_amount` numeric.
**UNIQUE (restaurant_id, business_date, focus_check_id, item_key).**

**`focus_payments`**.
`id`, `restaurant_id`, `business_date`, `focus_check_id`, `payment_key` text,
`payment_id` text, `name` text (tender), `amount` numeric, `tip` numeric,
`card_last4` text.
**UNIQUE (restaurant_id, business_date, focus_check_id, payment_key).**

Indexes on `(restaurant_id, business_date)` for each. **RLS** mirrors
`focus_daily_reports`: SELECT for any `user_restaurants` member; `FOR ALL` for
owner/manager. Edge functions write via the service-role client (bypasses RLS).

**PII:** customer names/phones/addresses live only in online-order "Kitchen
Comment" item lines (`FlagsKitchenComment=Y`); the parser flags them and the sync
**does not persist them**. Card numbers are stored as last-4 only.

## 4. Sync flow (mirror Toast)

- **`focus-sync-data`** (user-triggered) and **`focus-bulk-sync`** (cron, round-robin,
  service-role Bearer): for a business day → `focusLynkClient.fetchDatafeed` →
  `parseFocusDatafeed` → upsert `focus_orders`/`items`/`payments` (skip kitchen
  comments) → `sync_focus_transactions_to_unified_sales`.
- Backfill: reuse `initial_sync_done` / `sync_cursor` (90-day, one business day per
  cron pass). Incremental: yesterday + today.
- Business date is passed to Lynk as `MM/DD/YYYY`; stored as `date`.

**`unified_sales` mapping** (new RPC, mirrors `sync_toast_to_unified_sales`):
`pos_system='focus'`, `external_order_id = 'focus-{store_id}-{YYYYMMDD}-{check_id}'`,
per-priced-item sale rows (category via `report_group_id`), plus tax / tip /
discount offset rows; zero-value offsets skipped; categorization + `is_categorized`
preserved across re-syncs; GUC trigger bypass during batch writes.

## 5. Already implemented (do not redo)

- `focus_connections` migration (`20260630120000_focus_focuslink_api.sql`): API columns.
- `focusSaveConnectionHandler.ts`: stores encrypted key/secret + GUID + env.
- **`focusDatafeedParser.ts`** — `parseFocusDatafeed(xml)` → `{checks[], deletedCheckIds[]}`;
  each check has `checkId, openedAt, closedAt, orderTypeId, revenueCenterId, guests,
  total, discountTotal, taxableSales, items[], payments[]`; items carry
  `isKitchenComment`/`isModifier`/`price`; payments carry `amount/tip/cardLast4`.
  9 Vitest tests + validated against the real 4.7 MB 06/29 datafeed (reconciles with
  the daily report: Σcheck totals = $974.80, tips = $81.58). Uses `fast-xml-parser`
  (in `package.json` + `supabase/functions/deno.json`).

## 6. Security

- SSRF guard on all outbound: **https + host `(sub.)focuspos.com` OR
  `(sub.)blob.core.windows.net`** (the datafeed blob host); no userinfo.
- API secret AES-GCM encrypted at rest; key stored plaintext (it is the Basic
  username). Never logged.
- JWT + owner/manager role gate on save/test/sync; service-role for writes (RLS
  bypass); constant-time Bearer check on the cron function.

## 7. Testing

- **pgTAP**: schema/RLS for the 3 tables; the `unified_sales` sync RPC (sale rows,
  offsets, external_order_id, categorization preservation).
- **Vitest**: `focusLynkClient` (URL/body/header/auth, blob download, error kinds,
  SSRF), sync handler (fetch→parse→upsert→unified_sales with a mocked datafeed),
  test-connection (`GET /api/restaurants` validation), wizard/hook.
- **Real-data verification**: source `focus-creds.env` (never echo) and run the full
  pipeline against the live 06/29 datafeed; assert reconciliation with the daily report.

## 8. Out of scope / follow-ups

- Menu-item config sync (`/api/events/menu_item`) for recipe/inventory mapping —
  later.
- Dropping the vestigial `focus_daily_reports` table + the legacy portal/SSRS/http
  modules once fully cut over.
