import { describe, it, expect } from 'vitest';
import React from 'react';
import { render } from '@testing-library/react';
import { POSSalesDashboard } from '@/components/POSSalesDashboard';

const baseProps = {
  totalSales: 100,
  totalRevenue: 1000,
  discounts: 0,
  voids: 0,
  passThroughAmount: 0,
  collectedAtPOS: 1000,
  uniqueItems: 25,
  unmappedCount: 0,
  lastSyncTime: '2026-05-17T12:00:00Z',
  contextCueVisible: false,
  cuePinned: false,
  onToggleCuePin: () => {},
  contextDescription: '',
  highlightToken: 0,
  filtersActive: false,
  isLoading: false,
};

describe('POSSalesDashboard — mobile layout', () => {
  it('outer row stacks on mobile, switches to flex-row at sm+', () => {
    const { container } = render(<POSSalesDashboard {...baseProps} />);
    const outerRow = container.querySelector('[class*="sm:flex-row"]');
    expect(outerRow).not.toBeNull();
    const className = outerRow?.className ?? '';
    expect(className).toMatch(/\bflex-col\b/);
    expect(className).toMatch(/\bsm:flex-row\b/);
    expect(className).toMatch(/\bsm:items-center\b/);
  });
});
