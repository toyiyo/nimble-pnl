# Design: Fix Revel `sold_at` timezone corruption (data-integrity, ASAP)

**Date:** 2026-07-21
**Author:** investigation via Revel dashboard + production DB audit
**Severity:** P1 — production data integrity; customer complaints; **auditor exposure** (numbers must reconcile to Revel POS)
**Scope:** Revel POS integration only (Toast/Square/others verified unaffected)

---

## 1. Summary

Revel sends order timestamps as **naive local time, no offset** (e.g. `created_date: "2026-07-19T07:32:16"`). Our ingest parses them with `new Date(raw).toISOString()` in a **UTC** edge runtime, which stamps the local wall-clock with `+00:00`. Result: `unified_sales.sold_at` / `revel_orders.sold_at` are **not valid instants** — they are the local wall-clock mislabeled as UTC, off by the establishment's UTC offset (5h CDT / 6h CST — it varies with DST).

Any screen that converts `sold_at` into the restaurant timezone (the **Labor / SPLH / staffing** views) shifts every sale ~5–6h earlier, dragging the day into the overnight. The Labor optimizer currently tells operators to **staff 1–6 AM and calls 3 AM the peak** for a store that opens at 7 AM.

## 2. Confirmed root cause (evidence)

Real production chain, Rush Bowls Kallison Ranch (`ae87f51e-…`), order `7975787`, 2026-07-19:

| Layer | Value | Verdict |
|---|---|---|
| Revel `raw_json.created_date` | `2026-07-19T07:32:16` (naive local) | input |
| Stored `order_time` / `sale_time` | `07:32:16` | ✅ local-correct |
| Stored `sold_at` | `2026-07-19T07:32:16+00:00` | ❌ true instant is `12:32:16Z` |
| `restaurants.timezone` | `America/Chicago` | ✅ correct |
| Revel Hourly Sales report | 0 sales before 7 AM; first bucket 7:00–7:59 AM | ground truth |
| POS Sales list (reads `sale_time`) | 7:32 AM | ✅ matches Revel |
| Labor heatmap (reads `sold_at`→Central) | 07:32Z − 5h = **2:32 AM** | ❌ the bug |

Defect site: [`parseDateTime`](../../../supabase/functions/_shared/revelOrderProcessor.ts) — `const d = new Date(rawDate); ... soldAt = d.toISOString()`.

## 3. Scope — what's broken vs safe

**Broken (reads `sold_at` as instant → tz):**
- `src/lib/splhAnalytics.ts` `hourOfSale` (Labor heatmap, staffing suggestions)
- `src/hooks/useHourlySalesPattern.ts`, `useSplhData.ts`, `useWeekStaffingSuggestions.ts`, `useSplhAnalytics.ts`

**Already correct (must NOT regress):**
- **Revenue/period totals** (`get_unified_sales_totals` / grouped RPC) filter by **`sale_date`**, not `sold_at`. The **dollar figures the auditor sees are keyed on the local business date and are already right.** The bug is intra-day *hour* attribution only. → Still must be **proven** by reconciliation (§7).
- **POS Sales list** reads `sale_time` (local) → correct.
- **Toast** stores `sold_at` from `closedDate` (carries offset) = a correct instant; its `sale_time` is the UTC-derived one. A global "prefer `sale_time`" change would **break Toast** — so we do NOT touch the shared read path. Fix is at the Revel source + a data backfill.

## 4. Goals / non-goals

**Goals**
1. New Revel orders store a correct `sold_at` instant (DST-aware, per establishment tz).
2. Backfill existing `revel_orders` + `unified_sales` so historical `sold_at` is correct.
3. Labor/hourly views show the true 7 AM–9 PM shape; no overnight staffing advice.
4. Prove daily revenue + hourly distribution reconcile to Revel (auditor requirement).
5. Regression tests so this class of bug can't return (time-of-day path is currently untested).

**Non-goals**
- No change to the shared labor read path / `hourOfSale` priority (would break Toast).
- No change to `sale_date` / `sale_time` semantics (already correct).
- Other POS adapters (separate audit ticket if desired).

## 5. Design

### 5a. Source fix — `revelOrderProcessor.ts`

Add a tz-aware helper (new `supabase/functions/_shared/timezone.ts`, no external dep, mirrors `date-fns-tz` `fromZonedTime`):

```ts
// Probe the IANA tz once and fall back to the documented restaurant default.
// (Lesson 2026-07-02: an invalid/empty/legacy tz string makes Intl THROW a
// RangeError — validate before it reaches formatToParts, don't let it crash sync.)
function safeTz(tz: string | null | undefined): string {
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz ?? 'UTC' }); return tz as string; }
  catch { return 'America/Chicago'; } // restaurants.timezone default (migration 20251001022351)
}

// Interpret a naive local datetime ("YYYY-MM-DDTHH:MM:SS", no offset) as wall-clock
// in `timeZone` and return the correct UTC instant. DST-aware via Intl.
export function zonedNaiveToUtc(naive: string, timeZone: string): Date {
  const tz = safeTz(timeZone);
  const m = naive.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return new Date(NaN);
  const [, y, mo, d, h, mi, s] = m;
  const guess = Date.UTC(+y, +mo - 1, +d, +h, +mi, +(s ?? 0));
  const offset = tzOffsetMs(new Date(guess), tz); // formatToParts round-trip
  return new Date(guess - offset);
}
```

**Anchoring-convention audit (lesson 2026-05-10):** flipping `sold_at` from
local-as-UTC to a true instant is an anchoring-convention change. Every
consumer was audited: labor/SPLH read it via `Intl`/tz conversion
(`hourOfSale`, `useHourlySalesPattern`, `useSplhData`,
`useWeekStaffingSuggestions`) → correct once `sold_at` is a true instant;
revenue/period totals key on `sale_date` (not `sold_at`) → unaffected. No
consumer reads raw `.getUTC*()` off `sold_at` expecting local digits.

Rewrite `parseDateTime(order, timeZone)`:
- If `created_date` **already carries an offset** (`Z` / `±hh:mm`) → `new Date(raw)` (defensive; real Revel data is naive).
- Else (naive) → `soldAt = zonedNaiveToUtc(raw, timeZone).toISOString()`.
- `orderTime` = the naive local `HH:MM:SS` (unchanged).
- `orderDate` = **business date computed in local space**: take the naive local wall-clock, subtract 2h, take the date (matches Revel's confirmed 2 AM boundary). Today the 2h shift is applied to the mis-zoned UTC value — move it into local space.

Thread the timezone in: `processOrder(...)` / `normalizeOrder(...)` gain a `timeZone` param. Each caller — `revel-webhook`, `revel-sync-data`, `revel-bulk-sync` — resolves `restaurants.timezone` **once per run** and passes it (fallback `'America/Chicago'`; log a warning if null so misconfigured stores surface).

### 5b. Backfill migration

Postgres `AT TIME ZONE` does the DST-aware conversion natively. Idempotent; safe to re-run.

```sql
-- 1) revel_orders: recompute sold_at from the authoritative raw naive local time
UPDATE public.revel_orders o
SET sold_at = (COALESCE(o.raw_json->>'created_date',
                        o.raw_json->'Order'->>'created_date'))::timestamp
              AT TIME ZONE COALESCE(r.timezone, 'America/Chicago')
FROM public.restaurants r
WHERE r.id = o.restaurant_id
  AND COALESCE(o.raw_json->>'created_date', o.raw_json->'Order'->>'created_date') IS NOT NULL;

-- 2) unified_sales: propagate corrected instant to every Revel row (sale + adjustments)
UPDATE public.unified_sales u
SET sold_at = o.sold_at
FROM public.revel_orders o
WHERE u.pos_system = 'revel'
  AND u.restaurant_id = o.restaurant_id
  AND u.external_order_id = o.revel_order_id
  AND u.sold_at IS DISTINCT FROM o.sold_at;
```

Notes: `::timestamp` strips any spurious label and treats digits as naive (correct for Revel's naive feed). Batch by `restaurant_id` if row counts are large. Emit a pre/post report of affected rows and any restaurant whose `timezone` is null.

### 5c. Sequencing (stops the bleeding without re-corrupting)

1. Deploy **source fix** (5a) first — new syncs write correct `sold_at`.
2. Run **backfill** (5b) — heals history.
   (Backfill reads `raw_json`, so it's independent of code; but doing it after the deploy avoids a window where new orders re-introduce bad data.)
3. Verify (§7). The corrected `unified_sales.sold_at` is the fast customer relief — the Labor read path already converts `sold_at`→tz correctly; only the data was wrong.

## 6. Tests (TDD — write failing first)

- **Unit `zonedNaiveToUtc`**: `"2026-07-19T07:32:16" / America/Chicago → 2026-07-19T12:32:16Z` (CDT −5); winter `"2026-01-15T07:32:16" → 13:32:16Z` (CST −6); a DST-transition day.
- **Unit `normalizeOrder`/`parseDateTime`**: fix the existing fixture (currently `+0000`, and it never asserts `sold_at`) → use naive `"2026-07-19T07:32:16"`; assert `sold_at === 2026-07-19T12:32:16Z`, `order_time === "07:32:16"`, `order_date === "2026-07-19"`.
- **pgTAP**: after backfill, `(sold_at AT TIME ZONE r.timezone)::time` equals `sale_time` (± rounding) for all Revel rows; `mismatches = 0`.
- **Regression**: a Toast fixture proving Toast `sold_at`/hour attribution is unchanged.

## 7. Verification / acceptance criteria

- [ ] New Revel order → `sold_at` is the correct instant (unit test green).
- [ ] Backfill: `SELECT count(*) FILTER (WHERE (u.sold_at AT TIME ZONE r.timezone)::time <> u.sale_time)` ≈ 0.
- [ ] **Labor view** (Rush Bowls Kallison Ranch): earliest sales hour = **7 AM**, peak midday; **no "staff 1–6 AM" / "Peak 3 AM"** callouts.
- [ ] **Auditor reconciliation**: `sum(total_price) WHERE item_type='sale'` grouped by `sale_date` matches Revel **Sales Summary → Total Product Sales** per business day for a sampled range.
- [ ] **Hourly reconciliation**: our sold_at→tz hourly distribution matches Revel **Hourly Sales** (0 before 7 AM; tail at 9 PM).
- [ ] **Toast** restaurant hourly/labor unchanged (regression).

## 8. Risks & mitigations

- **Other `sold_at` consumers** shift when it becomes a true instant → audited: all are SPLH/labor (tz-aware) or `sale_date`-keyed totals. Covered by §7 reconciliation + Toast regression.
- **Misconfigured `restaurants.timezone`** → backfill fallback `America/Chicago` + report null/UTC tz stores before running.
- **DST-transition ambiguity** (twice/year, 1h window) → negligible for open hours; standard `fromZonedTime` behavior; documented.
- **Large-table backfill cost** → batch by restaurant; run off-peak; idempotent.
- **Re-corruption window** → deploy source fix before backfill (§5c).

## 9. Rollback

- Code: revert the edge-function change (redeploy previous).
- Data: backfill is idempotent and recomputes from `raw_json`; re-running the corrected UPDATE restores correct values. Capture pre-change `sold_at` in a scratch table if a byte-for-byte revert is desired.

## 10. Deliverables

1. `supabase/functions/_shared/timezone.ts` (+ unit tests)
2. `revelOrderProcessor.ts` `parseDateTime` tz-aware; callers thread `timeZone`
3. Backfill migration (revel_orders + unified_sales) with pre/post report
4. Fixed + expanded unit tests; pgTAP reconciliation test; Toast regression test
5. Post-deploy verification notes (Labor view screenshot + reconciliation query output)
