import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LaborVerdict, verdictDotClassName } from '@/components/labor/LaborVerdict';
import type { LaborPnlSummary } from '@/lib/laborPnlAnalytics';

function makeSummary(overrides: Partial<LaborPnlSummary>): LaborPnlSummary {
  return {
    sales: 10000,
    laborCost: 2800,
    laborPct: 28,
    revPerLaborHr: 73,
    verdict: 'Labor ran 28% of sales — right on your 28% target.',
    verdictTone: 'balanced',
    overWindows: [],
    underWindows: [],
    ...overrides,
  };
}

describe('verdictDotClassName', () => {
  it('maps over/under/balanced to their dedicated --labor-* token classes', () => {
    expect(verdictDotClassName('over')).toBe('bg-[hsl(var(--labor-over))]');
    expect(verdictDotClassName('under')).toBe('bg-[hsl(var(--labor-under))]');
    expect(verdictDotClassName('balanced')).toBe('bg-[hsl(var(--labor-balanced))]');
  });

  it('maps "none" to a neutral dot class, never a --labor-* token', () => {
    expect(verdictDotClassName('none')).toBe('bg-muted-foreground/50');
  });
});

describe('LaborVerdict — render', () => {
  it('renders a red dot + the verdict sentence when over target', () => {
    const summary = makeSummary({
      verdictTone: 'over',
      verdict: 'Labor ran 34.5% of sales — 0.5pt over target. Team earned $60/labor-hour.',
    });
    render(<LaborVerdict summary={summary} />);

    expect(screen.getByText(/labor ran 34\.5% of sales — 0\.5pt over target/i)).toBeInTheDocument();
    const dot = document.querySelector('[aria-hidden="true"]');
    expect(dot).toHaveClass('bg-[hsl(var(--labor-over))]');
  });

  it('renders an amber dot + the verdict sentence when under target', () => {
    const summary = makeSummary({
      verdictTone: 'under',
      verdict: 'Labor ran 18.2% of sales — 3.8pt under target. Team earned $110/labor-hour.',
    });
    render(<LaborVerdict summary={summary} />);

    expect(screen.getByText(/labor ran 18\.2% of sales — 3\.8pt under target/i)).toBeInTheDocument();
    const dot = document.querySelector('[aria-hidden="true"]');
    expect(dot).toHaveClass('bg-[hsl(var(--labor-under))]');
  });

  it('renders a green dot + the verdict sentence when balanced', () => {
    const summary = makeSummary({ verdictTone: 'balanced' });
    render(<LaborVerdict summary={summary} />);

    expect(screen.getByText(/right on your 28% target/i)).toBeInTheDocument();
    const dot = document.querySelector('[aria-hidden="true"]');
    expect(dot).toHaveClass('bg-[hsl(var(--labor-balanced))]');
  });

  it('renders a neutral dot + the no-data sentence when tone is "none"', () => {
    const summary = makeSummary({
      verdictTone: 'none',
      laborPct: null,
      revPerLaborHr: null,
      verdict: 'Not enough data to assess labor yet.',
    });
    render(<LaborVerdict summary={summary} />);

    expect(screen.getByText(/not enough data to assess labor yet/i)).toBeInTheDocument();
    const dot = document.querySelector('[aria-hidden="true"]');
    expect(dot).toHaveClass('bg-muted-foreground/50');
  });

  it('renders nothing when summary is null (defensive guard)', () => {
    const { container } = render(<LaborVerdict summary={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when summary is undefined (defensive guard)', () => {
    const { container } = render(<LaborVerdict summary={undefined} />);
    expect(container).toBeEmptyDOMElement();
  });
});
