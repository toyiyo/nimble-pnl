# Focus POS Near-Real-Time Sync — Design

- **Date:** 2026-07-04
- **Branch:** `feature/focus-sync-frequency`
- **Status:** Approved direction (user, 2026-07-04); this doc pins the implementation decisions.

## Problem

Two independent gaps keep Focus data stale:

1. **Today is never pulled.** The Lynk incremental window is
   `recentBusinessDays()` = `[yesterday, day-before-yesterday]`
   (`supabase/functions/_shared/focusReportClient.ts:146`). Intraday
   transactions only land after midnight — up to ~30 h of staleness. The
   busy-times/staffing use case needs *today*.
2. **The bulk cron runs every 6 hours** (`30 1,7,13,19 * * *`) and processes a
   fixed `LIMIT 5` batch — neither the cadence nor the capacity model scales
   to a 30-minute freshness goal across thousands of connections.

**Vendor constraints (verified against the OpenAPI spec, 2026-07-04):**

- No documented rate limits anywhere (no 429s, no quotas, no Retry-After).
- Auth is per-restaurant (API key + secret per store). There is no
  platform-level credential that could hit an aggregate ceiling.
- Lynk `LegacyDatafeed` requests are routed through Focus's cloud to the
  **store's own POS terminal**, which generates the ~4.5 MB XML and uploads it
  to Azure. The scarce resource is each store's terminal, not a central
  server. Load shards naturally per restaurant.
- No webhooks / sales events exist (`/api/events/*` covers only menu + team
  config). Polling is the only mechanism.

Therefore the binding constraint is **per-store politeness** (bounded datafeed
generations per terminal per hour), not aggregate vendor throttling.

## Goals

- A transaction is visible in `unified_sales` ≤ ~35 min after it happens
  (30-min pull interval + existing 5-min aggregation cron).
- Scheduler capacity scales with fleet size without redesign (thousands of
  connections).
- Per store, steady state: ~2 datafeed generations/hour for today + 1 every
  6 h for yesterday. Offline stores stop being polled (backoff).
- Unchanged feeds cost ~nothing on our side (no parse, no upserts, no
  `unified_sales` churn).

## Non-goals

- No UI for configuring the interval (DB column only; UI later if needed).
- No changes to `focus-backfill-sync` (owns `initial_sync_done=false` Lynk
  rows) or `focus-transactions-unified-sales-sync` (already every 5 min).
- No Toast/Square scheduler migration in this PR (the claim-RPC pattern is
  deliberately reusable, but that is follow-up work).
- No conditional-GET/ETag optimization on the Azure blob: the terminal
  re-uploads the blob per request, so ETags change even when content doesn't.
  Delta detection happens after download, on content.

## Design

### 1. Schema (one migration, timestamp generated at file-creation time)

**`focus_connections` — three new columns:**

| Column | Type | Default | Purpose |
|---|---|---|---|
| `sync_interval_minutes` | `integer NOT NULL` | `30` | Per-connection cadence. Migration seeds `360` for legacy portal rows (`api_key IS NULL`) so the SSRS path keeps its 6-h rhythm. |
| `next_attempt_at` | `timestamptz NULL` | `NULL` | Backoff gate. `NULL` = eligible. |
| `consecutive_failures` | `integer NOT NULL` | `0` | Drives exponential backoff. |

**New table `focus_datafeed_state`** — per-(restaurant, business date) feed
fingerprint:

```sql
CREATE TABLE focus_datafeed_state (
  restaurant_id  uuid NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  business_date  date NOT NULL,
  checks_bytes   integer NOT NULL,
  checks_sha256  text NOT NULL,
  fetched_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (restaurant_id, business_date)
);
ALTER TABLE focus_datafeed_state ENABLE ROW LEVEL SECURITY;
-- No client policies: service-role-only internal state.
```

No `updated_at` column — `fetched_at` is the only timestamp with meaning here
(design review #5: an `updated_at` nothing maintains is dead weight).
Retention: accepted unbounded growth — one ~100-byte row per restaurant per
business day (~73 MB/year even at 2,000 restaurants). A pruning cron is not
worth its surface area today; revisit if the table ever matters
(design review #6, accepted trade-off).

**Due predicate + claim RPC** (the predicate lives in exactly one function so
the cron fan-out and the claim can never drift):

```sql
-- The single source of truth for "is this connection due?".
-- MUST be LANGUAGE sql, STABLE, single-expression, and NOT STRICT so the
-- planner INLINES it into callers (plpgsql or STRICT would block inlining
-- and force an opaque per-row filter — design review #2). Inlined, the
-- claim query walks the existing partial index
-- focus_connections_active_sync_idx (last_sync_time ASC NULLS FIRST
-- WHERE is_active) and stops at LIMIT.
CREATE FUNCTION _focus_connection_is_due(fc focus_connections) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT fc.is_active
    AND (fc.next_attempt_at IS NULL OR fc.next_attempt_at <= now())
    AND (fc.last_sync_time IS NULL
         OR fc.last_sync_time <= now() - make_interval(mins => fc.sync_interval_minutes))
    -- Lynk rows still backfilling are owned by focus-backfill-sync:
    AND (fc.api_key IS NULL OR fc.initial_sync_done)
$$;

CREATE FUNCTION focus_due_sync_count() RETURNS integer ...   -- COUNT(*) over the predicate

-- CRITICAL (design review #1): the claim is ONE atomic statement — the
-- canonical job-queue shape. No separate SELECT-then-UPDATE-then-re-SELECT;
-- any multi-statement variant reopens the race SKIP LOCKED exists to close.
CREATE FUNCTION claim_focus_sync_batch(p_limit integer DEFAULT 5)
RETURNS SETOF focus_connections
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  UPDATE focus_connections
     SET last_sync_time = now()          -- claim marker; updated_at handled by trigger
   WHERE id IN (
     SELECT fc.id
       FROM focus_connections fc
      WHERE _focus_connection_is_due(fc)
      ORDER BY fc.last_sync_time ASC NULLS FIRST
      LIMIT p_limit
      FOR UPDATE SKIP LOCKED             -- parallel workers never double-claim
   )
  RETURNING *;
$$;
```

Privileges follow the #577 hardening pattern: `REVOKE ALL ... FROM PUBLIC,
anon, authenticated; GRANT EXECUTE ... TO service_role;` on all three
functions, with `SET search_path = pg_catalog, public` (the stronger form
adopted after #573's CodeRabbit pass).

The worker consumes the RPC result **by column name only** (supabase-js
returns objects, never tuples) — a future `ALTER TABLE focus_connections ADD
COLUMN` widens the SETOF contract silently, which is fine for named access
and fatal for positional (design review #9).

**Cron reschedule** (same `DO $$ unschedule-if-exists $$` + hardcoded-URL
pattern as `20260703120000_focus_backfill_reliability.sql`):

```sql
SELECT cron.schedule(
  'focus-bulk-sync',
  '*/5 * * * *',
  $cron$
  SELECT net.http_post(
    url := 'https://ncdujvdgqtaunuyigflp.supabase.co/functions/v1/focus-bulk-sync',
    headers := jsonb_build_object('Content-Type','application/json'),
    body := '{}'::jsonb,
    timeout_milliseconds := 5000
  )
  FROM generate_series(1,
    LEAST(20, GREATEST(1, CEIL(focus_due_sync_count() / 5.0)))::int
  );
  $cron$
);
```

Every 5 minutes the tick fires **K = ceil(due/5), capped at 20** parallel
worker invocations. Each worker claims its own batch of 5 via the RPC, so K
workers never collide. Capacity: K=20 × 5 claims × 12 ticks/h = 1,200
syncs/hour ⇒ ~600 connections at 30-min cadence per cap; raising the cap is a
one-line change if the fleet outgrows it. When a burst exceeds capacity, the
most-stale-first ordering degrades gracefully (intervals stretch, nothing is
starved).

**pg_net failure model (design review #7):** `net.http_post` is
fire-and-forget — the tick never blocks on worker responses, and response
rows in `net._http_response` self-expire (pg_net TTL). If one of the K
dispatches is lost at the pg_net layer, nothing retries it *within* the tick;
the affected connections simply stay "due" and are claimed by the next tick's
workers 5 minutes later. Accepted degradation — no per-dispatch observability
is added.

### 2. Worker changes (`focusBulkSyncHandler.ts`)

- **Selection:** replace the `select().order().limit(5)` query with
  `rpc('claim_focus_sync_batch', { p_limit: 5 })`. The claim itself bumps
  `last_sync_time`, which is what makes parallel workers and pg_cron's
  non-serialized ticks safe. The existing "bump last_sync_time on failure"
  best-effort write becomes redundant and is removed.
- **Lynk incremental window:** *today* every claim; *yesterday* only when its
  `focus_datafeed_state.fetched_at` is missing or older than 6 h. This bounds
  yesterday-correction staleness at 6 h (same as today's behavior) while
  halving steady-state terminal load. Both dates computed in the connection's
  timezone (existing `todayInTz`/`subtractDays` helpers).
- **Delta skip:** after downloading the XML and extracting the `<Checks>`
  block (the parser already pre-extracts it for CPU reasons —
  `extractChecksBlock` in `focusDatafeedParser.ts:191` gets **exported**),
  compute byte length + SHA-256. If they match the stored
  `focus_datafeed_state` row, update `fetched_at` and **skip** parse +
  upserts + the day-scoped unified_sales RPC entirely — no
  `focus_orders.updated_at` churn, so the unified-sales aggregation sees no
  phantom changes. On mismatch (or no state row), process normally and upsert
  the fingerprint. SHA-256 via Web Crypto (`crypto.subtle`), available in
  both Deno and the Vitest environment.
  **Integration point:** inside `processDayTransactions`
  (`focusTransactionSyncHandler.ts`) between fetch (step 2) and parse
  (step 3), returning a new discriminated result `{ status: 'unchanged' }`.
  The state store is an **optional injectable dep** — only the bulk handler
  wires it initially; the manual-sync, custom-range, and backfill paths keep
  current behavior and existing test mocks unbroken. (A manual sync that
  processes a feed without recording a fingerprint merely causes one
  redundant reprocess on the next tick — no correctness issue.)
- **Backoff:** on a failed connection, write
  `consecutive_failures = n+1` and
  `next_attempt_at = now() + LEAST(6 h, 15 min × 2^(n+1))`
  (→ 30 m, 1 h, 2 h, 4 h, 6 h cap). On success, reset both (`0` / `NULL`).
  An offline store (`UnreachableHost`) decays to one poll per 6 h until it
  comes back.
  **Explicit contract (design review #4):** the claim RPC bumps
  `last_sync_time` unconditionally, so backoff only exists if the worker's
  failure path *positively writes* both columns — this write replaces the old
  best-effort "bump last_sync_time on failure" (which is deleted). A unit test
  MUST assert that a simulated failure writes `consecutive_failures = n+1`
  and a future `next_attempt_at`, and that a success resets them.
- **Legacy portal branch:** logic unchanged; it is now paced by
  `sync_interval_minutes = 360` through the shared predicate instead of the
  6-hour cron schedule. The B5 "skip Lynk backfill rows" guard stays as a
  cheap defensive check even though the claim predicate already excludes
  those rows.

### 3. Politeness / scale math (documented for future us)

- Per store: 2 Lynk datafeed generations/hour for today + 4/day for
  yesterday ≈ **~52/day** (vs. 4–8/day currently). Each request is one
  message through Focus's router to one terminal.
- 2,000 connections at 30-min cadence = ~1.1 requests/sec across Focus's
  entire cloud router; each terminal sees only its own 2/hour.
- Recommendation to relay to Shift4 (Josh): confirm 30-min LegacyDatafeed
  polling per store is acceptable. Not a blocker — the system demonstrably
  regenerates feeds on demand — but polite to ask before large rollout.

### 4. Failure modes

- **Worker dies mid-batch:** claimed rows already have `last_sync_time`
  bumped; they simply wait one interval. Bounded delay, no stuck state.
- **pg_cron does not serialize ticks:** irrelevant now — claims are atomic
  (`FOR UPDATE SKIP LOCKED`), double-fire just means extra workers claiming
  disjoint batches.
- **Edge CPU limit (~10 s):** unchanged budget model — 5 connections per
  worker, 90-s wall budget, 2-s inter-restaurant delay. Delta skip *reduces*
  CPU vs. today.
- **Clock/timezone:** business dates computed per-connection timezone as
  today; `fetched_at` comparisons are UTC timestamps, no date math.

### 5. Testing

- **Vitest (`tests/unit/focusBulkSyncHandler.test.ts` + new files):**
  claim-RPC selection path; today-always / yesterday-every-6h window logic;
  delta-skip (match → no parse/upserts, fetched_at touched; mismatch →
  processed + fingerprint upserted); backoff write on failure and reset on
  success; budget/delay behavior unchanged.
- **pgTAP (`supabase/tests/`):** `_focus_connection_is_due` truth table
  (inactive, interval not elapsed, backoff in future, Lynk-backfill
  exclusion, legacy row with 360); `claim_focus_sync_batch` claims and
  bumps `last_sync_time`, and a second immediate call returns 0 rows —
  **which proves "claiming removes a row from the due set", NOT the SKIP
  LOCKED cross-session guarantee** (a transaction cannot contend with
  itself; the second call returns nothing because the bump made the row
  not-due — design review #3). True concurrent-session contention is a
  deliberate scope cut: the claim uses the canonical single-statement
  job-queue shape, and pgTAP has no two-session harness. Name the test
  accordingly. Also: privileges revoked from `anon`/`authenticated`;
  `focus_datafeed_state` RLS enabled with no client access; cron job
  present with `*/5 * * * *`.
  **Live-cron caveat (#577 lesson):** the pgTAP DB runs a live pg_cron —
  (re)schedule the job inside the rolled-back transaction before asserting
  its schedule.
- **Migration hygiene (explicit pre-PR checklist, design review #8 — this
  exact collision broke prod this week and `20260704010000_...` already
  occupies today's date):**
  1. Generate the timestamp at file-creation time (never from the plan doc).
  2. Immediately before `gh pr create`: `git fetch && git ls-tree
     origin/main supabase/migrations/ | grep <prefix>` must return nothing.
  3. `migrationVersionUniqueness.test.ts` is the CI backstop, not the check.

### 6. Rollout

Single migration + edge-function deploy; no data backfill. The existing prod
connection picks up `sync_interval_minutes = 30` from the column default and
moves to 30-min cadence on the first tick after deploy. Rollback = revert
cron schedule + columns are additive/inert.

## Decided trade-offs

- **Yesterday refreshes every 6 h, not every tick** — bounds correction
  staleness at the old freshness level while halving terminal load. Manual
  custom-range sync remains the escape hatch for older corrections.
- **Fan-out cap K ≤ 20 per tick** — protects pg_net/edge concurrency;
  most-stale-first ordering makes overload degrade gracefully instead of
  dropping connections.
- **Delta skip saves parse + DB writes, not download bandwidth** — content
  hashing after download is the only reliable change signal (Azure ETag
  changes on every terminal re-upload). Accepted: the download is cheap for
  us; the politeness budget is about *generation* count, which delta skip
  cannot reduce anyway.
- **`last_sync_time` doubles as the claim marker** — avoids a second
  "claimed_at" column and keeps the round-robin semantics the fleet already
  uses. A crashed worker costs one skipped interval, which is acceptable.
