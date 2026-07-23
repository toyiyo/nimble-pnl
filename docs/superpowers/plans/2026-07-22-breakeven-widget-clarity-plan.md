# Plan: Sales vs Break-Even widget clarity pass + POS day drill

**Spec:** `docs/superpowers/specs/2026-07-22-breakeven-widget-clarity-design.md`
**Branch:** `feature/breakeven-widget-clarity`

Each task is TDD: RED (failing test) → GREEN (minimal code) → REFACTOR → COMMIT.

---

## Task 1 — `BreakEvenData` gains partial-day fields (types only)

`src/types/operatingCosts.ts`

- `history[]` entries gain `isPartial: boolean`.
- `BreakEvenData` gains `netDelta: number` and `completeDays: number`.

No test of its own (types); `npm run typecheck` is the gate. Expect compile
errors at construction sites — Task 2 resolves them.

**Depends on:** nothing.

---

## Task 2 — `calculateBreakEven` excludes the partial day

`src/lib/breakEvenCalculator.ts`, `tests/unit/breakEvenCalculator.test.ts`

RED — new cases:
1. `isPartial` is `true` on exactly the `todayStr` row, `false` on all others.
2. A today row far below break-even does **not** increment `daysBelow` and does
   **not** move `avgShortfall`.
3. `netDelta` sums `delta` over complete days only.
4. `completeDays` equals `history.length - 1` when today is present, and
   `history.length` when it is not.
5. Edge: history containing only a partial row → `daysAbove`/`daysBelow` 0,
   `avgSurplus`/`avgShortfall` 0, `netDelta` 0, no divide-by-zero `NaN`.

GREEN — tag rows, split `completeHistory`, derive all four aggregates plus the
two new fields from it. `status`, `todaySales`, `todayStatus`, `todayDelta`
keep their current values.

**Depends on:** Task 1.

---

## Task 3 — `deriveWeekdayPattern` (new pure module)

`src/lib/breakEvenInsights.ts`, `tests/unit/breakEvenInsights.test.ts`

Signature: `deriveWeekdayPattern(history: BreakEvenHistoryEntry[]): string | null`

Rules (complete days only):
- `null` when fewer than 7 complete days, or when no weekday has ≥2 samples.
- **Clean split:** every weekday present is consistently above or consistently
  below, both groups non-empty → "Mon–Thu never break even; Fri–Sun always do.
  The gap averages $X/day."
- **Weakest day:** otherwise, the weekday with the worst average delta, when it
  is materially worse than the mean → "Tue is your weakest day, averaging $X
  below break-even."

RED — cases: clean split (the user's real 14-day shape); mixed data → weakest
day; 5 days → `null`; every weekday appearing once → `null`; all days above →
no "never break even" claim.

Weekday via the shared local-date parser (**not** `parseISO`, which reads bare
date strings as UTC and shifts the weekday in negative offsets). One test pins
this by running under a negative-offset date.

Consecutive-weekday runs are collapsed to a range ("Mon–Thu"); non-consecutive
sets are listed ("Mon, Wed, Fri").

**Depends on:** Task 1.

---

## Task 4 — Extract `parseLocalDate` to a shared module

`src/lib/parseLocalDate.ts` (moved out of `breakEvenCalculator.ts`)

Both Tasks 2 and 3 need it. Import it in `breakEvenCalculator.ts` and
`breakEvenInsights.ts`. Existing calculator tests must stay green.

> Note: per `memory/lessons.md` 2026-07-13, extracting shared code makes the
> moved lines count as **new** lines for the SonarCloud coverage gate. The new
> module gets its own direct unit test.

**Depends on:** Tasks 2, 3 (do it as the refactor step rather than up front, so
the tests exist before the move).

---

## Task 5 — Widget: verdict strip + net

`src/components/budget/SalesVsBreakEvenChart.tsx`,
`tests/unit/salesVsBreakEvenChart.test.tsx` (new)

Verdict strip above the chart: signed net at `text-[17px] font-semibold` in
`text-success`/`text-destructive`, plain-language clause, period covered
("13 complete days"). Rendered via React Testing Library assertions on visible
text — **not** source-text regex (those don't count for coverage).

**Depends on:** Task 2.

---

## Task 6 — Widget: partial bar owns its fill + hatch

Partial rows render `--warning` fill + `useId()`-scoped SVG `<pattern>` hatch
(`patternUnits="userSpaceOnUse"`), branching on `isPartial` **before** `status`.

RED — the finding-#2 regression guard: a partial row whose delta is deeply
negative must **not** render the destructive fill.

**Depends on:** Tasks 2, 5.

---

## Task 7 — Widget: two-letter weekday axis

Custom `tick` render function emitting two `<tspan>`s (weekday over `MMM d`);
`tickFormatter` cannot produce two lines.

RED — `EEEEEE` output distinguishes Tue (`Tu`) from Thu (`Th`).

**Depends on:** Task 5.

---

## Task 8 — Widget: custom tooltip

Sales / Break-even / signed Surplus-or-Shortfall; "In progress" for the partial
day. Reproduces `bg-background`, `border-border/40`, `rounded-lg` by hand
(Recharts drops `contentStyle` once `content` is set).

**Depends on:** Task 5.

---

## Task 9 — Widget: Y-axis tick formatter

One decimal below $10k, whole thousands above.

RED — the exact reported bug: 2512 and 3350 must not both format to `$3k`.

**Depends on:** Task 5.

---

## Task 10 — Widget: semantic color tokens

Replace the three hardcoded `hsl(...)` bar fills and the three `text-green-600`
literals (`:172`, `:180`, `:206`) with `--success` / `--destructive` /
`--warning` and `text-success`.

RED — a source-scan test asserting no raw `hsl(` literal and no `text-green-`
remains in this file. (Structural contract; Task 5's behavioral tests carry the
coverage.)

**Depends on:** Tasks 5, 6.

---

## Task 11 — Widget: COGS variance chip

Variance in points vs target, `text-destructive` when over, plus an explicit
period label. Handles either percentage being `undefined`.

**Depends on:** Task 5.

---

## Task 12 — Widget: weekday insight line

Render `deriveWeekdayPattern(...)` output as a **visible** `<p>` under the
chart. Hidden when `null`.

RED — asserts the sentence is in the accessible *and* visible tree; explicitly
**not** `sr-only`, per `memory/lessons.md` 2026-07-22.

**Depends on:** Tasks 3, 5.

---

## Task 13 — Widget: error state

Add the `error` prop + a distinct error branch; wire from `Index.tsx:701` and
`BudgetRunRate.tsx:235`.

RED — with `error` set, the card renders the error branch, not "Set up your
budget".

**Depends on:** Task 5.

---

## Task 14 — Bar click → POS Sales, with keyboard access

`<Bar onClick>` reading `entry.payload.date`; navigate to
`/pos-sales?startDate=<d>&endDate=<d>`. Each bar shape gets `tabIndex={0}`,
`role="button"`, `onKeyDown` (Enter/Space), a `:focus-visible` ring, and an
accessible name with date, sales, signed delta. Footer hint updated.

RED — click navigates to the right URL; Enter on a focused bar navigates
identically; the old `/reports` target is gone.

**Depends on:** Tasks 5, 6.

---

## Task 15 — `POSSales` reads the date search params

`src/pages/POSSales.tsx`, `tests/unit/posSalesSearchParamDates.test.tsx` (new)

`useEffect` keyed on `[searchParams]` (matching `Recipes.tsx:91-97`), applying
`startDate`/`endDate` when both are valid.

Validation: shape `/^\d{4}-\d{2}-\d{2}$/`, real-date round-trip, and
`startDate <= endDate`. Anything else → leave the existing defaults.

RED — seeds on mount; **re-applies on an already-mounted page when params
change**; rejects `potato`, `2026-02-31`, and an inverted range; defaults to
30 days when absent.

**Depends on:** Task 14.

---

## Task 16 — Help doc

`src/content/help/financials-and-accounting/budget-break-even.md:146` — update
the documented click target, and describe the new verdict/insight lines and the
in-progress bar.

**Depends on:** Tasks 12, 14.

---

## Verification (Phase 8)

`npm run typecheck`, `npm run lint`, `npm run test`, `npm run test:e2e`,
`npm run build` — plus one full `TZ=UTC npm run test` pass, since this PR adds
weekday derivation and partial-day detection (`memory/lessons.md` 2026-07-21).
