# Focus POS — Restaurant Picker + Server-Side Background Backfill — Design

**Date:** 2026-07-02
**Branch:** `feat/focus-focuslink-datafeed` (continue; PR #563, unmerged — keep the whole Focus feature as one reviewable unit)
**Status:** Binding design. Supersedes nothing; extends the transactions work already on this branch.

---

## 1. Problem

Two defects block a non-technical operator (a chef) from actually using the Focus POS integration:

### A. Setup dead-ends on a hand-typed Restaurant GUID

The setup wizard (`FocusSetupWizard.tsx`) asks the operator to type a **Restaurant GUID** (a UUID) and validates it only at the very end. A chef has no way to obtain that GUID — the only source is a `GET /api/restaurants` call they cannot run. Result: "auth is not working as is."

**Verified:** `GET /api/restaurants` with the stored API Key + Secret (HTTP Basic) returns `200` and
`{ count, request_count, page_count, items: [ { restaurant_guid, restaurant_name, created_date } ] }`.
The API auth is fine; the UX is the blocker.

### B. Initial sync requires ~90 manual clicks and can't run in the background

Backfill advances `sync_cursor` by **exactly one day per invocation** in both the manual handler
(`focusSyncDataHandler.ts`) and the cron (`focusBulkSyncHandler.ts`). The UI
(`SyncComponents.InitialSyncPendingAlert`) literally says *"Click Sync Now to continue."* The only
auto-advance is the 6-hour `focus-bulk-sync` cron (1 day / 6 h → **22 days** to backfill 90).
The **custom date range** picker is decorative — `FocusSync.handleSync` ignores the selected dates.

**Product requirement (user):** one click, then the operator can navigate away; the backfill finishes
**server-side in the background**, not by keeping a browser tab open.

## 2. Why this design (constraints)

- The Focus **Lynk Legacy Datafeed is one API call per business day**: `POST /api/lynk/sync` → `blob_url`
  (Azure SAS) → download a multi-MB XML → parse → hundreds of upserts. There is **no** date-range/bulk
  endpoint. 90 days = 90 separate multi-MB day-fetches — physically cannot fit one edge invocation's
  CPU/wall/memory budget. (This is why Square's single-call server import model is unavailable to Focus;
  Square's REST API supports paginated range queries, Focus's datafeed does not.)
- The codebase already provides the right primitives:
  - **5-minute pg_cron jobs** are idiomatic (the Toast/Shift4/Focus `unified_sales` syncs all run `*/5 * * * *`).
  - **`EdgeRuntime.waitUntil`** is already used (`stripe-disconnect-bank/index.ts`) for
    background-after-response work, with the fallback idiom
    `(globalThis as any).EdgeRuntime?.waitUntil?.(p) ?? p`.
- Therefore: **backfill is owned by a new 5-minute, backfill-only cron** (durable, crash-safe, no-op when
  idle); the manual click kicks a **small first batch** for instant feedback and returns immediately;
  the frontend shows **passive** progress by polling the connection row (no browser-driven loop).

## 3. Goals / Non-goals

**Goals**
- Operator enters API Key + Secret → picks their restaurant from a **server-fetched list** (never a GUID).
- One click → backfill runs **server-side in the background** to completion; tab-independent.
- Custom date range actually syncs the selected dates.
- Mirror existing patterns (split handler + thin Deno entry; injectable deps; 5-min cron; timing-safe
  service-role gate; SSRF allow-list; AES-GCM secret encryption).

**Non-goals**
- No change to the transaction data model (`focus_orders/items/payments`) or the
  `sync_focus_transactions_to_unified_sales` RPC.
- The legacy **portal (SSRS scrape) path** is deprecated; its backfill stays 1-day-per-run (untouched).
  All new batching/background work targets the **Lynk API path** (connections with `api_key`).
- No new columns on `focus_connections` (see §6.3 for why an overlap lock is unnecessary).

---

## 4. Increment A — Restaurant picker

### 4.1 New edge function `focus-list-restaurants`

Split per the codebase convention: `_shared/focusListRestaurantsHandler.ts` (pure, Vitest-testable) +
`focus-list-restaurants/index.ts` (thin Deno entry) + `config.toml` entry `verify_jwt = false`.

**Request** — `POST`, `Authorization: Bearer <supabase jwt>`, JSON body:
```jsonc
{ "restaurantId": "<eshq uuid>", "apiKey": "<focus key>", "apiSecret": "<focus secret>", "environment": "production" | "sandbox" (optional, default "production") }
```
Credentials are **NOT stored** — used once to call the API, then discarded.

**Handler flow** (mirrors `focusTestConnectionHandler`):
1. `Authorization` header present → else 401.
2. `userClient.auth.getUser()` → else 401.
3. Parse body; `restaurantId`, `apiKey`, `apiSecret` required non-empty → else 400.
4. Role check via `userClient.from('user_restaurants')` — owner/manager → else 403.
5. `baseUrl = focusApiBaseUrl(environment ?? 'production', sandboxBaseUrl)`; SSRF-guard with
   `isSafeUrl(baseUrl, FOCUSPOS_HOST_RE)` → else 200 `{success:false,error}`.
6. `GET {baseUrl}/api/restaurants`, `Authorization: Basic base64(apiKey:apiSecret)`, `Accept: application/json`,
   `redirect: 'error'`, `AbortSignal.timeout(20_000)`.
7. **Focus-side failures return HTTP 200** `{ success:false, error }` so the wizard shows a friendly inline
   message (mirrors test-connection): `401 → "check your API Key and Secret"`, `403 → "check the license / API permissions"`,
   `404 → "check the environment / base URL"`, other → `"Focus POS API returned HTTP <n>"`. Network error → 200 `{success:false,error}`.
8. Parse JSON; take `items[]`, map each entry with a **string** `restaurant_guid` to
   `{ restaurant_guid, restaurant_name }` (default `restaurant_name` to the guid if missing/blank).
9. Success → 200 `{ success:true, restaurants: [{restaurant_guid, restaurant_name}] }` (may be empty array).

**Security:** never `console.log` `apiKey`/`apiSecret`/the `Authorization` header. Our own errors
(400/401/403) use real HTTP codes; **Focus-side** errors use 200-with-`{success:false}` (so the SDK's
`{data}` carries them and the wizard can show a clean message rather than a scary "non-2xx" toast). The
role gate bounds abuse of the outbound call to owners/managers; the SSRF allow-list fixes the host to
`(*.)focuspos.com`.

### 4.2 Hook — `useFocusConnection.listRestaurants`

```ts
type FocusRestaurantOption = { restaurant_guid: string; restaurant_name: string };
listRestaurants(restaurantId, apiKey, apiSecret, environment='production'): Promise<FocusRestaurantOption[]>
```
`useMutation` calling `supabase.functions.invoke('focus-list-restaurants', { body })`; then
`if (error) throw error; if (data?.error) throw new Error(data.error); return data?.restaurants ?? []`.
No cache writes (read-only). **Tests must cover both invoke failure shapes** (2026-05-16 lesson):
`mockRejectedValue(new Error(...))` (transport) **and** `mockResolvedValue({data:null,error:{message}})` (HTTP).

### 4.3 Wizard — `FocusSetupWizard.tsx`

New step machine: `instructions → credentials → select → done`
(`stepIndex`: `instructions=0`, `credentials|select=1`, `done=2` — keep the 3-chip indicator).

- **instructions** — rewritten, plain-English, **no GUID / no "GET /api/restaurants"**:
  "Enter the API Key and Secret from Shift4/Focus. We'll look up your restaurant(s) automatically."
- **credentials** — API Key, API Secret, Environment. **Remove** the Restaurant GUID input, its
  `RESTAURANT_GUID_PATTERN`, and the GUID hint. Primary button **"Find my restaurant(s)"** →
  `listRestaurants(...)`.
  - On error → stay; show inline error (the friendly Focus-side message).
  - On empty list → inline "No restaurants were found for these credentials. Double-check the key/secret."
  - On success → store `restaurants` in state, advance to `select`.
- **select** — if `restaurants.length === 1`, auto-select it and show it as a confirmed line; else a
  shadcn `Select` (or radio list) of `restaurant_name` (value = `restaurant_guid`). Show Environment read-back.
  Primary **"Save & Connect"** → existing `handleSaveAndConnect` (uses the picked `restaurant_guid`):
  `saveConnection(restaurantId, apiKey, apiSecret, restaurantGuid, environment)` → `testConnection`.
  Keep the existing save-vs-test error-kind distinction. `testConnection` is guaranteed to pass (the GUID
  came from the account's own list) and serves as the status writer.
- **done** — unchanged.

`saveConnection`/`testConnection`/`triggerManualSync` hook signatures are unchanged by increment A.

## 5. Increment B — Server-side background backfill

### 5.1 Shared helper `_shared/focusBackfillBatch.ts`

Extract the per-day Lynk backfill loop so the manual handler, the new backfill cron, and (optionally) a
custom-range run all share one tested implementation.

```ts
processBackfillBatch(deps, config, opts): Promise<{
  syncCursor: number; initialSyncDone: boolean; daysProcessed: number;
  status: 'ok' | 'empty' | 'error'; lastError?: string;
}>
```
- `deps` = `{ supabase, fetchDatafeed }` (same as `processDayTransactions`).
- `config` = `TransactionSyncConfig` (restaurantId, storeId, apiKey, apiSecret, baseUrl).
- `opts` = `{ syncCursor, timezone, now, budgetMs, maxDays, targetDays=90, clock? }`.
- Loop while `cursor < targetDays && daysProcessed < maxDays && elapsed < budgetMs`:
  - `targetDate = subtractDays(todayInTz(tz, now), cursor + 1)` (newest-first, unchanged direction).
  - `processDayTransactions(deps, config, targetDate, { skipUnifiedSalesSync: true })` (unified_sales stays on its 5-min cron).
  - `error` → stop; return `status:'error'` and the **un-advanced** cursor (don't skip a failing day).
  - `inprogress` → stop; return current cursor (retry that day next tick).
  - `ok`/`empty` → `cursor++`, `daysProcessed++`.
- `initialSyncDone = cursor >= targetDays`.
- **Pure** (no DB writes to the connection row) — the caller persists `syncCursor/initialSyncDone/last_sync_time`.
- Elapsed time is measured via an injectable `clock` (default `Date.now`) so Vitest can drive the budget
  deterministically. (`Date.now` is disallowed in workflow scripts, not in edge/runtime code — but keep it
  injectable for tests.)

### 5.2 Manual click — `focusSyncDataHandler.ts` (Lynk path only)

- **Backfill (`initial_sync_done=false`)**: replace the single-day block with
  `processBackfillBatch(..., { budgetMs: 12_000, maxDays: 5 })` — a small, snappy first chunk for instant
  feedback. Persist the returned cursor/flag/last_sync_time. Respond
  `{ syncCursor, initialSyncDone, status, backgrounded: !initialSyncDone }`. The 5-min cron finishes the rest.
- **Custom range (new)**: if body has `{ startDate, endDate }` (ISO `YYYY-MM-DD`, ≤ 90 days, `start ≤ end`):
  run it in the background via an injectable `deps.scheduleBackground(promise)`:
  - index.ts passes `(p) => (globalThis as any).EdgeRuntime?.waitUntil?.(p) ?? p`.
  - tests pass a collector (`(p)=>{ tasks.push(p) }`) and await it, so the range logic is fully tested.
  - Range logic = `processDateRangeTransactions(deps, config, startDate, endDate, { maxDays: 90 })`
    (new small helper in `focusTransactionSyncHandler.ts` or `focusBackfillBatch.ts`): iterate the explicit
    date list, `processDayTransactions` each, then one `sync_focus_transactions_to_unified_sales(start,end)`.
    Respond immediately `{ backgrounded:true, mode:'custom' }`.
  - Note: custom-range uses `waitUntil` (not the durable cron), acceptable because ranges are small and
    user-retriggerable; the important 90-day backfill is on the durable cron.
- **Incremental (`initial_sync_done=true`)**: unchanged (last 2 business days).
- **Validation:** bad `startDate`/`endDate` (unparseable, `start > end`, span > 90 days) → 400.

### 5.3 New cron function `focus-backfill-sync` (the durable engine)

Split handler `_shared/focusBackfillSyncHandler.ts` + thin `focus-backfill-sync/index.ts`, `verify_jwt=false`.

- **Gate:** timing-safe Bearer compare vs `SUPABASE_SERVICE_ROLE_KEY` (reuse the `focusBulkSyncHandler`
  `timingSafeEqual` pattern) → 401.
- **Query:** active Lynk connections still backfilling:
  `is_active=true AND initial_sync_done=false AND api_key IS NOT NULL`,
  `ORDER BY last_sync_time ASC NULLS FIRST LIMIT 5` (round-robin, same fairness as bulk-sync).
- **Per connection:** decrypt secret; `processBackfillBatch(..., { budgetMs: <perRestaurant>, maxDays: 30 })`;
  persist cursor/flag/last_sync_time. Per-restaurant exception caught → recorded, continue.
- **Run budget:** overall wall-clock guard `BUDGET_MS = 80_000`; `2_000ms` inter-restaurant delay
  (injectable `sleep`); stop starting new restaurants past budget.
- Returns `{ processed, errors, elapsedMs }`.
- **Schedule:** `*/5 * * * *` (idiomatic 5-min) via pg_cron + pg_net (mirror `focus_cron.sql`). No-op when
  no connection is backfilling → negligible steady-state cost.

### 5.4 `focusBulkSyncHandler.ts` — cede backfill to the fast cron

The 6-hour bulk-sync must not also advance Lynk backfill (would race the 5-min cron on `sync_cursor`).
In `processConnection`, for the **Lynk path** only: `if (!row.initial_sync_done) return { unchanged cursor/flag }`
(skip — owned by `focus-backfill-sync`). Lynk incremental (`initial_sync_done=true`) is unchanged. The legacy
**portal path is fully unchanged** (still backfills 1-day/run here). Add a test asserting a backfilling Lynk
row is skipped by bulk-sync.

### 5.5 Frontend — passive progress, no loop

- **`useFocusConnection`**:
  - `triggerManualSync(restaurantId, options?: { startDate?: string; endDate?: string })` — pass `options`
    into the invoke body (mirrors `useToastConnection.triggerManualSync(id, options)`).
  - Connection query: add a **conditional `refetchInterval`** so progress updates while backfilling:
    `refetchInterval: (q) => q.state.data && !q.state.data.initial_sync_done && q.state.data.is_active ? 8000 : false`.
    Keep `staleTime: 30000`. (No manual caching — pure React Query, per CLAUDE.md.)
- **`FocusSync.tsx`**:
  - `handleSync` — **no loop**. `recent/initial` → `triggerManualSync(restaurantId)`; `custom` →
    `triggerManualSync(restaurantId, { startDate: from, endDate: to })` (ISO `YYYY-MM-DD`). One call, then a
    toast: *"Import started — running in the background. You can leave this page; it keeps going."*
  - Remove the fake `totalDays = 1` progress fiction. `isLoading` covers only the kick call. Live progress
    comes from the polling connection row (the `InitialSyncPendingAlert` "N of 90 days" updates itself).
- **`SyncComponents.InitialSyncPendingAlert`** — copy fix: replace *"…Click 'Sync Now' to continue."* with
  *"Importing your last 90 days in the background ({daysCompleted} of 90). No need to keep this page open."*
  `SyncModeSelector`/`SyncButton` custom-range descriptions unchanged (they already read correctly).

## 6. Cross-cutting

### 6.1 Testing
- **Vitest:** `focusListRestaurantsHandler` (auth/role/400, 401/403/404→friendly-200, JSON map, empty),
  `useFocusConnection.listRestaurants` (both invoke shapes), `focusSetupWizard` (picker flow: fetch → select
  → save; auto-select-one; error inline; empty list), `focusBackfillBatch` (advances N days, stops on
  budget/maxDays/error/inprogress, marks done at 90), `focusSyncDataHandler` (small backfill batch;
  custom-range via `scheduleBackground` collector; 400 on bad range; incremental unchanged),
  `focusBackfillSyncHandler` (Bearer gate; selects only backfilling Lynk rows; batches; budget/limit),
  `focusBulkSyncHandler` (skips backfilling Lynk rows), `FocusSync` (no loop; one call; custom passes dates).
- **pgTAP:** assert the `focus-backfill-sync` cron job exists on `*/5 * * * *` (mirror any existing focus-cron
  pgTAP; if none, a `cron.job` existence assertion).
- **Live:** with the creds file, exercise `focus-list-restaurants` (returns CSC-24329) and a 3-day custom
  range end-to-end against real data (reconciles with the daily report). Never echo secrets.

### 6.2 Security / RLS
- New edge fns are service-role for writes, `verify_jwt=false` + in-function JWT/role gate (list) or
  timing-safe service-role Bearer gate (backfill cron). No secret logging. SSRF allow-list unchanged
  (`FOCUSPOS_HOST_RE`, blob host). Backfill cron grants: `EXECUTE` to `service_role` only for any new SQL.

### 6.3 Decided trade-offs
- **No overlap lock / no new column.** The manual kick's batch is small (~12s) and returns before the next
  5-min tick, so it never runs concurrently with the cron on the same connection. Cron ticks are wall-bounded
  to 80s (≪ 300s), so ticks never overlap. `focus-orders/items/payments` upserts are **idempotent**
  (`ON CONFLICT`), so even a theoretical double-process is harmless. A lock column would add schema + failure
  modes for no real benefit.
- **Backfill vs incremental ownership split** (fast 5-min cron backfills; 6-h bulk-sync does incremental)
  keeps steady-state API load unchanged (no 72× increase) while making backfill finish in ~10–15 min
  server-side.
- **Custom range on `waitUntil`, not the durable cron.** Ranges are small and retriggerable; the durable
  path is reserved for the 90-day backfill. Documented as accepted.
- **Portal path untouched.** Deprecated; batching it is wasted effort.

## 7. Files

**New:** `_shared/focusListRestaurantsHandler.ts`, `focus-list-restaurants/index.ts`,
`_shared/focusBackfillBatch.ts`, `_shared/focusBackfillSyncHandler.ts`, `focus-backfill-sync/index.ts`,
`migrations/2026070212xxxx_focus_backfill_cron.sql`, plus Vitest/pgTAP tests.

**Modified:** `config.toml` (+2 fn entries), `focusSyncDataHandler.ts`, `focusTransactionSyncHandler.ts`
(add `processDateRangeTransactions`), `focusBulkSyncHandler.ts`, `FocusSetupWizard.tsx`,
`useFocusConnection.tsx`, `FocusSync.tsx`, `SyncComponents.tsx`.

**Dependency order:** A (list fn → hook → wizard) ∥ B1 (`focusBackfillBatch`) → B2 (`focus-sync-data`) →
B3 (`focus-backfill-sync` + cron) → B4 (`focus-bulk-sync` skip) → B5 (frontend). Commit per green task.

---

## 8. Design-review resolutions (2026-07-02) — BINDING, supersede §4–§7 on conflict

Two design reviewers (Supabase + Frontend) reviewed §1–§7. Accepted concerns below are the binding
contract. Where they refine an earlier section, the resolution wins.

### 8.1 Concurrency — optimistic compare-and-swap (Supabase critical #1)

pg_cron does **not** serialize overlapping runs of the same job. If a 5-min tick runs long, a second
tick can start and both read the same `sync_cursor`. Idempotent upserts prevent data corruption but not
**cursor** clobbering. **All cursor writes use compare-and-swap:**

```
UPDATE focus_connections
   SET sync_cursor = <new>, initial_sync_done = <newDone>, last_sync_time = now(), updated_at = now()
 WHERE id = <connId> AND restaurant_id = <restaurantId> AND sync_cursor = <readCursor>
```
Use `.select()` and check the returned row count: **0 rows ⇒ a concurrent tick already advanced it — do
NOT retry, just return** (this tick's day-fetches were wasted but harmless). This also fixes the
pre-existing **multi-tenant bug** (Supabase major #4): the write now filters `restaurant_id` too, matching
`focusBulkSyncHandler`. Applies to `focusSyncDataHandler` (backfill write), `focusBackfillSyncHandler`,
and the Lynk incremental writes. `readCursor` = the cursor value loaded at the start of the batch.

### 8.2 Custom range — synchronous, capped at 14 days (Supabase critical #2)

Drop `EdgeRuntime.waitUntil` / `scheduleBackground` entirely — it is unreliable on the Supabase edge
runtime and would silently drop a 90-day background promise. **Custom range is processed synchronously**
in `focusSyncDataHandler`: validate `startDate ≤ endDate` and span **≤ 14 days** (else 400 with a clear
message: *"Custom range is limited to 14 days. Use the automatic 90-day import for a full backfill."*);
iterate the explicit date list via `processDateRangeTransactions(deps, config, start, end)` (new helper),
`processDayTransactions` each day (no `skipUnifiedSalesSync` — run the RPC once for the range at the end),
return `{ daysSynced, status }`. Each day is committed as it goes, so it is durable and testable with no
background primitive. The 90-day "walk away" path stays on the durable cron (§8.3). Rationale: custom range
is a deliberate, small, targeted re-sync where a short wait is acceptable; the repeated-click pain the
feature fixes is specifically the 90-day initial backfill.

### 8.3 Backfill batch budgets (Supabase major #1 + minors)

- `processBackfillBatch` opts: **manual kick** `{ budgetMs: 12_000, maxDays: 5 }`; **cron per-restaurant**
  `{ budgetMs: <remaining run budget, ~50_000 max>, maxDays: 7 }`. NOT 30 — a day that hits the 30 s
  fetch timeout would blow a larger budget. 90 days → ~13–18 ticks (~65–90 min) fully server-side.
- `TARGET_DAYS = 90` is a module constant; `targetDays` param defaults to it and is only overridden in
  tests. Production callers never lower it (guards against premature `initial_sync_done`).
- On a day `error`, `processBackfillBatch` stops and returns the **un-advanced** cursor + `lastError`; the
  caller writes `connection_status='error'` + `last_error=<msg>` (+ `last_error_at`) so the operator sees the
  stall (Supabase minor #1) and the frontend can stop polling (§8.5). `inprogress` → stop, no cursor change.
- Elapsed measured via injectable `clock` (default `Date.now`) for deterministic Vitest budget tests.

### 8.4 Item/payment upserts batched per check (Supabase minor #3)

In `focusTransactionSyncHandler.ts`, replace the per-item and per-payment `await` loops with a **single
array upsert per check** (`.upsert([...allItems], { onConflict })` / `.upsert([...allPayments], …)`).
Same `onConflict` keys, same skip of `isKitchenComment` items. This collapses up to hundreds of sequential
round-trips per day into two, directly de-risking the batch budget and speeding the existing daily sync.
Update the existing `focusTransactionSyncHandler` tests to assert array-shaped upsert calls.

### 8.5 Frontend (Frontend criticals + majors)

- **`useFocusConnection.triggerManualSync(restaurantId, options?: { startDate?: string; endDate?: string })`**
  — the mutationFn MUST accept and **spread `options` into the invoke body** (`{ restaurantId, ...options }`).
  Current code drops it → custom range would silently do a normal sync (Frontend critical #1). Tests cover
  both invoke-error shapes.
- **Connection query `refetchInterval`** (Frontend major #1 — bound the polling):
  ```ts
  refetchInterval: (q) => {
    const d = q.state.data;                     // FocusConnection | null | undefined (pending → undefined → false)
    if (!d || d.initial_sync_done || !d.is_active || d.connection_status === 'error') return false;
    return 8000;
  }
  ```
  Keep `staleTime: 30000`; add a code comment that lowering it must not break progress polling. Polling
  stops on done, disconnect, or a persisted error; window-focus refetch self-heals a recovered backfill.
  `connection_status` must be added to `FocusConnection` type + `FOCUS_CONNECTION_COLUMNS` if not already
  selected. (It is already selected.)
- **`FocusSync.tsx` — remove dead progress state** (Frontend critical #2): delete `syncProgress`,
  `totalDaysSynced`, `syncResult`, and the `<SyncProgressDisplay>` + `<SyncResults>` renders. `handleSync`
  makes ONE call (no loop): `recent/initial` → `triggerManualSync(restaurantId)`; `custom` →
  `triggerManualSync(restaurantId, { startDate: format(from,'yyyy-MM-dd'), endDate: format(to,'yyyy-MM-dd') })`;
  then a toast *"Import started — running in the background. You can leave this page; it keeps going."*
  `isLoading` covers only the kick. Live progress is the polling `InitialSyncPendingAlert`.
- **`SyncComponents.InitialSyncPendingAlert`** (Frontend major #4 + minors): collapse to ONE message path
  (drop the `hasProgress`/not-started bifurcation) — *"Importing your last 90 days in the background
  ({daysCompleted} of 90). No need to keep this page open."*; wrap the count in
  `<span role="status" aria-live="polite" aria-atomic="true">`. Add `aria-label="Sync progress"` +
  `aria-valuemin/max` to the `<Progress>` in `SyncProgressDisplay` (still used by Toast). Swap the
  `RadioGroup` `space-x-3` → `gap-3`.
- **Wizard `select` step** (Frontend majors #2/#3/#6): after `listRestaurants` succeeds → `select` step.
  If `restaurants.length === 1`, auto-select and show it as a read-back line; else a shadcn `Select` with
  `<Label htmlFor="focus-restaurant">Restaurant</Label>` ⇄ `<SelectTrigger id="focus-restaurant">`, options
  = `restaurant_name` (value = `restaurant_guid`); if `restaurant_name` is blank show
  *"Restaurant (name unavailable)"* + the GUID as secondary text (not the raw GUID as the label — Supabase
  minor #4). The step folds in the old `confirmed` preview `Row` (restaurant name · environment · masked
  API key) and reuses the existing `connectError` + `connectErrorKind` (save vs test) alert below the
  picker; **"Save & Connect"** stays primary. On `credentials → select` transition, move focus to the step
  heading/`DialogContent` via a `ref` + `useEffect` keyed on `step`.
- **Wizard `instructions` step** (Frontend critical #3): DELETE the `<li>` that mentions the Restaurant
  GUID and *"GET /api/restaurants"*, DELETE `RESTAURANT_GUID_PATTERN` and the `restaurantGuid` credentials
  input/state. Rewrite the list to: (1) generate an API Key + Secret in Shift4/Focus, (2) click
  **Find my restaurant(s)** — "we'll look them up for you", (3) pick your location and connect.
- **Wizard `done` step** (Frontend minor #4): update copy — *"The first sync imports your last 90 days in
  the background. You can leave this page; it keeps going."* The done-step **Sync Now** shows the same
  background toast, then `onComplete()`.
- **Step indicator** (Frontend minor): move `aria-current="step"` onto the `role="listitem"` element.

### 8.6 Edge-function security / config (Supabase majors #3/#5 + minors)

- **`focus-list-restaurants`**: `sandboxBaseUrl` comes from `deps.sandboxBaseUrl`
  (index.ts: `Deno.env.get('FOCUS_API_SANDBOX_URL')`), **never** from the request body — same as
  `focusTestConnectionHandler`. SSRF guard `isSafeUrl(baseUrl, FOCUSPOS_HOST_RE)` after resolve; `redirect:'error'`.
- **`config.toml`**: add `[functions.focus-list-restaurants]` and `[functions.focus-backfill-sync]`, both
  `verify_jwt = false` (else the gateway 401s before the in-function gate). Explicit checklist item.
- **Cron migration**: use `current_setting('app.settings.service_role_key', true)` (missing_ok) so an unset
  GUC yields a graceful edge 401, not a cron-body exception. Idempotent unschedule guard; grants unchanged.

### 8.7 `focus-bulk-sync` skip guard (Supabase major #2, Frontend n/a)

Add `if (isLynkPath && !row.initial_sync_done) return { newSyncCursor: row.sync_cursor, newInitialSyncDone:
row.initial_sync_done };` at the **top of the `isLynkPath` block** in `focusBulkSyncHandler.processConnection`
(before decrypt/work), so the 6-h cron cedes Lynk backfill to the 5-min cron. Write the skip **test first**.
Portal path unchanged.

### 8.8 Deferred (noted, not in scope)

- `ConnectionStatus` badge raw colors (`bg-green-100 …`, `dark:` overrides) in `SyncComponents.tsx` — a
  pre-existing CLAUDE.md violation in a component shared by all 5 POS integrations. Fixing it ripples
  visually across Toast/Square/Clover/Sling/Focus and belongs in a dedicated theming pass. Left as-is.
- Batched item upsert changes payment/item error granularity (one bad row fails the check's batch); the
  check is retried next tick — accepted.

