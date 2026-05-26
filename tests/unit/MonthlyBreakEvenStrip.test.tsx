import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MonthlyBreakEvenStrip } from '@/components/dashboard/MonthlyBreakEvenStrip';
import type { MonthlyProgress } from '@/lib/monthlyBreakEvenProgress';

function makeProgress(partial: Partial<MonthlyProgress> = {}): MonthlyProgress {
  return {
    monthLabel: 'May 2026',
    daysInMonth: 31,
    dayOfMonth: 16,
    mtdSales: 30000,
    monthlyBreakEven: 60000,
    progressPercent: 50,
    expectedPercent: (16 / 31) * 100,
    paceDelta: 50 - (16 / 31) * 100,
    status: 'on_pace',
    amountRemaining: 30000,
    daysRemaining: 16,
    dailyNeeded: 1875,
    dailyActual: 1875,
    projectedMonthly: 58125,
    projectedDelta: -1875,
    ...partial,
  };
}

function renderWithRouter(ui: React.ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

describe('MonthlyBreakEvenStrip', () => {
  it('renders loading skeleton when isLoading is true', () => {
    const { container } = renderWithRouter(
      <MonthlyBreakEvenStrip progress={null} isLoading={true} />,
    );
    expect(screen.queryByText(/Monthly Break-Even/)).toBeNull();
    expect(container.querySelectorAll('[class*="skeleton"], .animate-pulse').length).toBeGreaterThan(0);
  });

  it('renders no-target state with a setup link', () => {
    renderWithRouter(
      <MonthlyBreakEvenStrip
        progress={makeProgress({ status: 'no_target', monthlyBreakEven: 0 })}
        isLoading={false}
      />,
    );
    expect(screen.getByText(/Set fixed and percentage costs/)).toBeDefined();
    const link = screen.getByRole('link', { name: /Set up costs/ });
    expect(link.getAttribute('href')).toBe('/budget');
  });

  it('renders ahead state with meter wiring, headline numbers, and Budget link', () => {
    renderWithRouter(
      <MonthlyBreakEvenStrip
        progress={makeProgress({
          status: 'ahead',
          progressPercent: 70,
          expectedPercent: 50,
          mtdSales: 42000,
          monthlyBreakEven: 60000,
          dailyNeeded: 1200,
        })}
        isLoading={false}
      />,
    );

    const meter = screen.getByRole('meter');
    expect(meter.getAttribute('aria-valuenow')).toBe('70');
    expect(meter.getAttribute('aria-valuemin')).toBe('0');
    expect(meter.getAttribute('aria-valuemax')).toBe('100');
    expect(meter.getAttribute('aria-label')).toMatch(/Ahead/);

    expect(screen.getByText(/Monthly Break-Even · May 2026/)).toBeDefined();
    expect(screen.getByText(/\$42,000 of \$60,000 \(70%\)/)).toBeDefined();
    expect(screen.getByText(/\$1,200\/day to hit target/)).toBeDefined();
    expect(screen.getByRole('status').textContent).toMatch(/Ahead/);

    const link = screen.getByRole('link', { name: /Open Budget page/ });
    expect(link.getAttribute('href')).toBe('/budget');
  });

  it('renders behind state with shorter labels', () => {
    renderWithRouter(
      <MonthlyBreakEvenStrip
        progress={makeProgress({
          status: 'behind',
          progressPercent: 20,
          expectedPercent: 50,
          mtdSales: 12000,
          monthlyBreakEven: 60000,
          dailyNeeded: 3200,
        })}
        isLoading={false}
      />,
    );
    expect(screen.getByRole('status').textContent).toMatch(/Behind/);
  });

  it('omits "per day" sentence when dailyNeeded is 0 (target already hit)', () => {
    renderWithRouter(
      <MonthlyBreakEvenStrip
        progress={makeProgress({
          status: 'ahead',
          progressPercent: 110,
          mtdSales: 66000,
          monthlyBreakEven: 60000,
          dailyNeeded: 0,
          amountRemaining: 0,
        })}
        isLoading={false}
      />,
    );
    expect(screen.queryByText(/\/day to hit target/)).toBeNull();
    expect(screen.getByText(/\$66,000 of \$60,000/)).toBeDefined();
  });
});
