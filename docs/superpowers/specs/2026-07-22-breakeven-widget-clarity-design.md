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
- `history[].status` also keeps its current value (other consumers read it);
  **the chart must branch on `isPartial` before `status`** — see C.

**The bar fill is part of this fix, not cosmetic.** Fixing only the aggregates
would leave today's bar rendering solid red from the unchanged
`classifyDelta` result — the widget would print "13 complete days, +$1,756"
above a chart that still visually says today failed. The partial row therefore
gets its **own render branch** in the chart: `--warning` fill, hatch overlay,
never the `above`/`below` fill, regardless of what `status` says.

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
extracted to a shared spot) — **not** native `new Date('yyyy-MM-dd')`, which
reads a bare date string as UTC midnight and shifts the weekday back a day in
negative UTC offsets.

**Rendered as visible copy.** Per `memory/lessons.md` 2026-07-22 (the lesson this
author wrote three days ago): a derived sentence good enough to be an
`aria-label` is good enough to be on screen. This string renders in a visible
`<p>`; it is not an `sr-only` summary.

### C. `SalesVsBreakEvenChart.tsx` — the card

- **Verdict strip** above the chart: net figure at `text-[17px] font-semibold`
  (`text-success` / `text-destructive`) — the top of the CLAUDE.md scale, and
  what the sibling `BreakEvenHeroCard` uses for its largest number — plus a
  plain-language clause and the period it covers ("13 complete days").
  Answers finding 1.
- **Weekday axis**: `format(date, 'EEEEEE')` — the **two-letter** form. The
  narrow `EEEEE` form renders Tue and Thu both as `T`, Sat and Sun both as `S`,
  which swaps "invisible" for "ambiguous" and defeats the point. Two lines
  (weekday over `MMM d`) require a custom `tick` **render function** emitting
  `<tspan>`s; Recharts' `tickFormatter` returns a single string and cannot do
  this. Answers finding 3.
- **Tooltip**: custom `content` renderer showing Sales, Break-even, and a signed
  Surplus/Shortfall; for the partial day, "In progress" instead of a verdict.
  Recharts ignores `contentStyle` once `content` is set, so the renderer must
  reproduce the `bg-background` / `border-border/40` / `rounded-lg` styling
  itself or the tooltip regresses to an unstyled default box. Answers finding 4.
- **Y-axis**: `tickFormatter` gains one decimal below $10k (`$2.5k`), whole
  thousands above. Answers finding 5.
- **COGS row**: gains a variance chip (`+18.9 pts over target`) in
  `text-destructive` when actual exceeds target, and a period label. Answers
  finding 6.
- **Colors**: `hsl(var(--success))` / `hsl(var(--destructive))` /
  `hsl(var(--warning))`. All three tokens already exist in `src/index.css` with
  dark-mode variants and Tailwind classes. Status additionally carries a signed
  number, so hue is no longer the sole encoding. The three existing
  `text-green-600` literals (`:172`, `:180`, `:206`) are folded into the same
  swap — leaving them beside new `text-success` in one file is an inconsistency.
  Answers finding 7.
- **Partial bar**: `--warning` fill plus an SVG `<pattern>` hatch, so "not yet
  judged" survives without relying on color alone. Pattern id via `useId()`
  (the widget mounts on two pages; a fixed id risks `url(#id)` collisions) and
  `patternUnits="userSpaceOnUse"` so hatch density doesn't stretch with bar
  width. At `h-56` over 14 bars each bar is only ~10–14px wide, so the hatch
  needs a **visual** spot-check in Phase 5, not just code review.
- **Click**: moves from the chart-level `onClick` (which fires anywhere in the
  active category, including empty space above a bar) to `<Bar onClick>`,
  reading `entry.payload.date` rather than `entry.date` — Recharts merges
  computed geometry keys onto the handler argument, and `.payload` is the
  guaranteed-untouched original datum.
- **Keyboard access for the bars.** `<Bar onClick>` alone is mouse/touch-only:
  Recharts emits plain SVG shapes with no `tabIndex`, `role`, or key handling.
  Shipping a click target no keyboard user can reach is the same
  visible-to-some-users-only failure as the aria-label-only bug, on the input
  side. Each bar shape gets `tabIndex={0}`, `role="button"`, an `onKeyDown`
  handling Enter and Space, a visible `:focus-visible` ring, and an accessible
  name carrying date, sales, and signed delta.
- **Error state.** `useBreakEvenAnalysis` already returns `error`
  (`useBreakEvenAnalysis.tsx:97-100`) and **neither** call site captures it, so a
  fetch/RLS failure currently falls through to the empty state and tells the
  owner "Set up your budget" — wrong and alarming. Add an `error` prop, render a
  distinct error branch, and wire it at both call sites. CLAUDE.md's "Always
  Handle States" rule; this is the natural moment to close it.

### D. Routing — `/pos-sales?startDate=<d>&endDate=<d>`

`navigate('/reports', { state: {...} })` becomes
`navigate('/pos-sales?startDate=${date}&endDate=${date}')`.

`POSSales.tsx:132-133` currently seeds both dates from `useState` and never reads
the URL, so it needs an entry point. **Search params, not `location.state`**:

- survives refresh and is shareable/bookmarkable (`location.state` is not);
- `useSearchParams` is the established convention across the codebase;
- keeps POS Sales' existing local-state editing intact — the URL is an entry
  point, not the ongoing source of truth (full bidirectional sync would fight
  the 8 other filters on that page).

**Applied via `useEffect` keyed on `[searchParams]`, not a `useState` lazy
initializer.** `Recipes.tsx:91-97` and `Inventory.tsx:94-101` already consume
incoming params this way, and it is the more resilient shape: a lazy initializer
runs once at mount and therefore depends on the invariant that arriving at
`/pos-sales` always remounts the page. That invariant holds today only because
`App.tsx` uses a flat `<Routes>` list with no layout routes or `<Outlet>` — a
future nested-route refactor would silently break seeding with nothing to catch
it. Matching the existing `useEffect` pattern removes the dependency on that
invariant and avoids introducing a second convention for the same job.

Invalid or absent params fall back to the current defaults (last 30 days).
Validation: `/^\d{4}-\d{2}-\d{2}$/`, a real-date check (so `2026-02-31` is
rejected, not just non-numeric junk), **and `startDate <= endDate`** — the widget
always sends an equal pair, but the whole rationale for search params is that
URLs get shared and hand-edited, and an inverted range would otherwise pass
validation and silently return zero rows.

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
| `breakEvenCalculator` | partial day excluded from counts + averages; `netDelta` over complete days only; no-partial-row case; all-partial edge case; `isPartial` set on exactly the `todayStr` row |
| `breakEvenInsights` | clean weekday split; no-split → weakest day; insufficient data → `null`; weekday derivation correct in a negative UTC offset |
| `SalesVsBreakEvenChart` | net rendered; two-letter weekday labels present and distinguish Tue/Thu; partial bar renders the warning fill **even when its delta is deeply negative** (the finding-#2 regression guard); tooltip shows delta; bar reachable by keyboard and Enter activates it; error prop renders the error branch, not the empty state; navigates to `/pos-sales?startDate=…&endDate=…` |
| `POSSales` | seeds dates from search params; **re-applies when already-mounted and params change** (not just a fresh mount); ignores malformed params; rejects inverted ranges; falls back to 30-day default |

Full suite additionally run under `TZ=UTC` (per `lessons.md` 2026-07-21) since
this PR touches date-derived rendering.
