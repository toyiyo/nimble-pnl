# Sales vs Break-Even widget — clarity pass + POS day drill

**Date:** 2026-07-22
**Branch:** `feature/breakeven-widget-clarity`
**Component:** `src/components/budget/SalesVsBreakEvenChart.tsx`

## Problem

The widget reports *what happened* but never finishes the thought. An owner
opening the dashboard asks three questions — "did we make money?", "when do we
lose it?", "what do I do about it?" — and the current card answers none of them
directly. Two of the gaps are outright bugs.

User-approved scope: all seven findings below plus the routing change.

## Findings

| # | Finding | Kind |
|---|---------|------|
| 1 | Net result is missing — four stats force mental math | design |
| 2 | Today's partial day is graded as a full day | **bug** |
| 3 | Weekday pattern (the actual insight) is invisible | design |
| 4 | Tooltip discards `breakEven` / `delta` it already receives | design |
| 5 | Y-axis renders two ticks both reading `$3k` | **bug** |
| 6 | COGS variance is the quietest thing on the card | design |
| 7 | Hardcoded HSL bar colors; status encoded by hue alone | design |
| 8 | Bar click goes to `/reports`; should go to POS Sales for that day | behavior |

### 2 — the partial-day bug (most consequential)

`breakEvenCalculator.ts:59` builds `rollingSales` with `d.date <= todayStr`, then
`:141` maps **every** row — today included — through
`classifyDelta(delta, dailyBreakEven)`. A day that is three hours old is compared
against a full day's break-even target, scored as a large shortfall, and folded
into `daysBelow`, `avgShortfall`, and by extension everything the card prints.

Observed on the user's dashboard: complete days average **−$394** short; today's
in-progress $240 drags the printed `avgShortfall` to **−$581**, and flips the
fortnight's net from **+$1,756** to **−$136**. A profitable two weeks rendered as
a loss.

### 5 — the axis bug

`tickFormatter={(v) => \`$${(v / 1000).toFixed(0)}k\`}` rounds to whole
thousands. Recharts' auto-ticks at ~2,512 and ~3,350 both render `$3k`.

## Approach

### A. `src/lib/breakEvenCalculator.ts` — partial-day awareness

Pure function, already unit-tested, and the only place this logic can live and
still be counted by the SonarCloud coverage gate (per `memory/lessons.md`
2026-07-20: source-text tests execute no product code).

- Tag each history row with `isPartial: date === todayStr`.
- Derive `daysAbove` / `daysBelow` / `avgSurplus` / `avgShortfall` from
  **complete days only**.
- Add `netDelta` (sum of `delta` over complete days) and `completeDays`.
- Leave `todaySales` / `todayStatus` / `todayDelta` untouched — the separate
  "Today" card legitimately reports progress-so-far and is out of scope.

**Timezone discipline:** "today" stays `startOfDay(new Date())` in browser-local
time, exactly as `useBreakEvenAnalysis.tsx:103` already computes it. We compare
`date === todayStr` — string equality against the same `todayStr` already passed
in. No new timezone semantics are introduced. This is deliberate: `lessons.md`
2026-07-21 documents that making a shared bucketing helper timezone-aware broke
a unit test and an E2E at once. Not this PR.

### B. `src/lib/breakEvenInsights.ts` (new) — weekday pattern

A pure, fully-testable function `deriveWeekdayPattern(history)` that returns a
plain-language sentence, or `null` when the data doesn't support a claim.

Two outcomes, in priority order:

1. **Clean split** — every weekday present is *consistently* above or
   *consistently* below, both groups non-empty. Yields: "Mon–Thu never break
   even; Fri–Sun always do. The gap averages $1,043/day."
2. **Weakest day** — no clean split, but one weekday has a materially worse
   average delta. Yields: "Tue is your weakest day, averaging $612 below
   break-even."

Returns `null` when fewer than 7 complete days exist, or when no weekday has ≥2
samples — an insight asserted from one Tuesday is noise.

Weekday derived with `parseLocalDate` (already in `breakEvenCalculator.ts`,
extracted to a shared spot) — **not** `parseISO`, which reads bare date strings
as UTC and shifts the weekday back a day in negative UTC offsets.

**Rendered as visible copy.** Per `memory/lessons.md` 2026-07-22 (the lesson this
author wrote three days ago): a derived sentence good enough to be an
`aria-label` is good enough to be on screen. This string renders in a visible
`<p>`; it is not an `sr-only` summary.

### C. `SalesVsBreakEvenChart.tsx` — the card

- **Verdict strip** above the chart: net figure (large, `text-success` /
  `text-destructive`), a plain-language clause, and the period it covers
  ("13 complete days"). Answers finding 1.
- **Weekday axis**: `format(date, 'EEEEE')` initial above the existing `MMM d`.
  Answers finding 3.
- **Tooltip**: custom `content` renderer showing Sales, Break-even, and a signed
  Surplus/Shortfall; for the partial day, "In progress" instead of a verdict.
  Answers finding 4.
- **Y-axis**: `tickFormatter` gains one decimal below $10k (`$2.5k`), whole
  thousands above. Answers finding 5.
- **COGS row**: gains a variance chip (`+18.9 pts over target`) in
  `text-destructive` when actual exceeds target, and a period label. Answers
  finding 6.
- **Colors**: `hsl(var(--success))` / `hsl(var(--destructive))` /
  `hsl(var(--warning))`. All three tokens already exist in `src/index.css` with
  dark-mode variants and Tailwind classes. Status additionally carries a signed
  number, so hue is no longer the sole encoding. Answers finding 7.
- **Partial bar**: rendered with an SVG `<pattern>` hatch + `--warning` stroke,
  so "not yet judged" is visible without relying on color alone.
- **Click**: moves from the chart-level `onClick` (which fires anywhere in the
  active category, including empty space above a bar) to `<Bar onClick>`.

### D. Routing — `/pos-sales?startDate=<d>&endDate=<d>`

`navigate('/reports', { state: {...} })` becomes
`navigate('/pos-sales?startDate=${date}&endDate=${date}')`.

`POSSales.tsx:132-133` currently seeds both dates from `useState` and never reads
the URL, so it needs an entry point. **Search params, not `location.state`**:

- survives refresh and is shareable/bookmarkable (`location.state` is not);
- `useSearchParams` is the established convention across the codebase;
- keeps POS Sales' existing local-state editing intact — we seed the initial
  value only, we do not make the URL the ongoing source of truth (that would be
  a larger refactor and risks fighting the 8 other filters on that page).

Invalid or absent params fall back to the current defaults (last 30 days).
Validation: `/^\d{4}-\d{2}-\d{2}$/` and a real-date check, so
`?startDate=potato` cannot poison the query.

### E. Help doc

`src/content/help/financials-and-accounting/budget-break-even.md:146` documents
the old click target verbatim. Updated in the same PR.

## Decided trade-offs

- **Not making the widget timezone-aware.** Correct-in-principle, but it is a
  cross-cutting change with a documented history of breaking tests, and it is
  orthogonal to all eight findings. Filed as follow-up.
- **Not making POS Sales' URL bidirectional.** Seeding-only. Writing every filter
  change back to the URL is a separate, larger change.
- **`todayStatus` / `todayDelta` keep their current meaning.** Other consumers
  (`MonthlyBreakEvenStrip`, the Today card) depend on them; redefining them would
  silently change unrelated surfaces.

## Test plan

| Area | Tests |
|---|---|
| `breakEvenCalculator` | partial day excluded from counts + averages; `netDelta` over complete days only; no-partial-row case; all-partial edge case |
| `breakEvenInsights` | clean weekday split; no-split → weakest day; insufficient data → `null`; weekday derivation correct in a negative UTC offset |
| `SalesVsBreakEvenChart` | net rendered; weekday labels present; partial bar marked; tooltip shows delta; navigates to `/pos-sales?startDate=…&endDate=…` |
| `POSSales` | seeds dates from search params; ignores malformed params; falls back to 30-day default |

Full suite additionally run under `TZ=UTC` (per `lessons.md` 2026-07-21) since
this PR touches date-derived rendering.
