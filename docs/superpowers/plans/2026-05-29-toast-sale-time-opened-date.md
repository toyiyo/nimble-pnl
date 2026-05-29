# Toast `sale_time` from `openedDate` — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Derive Toast `unified_sales.sale_time` from `openedDate` (service time) instead of `closedDate` (settle time), fixing the bogus 4 AM / late-night staffing bars. Backfill recent rows. `sale_date` unchanged.

**Architecture:** One new migration redefines both `sync_toast_to_unified_sales` overloads (replace the `closedDate` `sale_time` expression at all 4 insert sites in each) + a bounded backfill `DO` block. pgTAP proves the derivation.

**Tech Stack:** Supabase Postgres (plpgsql RPC), pgTAP.

**Spec:** `docs/superpowers/specs/2026-05-29-toast-sale-time-opened-date-design.md`

**Reference (current function):** `supabase/migrations/20260307130000_toast_derive_sale_time_from_closed_date.sql` — copy both function bodies verbatim, then apply the single find/replace below. Do NOT edit that file.

---

### Task 1: Failing pgTAP test

**Files:**
- Create: `supabase/tests/<next-free-number>_toast_sale_time_opened_date.sql`

- [ ] **Step 1: Write the test** (BEGIN/plan/ROLLBACK; disable RLS like test 38). Seed a restaurant (`America/Chicago`) and a `toast_orders` row with `raw_json` containing `openedDate` = `2026-05-29T23:30:00.000+0000` (→ 18:30 local) and `closedDate` = `2026-05-30T04:15:00.000+0000` (→ 23:15 local, *and* a 4 AM-UTC trap), plus one `toast_order_items` row (unit_price > 0, not voided). Then:

```sql
SELECT plan(4);
-- ... seed restaurants, toast_orders (openedDate/closedDate in raw_json), toast_order_items ...

-- Case 1: sale_time derives from openedDate (18:30 local), NOT closedDate
SELECT sync_toast_to_unified_sales('<rid>'::uuid, '2026-05-29'::date, '2026-05-31'::date);
SELECT is(
  (SELECT date_part('hour', sale_time)::int FROM unified_sales
   WHERE restaurant_id='<rid>' AND pos_system='toast' AND item_type='sale' LIMIT 1),
  18, 'sale_time hour comes from openedDate (local), not closedDate');

-- Case 2: openedDate absent -> falls back to closedDate (23 local)
-- (update raw_json to remove openedDate, re-sync, assert hour = 23)

-- Case 3: openedDate malformed ('not-a-date') -> no throw, falls back to closedDate
SELECT lives_ok($$ SELECT sync_toast_to_unified_sales('<rid>'::uuid, '2026-05-29'::date, '2026-05-31'::date) $$,
  'malformed openedDate does not abort sync');

-- Case 4: DST fall-back date — openedDate 2025-11-02T06:30:00Z -> 01:30 America/Chicago
SELECT is(
  (SELECT date_part('hour', ((raw->>'o')::timestamptz AT TIME ZONE 'America/Chicago'))::int
   FROM (SELECT '{"o":"2025-11-02T06:30:00.000+0000"}'::jsonb raw) t),
  1, 'DST fall-back converts to correct local hour');

SELECT * FROM finish();
```

- [ ] **Step 2: Run — verify it FAILS** (function still derives from closedDate)

Run: `npm run db:reset && npm run test:db 2>&1 | grep -A3 toast_sale_time`
Expected: Case 1 fails (hour is 23 from closedDate, not 18).

---

### Task 2: Migration — derive from openedDate

**Files:**
- Create: `supabase/migrations/20260529130000_toast_sale_time_from_opened_date.sql`

- [ ] **Step 1: Author the migration.** Copy BOTH `CREATE OR REPLACE FUNCTION sync_toast_to_unified_sales(...)` bodies from `20260307130000` verbatim, then in each body replace **every** occurrence (4 per overload, 8 total) of:

  **OLD:**
  ```sql
  CASE WHEN too.raw_json->>'closedDate' IS NOT NULL
       THEN ((too.raw_json->>'closedDate')::timestamptz AT TIME ZONE v_tz)::time
       ELSE too.order_time
  END
  ```
  **NEW:**
  ```sql
  COALESCE(
    CASE WHEN too.raw_json->>'openedDate' ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}'
         THEN ((too.raw_json->>'openedDate')::timestamptz AT TIME ZONE v_tz)::time END,
    CASE WHEN too.raw_json->>'closedDate' ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}'
         THEN ((too.raw_json->>'closedDate')::timestamptz AT TIME ZONE v_tz)::time END
  )
  ```

  Keep everything else identical (auth check, `v_tz` lookup, GUC flag, dedup deletes, `sale_date = too.order_date`, `ON CONFLICT … DO UPDATE SET sale_time = EXCLUDED.sale_time`, `SECURITY DEFINER`, `SET search_path = public`, `SET statement_timeout = '120s'`).

- [ ] **Step 2: Update both COMMENT ON FUNCTION** strings to:
  `'Syncs Toast orders to unified_sales. Derives sale_time from raw_json openedDate (service time) in restaurant timezone, falling back to closedDate. sale_date stays on businessDate.'`

- [ ] **Step 3: Append the bounded backfill** (after the function definitions):

```sql
DO $$
BEGIN
  SET LOCAL statement_timeout = '300s';
  UPDATE public.unified_sales us
  SET sale_time = ((too.raw_json->>'openedDate')::timestamptz AT TIME ZONE
                   COALESCE(r.timezone, 'America/Chicago'))::time
  FROM public.toast_orders too
  JOIN public.restaurants r ON r.id = too.restaurant_id
  WHERE us.pos_system = 'toast'
    AND us.external_order_id = too.toast_order_guid
    AND us.restaurant_id = too.restaurant_id
    AND us.item_type NOT IN ('tip','refund')
    AND us.sale_date > (CURRENT_DATE - INTERVAL '90 days')
    AND too.raw_json->>'openedDate' ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}';
END $$;
```

- [ ] **Step 4: Run — verify pgTAP PASSES**

Run: `npm run db:reset && npm run test:db 2>&1 | tail -20`
Expected: the new test file passes 4/4; no other db test regresses.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260529130000_toast_sale_time_from_opened_date.sql supabase/tests/*_toast_sale_time_opened_date.sql
git commit -m "fix(toast): derive sale_time from openedDate, not closedDate"
```

---

### Task 3: Confirm no consumer depends on closedDate semantics

- [ ] **Step 1:** `grep -rn "sale_time" src supabase/functions | grep -v test` — confirm consumers (`useAutomaticInventoryDeduction`, `useInventoryDeduction`, hourly aggregation) treat `sale_time` as service time / optional. Note findings in the PR body. No code change expected.

---

## Self-Review

- **Spec coverage:** openedDate derivation + regex guard + dropped order_time → Task 2 Step 1; COMMENT update → Step 2; bounded backfill → Step 3; pgTAP (4 cases incl. DST + malformed) → Task 1; consumer audit → Task 3. ✅
- **Placeholders:** the `<rid>`/`<next-free-number>` are concrete-at-build (seeded UUID, next test number) — not vague TODOs. The find/replace strings are exact.
- **Migration hygiene:** new file `20260529130000…` (> latest `20260529120000`); `20260307130000` untouched.
