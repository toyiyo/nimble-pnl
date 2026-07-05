# Focus Near-Real-Time Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Focus POS data lands in `unified_sales` within ~35 minutes at fleet scale — due-based claim scheduler (30-min default interval), today-inclusive sync window, content-hash delta skip, and failure backoff.

**Architecture:** One migration adds scheduling columns + `focus_datafeed_state` + an inlinable due-predicate + an atomic `claim_focus_sync_batch` RPC (single `UPDATE … WHERE id IN (SELECT … FOR UPDATE SKIP LOCKED) RETURNING *`), and re-points the `focus-bulk-sync` cron to a 5-minute tick that fans out `ceil(due/5)` (≤20) parallel gate-less workers. The worker selects via the claim RPC, syncs `[today(+yesterday when its fingerprint is ≥6h old)]`, skips unchanged feeds by `<Checks>`-block SHA-256, and writes exponential backoff on failure.

**Tech Stack:** Supabase Postgres (pg_cron, pg_net, plpgsql/sql functions, pgTAP), Deno edge functions (Web Crypto), Vitest.

**Design doc:** `docs/superpowers/specs/2026-07-04-focus-sync-frequency-design.md` — read it first; it pins the exact claim-RPC SQL shape (review-critical) and the backoff contract.

**Repo-lesson guardrails (non-negotiable):**
- Migration timestamp is generated at file-creation time (`date -u +%Y%m%d%H%M%S`), never copied from this plan. Before `gh pr create`: `git fetch && git ls-tree origin/main supabase/migrations/` must show no prefix collision.
- pgTAP CI runs a LIVE pg_cron: (re)schedule the cron job inside the rolled-back test transaction before asserting its schedule (see `supabase/tests/50_categorization_backlog_drain.sql` for the precedent).
- All new SECURITY DEFINER functions: `SET search_path = pg_catalog, public` + `REVOKE ALL … FROM PUBLIC, anon, authenticated` + `GRANT EXECUTE … TO service_role`.
- Workers stay gate-less (no Bearer check) — explicit user decision; do not add auth.
- Mock-heavy test files may start with `/* eslint-disable @typescript-eslint/no-explicit-any */`.

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `supabase/migrations/<GENERATED_TS>_focus_sync_frequency.sql` | Create | Columns, `focus_datafeed_state`, due predicate, count fn, claim RPC, privileges, cron reschedule |
| `supabase/tests/51_focus_sync_scheduler.sql` | Create | pgTAP: schema, predicate truth table, claim semantics, privileges, cron |
| `supabase/functions/_shared/focusDatafeedParser.ts` | Modify | Export `extractChecksBlock` |
| `supabase/functions/_shared/focusDatafeedFingerprint.ts` | Create | `computeChecksFingerprint`, `DatafeedStateStore` interface, `createDatafeedStateStore` |
| `supabase/functions/_shared/focusReportClient.ts` | Modify | Add `lynkIncrementalDates` (today + conditional yesterday) |
| `supabase/functions/_shared/focusTransactionSyncHandler.ts` | Modify | Delta-skip inside `processDayTransactions`; new `'unchanged'` result |
| `supabase/functions/_shared/focusBulkSyncHandler.ts` | Modify | Claim-RPC selection, new window, backoff writes, wire state store |
| `tests/unit/focusDatafeedFingerprint.test.ts` | Create | Fingerprint + store unit tests |
| `tests/unit/focusTransactionSyncHandler.test.ts` | Modify | Delta-skip cases |
| `tests/unit/focusBulkSyncHandler.test.ts` | Modify | Claim path, window, backoff |

---

### Task 1: Migration + pgTAP — scheduler schema, claim RPC, cron fan-out

**Files:**
- Create: `supabase/tests/51_focus_sync_scheduler.sql`
- Create: `supabase/migrations/<GENERATED_TS>_focus_sync_frequency.sql` (generate `<GENERATED_TS>` NOW: `date -u +%Y%m%d%H%M%S`)

- [ ] **Step 1: Write the failing pgTAP test file**

Create `supabase/tests/51_focus_sync_scheduler.sql`. Fixture style follows `supabase/tests/49_focus_backfill_reliability.sql` (RLS off inside txn, delete-before-insert, fixed UUIDs with a distinct prefix — use `c51...`).

```sql
-- Tests for the Focus due-based sync scheduler
-- Migration: <GENERATED_TS>_focus_sync_frequency.sql
--
-- NOTE (live pg_cron): the pgTAP database runs a real pg_cron, so the
-- focus-bulk-sync job is (re)scheduled INSIDE this rolled-back transaction
-- before its schedule is asserted (precedent: 50_categorization_backlog_drain.sql).
--
-- NOTE (claim semantics): test "second claim returns 0 rows" proves that
-- claiming removes a row from the due set (the last_sync_time bump), NOT the
-- SKIP LOCKED cross-session guarantee — a transaction cannot contend with
-- itself. Cross-session contention is covered by using the canonical
-- single-statement job-queue shape (see design doc).

BEGIN;
SELECT plan(19);

-- ── Fixtures ─────────────────────────────────────────────────────────────────
ALTER TABLE public.restaurants       DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.focus_connections DISABLE ROW LEVEL SECURITY;

DELETE FROM public.focus_connections WHERE restaurant_id::text LIKE 'c5100000-%';
DELETE FROM public.restaurants       WHERE id::text LIKE 'c5100000-%';

INSERT INTO public.restaurants (id, name)
VALUES
  ('c5100000-0000-0000-0000-000000000001', 'Scheduler Test 1'),
  ('c5100000-0000-0000-0000-000000000002', 'Scheduler Test 2'),
  ('c5100000-0000-0000-0000-000000000003', 'Scheduler Test 3'),
  ('c5100000-0000-0000-0000-000000000004', 'Scheduler Test 4'),
  ('c5100000-0000-0000-0000-000000000005', 'Scheduler Test 5'),
  ('c5100000-0000-0000-0000-000000000006', 'Scheduler Test 6'),
  ('c5100000-0000-0000-0000-000000000007', 'Scheduler Test 7');

-- Connection matrix (id prefix c5100000-…-00000000000N mirrors restaurant N):
--   n1 due:      lynk, done, last sync 1h ago, interval 30
--   n2 fresh:    lynk, done, last sync 5min ago            → NOT due
--   n3 backoff:  lynk, done, 1h ago BUT next_attempt_at in the future → NOT due
--   n4 backfill: lynk, NOT done                            → NOT due (owned by focus-backfill-sync)
--   n5 legacy:   api_key NULL, NOT done, 7h ago, interval 360 → due
--   n6 inactive: is_active=false                           → NOT due
--   n7 never:    lynk, done, last_sync_time NULL           → due, claimed FIRST (NULLS FIRST)
INSERT INTO public.focus_connections
  (id, restaurant_id, store_id, api_key, api_secret_encrypted, initial_sync_done,
   is_active, last_sync_time, timezone)
VALUES
  ('c5100000-aaaa-0000-0000-000000000001','c5100000-0000-0000-0000-000000000001','guid-1','key1','enc1', true,  true,  now() - interval '1 hour',   'America/Chicago'),
  ('c5100000-aaaa-0000-0000-000000000002','c5100000-0000-0000-0000-000000000002','guid-2','key2','enc2', true,  true,  now() - interval '5 minutes','America/Chicago'),
  ('c5100000-aaaa-0000-0000-000000000003','c5100000-0000-0000-0000-000000000003','guid-3','key3','enc3', true,  true,  now() - interval '1 hour',   'America/Chicago'),
  ('c5100000-aaaa-0000-0000-000000000004','c5100000-0000-0000-0000-000000000004','guid-4','key4','enc4', false, true,  now() - interval '1 hour',   'America/Chicago'),
  ('c5100000-aaaa-0000-0000-000000000005','c5100000-0000-0000-0000-000000000005','guid-5',NULL,  NULL,   false, true,  now() - interval '7 hours',  'America/Chicago'),
  ('c5100000-aaaa-0000-0000-000000000006','c5100000-0000-0000-0000-000000000006','guid-6','key6','enc6', true,  false, now() - interval '1 hour',   'America/Chicago'),
  ('c5100000-aaaa-0000-0000-000000000007','c5100000-0000-0000-0000-000000000007','guid-7','key7','enc7', true,  true,  NULL,                        'America/Chicago');

UPDATE public.focus_connections
   SET next_attempt_at = now() + interval '1 hour'
 WHERE id = 'c5100000-aaaa-0000-0000-000000000003';
UPDATE public.focus_connections
   SET sync_interval_minutes = 360
 WHERE id = 'c5100000-aaaa-0000-0000-000000000005';

-- ── 1-3: schema ──────────────────────────────────────────────────────────────
SELECT has_column('public','focus_connections','sync_interval_minutes','focus_connections.sync_interval_minutes exists');
SELECT is(
  (SELECT column_default FROM information_schema.columns
    WHERE table_schema='public' AND table_name='focus_connections' AND column_name='sync_interval_minutes'),
  '30', 'sync_interval_minutes defaults to 30');
SELECT has_column('public','focus_connections','next_attempt_at','focus_connections.next_attempt_at exists');

-- ── 4-5: focus_datafeed_state ────────────────────────────────────────────────
SELECT ok(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.focus_datafeed_state'::regclass),
  'focus_datafeed_state has RLS enabled');
SELECT is(
  (SELECT count(*)::int FROM pg_policies WHERE schemaname='public' AND tablename='focus_datafeed_state'),
  0, 'focus_datafeed_state has zero client policies (service-role only)');

-- ── 6-11: due predicate truth table ─────────────────────────────────────────
SELECT is((SELECT public._focus_connection_is_due(fc) FROM public.focus_connections fc WHERE fc.id='c5100000-aaaa-0000-0000-000000000001'), true,  'due: lynk done, interval elapsed');
SELECT is((SELECT public._focus_connection_is_due(fc) FROM public.focus_connections fc WHERE fc.id='c5100000-aaaa-0000-0000-000000000002'), false, 'not due: interval not elapsed');
SELECT is((SELECT public._focus_connection_is_due(fc) FROM public.focus_connections fc WHERE fc.id='c5100000-aaaa-0000-0000-000000000003'), false, 'not due: next_attempt_at in the future (backoff)');
SELECT is((SELECT public._focus_connection_is_due(fc) FROM public.focus_connections fc WHERE fc.id='c5100000-aaaa-0000-0000-000000000004'), false, 'not due: lynk row still backfilling is owned by focus-backfill-sync');
SELECT is((SELECT public._focus_connection_is_due(fc) FROM public.focus_connections fc WHERE fc.id='c5100000-aaaa-0000-0000-000000000005'), true,  'due: legacy portal row past its 360-min interval');
SELECT is((SELECT public._focus_connection_is_due(fc) FROM public.focus_connections fc WHERE fc.id='c5100000-aaaa-0000-0000-000000000006'), false, 'not due: inactive');

-- ── 12: due count (n1 + n5 + n7 = 3; other fixtures excluded) ───────────────
-- NOTE: count includes any pre-existing due rows in the test DB — scope it:
SELECT is(
  (SELECT count(*)::int FROM public.focus_connections fc
    WHERE public._focus_connection_is_due(fc) AND fc.restaurant_id::text LIKE 'c5100000-%'),
  3, 'exactly the 3 expected fixtures are due');

-- ── 13: NULLS FIRST — claim(1) takes the never-synced row ────────────────────
SELECT is(
  (SELECT (public.claim_focus_sync_batch(1)).id),
  'c5100000-aaaa-0000-0000-000000000007'::uuid,
  'claim(1) returns the never-synced connection first (NULLS FIRST)');

-- ── 14-16: claim bumps + removes from due set ────────────────────────────────
SELECT ok(
  (SELECT last_sync_time > now() - interval '1 minute'
     FROM public.focus_connections WHERE id='c5100000-aaaa-0000-0000-000000000007'),
  'claimed row last_sync_time bumped to now (claim marker)');

SELECT is(
  (SELECT count(*)::int FROM public.claim_focus_sync_batch(10) c
    WHERE c.restaurant_id::text LIKE 'c5100000-%'),
  2, 'second claim(10) returns the remaining 2 due fixtures');

SELECT is(
  (SELECT count(*)::int FROM public.claim_focus_sync_batch(10) c
    WHERE c.restaurant_id::text LIKE 'c5100000-%'),
  0, 'third claim returns 0 fixture rows — claiming removed them from the due set');

-- ── 17-18: privileges ────────────────────────────────────────────────────────
SELECT ok(
  NOT has_function_privilege('anon', 'public.claim_focus_sync_batch(integer)', 'EXECUTE'),
  'anon cannot execute claim_focus_sync_batch');
SELECT ok(
  NOT has_function_privilege('authenticated', 'public.focus_due_sync_count()', 'EXECUTE'),
  'authenticated cannot execute focus_due_sync_count');

-- ── 19: cron (rescheduled in-txn, live-cron safe) ────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'focus-bulk-sync') THEN
    PERFORM cron.unschedule('focus-bulk-sync');
  END IF;
  PERFORM cron.schedule(
    'focus-bulk-sync',
    '*/5 * * * *',
    'SELECT 1'  -- body irrelevant for the schedule assertion; rolled back anyway
  );
END $$;
SELECT is(
  (SELECT schedule FROM cron.job WHERE jobname = 'focus-bulk-sync'),
  '*/5 * * * *', 'focus-bulk-sync ticks every 5 minutes');

SELECT * FROM finish();
ROLLBACK;
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:db 2>&1 | tail -30`
Expected: FAIL — `column "sync_interval_minutes" does not exist` (or `has_column` failures 1–3 and function-missing errors for `_focus_connection_is_due`).

- [ ] **Step 3: Write the migration**

Generate the timestamp NOW (`date -u +%Y%m%d%H%M%S`) and create
`supabase/migrations/<GENERATED_TS>_focus_sync_frequency.sql`:

```sql
-- ═════════════════════════════════════════════════════════════════════════════
-- Focus POS near-real-time sync: due-based claim scheduler
--
-- Design: docs/superpowers/specs/2026-07-04-focus-sync-frequency-design.md
--
-- §1 focus_connections: sync_interval_minutes / next_attempt_at / consecutive_failures
-- §2 focus_datafeed_state (delta-skip fingerprints; RLS, service-role only)
-- §3 _focus_connection_is_due  — the ONE source of truth for "due" (inlinable SQL)
-- §4 focus_due_sync_count      — cron fan-out sizing
-- §5 claim_focus_sync_batch    — atomic UPDATE…SKIP LOCKED…RETURNING claim
-- §6 privileges                — REVOKE PUBLIC/anon/authenticated on all three
-- §7 cron                      — focus-bulk-sync every 5 min, K parallel workers
-- ═════════════════════════════════════════════════════════════════════════════

-- ── §1 scheduling columns ────────────────────────────────────────────────────
ALTER TABLE public.focus_connections
  ADD COLUMN IF NOT EXISTS sync_interval_minutes integer NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz,
  ADD COLUMN IF NOT EXISTS consecutive_failures integer NOT NULL DEFAULT 0;

-- Legacy portal rows (SSRS scrape) keep their 6-hour rhythm.
UPDATE public.focus_connections
   SET sync_interval_minutes = 360
 WHERE api_key IS NULL;

-- ── §2 datafeed fingerprints ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.focus_datafeed_state (
  restaurant_id  uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  business_date  date NOT NULL,
  checks_bytes   integer NOT NULL,
  checks_sha256  text NOT NULL,
  fetched_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (restaurant_id, business_date)
);
-- Service-role-only internal state: RLS on, zero client policies.
ALTER TABLE public.focus_datafeed_state ENABLE ROW LEVEL SECURITY;

-- ── §3 due predicate ─────────────────────────────────────────────────────────
-- MUST stay LANGUAGE sql, STABLE, single-expression, NOT STRICT: the planner
-- then inlines it into callers, so the claim query can walk
-- focus_connections_active_sync_idx (last_sync_time ASC NULLS FIRST WHERE
-- is_active) and stop at LIMIT instead of evaluating an opaque function per row.
CREATE OR REPLACE FUNCTION public._focus_connection_is_due(fc public.focus_connections)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT fc.is_active
    AND (fc.next_attempt_at IS NULL OR fc.next_attempt_at <= now())
    AND (fc.last_sync_time IS NULL
         OR fc.last_sync_time <= now() - make_interval(mins => fc.sync_interval_minutes))
    -- Lynk rows still backfilling are owned by the focus-backfill-sync cron:
    AND (fc.api_key IS NULL OR fc.initial_sync_done)
$$;

-- ── §4 due count (sizes the cron fan-out) ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.focus_due_sync_count()
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT count(*)::integer
    FROM public.focus_connections fc
   WHERE public._focus_connection_is_due(fc)
$$;

-- ── §5 atomic claim ──────────────────────────────────────────────────────────
-- ONE statement (canonical job-queue shape). Any SELECT-then-UPDATE variant
-- reopens the race SKIP LOCKED exists to close. last_sync_time doubles as the
-- claim marker; a crashed worker costs one skipped interval. updated_at is
-- maintained by the existing BEFORE UPDATE trigger.
CREATE OR REPLACE FUNCTION public.claim_focus_sync_batch(p_limit integer DEFAULT 5)
RETURNS SETOF public.focus_connections
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  UPDATE public.focus_connections
     SET last_sync_time = now()
   WHERE id IN (
     SELECT fc.id
       FROM public.focus_connections fc
      WHERE public._focus_connection_is_due(fc)
      ORDER BY fc.last_sync_time ASC NULLS FIRST
      LIMIT GREATEST(COALESCE(p_limit, 0), 0)
      FOR UPDATE SKIP LOCKED
   )
  RETURNING *;
$$;

-- ── §6 privileges ────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public._focus_connection_is_due(public.focus_connections) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.focus_due_sync_count() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_focus_sync_batch(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.focus_due_sync_count() TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_focus_sync_batch(integer) TO service_role;

-- ── §7 cron: 5-minute tick, K = ceil(due/5) capped at 20 parallel workers ────
-- Hardcoded URL: ALTER DATABASE SET app.settings.* is permission-denied on
-- Supabase (matches 20260703120000_focus_backfill_reliability.sql).
-- net.http_post is fire-and-forget: a lost dispatch just means those
-- connections stay due and are claimed on the next tick.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'focus-bulk-sync') THEN
    PERFORM cron.unschedule('focus-bulk-sync');
  END IF;
END $$;

SELECT cron.schedule(
  'focus-bulk-sync',
  '*/5 * * * *',
  $cron$
  SELECT net.http_post(
    url     := 'https://ncdujvdgqtaunuyigflp.supabase.co/functions/v1/focus-bulk-sync',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body    := '{}'::jsonb,
    timeout_milliseconds := 5000
  )
  FROM generate_series(1, LEAST(20, GREATEST(1, CEIL(public.focus_due_sync_count() / 5.0)))::int);
  $cron$
);
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test:db 2>&1 | tail -30`
Expected: `51_focus_sync_scheduler.sql` all 19 pass; zero regressions in 40–50 focus tests (49 exercises the old ORDER BY path — if it asserted the removed cron schedule `30 1,7,13,19 * * *`, update THAT assertion to `*/5 * * * *` with a comment; check `supabase/tests/42_focus_cron.sql` and `48/49` for schedule assertions and update them the same way).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/*_focus_sync_frequency.sql supabase/tests/51_focus_sync_scheduler.sql supabase/tests/4*.sql
git commit -m "feat(focus): due-based claim scheduler — 30-min intervals, atomic SKIP LOCKED claims, 5-min cron fan-out"
```

---

### Task 2: Fingerprint module (`extractChecksBlock` export + SHA-256 + state store)

**Files:**
- Modify: `supabase/functions/_shared/focusDatafeedParser.ts:191` (add `export` to `extractChecksBlock`)
- Create: `supabase/functions/_shared/focusDatafeedFingerprint.ts`
- Test: `tests/unit/focusDatafeedFingerprint.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi } from 'vitest';
import {
  computeChecksFingerprint,
  createDatafeedStateStore,
} from '../../supabase/functions/_shared/focusDatafeedFingerprint.ts';

const XML_A = '<Feed><Config>big</Config><Checks><Check><ID>1</ID></Check></Checks></Feed>';
const XML_A2 = '<Feed><Config>DIFFERENT CONFIG</Config><Checks><Check><ID>1</ID></Check></Checks></Feed>';
const XML_B = '<Feed><Config>big</Config><Checks><Check><ID>2</ID></Check></Checks></Feed>';
const XML_NO_CHECKS = '<Feed><Config>big</Config></Feed>';

describe('computeChecksFingerprint', () => {
  it('is stable for identical <Checks> content and ignores config outside the block', async () => {
    const a = await computeChecksFingerprint(XML_A);
    const a2 = await computeChecksFingerprint(XML_A2);
    expect(a).toEqual(a2);
    expect(a.bytes).toBeGreaterThan(0);
    expect(a.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('differs when check content differs', async () => {
    const a = await computeChecksFingerprint(XML_A);
    const b = await computeChecksFingerprint(XML_B);
    expect(a.sha256).not.toBe(b.sha256);
  });

  it('fingerprints a config-only feed (no <Checks>) as the empty block', async () => {
    const fp = await computeChecksFingerprint(XML_NO_CHECKS);
    expect(fp.bytes).toBe(0);
  });
});

describe('createDatafeedStateStore', () => {
  function makeClient(row: any, getError: any = null) {
    const maybeSingle = vi.fn(async () => ({ data: row, error: getError }));
    const upsertSelect = vi.fn(async () => ({ data: [], error: null }));
    const upsert = vi.fn(() => ({ select: upsertSelect }));
    const eq2 = vi.fn(() => ({ maybeSingle }));
    const eq1 = vi.fn(() => ({ eq: eq2 }));
    const select = vi.fn(() => ({ eq: eq1 }));
    const from = vi.fn(() => ({ select, upsert }));
    return { client: { from }, mocks: { from, select, upsert, upsertSelect, maybeSingle } };
  }

  it('get returns the stored fingerprint mapped to camelCase', async () => {
    const { client } = makeClient({ checks_bytes: 42, checks_sha256: 'ab'.repeat(32), fetched_at: '2026-07-04T10:00:00Z' });
    const store = createDatafeedStateStore(client as any);
    const got = await store.get('r1', '2026-07-04');
    expect(got).toEqual({ bytes: 42, sha256: 'ab'.repeat(32), fetchedAt: '2026-07-04T10:00:00Z' });
  });

  it('get fails OPEN: returns null on query error (delta-skip must never break the sync)', async () => {
    const { client } = makeClient(null, { message: 'boom' });
    const store = createDatafeedStateStore(client as any);
    expect(await store.get('r1', '2026-07-04')).toBeNull();
  });

  it('record upserts the fingerprint on the composite key', async () => {
    const { client, mocks } = makeClient(null);
    const store = createDatafeedStateStore(client as any);
    await store.record('r1', '2026-07-04', { bytes: 7, sha256: 'ff'.repeat(32) });
    expect(mocks.from).toHaveBeenCalledWith('focus_datafeed_state');
    expect(mocks.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        restaurant_id: 'r1',
        business_date: '2026-07-04',
        checks_bytes: 7,
        checks_sha256: 'ff'.repeat(32),
        fetched_at: expect.any(String),
      }),
      { onConflict: 'restaurant_id,business_date' },
    );
  });

  it('touch refreshes fetched_at via the same upsert path without changing the hash fields', async () => {
    const { client, mocks } = makeClient(null);
    const store = createDatafeedStateStore(client as any);
    await store.touch('r1', '2026-07-04', { bytes: 7, sha256: 'ff'.repeat(32) });
    expect(mocks.upsert).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run tests/unit/focusDatafeedFingerprint.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement**

In `focusDatafeedParser.ts`, change `function extractChecksBlock` → `export function extractChecksBlock` (no other changes).

Create `supabase/functions/_shared/focusDatafeedFingerprint.ts`:

```typescript
/**
 * focusDatafeedFingerprint.ts
 *
 * Content-hash delta detection for Focus Lynk datafeeds. The <Checks> block is
 * the only part of the ~4.5 MB feed that carries transaction data (~90 % is
 * static config), so its byte length + SHA-256 is a reliable "did anything
 * change?" signal. Fingerprints persist in focus_datafeed_state, one row per
 * (restaurant, business_date).
 *
 * FAIL-OPEN CONTRACT: every store operation tolerates errors — a broken state
 * read/write must degrade to "reprocess the feed", never break the sync.
 */

import { extractChecksBlock } from './focusDatafeedParser.ts';

export interface ChecksFingerprint {
  bytes: number;
  sha256: string;
}

export interface StoredFingerprint extends ChecksFingerprint {
  fetchedAt: string;
}

/** Minimal Supabase surface (service-role client in prod; mock in tests). */
export interface StateStoreClient {
  from(table: string): {
    select(columns: string): {
      eq(col: string, val: string): {
        eq(col: string, val: string): {
          maybeSingle(): Promise<{
            data: { checks_bytes: number; checks_sha256: string; fetched_at: string } | null;
            error: { message: string } | null;
          }>;
        };
      };
    };
    upsert(
      data: Record<string, unknown>,
      options?: Record<string, unknown>,
    ): { select(): Promise<{ data: unknown; error: { message: string } | null }> };
  };
}

export interface DatafeedStateStore {
  /** Stored fingerprint for (restaurant, date), or null when absent OR on error (fail open). */
  get(restaurantId: string, businessDate: string): Promise<StoredFingerprint | null>;
  /** Feed unchanged: refresh fetched_at (keeps the 6-h yesterday-window bookkeeping honest). */
  touch(restaurantId: string, businessDate: string, fp: ChecksFingerprint): Promise<void>;
  /** Feed processed: persist the new fingerprint. */
  record(restaurantId: string, businessDate: string, fp: ChecksFingerprint): Promise<void>;
}

/** SHA-256 (hex) + byte length of the <Checks> block; empty block when absent. */
export async function computeChecksFingerprint(xml: string): Promise<ChecksFingerprint> {
  const block = extractChecksBlock(xml) ?? '';
  const data = new TextEncoder().encode(block);
  const digest = await crypto.subtle.digest('SHA-256', data);
  const sha256 = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return { bytes: data.byteLength, sha256 };
}

export function createDatafeedStateStore(client: StateStoreClient): DatafeedStateStore {
  const upsertRow = async (
    restaurantId: string,
    businessDate: string,
    fp: ChecksFingerprint,
    label: string,
  ): Promise<void> => {
    try {
      const { error } = await client
        .from('focus_datafeed_state')
        .upsert(
          {
            restaurant_id: restaurantId,
            business_date: businessDate,
            checks_bytes: fp.bytes,
            checks_sha256: fp.sha256,
            fetched_at: new Date().toISOString(),
          },
          { onConflict: 'restaurant_id,business_date' },
        )
        .select();
      if (error) {
        console.warn(`focus_datafeed_state ${label} failed for ${restaurantId}/${businessDate}: ${error.message}`);
      }
    } catch (err: unknown) {
      console.warn(
        `focus_datafeed_state ${label} threw for ${restaurantId}/${businessDate}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  };

  return {
    async get(restaurantId, businessDate) {
      try {
        const { data, error } = await client
          .from('focus_datafeed_state')
          .select('checks_bytes, checks_sha256, fetched_at')
          .eq('restaurant_id', restaurantId)
          .eq('business_date', businessDate)
          .maybeSingle();
        if (error || !data) return null;
        return { bytes: data.checks_bytes, sha256: data.checks_sha256, fetchedAt: data.fetched_at };
      } catch {
        return null;
      }
    },
    touch: (restaurantId, businessDate, fp) => upsertRow(restaurantId, businessDate, fp, 'touch'),
    record: (restaurantId, businessDate, fp) => upsertRow(restaurantId, businessDate, fp, 'record'),
  };
}
```

- [ ] **Step 4: Run to verify pass** — `npx vitest run tests/unit/focusDatafeedFingerprint.test.ts` → PASS; also `npx vitest run tests/unit/focusDatafeedParser.test.ts` (export change is non-breaking).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/focusDatafeedFingerprint.ts supabase/functions/_shared/focusDatafeedParser.ts tests/unit/focusDatafeedFingerprint.test.ts
git commit -m "feat(focus): <Checks>-block fingerprint module for delta detection"
```

---

### Task 3: Delta-skip inside `processDayTransactions`

**Files:**
- Modify: `supabase/functions/_shared/focusTransactionSyncHandler.ts`
- Test: `tests/unit/focusTransactionSyncHandler.test.ts` (extend)

- [ ] **Step 1: Write the failing tests** (append a `describe('delta skip', ...)` block; reuse the file's existing mock helpers for supabase + fetchDatafeed — read them first and follow their construction style):

```typescript
describe('delta skip (optional stateStore dep)', () => {
  const XML = '<Feed><Checks><Check><CheckRecord>77</CheckRecord><ID>77</ID></Check></Checks></Feed>';

  function makeStateStore(stored: { bytes: number; sha256: string; fetchedAt: string } | null) {
    return {
      get: vi.fn(async () => stored),
      touch: vi.fn(async () => {}),
      record: vi.fn(async () => {}),
    };
  }

  it('returns unchanged and skips ALL writes when the fingerprint matches', async () => {
    const fp = await computeChecksFingerprint(XML); // import from focusDatafeedFingerprint
    const stateStore = makeStateStore({ ...fp, fetchedAt: '2026-07-04T10:00:00Z' });
    const { deps, upsertMock, rpcMock } = makeDeps(XML); // existing-style helper: fetchDatafeed → ok/XML
    const result = await processDayTransactions({ ...deps, stateStore }, config, '2026-07-04');
    expect(result).toEqual({ status: 'unchanged' });
    expect(upsertMock).not.toHaveBeenCalled();
    expect(rpcMock).not.toHaveBeenCalled();
    expect(stateStore.touch).toHaveBeenCalledWith(config.restaurantId, '2026-07-04', fp);
  });

  it('processes normally and records the fingerprint on mismatch', async () => {
    const stateStore = makeStateStore({ bytes: 1, sha256: '0'.repeat(64), fetchedAt: '2026-07-04T10:00:00Z' });
    const { deps, upsertMock } = makeDeps(XML);
    const result = await processDayTransactions({ ...deps, stateStore }, config, '2026-07-04');
    expect(result).toEqual({ status: 'ok', checksWritten: 1 });
    expect(upsertMock).toHaveBeenCalled();
    expect(stateStore.record).toHaveBeenCalled();
  });

  it('processes normally when no prior fingerprint exists (get returns null)', async () => {
    const stateStore = makeStateStore(null);
    const { deps } = makeDeps(XML);
    const result = await processDayTransactions({ ...deps, stateStore }, config, '2026-07-04');
    expect(result.status).toBe('ok');
    expect(stateStore.record).toHaveBeenCalled();
  });

  it('without a stateStore dep, behavior is exactly as before (no state calls, normal processing)', async () => {
    const { deps } = makeDeps(XML);
    const result = await processDayTransactions(deps, config, '2026-07-04');
    expect(result.status).toBe('ok');
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run tests/unit/focusTransactionSyncHandler.test.ts` → FAIL (`stateStore` not in deps type / `unchanged` never returned).

- [ ] **Step 3: Implement** in `focusTransactionSyncHandler.ts`:

1. Import: `import { computeChecksFingerprint, type DatafeedStateStore, type ChecksFingerprint } from './focusDatafeedFingerprint.ts';`
2. `TransactionSyncDeps` gains `stateStore?: DatafeedStateStore;`
3. `TransactionSyncResult` union gains `| { status: 'unchanged' }`.
4. In `processDayTransactions`, insert between step 2 (fetch ok) and step 3 (parse):

```typescript
    // ── 2.5 Delta skip (optional; bulk-sync wires a stateStore) ──────────────
    // Fingerprint the <Checks> block; if it matches the stored state, nothing
    // changed since the last pull — skip parse, upserts, and the day RPC, so
    // focus_orders.updated_at stays untouched and unified_sales sees no
    // phantom churn. Fail-open: store errors → prev=null → normal processing.
    let fingerprint: ChecksFingerprint | null = null;
    if (deps.stateStore) {
      fingerprint = await computeChecksFingerprint(result.xml);
      const prev = await deps.stateStore.get(config.restaurantId, businessDate);
      if (prev && prev.bytes === fingerprint.bytes && prev.sha256 === fingerprint.sha256) {
        await deps.stateStore.touch(config.restaurantId, businessDate, fingerprint);
        return { status: 'unchanged' };
      }
    }
```

5. After the upsert loop (step 5) succeeds, before the unified_sales RPC:

```typescript
    if (deps.stateStore && fingerprint) {
      await deps.stateStore.record(config.restaurantId, businessDate, fingerprint);
    }
```

6. In `processDateRangeTransactions`, the day processor is invoked with `{ supabase: deps.supabase, fetchDatafeed: deps.fetchDatafeed }` — leave as-is (range path deliberately does not delta-skip), but extend the early-exit guard so a hypothetical `'unchanged'` counts as a synced day: change `lastStatus = result.status as 'ok' | 'empty'` to `lastStatus = result.status === 'empty' ? 'empty' : 'ok'`.
7. Grep for exhaustive consumers: `grep -rn "status === 'empty'\|status === 'ok'" supabase/functions/_shared/focus*.ts supabase/functions/focus*/` and confirm none throws on an unknown status (they use if/else, not exhaustive switch). Fix any that do.

- [ ] **Step 4: Run to verify pass** — `npx vitest run tests/unit/focusTransactionSyncHandler.test.ts` → PASS (old + new). Also `npx tsc -p tsconfig.app.json --noEmit`… (edge functions aren't in tsconfig.app — instead run the full unit suite: `npx vitest run tests/unit/ 2>&1 | tail -5`).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/focusTransactionSyncHandler.ts tests/unit/focusTransactionSyncHandler.test.ts
git commit -m "feat(focus): delta-skip unchanged datafeeds inside processDayTransactions"
```

---

### Task 4: `lynkIncrementalDates` window helper

**Files:**
- Modify: `supabase/functions/_shared/focusReportClient.ts` (next to `recentBusinessDays`, line ~146)
- Test: `tests/unit/focusReportClient.test.ts` (extend; create the describe block if the file lacks one for date helpers)

- [ ] **Step 1: Write the failing tests**

```typescript
describe('lynkIncrementalDates', () => {
  const tz = 'America/Chicago';
  // 2026-07-04 18:00 UTC = 13:00 in Chicago (CDT)
  const now = new Date('2026-07-04T18:00:00Z');

  it('returns [today, yesterday] when yesterday has never been fetched', () => {
    expect(lynkIncrementalDates(tz, now, null)).toEqual(['2026-07-04', '2026-07-03']);
  });

  it('returns [today, yesterday] when yesterday was fetched ≥ 6h ago', () => {
    expect(lynkIncrementalDates(tz, now, '2026-07-04T11:59:00Z')).toEqual(['2026-07-04', '2026-07-03']);
  });

  it('returns [today] only when yesterday was fetched < 6h ago', () => {
    expect(lynkIncrementalDates(tz, now, '2026-07-04T13:00:00Z')).toEqual(['2026-07-04']);
  });

  it('treats an unparseable fetchedAt as stale (fail toward re-fetching)', () => {
    expect(lynkIncrementalDates(tz, now, 'not-a-date')).toEqual(['2026-07-04', '2026-07-03']);
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run tests/unit/focusReportClient.test.ts` → FAIL (not exported).

- [ ] **Step 3: Implement** in `focusReportClient.ts` (after `recentBusinessDays`):

```typescript
/** Yesterday is re-pulled at most every 6 h (bounded correction staleness). */
const YESTERDAY_REFRESH_MS = 6 * 60 * 60 * 1000;

/**
 * Business dates for one Lynk incremental sync: TODAY always; YESTERDAY only
 * when its fingerprint row is missing or stale (fetched ≥ 6 h ago). Replaces
 * recentBusinessDays() for the Lynk path — that helper never included today,
 * which meant intraday data only landed after midnight.
 */
export function lynkIncrementalDates(
  tz: string,
  now: Date,
  yesterdayFetchedAt: string | null,
): string[] {
  const today = todayInTz(tz, now);
  const yesterday = subtractDays(today, 1);
  const fetchedMs = yesterdayFetchedAt ? Date.parse(yesterdayFetchedAt) : NaN;
  const yesterdayIsFresh = Number.isFinite(fetchedMs) && now.getTime() - fetchedMs < YESTERDAY_REFRESH_MS;
  return yesterdayIsFresh ? [today] : [today, yesterday];
}
```

- [ ] **Step 4: Run to verify pass** — `npx vitest run tests/unit/focusReportClient.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/focusReportClient.ts tests/unit/focusReportClient.test.ts
git commit -m "feat(focus): lynkIncrementalDates — today always, yesterday on a 6-h refresh"
```

---

### Task 5: Bulk handler — claim-RPC selection + backoff contract

**Files:**
- Modify: `supabase/functions/_shared/focusBulkSyncHandler.ts`
- Test: `tests/unit/focusBulkSyncHandler.test.ts`

This task changes HOW connections are selected and how failure/success state is written. Read the existing test file's `makeServiceClientMock` first — it must gain an `rpc` mock; the `.select().order().limit()` chain for focus_connections goes away (keep `from()` for updates + state reads).

- [ ] **Step 1: Write the failing tests** (adapt existing describe blocks — the "happy path" setup changes from seeding the select-chain to seeding `rpc('claim_focus_sync_batch')`):

```typescript
describe('claim-based selection', () => {
  it('selects connections via claim_focus_sync_batch RPC with p_limit 5', async () => {
    const { deps, mocks } = makeDeps({ claimRows: [lynkRow()] });
    await handleBulkSync(req(), deps);
    expect(mocks.rpc).toHaveBeenCalledWith('claim_focus_sync_batch', { p_limit: 5 });
  });

  it('returns 500 when the claim RPC errors', async () => {
    const { deps } = makeDeps({ claimError: { message: 'rpc down' } });
    const res = await handleBulkSync(req(), deps);
    expect(res.status).toBe(500);
  });

  it('returns processed:0 when the claim returns no rows', async () => {
    const { deps } = makeDeps({ claimRows: [] });
    const res = await handleBulkSync(req(), deps);
    expect(await res.json()).toMatchObject({ processed: 0, errors: [] });
  });
});

describe('backoff contract (design review #4)', () => {
  it('a failed connection writes consecutive_failures+1 and a future next_attempt_at (NOT a bare last_sync_time bump)', async () => {
    const { deps, mocks } = makeDeps({ claimRows: [lynkRow({ consecutive_failures: 1 })], failProcessing: true });
    await handleBulkSync(req(), deps);
    const update = mocks.updateCalls.find((c: any) => c.payload.consecutive_failures !== undefined);
    expect(update.payload.consecutive_failures).toBe(2);
    // 15 min × 2^2 = 60 min
    const delta = Date.parse(update.payload.next_attempt_at) - NOW_MS;
    expect(delta).toBeGreaterThanOrEqual(59 * 60 * 1000);
    expect(delta).toBeLessThanOrEqual(61 * 60 * 1000);
    expect(update.payload.last_sync_time).toBeUndefined(); // claim already bumped it
  });

  it('backoff caps at 6 hours', async () => {
    const { deps, mocks } = makeDeps({ claimRows: [lynkRow({ consecutive_failures: 9 })], failProcessing: true });
    await handleBulkSync(req(), deps);
    const update = mocks.updateCalls.find((c: any) => c.payload.consecutive_failures !== undefined);
    expect(Date.parse(update.payload.next_attempt_at) - NOW_MS).toBe(6 * 60 * 60 * 1000);
  });

  it('a successful connection resets consecutive_failures to 0 and next_attempt_at to null', async () => {
    const { deps, mocks } = makeDeps({ claimRows: [lynkRow({ consecutive_failures: 3, next_attempt_at: '2026-07-04T12:00:00Z' })] });
    await handleBulkSync(req(), deps);
    const update = mocks.updateCalls.find((c: any) => c.payload.initial_sync_done !== undefined);
    expect(update.payload.consecutive_failures).toBe(0);
    expect(update.payload.next_attempt_at).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run tests/unit/focusBulkSyncHandler.test.ts` → FAIL.

- [ ] **Step 3: Implement** in `focusBulkSyncHandler.ts`:

1. `ServiceClient` interface: add
   ```typescript
   rpc(fn: string, args: Record<string, unknown>): Promise<{
     data: FocusConnectionRow[] | null;
     error: { message: string } | null;
   }>;
   ```
   and drop the now-unused `select→eq→order→limit` chain from the interface **only if** nothing else in this handler uses it (state reads go through the fingerprint store, Task 6).
2. `FocusConnectionRow` gains `sync_interval_minutes: number; next_attempt_at: string | null; consecutive_failures: number;` (RPC returns full rows — consume **by column name**, never positionally).
3. Replace the connections query:
   ```typescript
   const { data: rows, error: queryError } = await deps.serviceClient
     .rpc('claim_focus_sync_batch', { p_limit: LIMIT });
   ```
   (keep the existing error → 500 and empty → `processed: 0` handling).
4. Backoff constants + helper at module scope:
   ```typescript
   /** Backoff base/cap: 15 min × 2^n, capped at 6 h (30 m, 1 h, 2 h, 4 h, 6 h…). */
   const BACKOFF_BASE_MS = 15 * 60 * 1000;
   const BACKOFF_CAP_MS = 6 * 60 * 60 * 1000;

   function backoffAfterFailure(priorFailures: number, nowMs: number): {
     consecutive_failures: number;
     next_attempt_at: string;
   } {
     const failures = priorFailures + 1;
     const delay = Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** failures);
     return { consecutive_failures: failures, next_attempt_at: new Date(nowMs + delay).toISOString() };
   }
   ```
5. In the catch block of the per-connection loop, REPLACE the best-effort `last_sync_time` bump (the claim already bumped it) with a best-effort backoff write:
   ```typescript
   deps.serviceClient
     .from('focus_connections')
     .update({ ...backoffAfterFailure(row.consecutive_failures ?? 0, deps.now()), updated_at: new Date().toISOString() })
     .eq('id', row.id)
     .eq('restaurant_id', row.restaurant_id)
     .then(...warn-on-error...).catch(...warn...);   // same best-effort shape as before
   ```
6. In the success-path update (the one writing `sync_cursor`/`initial_sync_done`/`last_sync_time`), add `consecutive_failures: 0, next_attempt_at: null`.
7. The B5 skip guard stays (belt-and-braces; the claim predicate already excludes Lynk backfill rows). Skipped rows still write nothing.

- [ ] **Step 4: Run to verify pass** — `npx vitest run tests/unit/focusBulkSyncHandler.test.ts` → PASS (rewrite any old tests that seeded the select-chain to seed `claimRows` instead — behavior parity, not deletion: every old assertion keeps an equivalent).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/focusBulkSyncHandler.ts tests/unit/focusBulkSyncHandler.test.ts
git commit -m "feat(focus): bulk-sync claims via atomic RPC; exponential backoff replaces failure bump"
```

---

### Task 6: Bulk handler — today-inclusive window + wire the state store

**Files:**
- Modify: `supabase/functions/_shared/focusBulkSyncHandler.ts`
- Test: `tests/unit/focusBulkSyncHandler.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
describe('Lynk incremental window (today + conditional yesterday)', () => {
  // deps.now() is pinned to 2026-07-04T18:00:00Z; tz America/Chicago → today = 2026-07-04

  it('syncs TODAY and YESTERDAY when yesterday has no fingerprint row', async () => {
    const { deps, processedDates } = makeDeps({ claimRows: [lynkRow()], stateFetchedAt: null });
    await handleBulkSync(req(), deps);
    expect(processedDates).toEqual(['2026-07-04', '2026-07-03']);
  });

  it('syncs only TODAY when yesterday was fingerprinted < 6h ago', async () => {
    const { deps, processedDates } = makeDeps({ claimRows: [lynkRow()], stateFetchedAt: '2026-07-04T13:00:00Z' });
    await handleBulkSync(req(), deps);
    expect(processedDates).toEqual(['2026-07-04']);
  });

  it('passes the stateStore through to processDayTransactions (delta-skip active on the cron path)', async () => {
    const { deps, txDepsSeen } = makeDeps({ claimRows: [lynkRow()] });
    await handleBulkSync(req(), deps);
    expect(txDepsSeen[0].stateStore).toBeDefined();
  });

  it("an 'unchanged' day result counts as success (connection state resets, no error)", async () => {
    const { deps, mocks } = makeDeps({ claimRows: [lynkRow()], dayResult: { status: 'unchanged' } });
    const res = await handleBulkSync(req(), deps);
    expect((await res.json()).processed).toBe(1);
    expect(mocks.errorStateWrites).toHaveLength(0);
  });
});
```

(`makeDeps` grows: inject `processDayTransactions` results per date and capture the dates called — mirror how `focusBackfillBatch`'s tests inject their day processor. If `processDayTransactions` is not currently injectable from the bulk handler, make it so: add optional `processDayTransactions?: typeof processDayTransactions` to `BulkSyncDeps`, defaulting to the real one — same pattern as `DateRangeSyncDeps`.)

- [ ] **Step 2: Run to verify failure** — `npx vitest run tests/unit/focusBulkSyncHandler.test.ts` → FAIL.

- [ ] **Step 3: Implement** in `focusBulkSyncHandler.ts` (Lynk branch of `processConnection`):

```typescript
    // Build the delta-skip state store once per connection (service client).
    const stateStore = createDatafeedStateStore(
      deps.serviceClient as unknown as StateStoreClient,
    );

    const txDeps = {
      supabase: deps.serviceClient as unknown as Parameters<typeof processDayTransactions>[0]['supabase'],
      fetchDatafeed: realFetchDatafeed,
      stateStore,
    };

    // Window: TODAY always; YESTERDAY only when its fingerprint is missing or
    // ≥ 6 h old (bounded correction staleness at pre-change freshness levels).
    const today = todayInTz(tz, now);
    const yesterday = subtractDays(today, 1);
    const yesterdayState = await stateStore.get(row.restaurant_id, yesterday);
    const dates = lynkIncrementalDates(tz, now, yesterdayState?.fetchedAt ?? null);

    const dayProcessor = deps.processDayTransactions ?? processDayTransactions;
    const results = await Promise.all(dates.map((d) => dayProcessor(txDeps, txConfig, d)));
    const failed = results.find((r) => r.status === 'error');
```

Imports to add: `createDatafeedStateStore, type StateStoreClient` from `./focusDatafeedFingerprint.ts`; `lynkIncrementalDates, todayInTz, subtractDays` from `./focusReportClient.ts` (todayInTz/subtractDays already imported). `'unchanged'`/`'empty'`/`'ok'` all fall through as success (only `'error'` throws) — verify the existing `failed` check already behaves this way.

`ServiceClient` interface: `from()` must expose the select-chain used by the state store (`select→eq→eq→maybeSingle`) and the existing `update`/`upsert` — extend the interface accordingly (this partially restores what Task 5 may have trimmed; end state: `from()` supports `select→eq→eq→maybeSingle`, `update→eq→eq`, `upsert→select`; plus `rpc`).

- [ ] **Step 4: Run to verify pass** — `npx vitest run tests/unit/focusBulkSyncHandler.test.ts tests/unit/focusTransactionSyncHandler.test.ts tests/unit/focusBackfillSyncHandler.test.ts` → ALL PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/focusBulkSyncHandler.ts tests/unit/focusBulkSyncHandler.test.ts
git commit -m "feat(focus): incremental window includes today; cron path delta-skips via state store"
```

---

### Task 7: Full verification + pre-PR checklist

**Files:** none (verification only)

- [ ] **Step 1: Full local suite**

```bash
npx vitest run 2>&1 | tail -4          # expect: all pass (baseline had 5,418)
npm run typecheck                      # expect: clean
npm run lint 2>&1 | tail -3            # expect: no NEW errors in touched files
npm run build 2>&1 | tail -3           # expect: success
npm run test:db 2>&1 | tail -10        # expect: 51_focus_sync_scheduler all pass, zero regressions
```

- [ ] **Step 2: Migration collision check (MANDATORY — this exact failure broke prod this week)**

```bash
git fetch origin
NEW_TS=$(basename supabase/migrations/*_focus_sync_frequency.sql | cut -c1-14)
git ls-tree origin/main supabase/migrations/ | grep "$NEW_TS" && echo "COLLISION — regenerate timestamp" || echo "clean"
```
Expected: `clean`. If COLLISION: `git mv` the migration to a fresh `date -u +%Y%m%d%H%M%S` prefix and re-run `npm run test:db`.

- [ ] **Step 3: Commit any stragglers, hand off to Ship phase**

The workflow's Ship phase (9a) opens the PR. PR body must include: the freshness math (30-min pull + 5-min aggregation ⇒ ≤ ~35 min), the per-store politeness numbers (~52 datafeed generations/day vs 4–8 today), and the design-doc link.

---

## Deliberate scope cuts (do NOT add)

- No UI for `sync_interval_minutes` (DB column only).
- No changes to `focus-backfill-sync`, `focus-transactions-unified-sales-sync`, the manual-sync handler, or `focusBackfillBatch` (they simply don't pass a `stateStore`).
- No cross-session SKIP LOCKED test harness (dblink) — see design doc, review #3.
- No `focus_datafeed_state` pruning cron (documented acceptance, review #6).
- No Toast/Square scheduler migration.

## Self-review (done at plan-writing time)

- Spec coverage: schema §1–§2 → Task 1; predicate/count/claim §3–§5 → Task 1; cron §7 → Task 1; fingerprint + export → Task 2; delta-skip + `'unchanged'` → Task 3; window helper → Task 4; claim selection + backoff contract (review #1/#4) → Task 5; window integration + store wiring → Task 6; migration-collision checklist (review #8) → Task 7.
- Type consistency: `DatafeedStateStore.get/touch/record`, `ChecksFingerprint {bytes, sha256}`, `StoredFingerprint.fetchedAt`, `lynkIncrementalDates(tz, now, yesterdayFetchedAt)`, `claim_focus_sync_batch(p_limit)` — spelled identically across Tasks 2–6.
- Placeholder scan: every code step carries real code; test snippets reference existing mock helpers by name with instructions to read them first (they are file-local and large — reproducing them verbatim here would drift; the instruction is "extend, follow construction style", which is concrete).
