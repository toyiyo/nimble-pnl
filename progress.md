# Feature Progress: focus-focuslink-datafeed

## Branch
`feat/focus-focuslink-datafeed`

## Phases

### Preflight — COMPLETED (2026-07-01)
- gh: authenticated as jdelgado2002 (scopes: gist, read:org, repo, workflow)
- jq: 1.7.1-apple
- node: v20.20.2
- coderabbit: 0.6.4
- codex: 0.137.0 (available)
- Sonar: NOT configured (SONAR_TOKEN and SONAR_PROJECT_KEY unset) — WARNING only
- Worktree on correct branch: feat/focus-focuslink-datafeed
- .env.local symlink created: /Users/josedelgado/Documents/GitHub/nimble-pnl/.claude/worktrees/focus-focuslink/.env.local -> /Users/josedelgado/Documents/GitHub/nimble-pnl/.env.local

### Build — IN PROGRESS

#### Task 1 — Transaction tables migration + pgTAP — COMPLETED (2026-07-01)
- Commit: `a769c56d`
- Files:
  - `supabase/migrations/20260701120000_focus_transactions.sql` — creates `focus_orders`, `focus_order_items`, `focus_payments` with named UNIQUE constraints, composite indexes, ON DELETE CASCADE, updated_at triggers, RLS (SELECT for member / FOR ALL for owner+manager), grants.
  - `supabase/tests/46_focus_transactions_schema.sql` — 32 pgTAP tests: table/column existence, named unique constraints, composite indexes, RLS enabled, SELECT + FOR ALL policies, cascade deletes, NOT NULL enforcement.
- TDD: RED confirmed (all 32 fail before migration), GREEN confirmed (all 32 pass after migration). Full suite clean.

#### Task 2 — Lynk datafeed client (`_shared/focusLynkClient.ts`) + Vitest — COMPLETED (2026-07-01)
- Commit: `284c424c`
- Files:
  - `supabase/functions/_shared/focusLynkClient.ts` — exports `focusApiBaseUrl`, `buildLynkRequest`, `fetchDatafeed`. POSTs to `/api/lynk/sync` with Basic auth + `focuspos-restaurant-id` header + LegacyDatafeed JSON body (business_date in MM/DD/YYYY); extracts `blob_url` from response; SSRF-guards the blob URL (must be `blob.core.windows.net`); GETs XML. Discriminated result with 8 error kinds. Unique `crypto.randomUUID()` per request.
  - `tests/unit/focusLynkClient.test.ts` — 33 Vitest tests covering all exported functions, HTTP error mapping, SSRF rejection, InProgress handling, unique request IDs.
- TDD: RED confirmed (module not found before implementation), GREEN: all 33 pass. Full suite (383 test files, 5117 tests) clean.

#### Task 3 — unified_sales RPC migration + pgTAP — COMPLETED (2026-07-01)
- Commit: `7342d71a`
- Files:
  - `supabase/migrations/20260701130000_focus_transactions_unified_sales.sql` — creates `_sync_focus_transactions_to_unified_sales_impl(uuid,date,date)`, `sync_focus_transactions_to_unified_sales(uuid)`, `sync_focus_transactions_to_unified_sales(uuid,date,date)`, `sync_all_focus_transactions_to_unified_sales()`. Per-check loop: orphan delete, UPSERT sale rows (price != 0, includes modifiers), UPSERT discount rows (discount_amount > 0, negative), UPSERT tip rows (focus_payments.tip != 0). GUC trigger bypass, categorization preservation, auth guard on public wrappers, service-role bypass on `_impl`. external_order_id = `focus-{store_id}-{YYYYMMDD}-{check_id}`. GRANTs to authenticated + service_role.
  - `supabase/tests/47_focus_transactions_unified_sales.sql` — 21 pgTAP tests covering function existence (4), sale row counts/amounts, external_order_id pattern, pos_category from report_group_id, modifier with price included, zero-price excluded, tip offset, discount offset, no discount for zero-amount, categorization preservation, orphan deletion, pos_system correctness, sale_date correctness, auth rejection, service-role access, cron wrapper row, date-range scoping.
- TDD: RED confirmed (4 "not ok" for missing functions, then SQL abort before migration), GREEN: all 21 pass. Pre-existing 1-test failure in `32_weekly_brief_queue.sql` unrelated (present since before this branch).

#### Task 4 — Sync handlers + cron edge functions — COMPLETED (2026-07-01)
- Commit: `d9e9622a`
- Files:
  - `supabase/functions/_shared/focusTransactionSyncHandler.ts` — `processDayTransactions(deps, config, businessDate, options?)`: calls `fetchDatafeed` (Lynk client), parses XML with `parseFocusDatafeed`, upserts `focus_orders`/`focus_order_items` (skips `isKitchenComment` lines)/`focus_payments`, calls `sync_focus_transactions_to_unified_sales` RPC. Returns discriminated result `ok/empty/inprogress/error`. Injectable deps (supabase + fetchDatafeed) for full Vitest coverage.
  - `supabase/functions/_shared/focusSyncDataHandler.ts` — Updated to dispatch to `processDayTransactions` (Lynk path) when `api_key` is present on the connection row; falls back to existing portal/SSRS path for legacy connections. Also fetches `api_key`, `api_secret_encrypted`, `environment` from the connection select.
  - `supabase/functions/_shared/focusBulkSyncHandler.ts` — Same Lynk-path dispatch added to `processConnection`; also fetches Lynk columns in the round-robin query.
  - `supabase/migrations/20260701140000_focus_transactions_cron.sql` — pg_cron job `focus-transactions-unified-sales-sync` (every 6 h) calling `sync_all_focus_transactions_to_unified_sales()` as safety-net for unified_sales currency.
  - `tests/unit/focusTransactionSyncHandler.test.ts` — 24 Vitest tests covering: fetchDatafeed call contract (baseUrl, restaurantGuid, apiKey/Secret, businessDate, called once), focus_orders upsert (one per check, totals, onConflict), focus_order_items (kitchen comment skipped, priced item, modifier, onConflict), focus_payments (amount/tip/card_last4, onConflict), RPC call (correct params), skipUnifiedSalesSync flag, empty datafeed, inprogress result, error results (network/auth/upsert), multi-check.
- TDD: RED confirmed (module not found), GREEN: all 24 pass. Full suite (5141 tests, 384 files) clean. Existing focusSyncDataHandler (30 tests) and focusBulkSyncHandler (20 tests) both still pass after handler updates.

#### Task 5 — Repoint test-connection to GET /api/restaurants + Vitest — COMPLETED (2026-07-01)
- Commit: `bbd41573`
- Files:
  - `supabase/functions/_shared/focusTestConnectionHandler.ts` — Rewrites business logic from the old FocusLink datafeed verification to `GET /api/restaurants` on `pos-api.focuspos.com`. Checks whether `conn.store_id` GUID is in `items[].restaurant_guid`. Removes `now`/datafeed deps; reuses `focusApiBaseUrl()` from `focusLynkClient` for production/sandbox routing; SSRF guard preserved; `writeStatus` helper extracted. Error gates: 401 (credentials), 403 (license/permission), 404 (route not found), network, non-JSON, GUID-not-found (actionable message).
  - `tests/unit/focusTestConnectionHandler.test.ts` — 17 Vitest tests (was 7 using old datafeed URL). Covers: auth/role/404 guards, correct URL and Basic auth header, sandbox base URL routing, GUID-found → connected, GUID-missing → error + actionable message, HTTP 401/403/404/5xx, network failure, non-JSON response, last_error_at lifecycle.
- TDD: RED confirmed (3 failures vs old datafeed URL + missing GUID membership check), GREEN: all 17 pass. Full suite (5151 tests, 384 files) clean.

#### Task 6 — Wizard + hook + logo + UX fix — COMPLETED (2026-07-01)
- Commit: `0ac9a106`
- Files:
  - `src/components/pos/FocusSetupWizard.tsx` — Replaced portal username/password/storeId fields with API Key, API Secret, Restaurant GUID (UUID), and Environment (production/sandbox). Save failure now shows "Failed to save" (distinct from "Connection test failed") — fixes the UX bug where both error kinds rendered the same misleading message. Retry button only shown after test failure, not save failure.
  - `src/hooks/useFocusConnection.tsx` — `saveConnection` signature updated to `(restaurantId, apiKey, apiSecret, restaurantGuid, environment='production')`. Calls `focus-save-connection` with `{ apiKey, apiSecret, storeId: restaurantGuid, environment }`. `FocusConnection` type updated to reflect `api_key`/`environment` columns; legacy portal columns removed.
  - `src/components/IntegrationLogo.tsx` — Added `'focus-pos': '/logos/focus.svg'` to `imageLogoMap`; removes the 🍦 emoji placeholder.
  - `public/logos/focus.svg` — Stylised F mark on dark rounded square (Focus POS brand).
  - `tests/unit/focusSetupWizard.test.tsx` — 4 new tests: API Key/Secret/GUID/env flow, default-production, save-failure vs test-failure distinction, logo image assertion. Old portal field assertions updated to new API field assertions.
  - `tests/unit/useFocusConnection.test.tsx` — 2 new tests: apiKey/apiSecret/storeId(=GUID)/environment contract, default-production when env omitted. Old username/password test replaced.
  - `tests/unit/focusPosRegistration.test.tsx` — Logo test updated from 🍦 emoji assertion to `<img alt="focus-pos logo">` assertion.
- TDD: RED confirmed (11 failures on new API-field tests + logo image test), GREEN: all 40 wizard+hook tests pass; focusPosRegistration 12/12 pass. TypeScript 0 errors. Full suite clean.

### UI Review — COMPLETED (2026-07-01)
- Commit: `03a13e7a`
- Files reviewed: `src/components/pos/FocusSetupWizard.tsx`, `src/components/IntegrationLogo.tsx`
- Findings:
  - Typography scale: all correct (text-[17px] title, text-[13px] secondary, text-[12px] uppercase labels).
  - Semantic tokens: no direct colors; all bg-foreground/text-foreground/bg-muted/30/border-border/40.
  - Dialog structure: DialogContent p-0 gap-0, icon box rounded-xl bg-muted/50, DialogDescription (not bare p).
  - Accessibility: aria-labels, htmlFor+id on all inputs, aria-invalid+aria-describedby, aria-hidden on icons, role="list"/listitem/aria-current="step" on step indicator. Fixed: added `aria-label="Saving connection…"` to Save & Connect button during isConnecting state.
  - IntegrationLogo: removed stale `'focus-pos': '🍦'` dead-code entry from emojiMap (unreachable; imageLogoMap takes precedence).
- TypeScript: 0 errors. Unit tests: 52/52 pass.

### Simplify — COMPLETED (2026-07-01)
- Commit: `8a106cdf`
- Files changed: 4
- Simplifications applied:
  - `focusLynkClient.ts`: Removed redundant `.trim() === ''` guard after `!config.restaurantGuid` (falsy already covers blank/empty strings).
  - `focusBulkSyncHandler.ts`: Collapsed double `throw err` (one inside `if (err instanceof FocusAuthError)`, one after) into a single re-throw after the status-write block — same behavior, one code path.
  - `focusSyncDataHandler.ts`: Removed the `status = 'ok'` inprogress branch (default was already `'ok'`); condensed to a single `else` path that maps result status, eliminating the dead assignment.
  - `FocusSetupWizard.tsx`: Extracted `onConnectSuccess()` helper shared by `handleSaveAndConnect` and `handleRetry` to remove duplicated toast + step-transition code.
- TypeScript: 0 errors. Tests: 5155/5155 pass (no regressions).

### Review — PENDING
### Verify — PENDING
### Ship — PENDING
