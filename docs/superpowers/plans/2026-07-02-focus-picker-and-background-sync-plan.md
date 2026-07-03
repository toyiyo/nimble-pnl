# Focus POS — Picker + Background Backfill — Implementation Plan

**Design (binding):** `docs/superpowers/specs/2026-07-02-focus-picker-and-background-sync-design.md`
(especially **§8 Design-review resolutions**, which supersede §4–§7 on conflict).
**Branch:** `feat/focus-focuslink-datafeed` (continue; PR #563).
**Discipline:** TDD every task — RED (failing test) → GREEN (minimal code) → REFACTOR → COMMIT.
**Live verify:** `source "/Users/josedelgado/Documents/Cold Stone Setup/focus-creds.env"`
(`FOCUS_API_KEY`/`FOCUS_API_SECRET`/`FOCUS_RESTAURANT_GUID`) — **never echo/print/commit the values**.

Existing patterns to mirror: `focusTestConnectionHandler.ts` (auth/role/SSRF), `focusBulkSyncHandler.ts`
(timing-safe Bearer gate, round-robin, wall budget), `focus_cron.sql` (pg_cron+pg_net), split
handler+thin-index, injectable deps, `useToastConnection.triggerManualSync(id, options)`.

---

## Increment A — Restaurant picker

### A1 — `focusListRestaurantsHandler.ts` + tests
Files: `supabase/functions/_shared/focusListRestaurantsHandler.ts`, `tests/unit/focusListRestaurantsHandler.test.ts`.
- RED: missing auth→401; bad JWT→401; missing `apiKey`/`apiSecret`/`restaurantId`→400; non-owner/manager→403;
  Focus 401/403/404→**HTTP 200** `{success:false,error:<friendly>}`; network error→200`{success:false}`;
  success→200 `{success:true, restaurants:[{restaurant_guid, restaurant_name}]}`; blank name defaults handled;
  empty `items`→`{success:true, restaurants:[]}`; **asserts apiKey/apiSecret never appear in any console call**.
- GREEN: mirror `focusTestConnectionHandler`. `sandboxBaseUrl` from `deps` only (§8.6). Basic auth,
  `redirect:'error'`, `AbortSignal.timeout(20_000)`, `isSafeUrl(baseUrl, FOCUSPOS_HOST_RE)`.

### A2 — `focus-list-restaurants/index.ts` + config
Files: `supabase/functions/focus-list-restaurants/index.ts`, `supabase/config.toml`.
- Thin Deno entry mirroring `focus-save-connection/index.ts`: CORS, userClient(JWT)+serviceClient(role),
  `fetch: globalThis.fetch.bind(globalThis)`, `sandboxBaseUrl: Deno.env.get('FOCUS_API_SANDBOX_URL')||undefined`.
- Add `[functions.focus-list-restaurants]\nverify_jwt = false` to config.toml.
- (No Vitest for index.ts — Deno glue; covered by handler tests.)

### A3 — hook: `listRestaurants` + `triggerManualSync(options)` passthrough
Files: `src/hooks/useFocusConnection.tsx`, `tests/unit/useFocusConnection.test.tsx`.
- RED: `listRestaurants` resolves `restaurants` on success; throws on invoke `error` (transport shape) AND
  on `{data:null,error:{message}}` (HTTP shape) — **both** (2026-05-16 lesson). `triggerManualSync(id,
  {startDate,endDate})` spreads options into the invoke body; `triggerManualSync(id)` still works.
- GREEN: add `FocusRestaurantOption` type; `listRestaurantsMutation` (no cache writes); change
  `triggerManualSyncMutation` mutationFn to `{restaurantId, options?}` → body `{restaurantId, ...options}`.
- **Also** (for B6, do here): add the conditional `refetchInterval` (§8.5) to the connection query +
  `staleTime` comment. Test: query options object shape (interval fn returns 8000 while backfilling,
  false when done/inactive/errored).

### A4 — wizard picker flow
Files: `src/components/pos/FocusSetupWizard.tsx`, `tests/unit/focusSetupWizard.test.tsx`.
- RED: entering key/secret + "Find my restaurant(s)" calls `listRestaurants`; success with 1 →
  auto-selected read-back + Save&Connect; success with N → labelled `Select`; `listRestaurants` error →
  inline error on credentials step; empty list → inline "no restaurants found"; blank name → "(name
  unavailable)"; Save&Connect uses the picked GUID; save-failure vs test-failure distinction preserved;
  instructions step has **no** "GET /api/restaurants"/GUID copy.
- GREEN: step machine `instructions → credentials → select → done`; delete `restaurantGuid` state +
  `RESTAURANT_GUID_PATTERN` + the GUID `<li>` + GUID input; add `restaurants`/`selectedGuid` state;
  `select` step folds the preview `Row` + `connectError`(save/test) + `<Label htmlFor="focus-restaurant">`;
  focus-move on step change (ref+`useEffect` keyed on `step`); rewrite instructions copy; step-indicator
  `aria-current` onto `role="listitem"`.

---

## Increment B — Server-side background backfill

### B1 — `focusBackfillBatch.ts` (`processBackfillBatch`) + tests
Files: `supabase/functions/_shared/focusBackfillBatch.ts`, `tests/unit/focusBackfillBatch.test.ts`.
- RED: advances cursor N days for N ok-days; stops at `maxDays`; stops at `budgetMs` (injectable `clock`);
  stops + returns un-advanced cursor + `lastError` on a day `error`; stops (no advance) on `inprogress`;
  sets `initialSyncDone` when `cursor>=targetDays`; `targetDays` param honored (test uses small value);
  pure (no connection-row writes). Uses a mocked `processDayTransactions`.
- GREEN: implement the budget/day-cap loop per §5.1 + §8.3. `TARGET_DAYS=90` constant.

### B2 — batch per-check item/payment upserts
Files: `supabase/functions/_shared/focusTransactionSyncHandler.ts`, `tests/unit/focusTransactionSyncHandler.test.ts`.
- RED: update tests to assert **one array upsert** per check for items (kitchen-comment items excluded)
  and one for payments; `onConflict` keys unchanged; error from the array upsert → check fails.
- GREEN: replace per-row `await` loops with `.upsert([...], {onConflict})`. Add `processDateRangeTransactions`
  (iterate explicit date list, `processDayTransactions` each, one unified_sales RPC for the range) + tests.

### B3 — `focus-sync-data`: small kick + CAS + custom-range + error status
Files: `supabase/functions/_shared/focusSyncDataHandler.ts`, `supabase/functions/focus-sync-data/index.ts`,
`tests/unit/focusSyncDataHandler.test.ts`.
- RED: Lynk backfill uses `processBackfillBatch({budgetMs:12_000,maxDays:5})`; cursor persisted via **CAS**
  `.eq('id').eq('restaurant_id').eq('sync_cursor', readCursor)` (0-rows ⇒ no retry); on day error writes
  `connection_status='error'`+`last_error`; response `{syncCursor,initialSyncDone,status,backgrounded}`.
  Custom range: body `{startDate,endDate}` valid ≤14d → `processDateRangeTransactions`, returns
  `{daysSynced,status}`; span>14 or start>end or unparseable → **400**. Incremental unchanged.
- GREEN: implement; index.ts passes `fetchDatafeed` + native fetch (no scheduleBackground/waitUntil).

### B4 — `focus-backfill-sync` function + cron
Files: `supabase/functions/_shared/focusBackfillSyncHandler.ts`, `supabase/functions/focus-backfill-sync/index.ts`,
`supabase/config.toml`, `supabase/migrations/2026070212XXXX_focus_backfill_cron.sql`,
`tests/unit/focusBackfillSyncHandler.test.ts`, `supabase/tests/48_focus_backfill_cron.sql`.
- RED (Vitest): timing-safe Bearer gate→401; selects only `is_active AND NOT initial_sync_done AND api_key
  IS NOT NULL` ORDER BY last_sync_time LIMIT 5; per-restaurant `processBackfillBatch({maxDays:7})` with CAS
  write; wall budget (~80s, injectable `now`) stops early; 2s inter-restaurant `sleep`; per-restaurant error
  isolated → continue; returns `{processed,errors,elapsedMs}`.
- RED (pgTAP `48_…`): assert `cron.job` row named `focus-backfill-sync` on `*/5 * * * *`.
- GREEN: implement handler (mirror `focusBulkSyncHandler`); thin index.ts; config.toml
  `[functions.focus-backfill-sync] verify_jwt=false`; migration mirrors `focus_cron.sql` with
  `current_setting('app.settings.service_role_key', true)` + idempotent unschedule guard.

### B5 — `focus-bulk-sync` cedes Lynk backfill (test-first)
Files: `supabase/functions/_shared/focusBulkSyncHandler.ts`, `tests/unit/focusBulkSyncHandler.test.ts`.
- RED **first**: a backfilling Lynk row (`api_key` set, `initial_sync_done=false`) is **skipped** — cursor
  unchanged, no datafeed fetch; incremental Lynk + portal rows still processed.
- GREEN: add `if (isLynkPath && !row.initial_sync_done) return {unchanged}` at the top of the `isLynkPath`
  block in `processConnection` (§8.7).

### B6 — FocusSync passive progress + copy/a11y
Files: `src/components/FocusSync.tsx`, `src/components/pos/SyncComponents.tsx`,
`tests/unit/*` (FocusSync test if present; SyncComponents covered via wizard/sync tests).
- RED: `handleSync` makes ONE call (no loop); custom mode passes `{startDate,endDate}` as `yyyy-MM-dd`;
  background toast shown; no `SyncProgressDisplay`/`SyncResults`/`syncResult` render. `InitialSyncPendingAlert`
  single message path + `role="status"`/`aria-live`.
- GREEN: remove dead state (`syncProgress`,`totalDaysSynced`,`syncResult`); collapse `InitialSyncPendingAlert`
  branch + live region; `<Progress aria-label…>`; `space-x-3`→`gap-3`; wizard done-step copy (in A4 or here).

---

## Ordering & gates
- **A1→A2→A3→A4** and **B1→B2→B3→B4→B5→B6**. A3 and B6 both touch `useFocusConnection`/frontend — A3 lands
  the hook changes (incl. `refetchInterval`), B6 consumes them. B3 depends on B1+B2; B6 depends on B3.
- Commit after each green task. **Acceptance gate:** full `unified_sales` reconciliation + a live 3-day
  custom-range + `focus-list-restaurants` returning CSC-24329 against real 06/29 data.
- Then Phases 5–9 (UI review, simplify, multi-model review, verify, push to #563, CI + comment triage).
