# Focus POS Transactions — Implementation Plan

**Design:** `docs/superpowers/specs/2026-07-01-focus-pos-transactions-design.md` (binding).
**Branch:** `feat/focus-focuslink-datafeed` (continue; do NOT commit to main).
**Discipline:** TDD every step (RED → GREEN → commit). Mirror the Toast integration
(`toast_orders/items/payments`, `toastOrderProcessor.ts`, `sync_toast_to_unified_sales`,
`toast-sync-data`, `toast-bulk-sync`, `ToastSetupWizard.tsx`, `useToastConnection.tsx`).

**Live verification:** `source "$FOCUS_CREDS_ENV_FILE"`
(vars `FOCUS_API_KEY`/`FOCUS_API_SECRET`/`FOCUS_RESTAURANT_GUID`) — **never echo/print/commit
the values**. Sanitized fixture: `tests/fixtures/focus-datafeed-sample.xml`. OpenAPI:
see `docs/superpowers/specs/2026-07-01-focus-pos-transactions-design.md` for API reference.

Reuse (already built, do not redo): `focus_connections` API-columns migration,
`focusSaveConnectionHandler.ts`, and `focusDatafeedParser.ts` (`parseFocusDatafeed`).

---

## Task 1 — Transaction tables migration + pgTAP

**Files:** `supabase/migrations/20260701120000_focus_transactions.sql`,
`supabase/tests/46_focus_transactions_schema.sql`.

- RED: pgTAP asserting `focus_orders`/`focus_order_items`/`focus_payments` exist with
  key columns, the named UNIQUE constraints (for ON CONFLICT), RLS enabled, and the
  SELECT (member) + FOR ALL (owner/manager) policies. `npm run test:db` → fail.
- GREEN: create the 3 tables per design §3 (FK→restaurants ON DELETE CASCADE, named
  UNIQUEs, `(restaurant_id, business_date)` indexes, `updated_at` trigger reuse,
  RLS policies mirroring the `focus_daily_reports` SELECT/FOR ALL pattern).
- Verify RED→GREEN on a throwaway DB (seed `restaurants` + `user_restaurants` stubs)
  like the earlier focus migrations were verified.

## Task 2 — Lynk datafeed client (`_shared/focusLynkClient.ts`)

**Files:** `supabase/functions/_shared/focusLynkClient.ts`, `tests/unit/focusLynkClient.test.ts`.

- RED first: tests for `buildLynkRequest`, `focusApiBaseUrl(environment,sandboxUrl)`,
  and `fetchDatafeed(deps,{baseUrl,guid,apiKey,apiSecret},businessDate)` →
  discriminated result `{ok,status,xml}` | `{ok:false,kind}`; kinds:
  `config|license|auth|not_found|http|network|inprogress|parse`.
- Behaviour: POST `{base}/api/lynk/sync` with Basic auth + `focuspos-restaurant-id`
  header + LegacyDatafeed body (business_date `MM/DD/YYYY`, unique request_id);
  extract `blob_url`; GET the blob (native fetch); return the XML string. On
  `error_condition:"InProgress"` → kind `inprogress` (caller retries next pass).
- SSRF guard: https + host `(sub.)focuspos.com` OR `(sub.)blob.core.windows.net`,
  no userinfo. Injectable `fetch`; native Deno fetch in the index.
- Verify against live data: `source` creds, fetch 06/29, assert XML parses to ≥58 checks.

## Task 3 — unified_sales RPC + pgTAP

**Files:** `supabase/migrations/20260701130000_focus_transactions_unified_sales.sql`,
`supabase/tests/47_focus_transactions_unified_sales.sql`.

- Mirror `sync_toast_to_unified_sales`: `sync_focus_transactions_to_unified_sales(restaurant_id[,date,date])`
  + an `_impl` + a `sync_all_focus_transactions_to_unified_sales()` cron wrapper.
- Map `focus_orders`/`focus_order_items` → `unified_sales`: `pos_system='focus'`,
  `external_order_id='focus-{store_id}-{YYYYMMDD}-{check_id}'`, per-priced-item sale
  rows (skip modifiers/kitchen comments; category from `report_group_id`), tax/tip/
  discount offset rows (zero-value skipped+cleaned), GUC trigger bypass, orphan
  delete, categorization + `is_categorized` preserved, `auth.uid()`-guarded batch
  categorize. GRANTs to authenticated + service_role.
- pgTAP: sale-row counts/amounts, offsets, external_order_id pattern, categorization
  preservation, auth rejection.

## Task 4 — Sync handlers + cron (mirror Toast)

**Files:** `supabase/functions/_shared/focusTransactionSyncHandler.ts`,
`supabase/functions/focus-sync-data/{index,}.ts`,
`supabase/functions/focus-bulk-sync/index.ts` (+ handler), pgTAP/Vitest as appropriate,
cron migration `20260701140000_focus_transactions_cron.sql` if the existing focus cron
needs repointing.

- RED: Vitest for the handler — given a mocked `fetchDatafeed` (returns fixture XML) +
  mocked service client, it parses, upserts orders/items/payments (skips
  `isKitchenComment`), and calls the unified_sales sync; advances `sync_cursor` only on
  success; 90-day backfill + incremental like Toast.
- GREEN: implement; `focus-bulk-sync` keeps the constant-time service-role Bearer check
  and round-robin (LIMIT 5). Reuse `initial_sync_done`/`sync_cursor`.
- Verify end-to-end against live 06/29 data locally (throwaway DB): rows reconcile with
  the daily report.

## Task 5 — Repoint test-connection to `GET /api/restaurants`

**Files:** `supabase/functions/_shared/focusTestConnectionHandler.ts` (rewrite),
`supabase/functions/focus-test-connection/index.ts`, `tests/unit/focusTestConnectionHandler.test.ts`.

- RED: tests — with a mocked fetch returning the `/api/restaurants` items, the handler
  sets `connection_status='connected'` when the stored `store_id` (GUID) is in
  `items[].restaurant_guid`, else `error` with an actionable message; auth/role/404 gates.
- GREEN: replace the current FocusLink datafeed-call implementation; native fetch;
  Basic auth. Update index.ts deps.

## Task 6 — Wizard + hook + logo + UX fix

**Files:** `src/components/pos/FocusSetupWizard.tsx`, `src/hooks/useFocusConnection.tsx`,
`src/components/IntegrationLogo.tsx`, `tests/unit/focusSetupWizard.test.tsx`,
`tests/unit/useFocusConnection.test.tsx`.

- Collect **API Key + API Secret + Restaurant GUID + environment** (sandbox/production);
  drop portal username/password/storeId fields. Hook `saveConnection`/`testConnection`
  signatures updated accordingly.
- Fix the Focus logo (replace the 🍦 emoji placeholder in `IntegrationLogo.tsx` — add a
  proper Focus/Shift4 mark under `public/logos/` and wire `imageLogoMap['focus-pos']`).
- Fix the wizard UX bug: a **save** failure must not render as "Connection test failed /
  Your credentials were saved" — distinguish save-failure from test-failure.
- Repoint the two earlier FocusLink-oriented commits (`focusDatafeed.ts` client
  `6d39cf54`, test-connection `910ca525`) to the pos-api/Lynk implementations; remove the
  now-dead FocusLink daily-JSON client if unused.

---

**Dependency order:** 1 → 2 → 3 → 4 (needs 1,2,3) → 5 → 6. Commit after each green step.
Full `unified_sales` reconciliation against the live 06/29 datafeed is the acceptance gate.
