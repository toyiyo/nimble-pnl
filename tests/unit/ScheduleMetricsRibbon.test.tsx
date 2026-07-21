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
  salary: { cost: 0, estimatedDays: 0 },
  contractor: { cost: 0, estimatedDays: 0 },
  daily_rate: { cost: 0, estimatedDays: 0 },
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
    // "labor cost" text is relied on by employee-payroll.spec.ts (PR #630) to
    // locate the labor figure on the scheduling page — keep it discoverable.
    expect(screen.getByText(/labor cost/i)).toBeInTheDocument();
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

  it('uses a budget-specific label when only the budget tier triggers the warning', () => {
    renderRibbon({
      laborBudgetData: { ...budget, hasBudget: true, tier: 'warning' },
    });
    expect(screen.getByLabelText(/labor nearing budget warning/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/high average rate warning/i)).not.toBeInTheDocument();
  });

  it('uses an over-budget label when the budget tier is danger', () => {
    renderRibbon({
      laborBudgetData: { ...budget, hasBudget: true, tier: 'danger' },
    });
    expect(screen.getByLabelText(/labor over budget warning/i)).toBeInTheDocument();
  });

  it('singularizes the shift count when there is exactly one shift', () => {
    renderRibbon({ shiftCount: 1 });
    expect(screen.getByText(/1 shift ·/)).toBeInTheDocument();
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

  // Regression guard (CI E2E, PR #630): the sticky ribbon pins over the tabs
  // that scroll beneath it. Without pointer-events-none on the wrapper, its
  // opaque box intercepts clicks meant for those tabs (Playwright reported
  // "subtree intercepts pointer events"). The interactive Details button must
  // re-enable pointer events so it stays clickable.
  it('keeps the sticky wrapper click-through while its controls stay interactive', () => {
    renderRibbon();
    const wrapper = screen.getByRole('heading', { level: 1, name: /staff schedule/i })
      .closest('.sticky');
    expect(wrapper).toHaveClass('pointer-events-none');
    expect(screen.getByRole('button', { name: /details/i })).toHaveClass('pointer-events-auto');
  });
});
