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

### Review — PENDING
### Verify — PENDING
### Ship — PENDING
