import React from 'react';
import { describe, it, expect, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  SalesByDayChart,
  PRIOR_BAR_MAX_DAYS,
  buildPriorAriaLabel,
  formatPriorTooltip,
} from '@/components/pos-sales/SalesByDayChart';
import type { DailySeriesRowWithPrior } from '@/lib/salesTrends';

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({ width: 600, height: 300, top: 0, left: 0, bottom: 300, right: 600, x: 0, y: 0, toJSON: () => {} }),
  });
});

function rows(n: number, withPrior: boolean): DailySeriesRowWithPrior[] {
  return Array.from({ length: n }, (_, i) => {
    const day = String(i + 1).padStart(2, '0');
    const row = { date: `2026-03-${day}`, total: 100, square: 100 } as unknown as DailySeriesRowWithPrior;
    if (withPrior) {
      row.prior = 50;
      row.priorDate = `2026-02-${day}`;
    }
    return row;
  });
}

describe('buildPriorAriaLabel', () => {
  it('uses the full prior total when given', () => {
    const label = buildPriorAriaLabel('Daily sales.', rows(2, true), true, 100);
    expect(label).toContain('$100.00');
  });

  it('adds both totals when showPrior is true', () => {
    const label = buildPriorAriaLabel('Daily sales.', rows(2, true), true);
    expect(label).toContain('Daily sales.');
    expect(label).toContain('$200');
    expect(label).toContain('$100');
  });
  it('returns the base label when showPrior is false', () => {
    expect(buildPriorAriaLabel('Daily sales.', rows(2, true), false)).toBe('Daily sales.');
  });
});

describe('formatPriorTooltip', () => {
  it('shows the prior date and amount', () => {
    const out = formatPriorTooltip(50, rows(1, true)[0]);
    expect(out).toContain('$50');
    expect(out).toContain('Feb');
  });
});

describe('SalesByDayChart prior series', () => {
  it('sets the aria-label with both totals', () => {
    render(<SalesByDayChart data={rows(3, true)} showPrior posSystems={['square']} ariaLabel="Daily sales." />);
    const el = screen.getByRole('img');
    expect(el.getAttribute('aria-label')).toContain('$300');
    expect(el.getAttribute('aria-label')).toContain('$150');
  });
  it('keeps the base aria-label when no row has prior', () => {
    render(<SalesByDayChart data={rows(3, false)} showPrior posSystems={['square']} ariaLabel="Daily sales." />);
    expect(screen.getByRole('img').getAttribute('aria-label')).toBe('Daily sales.');
  });
  it('uses 14 as the bar limit', () => {
    expect(PRIOR_BAR_MAX_DAYS).toBe(14);
  });
});
