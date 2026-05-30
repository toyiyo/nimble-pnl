# Additive `sold_at` for Toast Service-Time — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans. Checkbox (`- [ ]`) steps.

**Goal:** Fix the bogus 4 AM / late-night staffing hours **non-breakingly** by adding a nullable `sold_at timestamptz` (absolute instant from Toast `openedDate`) and having the two hourly consumers convert at read; `sale_time`/`sale_date` untouched.

**Architecture:** New migration adds the column + extends both `sync_toast_to_unified_sales` overloads to populate `sold_at` + bounded backfill. `aggregateHourlySales` gains an optional `timeZone` and prefers `sold_at` (falls back to `sale_time`). `generate-schedule` does the same.

**Tech Stack:** Supabase Postgres (plpgsql), pgTAP, React/TS, Vitest, Deno edge fn.

**Spec:** `docs/superpowers/specs/2026-05-29-toast-sale-time-opened-date-design.md`

---

## Task 1: `aggregateHourlySales` prefers `sold_at` (TZ-aware)

**Files:** Modify `src/hooks/useHourlySalesPattern.ts`; Test `tests/unit/useHourlySalesPattern.test.ts` (create if absent)

- [ ] **Step 1: Failing test** — add `sold_at` to `RawSale`; assert hour comes from `sold_at` in the given tz, falls back to `sale_time` when `sold_at` null, and a DST-instant maps correctly.

```ts
import { aggregateHourlySales } from '@/hooks/useHourlySalesPattern';
// 2026-05-30T01:30:00Z == 2026-05-29 20:30 America/Chicago (CDT) -> hour 20
const rows = [{ sale_date: '2026-05-29', sale_time: '23:15:00', sold_at: '2026-05-30T01:30:00.000Z', total_price: 100 }];
const out = aggregateHourlySales(rows, 'America/Chicago');
expect(out.data[0].hour).toBe(20);            // from sold_at, not 23 from sale_time
const legacy = aggregateHourlySales([{ sale_date:'2026-05-29', sale_time:'14:00:00', sold_at:null, total_price:50 }], 'America/Chicago');
expect(legacy.data[0].hour).toBe(14);          // fallback to sale_time
```

- [ ] **Step 2: Run → FAIL** (`npx vitest run tests/unit/useHourlySalesPattern.test.ts`).

- [ ] **Step 3: Implement.** Add `sold_at?: string | null` to `RawSale`. Signature: `aggregateHourlySales(rawSales, timeZone = 'America/Chicago')`. Replace the hour derivation (line ~38-39) with:

```ts
function hourInTz(iso: string, tz: string): number {
  const s = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: '2-digit', hourCycle: 'h23' }).format(new Date(iso));
  return parseInt(s, 10);
}
// inside the loop:
let hour: number;
if (sale.sold_at) hour = hourInTz(sale.sold_at, timeZone);
else if (sale.sale_time) hour = parseInt(sale.sale_time.split(':')[0], 10);
else continue;
if (isNaN(hour)) continue;
```

- [ ] **Step 4: Run → PASS.** Then `git commit -m "feat(staffing): aggregateHourlySales prefers sold_at (tz-aware)"`.

---

### Task 2: Migration — add `sold_at`, populate from openedDate, backfill

**Files:** Create `supabase/migrations/<ts>_unified_sales_sold_at.sql`; Test `supabase/tests/<n>_unified_sales_sold_at.sql`

- [ ] **Step 0: Pick a non-colliding timestamp.** `git fetch origin main && ls supabase/migrations/202605*`. Use a timestamp strictly greater than the max present (start from `20260529130000`, bump if taken).

- [ ] **Step 1: Failing pgTAP** — seed a `toast_orders` row with `raw_json.openedDate`=`2026-05-30T01:30:00.000+0000` (→20:30 local) and `closedDate`=`2026-05-30T04:15:00.000+0000`; run `sync_toast_to_unified_sales(rid, range)`; assert `date_part('hour', sold_at AT TIME ZONE 'America/Chicago') = 20`. Cases: openedDate absent → falls back to closedDate; malformed openedDate → no throw, sold_at from closedDate; backfill populates a pre-existing NULL-`sold_at` row. Run → FAIL (column/derivation absent).

- [ ] **Step 2: Migration.**
  - `ALTER TABLE public.unified_sales ADD COLUMN IF NOT EXISTS sold_at timestamptz;` + `COMMENT ON COLUMN` (note: metadata-only, no rewrite; nullable; convert at read; no index intentional).
  - Copy BOTH `sync_toast_to_unified_sales` bodies from `20260307130000` verbatim. In each of the 4 item inserts (REVENUE/DISCOUNT/VOID/TAX): add `sold_at` to the column list and this SELECT expression:

    ```sql
    COALESCE(
      CASE WHEN too.raw_json->>'openedDate' ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}'
           THEN (too.raw_json->>'openedDate')::timestamptz END,
      CASE WHEN too.raw_json->>'closedDate' ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}'
           THEN (too.raw_json->>'closedDate')::timestamptz END
    )
    ```
    and to each `ON CONFLICT … DO UPDATE SET`: `sold_at = COALESCE(EXCLUDED.sold_at, unified_sales.sold_at)`. Leave `sale_time`/`sale_date` and everything else (auth, GUC, dedup deletes, SECURITY DEFINER, search_path, statement_timeout) byte-for-byte. TIP/REFUND inserts: do NOT add sold_at (stays NULL).
  - Backfill DO block (bounded 90 days, `sold_at IS NULL` guard, regex guard, exclude tip/refund) per the design §3.
  - Update both `COMMENT ON FUNCTION` to mention `sold_at` is populated from openedDate.

- [ ] **Step 3: `npm run db:reset && npm run test:db`** → new test passes; no regression (esp. existing toast accuracy tests, since sale_time/sale_date unchanged).

- [ ] **Step 4: Commit** `fix(toast): populate unified_sales.sold_at from openedDate`.

---

### Task 3: Wire the staffing query to `sold_at` + restaurant timezone

**Files:** Modify `src/components/scheduling/ShiftPlanner/StaffingOverlay.tsx` (and `useHourlySalesPattern.ts` query)

- [ ] **Step 1:** In both unified_sales selects (StaffingOverlay line ~79 and the `useHourlySalesPattern` query line ~103), add `sold_at` to the column list.
- [ ] **Step 2:** Resolve the restaurant timezone: `const tz = selectedRestaurant?.timezone ?? 'America/Chicago'` (from `useRestaurantContext`; verify the field exists on the restaurant row — it does in the `restaurants` table). Pass `tz` into `aggregateHourlySales(filtered, tz)` / `computeStaffingSuggestions` path.
- [ ] **Step 3:** `npm run typecheck` → PASS. Commit `feat(staffing): read sold_at with restaurant tz in overlay`.

---

### Task 4: `generate-schedule` — `sold_at` hour + day-of-week fix

**Files:** Modify `supabase/functions/generate-schedule/index.ts`

- [ ] **Step 1:** Add `sold_at` to the select (line ~191). Resolve restaurant `timezone` (the fn already loads the restaurant; read `.timezone`, default `America/Chicago`).
- [ ] **Step 2:** Replace the hour derivation (line ~390-395): if `sale.sold_at`, `hour = Number(new Intl.DateTimeFormat('en-US',{timeZone:tz,hour:'2-digit',hourCycle:'h23'}).format(new Date(sale.sold_at)))`; else fall back to the existing `sale_time` parse.
- [ ] **Step 3:** Fix the adjacent day-of-week bug (line ~388): `new Date(sale.sale_date + 'T12:00:00').getDay()` (was `new Date(sale.sale_date).getDay()`, UTC-wrong).
- [ ] **Step 4:** `deno check supabase/functions/generate-schedule/index.ts` (or project lint). Commit `fix(scheduler): use sold_at hour + local day-of-week`.

---

## Self-Review

- **Spec coverage:** column+populate+backfill → Task 2; aggregateHourlySales tz/sold_at → Task 1; overlay wiring → Task 3; generate-schedule + day fix → Task 4. ✅
- **Non-breaking:** `sale_time`/`sale_date` never written/changed; non-Toast rows have `sold_at` NULL → `sale_time` fallback → identical behavior. P&L/inventory untouched. ✅
- **Folded review concerns:** `sold_at IS NULL` backfill guard; `COALESCE(EXCLUDED.sold_at, unified_sales.sold_at)` upsert; optional `timeZone` default; `hourCycle:'h23'` (midnight = 0 not 24); migration-timestamp collision check (Task 2 Step 0); generate-schedule day-of-week fix.
