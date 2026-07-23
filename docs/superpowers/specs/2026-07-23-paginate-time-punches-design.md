# Design: Paginate the `time_punches` fetches capped at PostgREST's 1000-row default

**Date:** 2026-07-23
**Author:** Claude (systematic-debugging → development-workflow)
**Status:** Approved. Original scope was 3 hooks; a 4th call site
(`useTimePunches.tsx`) surfaced in Phase 7a review and the user explicitly chose
to **fold it into this PR** — so this PR now paginates **4** `time_punches`
fetches.

## Problem

The `/labor` page (and the Dashboard labor card) showed **$0 labor for recent
days** for a restaurant that clearly had staff on the clock. Root cause, proven
against production:

`useLaborCostsFromTimeTracking` fetches `time_punches` for an **18-week window**
with a single **unpaginated** `.select('*')`. PostgREST caps any unpaginated
response at its default `db-max-rows = 1000`, returning only the **oldest 1,000**
rows (the query is `order('punch_time', ascending)`) and silently dropping
everything newer. Once a restaurant accumulates >1,000 punches in the window,
the most recent days lose their punches → the payroll-grade KPI computes $0.
The boundary creeps earlier as punches accumulate (matches the reported symptom:
"the 20th works, the 21st+ is blank," and two days later the 22nd went blank
too).

### Evidence (production, restaurant `7c0c76e3-…`, tz America/Chicago)

| Check | Result |
|---|---|
| Total punches in the 18-week window | **1,039** (> 1,000) |
| Punches per day | 18–50/day (7–19 employees) — normal, no data-quality issue |
| Worst single employee-day | 6 punches (a split shift) — no runaway/duplicates |
| Punch types | 515 `clock_in` + 522 `clock_out` + 2 `break_start` — clean pairs |
| 1,000th row (asc) lands at | 2026-07-21 16:59 UTC → Jul 21 afternoon onward dropped |
| Full data → Jul 22 labor | **$586.72** |
| Truncated (oldest 1,000) → Jul 22 | **$0** |

The count is legitimate: the *window* is 18 weeks wide (~126 days × ~25
punches), not a single day. The single-day view is a **client-side filter
applied after the already-truncated fetch**. The intraday chart renders because
its data path (`useSplhData.fetchAllPunches`) already paginates via `.range()`.

### The affected fetches (same latent bug)

| Site | Feeds | Error handling |
|---|---|---|
| `src/hooks/useLaborCostsFromTimeTracking.tsx:100` | /labor KPI + Dashboard card | `throw` |
| `src/hooks/usePayroll.tsx:144` | Payroll calculation (pay to employees) | `throw` |
| `src/hooks/useMonthlyMetrics.tsx:368` | Monthly P&L labor | `console.warn` (non-fatal) |
| `src/hooks/useTimePunches.tsx:46` | Time Punches manager + Tips screens (`TimePunchesManager.tsx`, `Tips.tsx`) | `throw`; `console.warn` on page-cap |

The first three share the exact shape: `.select('*').eq('restaurant_id', …)
.gte('punch_time', <instant>.toISOString()).lte('punch_time', <instant>.toISOString())
.order('punch_time', { ascending: true })` with **no `.range()`/`.limit()`**.

Already-correct (paginated, out of scope): `useSplhData.ts`,
`useWeekStaffingSuggestions.ts`.

## Goals

1. Every `time_punches` fetch that spans a multi-week window must retrieve **all**
   matching rows, not the oldest 1,000.
2. Page boundaries must be **deterministic** (no skipped/duplicated rows).
3. Truncation beyond a hard page cap must be **surfaced**, never silent.
4. One shared, unit-tested helper — not three copies of a `.range()` loop.

## Non-goals

- Narrowing the 18-week fetch window (it also feeds the busy-hours heatmap and
  enables preset switching without a refetch — narrowing would regress those).
- Refactoring the already-correct `useSplhData` / `useWeekStaffingSuggestions`
  to use the new helper. They work; changing code that feeds the working chart
  adds blast radius for no user-facing gain. (Noted as a possible future DRY.)
- Any schema, RLS, migration, or RPC change. This is client-side read
  pagination only.

## Design

### New shared helper: `src/utils/fetchAllRows.ts`

A higher-order paginated fetch. The caller passes a `buildPage(from, to)`
callback that returns the awaitable Supabase query with `.range(from, to)`
applied; the helper runs the loop and reports truncation. This keeps each
caller's exact `select`/filter/order intact while removing the duplicated loop.

```ts
export const SUPABASE_MAX_ROWS = 1000; // PostgREST db-max-rows default
export const DEFAULT_MAX_PAGES = 20;   // 20k-row backstop; surfaced via `capped`

export interface PagedResult<T> {
  rows: T[];
  /** True when the loop hit maxPages — results may be truncated. */
  capped: boolean;
}

export async function fetchAllRows<T>(
  buildPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
  opts?: { pageSize?: number; maxPages?: number },
): Promise<PagedResult<T>> {
  const pageSize = opts?.pageSize ?? SUPABASE_MAX_ROWS;
  const maxPages = opts?.maxPages ?? DEFAULT_MAX_PAGES;
  const rows: T[] = [];
  for (let page = 0; page < maxPages; page++) {
    const from = page * pageSize;
    const { data, error } = await buildPage(from, from + pageSize - 1);
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < pageSize) return { rows, capped: false };
  }
  return { rows, capped: true };
}
```

Mirrors the semantics already proven in `useSplhData` (PAGE=1000, MAX_PAGES=20,
`capped` on overflow), extracted so it is independently testable.

### Applying to each hook

At every site, replace the single unpaginated query with:

```ts
const { rows: punches, capped } = await fetchAllRows<DBTimePunch>((from, to) =>
  supabase
    .from('time_punches')
    .select('*')
    .eq('restaurant_id', restaurantId)
    .gte('punch_time', fetchStart.toISOString())
    .lte('punch_time', fetchEnd.toISOString())
    .order('punch_time', { ascending: true })
    .order('id')            // deterministic page-boundary tiebreaker (see below)
    .range(from, to),
);
```

- **Keep `.select('*')`.** The existing `DBTimePunch → TimePunch` mapping reads
  many columns (`location`, `shift_id`, etc.). Narrowing would create a
  projection-string contract to test (lessons 2026-06) for zero benefit here.
- **Add `.order('id')` tiebreaker.** Currently these order only by
  `punch_time`. Two rows sharing a `punch_time` could straddle a 1,000-row page
  boundary and be skipped or duplicated. A unique final `ORDER BY` column makes
  OFFSET paging deterministic (lesson 2026-07-08, `useUnifiedSales`). This does
  not change any computed total — `calculateActualLaborCost` /
  `calculateEmployeePay` re-group and re-sort per employee internally.

### Surfacing `capped`

- **`useLaborCostsFromTimeTracking`** → add `capped` to its result and OR it
  into `useLaborPnlCore`'s existing `capped` (already surfaced as a banner on
  `/labor`). Real UX path.
- **`usePayroll` / `useMonthlyMetrics`** → `if (capped) console.warn(...)`.
  Matching their existing non-fatal logging. (In practice 20k punches in a pay
  period / month is unreachable; the warning is a safety signal only.)

## Testing

| Test | Level | Asserts |
|---|---|---|
| `tests/unit/fetchAllRows.test.ts` (new) | helper contract | advancing offsets (`[0,999]`,`[1000,1999]`…); no duplicate rows across pages; short final page → `capped:false`; hitting `maxPages` → `capped:true`; `error` propagates via throw |
| `tests/unit/useLaborCostsFromTimeTracking.pagination.test.ts` (new) | hook | mock supabase returns 1,039 punches across 2 pages → the newest day's labor is non-zero (bug fixed end-to-end); `.range` called with advancing offsets |
| `tests/unit/laborPunchPaginationRepro.test.ts` (kept) | calc symptom | full set → Jul 22 = $586.72; oldest-1,000 truncation → Jul 22 = $0 (proves the mechanism the fix defeats) |

## Risks & mitigations

- **Wrong page-boundary math** → contract test asserts offsets advance and no
  dup rows.
- **`.select('*')` + `.range()` typing** → `fetchAllRows` is generic over the
  row type; each caller keeps its existing `DBTimePunch` cast.
- **Behaviour change from added `id` ordering** → none to computed output
  (downstream re-sorts); only makes paging deterministic.

## Decided trade-offs

- Left `useSplhData`/`useWeekStaffingSuggestions` on their own inline loops
  rather than migrating them onto `fetchAllRows` now, to keep the blast radius
  on the reported bug. Future cleanup candidate.
- `capped` reports `true` if total rows are an exact multiple of
  `pageSize × maxPages` (the loop exits on the `for` bound rather than the
  short-page check) even though nothing was truncated. Accepted: mirrors the
  proven `useSplhData` pattern and is unreachable at current volumes (largest
  tenant 1,039 rows vs the 20,000-row cap, ~19× headroom).
- `.select('*')` pulls jsonb `location` + `photo_path`/`device_info`/`notes` on
  every page. Negligible at current volumes; revisit if a tenant's punch volume
  grows an order of magnitude.

## Out of scope for this PR (explicit)

- This fix changes only `.range()` pagination. The upstream instant-resolution
  logic that builds `fetchStart`/`fetchEnd` (`lookaheadPunchFetchRange` /
  `bufferPunchFetchRange`) is unchanged and **not** audited here — its
  timezone-boundary correctness is a separate concern.
- ~~`src/hooks/useTimePunches.tsx:46`~~ **— now IN scope (folded in).** Phase
  7a's Codex adversarial reviewer found this hook (feeds `TimePunchesManager`
  and `Tips.tsx`) runs the same unpaginated `time_punches` `.select()` with no
  `.range()`, ordered `punch_time desc` — the identical 1,000-row-truncation
  bug class. It was outside the original 3-hook scope; when surfaced, the user
  explicitly chose to **fold it into this PR**. Fixed with the same
  `fetchAllRows` swap + `.order('id')` tiebreaker (preserving this hook's DESC
  order), `console.warn` on page-cap (non-fatal, matching the manager/Tips
  read path), covered by `tests/unit/useTimePunches.pagination.test.ts`.

## Design-review outcome (Phase 2.5)

Supabase design reviewer: **no critical/major**. Verified against prod —
`idx_time_punches_restaurant_punch_time (restaurant_id, punch_time)` exists and
is actively used (no new index needed); `id` is the uuid PK (valid unique
tiebreaker); TIMESTAMPTZ + resolved `.toISOString()` filters are tz-safe; RLS
tenant isolation preserved (the `.eq('restaurant_id', …)` filter is rebuilt on
every page). Three minor notes folded in above.
