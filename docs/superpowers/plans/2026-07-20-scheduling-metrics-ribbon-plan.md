# Scheduling Metrics Ribbon Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the tall hero header + three metric cards atop `/scheduling` with one compact, sticky metrics ribbon whose rich detail collapses behind a "Details" disclosure, so the schedule grid is visible on load.

**Architecture:** A new presentational component `ScheduleMetricsRibbon` renders the three hero numbers as inline pills plus a folded-in `<h1>` title, and is `position: sticky` beneath the app header. A collapsible panel (in-memory `useState`, collapsed by default) holds the existing `LaborCostBreakdown` + `LaborBudgetIndicator` + per-type cost rows. `Scheduling.tsx` deletes the old header/card block and drills its already-computed labor data into the ribbon.

**Tech Stack:** React 18 + TypeScript, TailwindCSS semantic tokens, shadcn/ui (`Button`, `Skeleton`, `Tooltip`), Lucide icons, Vitest + Testing Library.

**Design doc:** `docs/superpowers/specs/2026-07-20-scheduling-metrics-ribbon-design.md`

---

## File Structure

- **Create** `src/components/scheduling/ScheduleMetricsRibbon.tsx` — the ribbon + a private `MetricPill` sub-component. One responsibility: present schedule summary metrics compactly with a collapsible detail panel.
- **Create** `tests/unit/ScheduleMetricsRibbon.test.tsx` — behavior tests (pills render, toggle, warning state, loading, error).
- **Modify** `src/pages/Scheduling.tsx` — remove old header + 3-card block (lines ~725–987), insert `<ScheduleMetricsRibbon />`, add the import.

---

### Task 1: Create `ScheduleMetricsRibbon` (RED test first)

**Files:**
- Create: `src/components/scheduling/ScheduleMetricsRibbon.tsx`
- Test: `tests/unit/ScheduleMetricsRibbon.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/ScheduleMetricsRibbon.test.tsx`:

```tsx
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ScheduleMetricsRibbon } from '@/components/scheduling/ScheduleMetricsRibbon';
import type { LaborCostSummary } from '@/hooks/useEmployeeLaborCosts';
import type { ScheduledLaborCostBreakdown } from '@/hooks/useScheduledLaborCosts';
import type { LaborBudgetData } from '@/hooks/useScheduleLaborBudget';

const breakdown: ScheduledLaborCostBreakdown = {
  hourly: { cost: 3258, hours: 325.8 },
  salary: { cost: 0, hours: 0 },
  contractor: { cost: 0, hours: 0 },
  daily_rate: { cost: 0, hours: 0 },
  total: 3258,
};

const summary: LaborCostSummary = {
  totalCost: 3258,
  totalHours: 325.8,
  averageHourlyRate: 10,
  isAverageHigh: false,
  employeeCosts: [
    { id: 'e1', name: 'Shy Harrison', position: 'Server', hours: 33, rate: 10, cost: 330, compensationType: 'hourly', isOutlier: false, outlierLevel: 'none' },
  ],
};

const budget: LaborBudgetData = {
  hasBudget: false, weeklyTarget: 0, percentage: 0, variance: 0,
  tier: 'success', source: null, laborEntry: null, isLoading: false,
};

function renderRibbon(overrides: Partial<React.ComponentProps<typeof ScheduleMetricsRibbon>> = {}) {
  return render(
    <MemoryRouter>
      <ScheduleMetricsRibbon
        activeEmployeeCount={24}
        totalScheduledHours={325.8}
        laborCostBreakdown={breakdown}
        laborCostSummary={summary}
        laborBudgetData={budget}
        shiftCount={57}
        scheduledEmployeeCount={17}
        isLoading={false}
        onEditEmployee={vi.fn()}
        {...overrides}
      />
    </MemoryRouter>
  );
}

describe('ScheduleMetricsRibbon', () => {
  it('renders the hero pills and title', () => {
    renderRibbon();
    expect(screen.getByRole('heading', { level: 1, name: /staff schedule/i })).toBeInTheDocument();
    expect(screen.getByText('24')).toBeInTheDocument();
    expect(screen.getByText('325.8')).toBeInTheDocument();
    expect(screen.getByText('$3,258')).toBeInTheDocument();
    expect(screen.getByText(/57 shifts · 17 staff/)).toBeInTheDocument();
  });

  it('toggles the details panel and flips aria-expanded', () => {
    renderRibbon();
    const toggle = screen.getByRole('button', { name: /details/i });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Top Earners')).not.toBeInTheDocument();
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Top Earners')).toBeInTheDocument();
  });

  it('shows the high-rate warning affordance', () => {
    renderRibbon({ laborCostSummary: { ...summary, isAverageHigh: true } });
    expect(screen.getByLabelText(/high average rate warning/i)).toBeInTheDocument();
  });

  it('renders skeletons while loading', () => {
    const { container } = renderRibbon({ isLoading: true });
    expect(screen.queryByText('$3,258')).not.toBeInTheDocument();
    expect(container.querySelectorAll('[data-slot="skeleton"], .animate-pulse').length).toBeGreaterThan(0);
  });

  it('renders an inline error affordance', () => {
    renderRibbon({ error: true });
    expect(screen.getByText(/couldn't load metrics/i)).toBeInTheDocument();
    expect(screen.queryByText('$3,258')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -- tests/unit/ScheduleMetricsRibbon.test.tsx`
Expected: FAIL — cannot resolve `@/components/scheduling/ScheduleMetricsRibbon`.

- [ ] **Step 3: Write the component**

Create `src/components/scheduling/ScheduleMetricsRibbon.tsx`:

```tsx
import { useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Calendar, Users, Clock, DollarSign, AlertTriangle, ChevronDown, ChevronUp, TrendingUp } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

import { LaborCostBreakdown } from '@/components/scheduling/LaborCostBreakdown';
import { LaborBudgetIndicator } from '@/components/scheduling/LaborBudgetIndicator';

import type { LaborCostSummary } from '@/hooks/useEmployeeLaborCosts';
import type { ScheduledLaborCostBreakdown } from '@/hooks/useScheduledLaborCosts';
import type { LaborBudgetData } from '@/hooks/useScheduleLaborBudget';

import { cn } from '@/lib/utils';

interface ScheduleMetricsRibbonProps {
  activeEmployeeCount: number;
  totalScheduledHours: number;
  laborCostBreakdown: ScheduledLaborCostBreakdown;
  laborCostSummary: LaborCostSummary;
  laborBudgetData: LaborBudgetData;
  shiftCount: number;
  scheduledEmployeeCount: number;
  isLoading: boolean;
  error?: boolean;
  onEditEmployee: (employeeId: string) => void;
}

interface MetricPillProps {
  icon: LucideIcon;
  value: string;
  unit: string;
  tone?: string;
  children?: React.ReactNode;
}

function MetricPill({ icon: Icon, value, unit, tone = 'text-foreground', children }: MetricPillProps) {
  return (
    <span className="inline-flex items-center gap-1.5 h-7 pl-2 pr-2.5 rounded-full bg-muted/30 text-[13px]">
      <Icon className="h-3.5 w-3.5 text-muted-foreground" />
      <span className={cn('font-medium tabular-nums', tone)}>{value}</span>
      <span className="text-muted-foreground">{unit}</span>
      {children}
    </span>
  );
}

// Sticky offset couples to AppHeader (h-14 / 56px, sticky top-0 z-50 in
// src/components/AppHeader.tsx). If the header height changes, update top-14.
export function ScheduleMetricsRibbon({
  activeEmployeeCount,
  totalScheduledHours,
  laborCostBreakdown,
  laborCostSummary,
  laborBudgetData,
  shiftCount,
  scheduledEmployeeCount,
  isLoading,
  error = false,
  onEditEmployee,
}: ScheduleMetricsRibbonProps) {
  const [detailsOpen, setDetailsOpen] = useState(false);

  const isDanger =
    laborCostSummary.isAverageHigh ||
    (laborBudgetData.hasBudget && laborBudgetData.tier === 'danger');
  const isWarning = laborBudgetData.hasBudget && laborBudgetData.tier === 'warning';
  const laborTone = isDanger ? 'text-destructive' : isWarning ? 'text-warning' : 'text-foreground';

  const breakdownRows: Array<{ key: string; label: string; dot: string; value: string }> = [
    {
      key: 'hourly',
      label: 'Hourly',
      dot: 'bg-primary/60',
      value: `$${laborCostBreakdown.hourly.cost.toLocaleString()} (${laborCostBreakdown.hourly.hours.toFixed(0)}h)`,
    },
    ...(laborCostBreakdown.salary.cost > 0
      ? [{ key: 'salary', label: 'Salary', dot: 'bg-accent/60', value: `$${laborCostBreakdown.salary.cost.toLocaleString()}` }]
      : []),
    ...(laborCostBreakdown.contractor.cost > 0
      ? [{ key: 'contractor', label: 'Contractors', dot: 'bg-warning/60', value: `$${laborCostBreakdown.contractor.cost.toLocaleString()}` }]
      : []),
    ...(laborCostBreakdown.daily_rate.cost > 0
      ? [{ key: 'daily_rate', label: 'Daily Rate', dot: 'bg-info/60', value: `$${laborCostBreakdown.daily_rate.cost.toLocaleString()}` }]
      : []),
  ];

  return (
    <div className="sticky top-14 z-30 -mx-4 px-4 bg-background border-b border-border/40">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 py-2.5">
        {/* Title group — folds the old hero header in, keeps the page's <h1> */}
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="h-8 w-8 rounded-lg bg-muted/50 flex items-center justify-center shrink-0">
            <Calendar className="h-4 w-4 text-foreground" />
          </div>
          <div className="min-w-0">
            <h1 className="text-[14px] font-semibold text-foreground leading-tight truncate">Staff schedule</h1>
            <p className="text-[12px] text-muted-foreground leading-tight">
              {shiftCount} shifts · {scheduledEmployeeCount} staff
            </p>
          </div>
        </div>

        {/* Hero metric pills */}
        {error ? (
          <p className="text-[13px] text-muted-foreground">Couldn't load metrics</p>
        ) : isLoading ? (
          <div className="flex items-center gap-2">
            <Skeleton className="h-7 w-24 rounded-full" />
            <Skeleton className="h-7 w-24 rounded-full" />
            <Skeleton className="h-7 w-28 rounded-full" />
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <MetricPill icon={Users} value={String(activeEmployeeCount)} unit="staff" />
            <MetricPill icon={Clock} value={totalScheduledHours.toFixed(1)} unit="hrs" />
            <MetricPill
              icon={DollarSign}
              value={`$${laborCostBreakdown.total.toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
              unit="labor"
              tone={laborTone}
            >
              {(isDanger || isWarning) && (
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <AlertTriangle
                        className={cn('h-3.5 w-3.5', isDanger ? 'text-destructive' : 'text-warning')}
                        aria-label="High average rate warning"
                      />
                    </TooltipTrigger>
                    <TooltipContent side="bottom" className="max-w-xs">
                      <p className="text-xs">
                        {laborCostSummary.isAverageHigh
                          ? 'Average hourly rate is unusually high. Check for data-entry errors in employee rates.'
                          : 'Scheduled labor is trending against budget. Open Details to review.'}
                      </p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}
            </MetricPill>
            {laborCostBreakdown.hourly.hours > 0 && (
              <span className="inline-flex items-center gap-1 text-[12px] text-muted-foreground">
                <TrendingUp className="h-3 w-3" />
                ${laborCostSummary.averageHourlyRate.toFixed(2)}/hr avg
              </span>
            )}
          </div>
        )}

        {/* Details disclosure */}
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setDetailsOpen((open) => !open)}
          aria-expanded={detailsOpen}
          aria-controls="ribbon-details"
          className="ml-auto h-8 px-2.5 text-[13px] font-medium text-muted-foreground hover:text-foreground transition-colors"
        >
          {detailsOpen ? 'Hide' : 'Details'}
          {detailsOpen ? <ChevronUp className="h-4 w-4 ml-1" /> : <ChevronDown className="h-4 w-4 ml-1" />}
        </Button>
      </div>

      {/* Collapsible detail — `group` enables LaborCostBreakdown's hover-to-edit */}
      {detailsOpen && !isLoading && !error && (
        <div id="ribbon-details" className="group grid gap-3 pb-4 pt-1 sm:grid-cols-2">
          <div className="rounded-xl border border-border/40 bg-muted/30 p-3 space-y-2">
            {breakdownRows.map((row) => (
              <div key={row.key} className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground flex items-center gap-1.5">
                  <span className={cn('w-2 h-2 rounded-full', row.dot)} />
                  {row.label}
                </span>
                <span className="font-medium tabular-nums">{row.value}</span>
              </div>
            ))}
            {laborCostBreakdown.hourly.hours > 0 && (
              <div className="flex items-center justify-between text-xs pt-2 border-t border-border/40">
                <span className="text-muted-foreground">Avg Rate</span>
                <span className={cn('font-medium tabular-nums', laborCostSummary.isAverageHigh && 'text-destructive')}>
                  ${laborCostSummary.averageHourlyRate.toFixed(2)}/hr
                </span>
              </div>
            )}
            <LaborBudgetIndicator budgetData={laborBudgetData} />
          </div>

          <div className="rounded-xl border border-border/40 bg-muted/30 p-3">
            {laborCostSummary.employeeCosts.length > 0 ? (
              <LaborCostBreakdown
                employeeCosts={laborCostSummary.employeeCosts}
                onEditEmployee={onEditEmployee}
                maxItems={3}
                showViewAll={false}
              />
            ) : (
              <p className="text-xs text-muted-foreground">No labor costs yet for this week.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test -- tests/unit/ScheduleMetricsRibbon.test.tsx`
Expected: PASS (5 tests). If the skeleton selector misses, inspect the shadcn `Skeleton` markup (`src/components/ui/skeleton.tsx`) and adjust the selector to the class/attribute it actually renders.

- [ ] **Step 5: Typecheck the new file**

Run: `npm run typecheck`
Expected: no errors. (Confirms the `LaborCostSummary.employeeCosts` element shape used in the test matches `EmployeeLaborCost`.)

- [ ] **Step 6: Commit**

```bash
git add src/components/scheduling/ScheduleMetricsRibbon.tsx tests/unit/ScheduleMetricsRibbon.test.tsx
git commit -m "feat(scheduling): add ScheduleMetricsRibbon component"
```

---

### Task 2: Wire the ribbon into `Scheduling.tsx`, remove the old header + cards

**Files:**
- Modify: `src/pages/Scheduling.tsx` (import; replace lines ~725–987)

- [ ] **Step 1: Add the import**

In the custom-hooks/components import group of `src/pages/Scheduling.tsx`, add:

```tsx
import { ScheduleMetricsRibbon } from '@/components/scheduling/ScheduleMetricsRibbon';
```

- [ ] **Step 2: Replace the header + metrics block**

Delete the entire `{/* Header - Professional Kitchen Aesthetic */}` block AND the `{/* Metrics Row - Enhanced Cards */}` block — from the opening `<div className="relative overflow-hidden rounded-xl border ...">` (currently line ~726) through the closing `</div>` that ends the three-card grid (currently line ~987, the `</div>` closing `<div className="grid gap-4 md:grid-cols-3">`). Replace both with:

```tsx
      <ScheduleMetricsRibbon
        activeEmployeeCount={filteredActiveEmployees.length}
        totalScheduledHours={totalScheduledHours}
        laborCostBreakdown={laborCostBreakdown}
        laborCostSummary={laborCostSummary}
        laborBudgetData={laborBudgetData}
        shiftCount={shifts.length}
        scheduledEmployeeCount={scheduledEmployeeCount}
        isLoading={employeesLoading || shiftsLoading}
        onEditEmployee={handleEditEmployeeById}
      />
```

The outer `<div className="space-y-6">` and the `<Tabs>` that follow stay unchanged. The ribbon becomes the first child.

- [ ] **Step 3: Remove now-unused imports/vars**

Run: `npm run lint -- src/pages/Scheduling.tsx`
Fix any `no-unused-vars` for symbols that were only used by the deleted block (candidates: `Card/CardHeader/CardContent/CardTitle` if unused elsewhere, `TrendingUp`, `AlertTriangle`, `DollarSign`, `Users`, `Clock`, `LaborCostBreakdown`, `LaborBudgetIndicator`, `ScheduleStatusBadge` is still used in the week nav — keep it). Only remove imports the linter actually flags; several (e.g. `Card`) are still used by the schedule grid below.

- [ ] **Step 4: Typecheck + build**

Run: `npm run typecheck && npm run build`
Expected: both pass.

- [ ] **Step 5: Run the scheduling-adjacent tests**

Run: `npm run test -- tests/unit/ScheduleMetricsRibbon.test.tsx tests/unit/ScheduleOverviewPanel.test.tsx`
Expected: PASS. (Sanity that the page's sibling components still import cleanly.)

- [ ] **Step 6: Commit**

```bash
git add src/pages/Scheduling.tsx
git commit -m "feat(scheduling): replace hero header + metric cards with sticky ribbon"
```

---

## Self-Review

**Spec coverage:**
- Compact pills (staff/hours/labor/avg rate) → Task 1 component ✓
- Sticky `top-14 z-30`, opaque `bg-background` → Task 1 ✓
- Collapsible Details, collapsed default, in-memory `useState` → Task 1 ✓
- Fold hero header, preserve `<h1>` → Task 1 title group ✓
- `group` ancestor for edit reveal → Task 1 details wrapper ✓
- Warning state via semantic tokens + AlertTriangle tooltip → Task 1 ✓
- Three-state (loading/error/empty) → Task 1 skeleton/error/employeeCosts-empty ✓
- Reuse `LaborCostBreakdown` + `LaborBudgetIndicator` unchanged → Task 1 ✓
- Remove old header + cards, wire ribbon → Task 2 ✓
- Mobile height / no horizontal overflow → verified in Phase 5 (UI review), acceptance check in design doc.

**Placeholder scan:** none — all steps carry real code/commands.

**Type consistency:** `ScheduledLaborCostBreakdown`, `LaborCostSummary`, `LaborBudgetData` used identically in test, component, and props. `employeeCosts` typed via `LaborCostSummary['employeeCosts']` in the test to stay in lockstep with the hook.

**Note for executor:** Line numbers (~725–987) drift as the file changes — anchor deletions on the `{/* Header ... */}` and `{/* Metrics Row ... */}` comments and the `grid md:grid-cols-3` wrapper, not raw line numbers.
