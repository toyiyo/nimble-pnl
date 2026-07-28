# SPLH ↔ Labor-% Consistency Guard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend PR #650's SPLH↔labor-% guard to the Settings Labor-Planning tab and the Planner's inline staffing panel, and stop all surfaces from computing an implied labor % off the fabricated $15/hr fallback wage.

**Architecture:** `impliedLabor` / `laborConsistentSplh` move from `coverageChartModel.ts` to `staffingCalculator.ts` (the staffing-domain home, beside `computeAvgHourlyRateCents` which feeds them). A new `hasHourlyWageData` predicate gates every implied-% readout. No new math is written.

**Tech Stack:** React 18 + TypeScript, Vitest, TailwindCSS, shadcn/ui.

**Spec:** `docs/superpowers/specs/2026-07-24-splh-labor-pct-consistency-design.md`

## Global Constraints

- **Do not change** `impliedLabor` / `laborConsistentSplh` behavior: tolerance stays `0.05` percentage points, `wage` stays in **dollars**. Only their file location changes.
- Over-target emphasis on new inline text uses the semantic token **`text-warning`** — never raw `text-amber-*`. `SplhSlider`'s existing pill keeps `bg-destructive/15 text-destructive` (untouched).
- Typography: Planner hint `text-[11px]`; Settings hint `text-[13px]`; slider fallback `text-[13px] text-muted-foreground`.
- Every hint renders inside an `aria-live="polite"` container.
- Gate on `Number.isFinite(x) && x > 0` for both SPLH and labor-%, not a bare `> 0` — a cleared field parses to `NaN` and `NaN <= 0` is `false`.
- Warn only — never disable or block a save.
- `computeAvgHourlyRateCents` returns **cents**; call sites divide by 100 for the dollar `wage` these helpers take.

---

### Task 1: Move the shared math + add the roster predicate

**Files:**
- Modify: `src/lib/coverageChartModel.ts` (remove lines 54-92: `ImpliedLaborResult`, `impliedLabor`, `laborConsistentSplh`)
- Modify: `src/lib/staffingCalculator.ts` (receive them + add `hasHourlyWageData`)
- Modify: `src/components/scheduling/ShiftTimeline/SplhSlider.tsx:5` (import path)
- Modify: `tests/unit/coverageChartModel.test.ts` (remove the two moved describe blocks + their imports)
- Modify: `tests/unit/staffingCalculator.test.ts` (receive those blocks + new tests)

**Interfaces:**
- Produces (all from `@/lib/staffingCalculator`):
  - `interface ImpliedLaborResult { pct: number; overTarget: boolean }`
  - `impliedLabor(params: { wage: number; splh: number; targetLaborPct: number }): ImpliedLaborResult`
  - `laborConsistentSplh(params: { wage: number; targetLaborPct: number }): number`
  - `hasHourlyWageData(employees: Employee[] | undefined): boolean`

- [ ] **Step 1: Write the failing tests for the new predicate**

Append to `tests/unit/staffingCalculator.test.ts`. Extend its existing import from `@/lib/staffingCalculator` to add `hasHourlyWageData`, `impliedLabor`, and `laborConsistentSplh`, and add `import type { Employee } from '@/types/scheduling';` if absent.

```typescript
function emp(overrides: Partial<Employee> = {}): Employee {
  return {
    compensation_type: 'hourly',
    is_active: true,
    hourly_rate: 1000,
    ...overrides,
  } as Employee;
}

describe('hasHourlyWageData', () => {
  it('should be false when the roster is undefined or empty', () => {
    expect(hasHourlyWageData(undefined)).toBe(false);
    expect(hasHourlyWageData([])).toBe(false);
  });

  it('should be false when every employee is salaried', () => {
    expect(hasHourlyWageData([emp({ compensation_type: 'salary' })])).toBe(false);
  });

  it('should be false when the only hourly employee is inactive', () => {
    expect(hasHourlyWageData([emp({ is_active: false })])).toBe(false);
  });

  it('should be true when at least one active hourly employee exists', () => {
    expect(hasHourlyWageData([emp({ compensation_type: 'salary' }), emp()])).toBe(true);
  });

  it('should agree with computeAvgHourlyRateCents about when the wage is real', () => {
    // Salaried-only → predicate false AND the wage is the $15 default, not derived.
    const salaried = [emp({ compensation_type: 'salary', hourly_rate: 9999 })];
    expect(hasHourlyWageData(salaried)).toBe(false);
    expect(computeAvgHourlyRateCents(salaried)).toBe(1500);
  });
});

describe('SPLH ↔ labor % identity (real-world case)', () => {
  it('should flag $30 SPLH at $10/hr against a 25% target and name $40 as consistent', () => {
    const { pct, overTarget } = impliedLabor({ wage: 10, splh: 30, targetLaborPct: 25 });
    expect(pct).toBeCloseTo(33.33, 1);
    expect(overTarget).toBe(true);
    expect(laborConsistentSplh({ wage: 10, targetLaborPct: 25 })).toBe(40);
  });

  it('should not flag the labor-consistent SPLH when fed back through', () => {
    for (const [wage, target] of [[10, 25], [10.37, 30], [18.75, 18], [22, 33]] as const) {
      const consistent = laborConsistentSplh({ wage, targetLaborPct: target });
      const { pct, overTarget } = impliedLabor({ wage, splh: consistent, targetLaborPct: target });
      expect(pct).toBeCloseTo(target, 6);
      expect(overTarget).toBe(false);
    }
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/unit/staffingCalculator.test.ts`
Expected: FAIL — `hasHourlyWageData is not a function` (and `impliedLabor` / `laborConsistentSplh` not exported from this module yet).

- [ ] **Step 3: Move the two functions and add the predicate**

In `src/lib/coverageChartModel.ts`, **delete** lines 54-92 — the `ImpliedLaborResult` interface, the `impliedLabor` function, and the `laborConsistentSplh` function, along with their JSDoc blocks. Leave `classifyHour` above and the `// ── Receipt ──` banner below untouched.

In `src/lib/staffingCalculator.ts`, paste them verbatim (JSDoc included) directly after `computeAvgHourlyRateCents` (which ends at line 15), then add the predicate:

```typescript
/**
 * True when the roster has at least one active hourly employee — i.e. the wage
 * from computeAvgHourlyRateCents is real, not the DEFAULT_HOURLY_RATE_CENTS
 * ($15/hr) fallback. Mirrors that function's own filter so the two can never
 * disagree. Surfaces use this to suppress an implied-labor readout that would
 * otherwise be derived from a wage nobody is paid.
 */
export function hasHourlyWageData(employees: Employee[] | undefined): boolean {
  return !!employees?.some((e) => e.compensation_type === 'hourly' && e.is_active);
}
```

- [ ] **Step 4: Update the import in SplhSlider**

`src/components/scheduling/ShiftTimeline/SplhSlider.tsx:5` — change:

```typescript
import { impliedLabor, laborConsistentSplh } from '@/lib/coverageChartModel';
```

to:

```typescript
import { impliedLabor, laborConsistentSplh } from '@/lib/staffingCalculator';
```

Also update the JSDoc on line 63 that says "math from `coverageChartModel`" to say "math from `staffingCalculator`".

- [ ] **Step 5: Move the existing test blocks**

In `tests/unit/coverageChartModel.test.ts`, delete the `describe('impliedLabor', …)` and `describe('laborConsistentSplh', …)` blocks (lines 87-145) and remove `impliedLabor` / `laborConsistentSplh` from its import at lines 4-5. Paste both describe blocks **verbatim** into `tests/unit/staffingCalculator.test.ts`.

- [ ] **Step 6: Run all affected suites**

Run: `npx vitest run tests/unit/staffingCalculator.test.ts tests/unit/coverageChartModel.test.ts tests/unit/splhSlider.test.tsx tests/unit/coverageReceipt.test.tsx`
Expected: PASS. The moved blocks must pass unchanged — behavior did not change.

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/lib/staffingCalculator.ts src/lib/coverageChartModel.ts src/components/scheduling/ShiftTimeline/SplhSlider.tsx tests/unit/staffingCalculator.test.ts tests/unit/coverageChartModel.test.ts
git commit -m "refactor(staffing): move implied-labor math to staffingCalculator, add wage-data predicate"
```

---

### Task 2: Gate the slider's readout, pill, notch, and aria-valuetext

**Files:**
- Modify: `src/components/scheduling/ShiftTimeline/SplhSlider.tsx`
- Modify: `src/components/scheduling/ShiftTimeline/ShiftTimelineTab.tsx`
- Test: `tests/unit/splhSlider.test.tsx`

**Interfaces:**
- Consumes: `hasHourlyWageData` (Task 1).
- Produces: new required prop `hasWageData: boolean` on `SplhSlider`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/unit/splhSlider.test.tsx`. Match the existing render-helper style in that file; if it has a `renderSlider(props)` helper, pass `hasWageData` through it, otherwise render `<SplhSlider … hasWageData={false} />` directly with the same props the existing tests use.

```typescript
describe('SplhSlider without wage data', () => {
  it('should hide the pill and notch and show a prompt instead of a fabricated labor %', () => {
    render(
      <SplhSlider
        value={60}
        wage={15}
        targetLaborPct={22}
        hasWageData={false}
        canSave
        isSaving={false}
        onChange={() => {}}
        onSave={() => {}}
        onReset={() => {}}
      />,
    );
    expect(screen.queryByTestId('splh-slider-pill')).not.toBeInTheDocument();
    expect(screen.queryByTestId('splh-slider-notch')).not.toBeInTheDocument();
    expect(screen.getByText('Add hourly rates')).toBeInTheDocument();
    expect(screen.queryByText(/% labor at/)).not.toBeInTheDocument();
  });

  it('should keep the fabricated percentage out of aria-valuetext', () => {
    render(
      <SplhSlider
        value={60}
        wage={15}
        targetLaborPct={22}
        hasWageData={false}
        canSave
        isSaving={false}
        onChange={() => {}}
        onSave={() => {}}
        onReset={() => {}}
      />,
    );
    expect(screen.getByRole('slider')).toHaveAttribute('aria-valuetext', '$60/hr');
  });
});
```

Also add `hasWageData={true}` to every existing `SplhSlider` render in this file so the current assertions keep exercising the populated path.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/unit/splhSlider.test.tsx`
Expected: FAIL — the pill/notch still render and `aria-valuetext` still contains `% labor`.

- [ ] **Step 3: Add the prop and gate the four outputs**

In `SplhSlider.tsx`, add to `SplhSliderProps` after the `wage` field:

```typescript
  /**
   * Whether `wage` reflects real roster data (`hasHourlyWageData`). When false,
   * `computeAvgHourlyRateCents` returned its $15/hr fallback, so every
   * implied-labor output is suppressed rather than presented as fact.
   */
  readonly hasWageData: boolean;
```

Add `hasWageData,` to the destructured params. Then:

Replace the readout span (currently `→ {pctLabel}% labor at ${wage.toFixed(2)}/hr`) and the pill with a conditional:

```tsx
          {hasWageData ? (
            <>
              <span className="text-[13px] text-muted-foreground tabular-nums">
                → {pctLabel}% labor at ${wage.toFixed(2)}/hr
              </span>
              <span
                data-testid="splh-slider-pill"
                className={cn(
                  'text-[11px] font-medium px-1.5 py-0.5 rounded-md',
                  overTarget ? 'bg-destructive/15 text-destructive' : 'bg-success/15 text-success',
                )}
              >
                {overTarget ? 'Over target' : 'On target'}
              </span>
            </>
          ) : (
            <span className="text-[13px] text-muted-foreground">Add hourly rates</span>
          )}
```

Wrap the notch `<div data-testid="splh-slider-notch" …>…</div>` in `{hasWageData && ( … )}`.

Change `aria-valuetext` (line 141) to:

```tsx
          aria-valuetext={hasWageData ? `$${value}/hr → ${pctLabel}% labor` : `$${value}/hr`}
```

- [ ] **Step 4: Pass the prop from ShiftTimelineTab**

In `ShiftTimelineTab.tsx`, add `hasHourlyWageData` to the existing `@/lib/staffingCalculator` import, then next to `avgWage` (line 505) add:

```typescript
  // Whether `avgWage` is real roster data or computeAvgHourlyRateCents's $15/hr
  // fallback — gates every implied-labor readout (design §4a).
  const hasWageData = hasHourlyWageData(employees);
```

Add `hasWageData={hasWageData}` to the `<SplhSlider>` props (after `wage={avgWage}`).

- [ ] **Step 5: Run tests**

Run: `npx vitest run tests/unit/splhSlider.test.tsx tests/unit/shiftTimelineTab.test.tsx`
Expected: PASS.

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/components/scheduling/ShiftTimeline/SplhSlider.tsx src/components/scheduling/ShiftTimeline/ShiftTimelineTab.tsx tests/unit/splhSlider.test.tsx
git commit -m "fix(scheduling): suppress slider implied-labor readout without real wage data"
```

---

### Task 3: Gate the receipt's implied-SPLH aside

**Files:**
- Modify: `src/lib/coverageChartModel.ts` (`buildReceipt`)
- Modify: `src/components/scheduling/ShiftTimeline/CoverageReceipt.tsx`
- Modify: `src/components/scheduling/ShiftTimeline/ShiftTimelineTab.tsx`
- Test: `tests/unit/coverageReceipt.test.tsx`

**Interfaces:**
- Consumes: `impliedLabor` from `@/lib/staffingCalculator` (Task 1); `hasWageData` from `ShiftTimelineTab` (Task 2).
- Produces: `buildReceipt(h, { minStaff, weekdayKey, wage, lookbackWeeks, hasWageData })`; `CoverageReceipt` gains a `hasWageData: boolean` prop.

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/coverageReceipt.test.tsx`, following that file's existing render helper and fixture style (it renders `<CoverageReceipt>` with a `CoverageHour`). Use a fixture whose `scheduled > 0` so the aside would otherwise appear:

```typescript
it('should omit the implied-SPLH aside when there is no real wage data', () => {
  renderReceipt({ hasWageData: false });
  expect(screen.queryByText(/implied SPLH is/)).not.toBeInTheDocument();
});

it('should still show the implied-SPLH aside when wage data is real', () => {
  renderReceipt({ hasWageData: true });
  expect(screen.getByText(/implied SPLH is/)).toBeInTheDocument();
});
```

Add `hasWageData: true` to the existing render helper's defaults so current assertions keep passing.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/unit/coverageReceipt.test.tsx`
Expected: FAIL — the aside renders regardless.

- [ ] **Step 3: Thread the flag and reuse `impliedLabor`**

In `coverageChartModel.ts`, add `impliedLabor` to the existing `@/lib/staffingCalculator` import (create the import if the file has none), extend the `buildReceipt` params type (line 131) to
`{ minStaff: number; weekdayKey: string; wage: number; lookbackWeeks: number; hasWageData: boolean }`,
add `hasWageData` to the destructure on line 133, and replace the aside block (lines 188-192):

```typescript
  // Implied SPLH at the scheduled count — only meaningful when someone is
  // actually scheduled (avoids a divide-by-zero and a nonsensical "$Infinity/hr"),
  // and only honest when `wage` is real roster data rather than the $15/hr
  // fallback (design §4a2).
  if (scheduled > 0 && hasWageData) {
    const splhAt = projectedSales / scheduled;
    const laborPctAt = Math.round(impliedLabor({ wage, splh: splhAt, targetLaborPct: 0 }).pct);
    asides.push(`At ${scheduled} scheduled, implied SPLH is ${fmtUsd(Math.round(splhAt))}/hr → ${laborPctAt}% labor.`);
  }
```

(`targetLaborPct: 0` is passed because only `pct` is consumed here — the aside states a fact and carries no over/under-target judgement.)

- [ ] **Step 4: Pass it through the component**

In `CoverageReceipt.tsx`, add to `CoverageReceiptProps` after `wage`:

```typescript
  /** Whether `wage` is real roster data — gates the implied-SPLH aside. */
  readonly hasWageData: boolean;
```

Add `hasWageData` to the destructured props and to the `buildReceipt` call on line 78:

```typescript
  const receipt = buildReceipt(hour, { minStaff, weekdayKey, wage, lookbackWeeks, hasWageData });
```

In `ShiftTimelineTab.tsx`, add `hasWageData={hasWageData}` to the `<CoverageReceipt>` props (after `wage={avgWage}`).

- [ ] **Step 5: Run tests**

Run: `npx vitest run tests/unit/coverageReceipt.test.tsx tests/unit/coverageChartModel.test.ts tests/unit/shiftTimelineTab.test.tsx`
Expected: PASS.

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/coverageChartModel.ts src/components/scheduling/ShiftTimeline/CoverageReceipt.tsx src/components/scheduling/ShiftTimeline/ShiftTimelineTab.tsx tests/unit/coverageReceipt.test.tsx
git commit -m "fix(scheduling): gate receipt implied-SPLH aside on real wage data"
```

---

### Task 4: Expose wage + flag from `useWeekStaffingSuggestions`

**Files:**
- Modify: `src/hooks/useWeekStaffingSuggestions.ts`
- Test: `tests/unit/useWeekStaffingSuggestions.wageData.test.tsx` (create)

**Interfaces:**
- Consumes: `hasHourlyWageData` (Task 1).
- Produces: two new fields on the hook's return object — `avgHourlyRateCents: number`, `hasWageData: boolean`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/useWeekStaffingSuggestions.wageData.test.tsx`. Mirror the mocking setup in the existing `tests/unit/useWeekStaffingSuggestions.actualSplh.test.ts` (it already mocks `useStaffingSettings`, `useEmployees`, `RestaurantContext`, and the supabase client) and use `renderHook`:

```typescript
it('should expose the blended wage and flag it as real for an hourly roster', () => {
  mockEmployees([
    { compensation_type: 'hourly', is_active: true, hourly_rate: 1000 },
    { compensation_type: 'hourly', is_active: true, hourly_rate: 2000 },
  ]);
  const { result } = renderHook(() => useWeekStaffingSuggestions('r1', ['2026-07-27'], null), { wrapper });
  expect(result.current.avgHourlyRateCents).toBe(1500);
  expect(result.current.hasWageData).toBe(true);
});

it('should flag the fallback wage as not real for an empty roster', () => {
  mockEmployees([]);
  const { result } = renderHook(() => useWeekStaffingSuggestions('r1', ['2026-07-27'], null), { wrapper });
  expect(result.current.avgHourlyRateCents).toBe(1500); // the $15 default
  expect(result.current.hasWageData).toBe(false);       // …but not real data
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/unit/useWeekStaffingSuggestions.wageData.test.tsx`
Expected: FAIL — `expected undefined to be 1500`.

- [ ] **Step 3: Derive and return the fields**

In `src/hooks/useWeekStaffingSuggestions.ts`, add `hasHourlyWageData` to the existing `@/lib/staffingCalculator` import. After the `avgHourlyRateCents` useMemo (ends ~line 80), add:

```typescript
  const hasWageData = useMemo(() => hasHourlyWageData(employees), [employees]);
```

In the returned object, after `actualSplh,`, add:

```typescript
    avgHourlyRateCents,
    hasWageData,
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/unit/useWeekStaffingSuggestions.wageData.test.tsx tests/unit/useWeekStaffingSuggestions.actualSplh.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useWeekStaffingSuggestions.ts tests/unit/useWeekStaffingSuggestions.wageData.test.tsx
git commit -m "feat(staffing): expose avg wage + hasWageData from week suggestions"
```

---

### Task 5: Render the hint in the Planner panel

**Files:**
- Modify: `src/components/scheduling/ShiftPlanner/StaffingConfigPanel.tsx`
- Modify: `src/components/scheduling/ShiftPlanner/StaffingOverlay.tsx`
- Test: `tests/unit/StaffingConfigPanel.splhConsistency.test.tsx` (create)
- Test: `tests/unit/StaffingOverlay.wiring.test.tsx` (extend)

**Interfaces:**
- Consumes: `impliedLabor`, `laborConsistentSplh` (Task 1); hook fields `avgHourlyRateCents`, `hasWageData` (Task 4).
- Produces: `StaffingConfigPanel` props `avgHourlyRateCents: number`, `hasWageData: boolean`.

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/StaffingConfigPanel.splhConsistency.test.tsx`, following the render style of the existing `tests/unit/StaffingConfigPanel.saveGating.test.tsx` (same required props; add the two new ones).

```typescript
const baseSettings = {
  target_splh: 30,
  target_labor_pct: 25,
  min_staff: 1,
  min_crew: null,
};

it('should hide the hint when there is no real wage data', () => {
  renderPanel({ settings: baseSettings, avgHourlyRateCents: 1500, hasWageData: false });
  expect(screen.queryByText(/labor at current wage/)).not.toBeInTheDocument();
});

it('should hide the hint when the SPLH target is not a finite positive number', () => {
  renderPanel({ settings: { ...baseSettings, target_splh: Number.NaN }, avgHourlyRateCents: 1000, hasWageData: true });
  expect(screen.queryByText(/labor at current wage/)).not.toBeInTheDocument();
});

it('should warn with the labor-consistent SPLH for the $10/hr, $30, 25% case', () => {
  renderPanel({ settings: baseSettings, avgHourlyRateCents: 1000, hasWageData: true });
  const line = screen.getByText(/33% labor at current wage/);
  expect(line).toHaveClass('text-warning');
  expect(line).toHaveTextContent('above your 25% target, try $40');
});

it('should render the implied line muted when within target', () => {
  renderPanel({ settings: { ...baseSettings, target_splh: 40 }, avgHourlyRateCents: 1000, hasWageData: true });
  const line = screen.getByText(/25% labor at current wage/);
  expect(line).not.toHaveClass('text-warning');
  expect(line).not.toHaveTextContent('above your');
});

it('should always show the directional helper line when the hint renders', () => {
  renderPanel({ settings: baseSettings, avgHourlyRateCents: 1000, hasWageData: true });
  expect(screen.getByText('Lower SPLH → more staff recommended.')).toBeInTheDocument();
});

it('should announce the hint politely', () => {
  const { container } = renderPanel({ settings: baseSettings, avgHourlyRateCents: 1000, hasWageData: true });
  expect(container.querySelector('[aria-live="polite"]')).not.toBeNull();
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/unit/StaffingConfigPanel.splhConsistency.test.tsx`
Expected: FAIL — nothing renders.

- [ ] **Step 3: Add props and derive the values**

In `StaffingConfigPanel.tsx`, add the import:

```typescript
import { impliedLabor, laborConsistentSplh } from '@/lib/staffingCalculator';
```

Add to `StaffingConfigPanelProps` (after `lookbackWeeks: number;`):

```typescript
  /** Blended hourly wage in cents (`computeAvgHourlyRateCents`). */
  avgHourlyRateCents: number;
  /** Whether that wage is real roster data — gates the implied-labor hint. */
  hasWageData: boolean;
```

Add `avgHourlyRateCents,` and `hasWageData,` to the destructured params. After `const [newPosition, setNewPosition] = useState('');`, add:

```typescript
  // Implied labor % of the current SPLH target at the blended wage. Null when
  // there is no real wage, or when either input is non-finite/non-positive —
  // a cleared field parses to NaN, and `NaN <= 0` is false (design §4).
  const splhHint = useMemo(() => {
    const splh = settings.target_splh;
    const target = settings.target_labor_pct;
    const positive = (n: number) => Number.isFinite(n) && n > 0;
    if (!hasWageData || !positive(splh) || !positive(target)) return null;
    const wage = avgHourlyRateCents / 100;
    const { pct, overTarget } = impliedLabor({ wage, splh, targetLaborPct: target });
    return { pct, overTarget, consistent: laborConsistentSplh({ wage, targetLaborPct: target }) };
  }, [avgHourlyRateCents, hasWageData, settings.target_splh, settings.target_labor_pct]);
```

- [ ] **Step 4: Render the hint**

Directly after the existing `{actualSplh !== null && ( … )}` block in the SPLH column, add:

```tsx
          {splhHint && (
            <div aria-live="polite" className="flex flex-col gap-0.5 max-w-[220px]">
              <span className={`text-[11px] ${splhHint.overTarget ? 'text-warning' : 'text-muted-foreground/80'}`}>
                ≈ {splhHint.pct.toFixed(0)}% labor at current wage
                {splhHint.overTarget && (
                  <> — above your {settings.target_labor_pct}% target, try ${Math.round(splhHint.consistent)}</>
                )}
              </span>
              <span className="text-[11px] text-muted-foreground/70">
                Lower SPLH → more staff recommended.
              </span>
            </div>
          )}
```

- [ ] **Step 5: Wire from StaffingOverlay**

In `StaffingOverlay.tsx`, add `avgHourlyRateCents,` and `hasWageData,` to the `useWeekStaffingSuggestions` destructure, and add these props to `<StaffingConfigPanel>`:

```tsx
                avgHourlyRateCents={avgHourlyRateCents}
                hasWageData={hasWageData}
```

Then extend `tests/unit/StaffingOverlay.wiring.test.tsx` with an assertion that both values reach the panel (that file already mocks `StaffingConfigPanel`; capture its props and assert `avgHourlyRateCents` and `hasWageData` are present).

- [ ] **Step 6: Run tests**

Run: `npx vitest run tests/unit/StaffingConfigPanel.splhConsistency.test.tsx tests/unit/StaffingConfigPanel.saveGating.test.tsx tests/unit/StaffingOverlay.wiring.test.tsx tests/unit/StaffingOverlay.deadends.test.tsx tests/unit/StaffingOverlay.tz.test.tsx`
Expected: PASS. If `StaffingConfigPanel.saveGating.test.tsx` fails on the two new required props, add `avgHourlyRateCents={1000} hasWageData={false}` to its render and commit that with this task.

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/components/scheduling/ShiftPlanner/StaffingConfigPanel.tsx src/components/scheduling/ShiftPlanner/StaffingOverlay.tsx tests/unit/StaffingConfigPanel.splhConsistency.test.tsx tests/unit/StaffingConfigPanel.saveGating.test.tsx tests/unit/StaffingOverlay.wiring.test.tsx
git commit -m "feat(staffing): SPLH consistency hint in planner panel"
```

---

### Task 6: Render the hint in the Settings Labor-Planning tab

**Files:**
- Modify: `src/pages/RestaurantSettings.tsx`
- Test: `tests/unit/restaurantSettings.splhConsistency.test.tsx` (create)

**Interfaces:**
- Consumes: `useEmployees`; `computeAvgHourlyRateCents`, `hasHourlyWageData`, `impliedLabor`, `laborConsistentSplh` (Task 1).

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/restaurantSettings.splhConsistency.test.tsx`. Because `RestaurantSettings` is a large page with many providers, extract the smallest viable render: mock `useRestaurantContext`, `useAuth`, `useRestaurants`, `useStaffingSettings` (returning `effectiveSettings` with `target_splh: 30, target_labor_pct: 25`), and `useEmployees` (returning two active hourly employees at `hourly_rate: 1000`), then render the page and select the `labor-planning` tab. Follow the provider/mocking pattern already used by `tests/unit/StaffingOverlay.wiring.test.tsx`.

```typescript
it('should warn under both the SPLH and the labor % fields', async () => {
  renderLaborPlanningTab();
  const warnings = await screen.findAllByText(/33% labor at your current average wage/);
  expect(warnings).toHaveLength(2);
  warnings.forEach((w) => {
    expect(w).toHaveClass('text-warning');
    expect(w).toHaveTextContent('Try $40 to hit it.');
  });
});

it('should hide the hint when the roster has no hourly employees', async () => {
  renderLaborPlanningTab({ employees: [] });
  expect(screen.queryByText(/labor at your current average wage/)).not.toBeInTheDocument();
});

it('should hide the hint when the SPLH field is cleared', async () => {
  renderLaborPlanningTab();
  await userEvent.clear(screen.getByLabelText(/Target SPLH/i));
  expect(screen.queryByText(/labor at your current average wage/)).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/unit/restaurantSettings.splhConsistency.test.tsx`
Expected: FAIL — no hint rendered.

- [ ] **Step 3: Add imports and derive the hint**

In `src/pages/RestaurantSettings.tsx` add (grouped with the other hook/lib imports near line 32):

```typescript
import { useEmployees } from '@/hooks/useEmployees';
import {
  computeAvgHourlyRateCents,
  hasHourlyWageData,
  impliedLabor,
  laborConsistentSplh,
} from '@/lib/staffingCalculator';
```

`useMemo` is already imported on line 1. After the `useStaffingSettings` line (85), add:

```typescript
  const { employees: staffEmployees } = useEmployees(selectedRestaurant?.restaurant_id ?? null);
  // Implied labor % of the SPLH currently typed into the form. Null when the
  // roster has no real hourly wage, or when either field is blank/non-numeric
  // (Number.parseFloat('') is NaN, and `NaN <= 0` is false — design §4).
  const splhHint = useMemo(() => {
    const splh = Number.parseFloat(lpTargetSplh);
    const target = Number.parseFloat(lpTargetLaborPct);
    const positive = (n: number) => Number.isFinite(n) && n > 0;
    if (!hasHourlyWageData(staffEmployees) || !positive(splh) || !positive(target)) return null;
    const wage = computeAvgHourlyRateCents(staffEmployees) / 100;
    const { pct, overTarget } = impliedLabor({ wage, splh, targetLaborPct: target });
    return { pct, overTarget, consistent: laborConsistentSplh({ wage, targetLaborPct: target }) };
  }, [staffEmployees, lpTargetSplh, lpTargetLaborPct]);
```

- [ ] **Step 4: Extract the hint markup once, render it twice**

Still inside the component (after `splhHint`), define:

```tsx
  const splhHintBlock = splhHint && (
    <div aria-live="polite" className="flex flex-col gap-0.5">
      <p className={`text-[13px] ${splhHint.overTarget ? 'text-warning' : 'text-muted-foreground'}`}>
        ≈ {splhHint.pct.toFixed(0)}% labor at your current average wage
        {splhHint.overTarget && (
          <> — above your {lpTargetLaborPct}% target. Try ${Math.round(splhHint.consistent)} to hit it.</>
        )}
      </p>
      <p className="text-[13px] text-muted-foreground/70">
        Lowering this target increases recommended headcount.
      </p>
    </div>
  );
```

Render `{splhHintBlock}` in two places: immediately after the closing `</p>` of `lpTargetSplh-help` (line 1147), and immediately after the closing `</p>` of `lpTargetLaborPct-help` (line ~1198). The two fields live in separate cards, and the grid is single-column at 375px, so a manager editing either one sees the warning without scrolling (design §4c).

- [ ] **Step 5: Run tests**

Run: `npx vitest run tests/unit/restaurantSettings.splhConsistency.test.tsx`
Expected: PASS.

Run: `npm run typecheck && npm run lint`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/pages/RestaurantSettings.tsx tests/unit/restaurantSettings.splhConsistency.test.tsx
git commit -m "feat(staffing): SPLH consistency hint in labor planning settings"
```

---

## Self-Review

**Spec coverage:**
- Gap 1 (Settings tab) → Task 6, hint under both fields. ✓
- Gap 2 (Planner panel) → Tasks 4 + 5. ✓
- Gap 3 (fabricated wage) → Task 2 (slider readout, pill, notch, `aria-valuetext`) + Task 3 (receipt aside). ✓
- Goal 2 (directional helper line) → Tasks 5 and 6. ✓
- Relocation of shared math → Task 1, with the moved test blocks and the single production import. ✓
- `buildReceipt` reusing `impliedLabor` (review minor) → Task 3 Step 3. ✓
- Non-goals honored: tolerance stays `0.05`, `wage` stays dollars, no schema change, save never blocked. ✓

**Placeholder scan:** No TBD/TODO. Every code step shows full code. The two places that defer to an existing file's conventions (Task 5 Step 1's `renderPanel`, Task 6 Step 1's provider mocks) name the specific existing test file to copy from. ✓

**Type consistency:** `impliedLabor({wage, splh, targetLaborPct})` and `laborConsistentSplh({wage, targetLaborPct})` keep #650's exact signatures in Tasks 1, 3, 5, 6. `hasHourlyWageData(employees)` identical in Tasks 1, 2, 4, 6. `hasWageData: boolean` is the prop name on `SplhSlider` (Task 2), `CoverageReceipt` (Task 3), and `StaffingConfigPanel` (Task 5), and the hook field name (Task 4). `avgHourlyRateCents` is cents everywhere; every `wage` is dollars, converted at the call site. ✓
