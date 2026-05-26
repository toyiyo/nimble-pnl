# Plan — Monthly Break-Even Progress

**Spec:** `docs/superpowers/specs/2026-05-26-budget-monthly-break-even-progress-design.md`

## Sequence

Tasks are ordered so each step lands a green test commit. T1 must land before T2/T3/T4 (they consume the pure function). T2/T3/T4 are independent of each other and can be parallelized via subagent dispatch. T5 is sequential after the components exist. T6/T7 are page wiring, sequential after the components.

### T1. Pure math + types ✅ unit-tested

**Files:**
- `src/lib/monthlyBreakEvenProgress.ts` — new
- `tests/unit/monthlyBreakEvenProgress.test.ts` — new
- `src/types/operatingCosts.ts` — modify (`BreakEvenData.monthlyProgress?: MonthlyProgress | null`, import the type from the lib)

**Behavior:**
- Export `MonthlyProgress` interface (the shape declared in §1 of the spec, but renamed `MonthlyProgress` not `monthlyProgress`).
- Export `calculateMonthlyProgress({ monthlyBreakEven, mtdSales, today })` returning `MonthlyProgress | null`.
- Status thresholds: ±5pp, mirroring `BREAK_EVEN_TOLERANCE`. Treat `monthlyBreakEven <= 0` and `!Number.isFinite(monthlyBreakEven)` as `no_target`.
- `daysInMonth` from `date-fns/getDaysInMonth`.
- `dayOfMonth` = `today.getDate()` (browser local TZ, same as the rest of the budget code).
- `daysRemaining = max(1, daysInMonth - dayOfMonth + 1)` so dailyNeeded never divides by 0.
- `projectedMonthly = (mtdSales / dayOfMonth) * daysInMonth`; if `dayOfMonth === 0` (shouldn't happen) → 0.

**Tests (single Vitest file, ~10 cases, each fixture exercises multiple branches per [2026-05-24] coverage lesson):**

| # | Fixture | Asserts |
|---|---|---|
| 1 | Day 1 of 31, mtd=0, target=$31k | expectedPercent ≈ 3.2, dailyNeeded ≈ 1k, status `behind` |
| 2 | Day 16/31, mtd = 16/31 × target | progressPercent ≈ expectedPercent, status `on_pace` |
| 3 | Day 16/31, mtd = 0.7×target | paceDelta > +5pp, status `ahead`, projectedMonthly > target |
| 4 | Day 16/31, mtd = 0.2×target | paceDelta < −5pp, status `behind`, projectedMonthly < target |
| 5 | Target = 0 | status `no_target`, function returns object with nulled stats OR null (decide: return obj with `status: 'no_target'`) |
| 6 | Target = Infinity | status `no_target` |
| 7 | Day 31/31, daysRemaining = 1, dailyNeeded = amountRemaining | math holds |
| 8 | mtd = target | amountRemaining = 0, dailyNeeded = 0, status `ahead` |
| 9 | mtd > target | same as #8 (over-achieved) |
| 10 | Single comprehensive fixture covering ahead-with-projection-over-target plus the "below target" wording branch | hits the projection-sentence branches in one test |

**Commit:** `feat(budget): pure function for monthly break-even progress math`

### T2. Extend `useBreakEvenAnalysis` to expose monthly progress

**Files:**
- `src/hooks/useBreakEvenAnalysis.tsx` — modify
- `src/lib/breakEvenCalculator.ts` — modify (wire the new field onto `BreakEvenData`)
- `tests/unit/breakEvenCalculator.monthlyProgress.test.ts` — new (small smoke test that `calculateBreakEven` returns a populated `monthlyProgress` when target is set)

**Changes in the hook:**
- Replace `historyStart = useMemo(() => subDays(today, historyDays - 1), [today, historyDays]);` with `historyStart = useMemo(() => { const monthStart = startOfMonth(today); const windowStart = subDays(today, historyDays - 1); return monthStart < windowStart ? monthStart : windowStart; }, [today, historyDays]);`
- Pass `salesData` (which now reliably covers month-to-date) and `today` into `calculateBreakEven`.

**Changes in the calculator:**
- Inside `calculateBreakEven`, compute `mtdStart = startOfMonth(today)`, `mtdSales = sum(d.netRevenue for d in salesData where d.date >= mtdStart)`, then call `calculateMonthlyProgress({ monthlyBreakEven, mtdSales, today })` and attach to the returned `BreakEvenData`.

**Commit:** `feat(budget): expose month-to-date progress from useBreakEvenAnalysis`

### T3. `MonthlyBreakEvenProgressCard` component

**File:** `src/components/budget/MonthlyBreakEvenProgressCard.tsx` — new

**Props:** `{ progress: MonthlyProgress | null; isLoading: boolean; monthlyBreakEven: number }` — `monthlyBreakEven` carried separately so the no-target empty state can still tell the user what's missing.

**Layout:** matches the spec mockup. Use shadcn `Card` compound components (mirroring `BreakEvenHeroCard`). The progress bar is a `<div role="meter" aria-valuenow ...>` with a child fill div + pace marker overlay (overflow-visible). Status colour palette pulled from the same `green|yellow|red` Tailwind scale as the hero card.

**States:** loading skeleton (four-zone), `no_target` (text + Target icon, no CTA), `ahead`/`on_pace`/`behind` (status-tinted gradient + badge).

**Commit:** `feat(budget): MonthlyBreakEvenProgressCard component`

### T4. `MonthlyBreakEvenStrip` component

**File:** `src/components/dashboard/MonthlyBreakEvenStrip.tsx` — new

**Props:** `{ progress: MonthlyProgress | null; isLoading: boolean }`

**Layout:** single-line headline `[Monthly Break-Even · May 2026] ... [Ahead]`, thinner progress bar with pace marker, secondary line `$42.3k of $66k (64%) · $4,740/day to hit target`, "→ Budget" CTA on the right as `<Link to="/budget">` with explicit `min-h-[24px]`. Empty state shows `<Link to="/budget">Set up costs</Link>`.

**Commit:** `feat(budget): MonthlyBreakEvenStrip dashboard widget`

T3 and T4 can be parallelized via the subagent-driven-development skill since they share no files.

### T5. Component smoke tests

**Files:**
- `tests/unit/MonthlyBreakEvenProgressCard.test.tsx` — new
- `tests/unit/MonthlyBreakEvenStrip.test.tsx` — new

Smoke tests using `@testing-library/react`: render each component with (a) `isLoading=true` (b) `progress=null` (c) `status='ahead'` (d) `status='behind'`. Assert visible text and `role="meter"` accessibility wiring. Branch-coverage: do (c) and (d) cases on the same render to also exercise the projection-sentence branches (per [2026-05-24] lesson).

**Commit:** `test(budget): component smoke tests for monthly progress widgets`

### T6. Wire into `BudgetRunRate.tsx`

Insert `<MonthlyBreakEvenProgressCard progress={breakEvenData?.monthlyProgress ?? null} isLoading={isLoading} monthlyBreakEven={breakEvenData?.monthlyBreakEven ?? 0} />` between `BreakEvenHeroCard` (line 175) and the cost-structure `<Card>` (line 178).

**Commit:** `feat(budget): show monthly progress card on Budget page`

### T7. Wire into `Index.tsx`

Insert `<MonthlyBreakEvenStrip progress={breakEvenData?.monthlyProgress ?? null} isLoading={breakEvenLoading} />` above `<SalesVsBreakEvenChart>` (currently around `Index.tsx:689`). `breakEvenLoading` and `breakEvenData` are already in scope from `useBreakEvenAnalysis` (line 260).

**Commit:** `feat(dashboard): show monthly break-even strip above daily chart`

## Verification gates

- **T1 → unit tests pass:** `npm run test -- monthlyBreakEvenProgress`
- **T2 → unit tests pass:** `npm run test -- breakEvenCalculator`
- **T3 / T4 → typecheck + lint:** `npm run typecheck && npm run lint`
- **T5 → smoke tests pass:** `npm run test -- MonthlyBreakEven`
- **T6 / T7 → build green:** `npm run build`
- **All:** Phase 8 runs the full suite.

## Risk / rollback

Low. No DB changes, no migrations, no edge functions. Reverting any single commit takes the affected surface back to the prior pixel.

## Estimated effort

~2–3 hours including reviews and CI loop. Pure UI addition.
