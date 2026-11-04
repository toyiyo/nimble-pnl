import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@/hooks/useFinancialSettings', () => ({
  useFinancialSettings: () => ({
    cogsMethod: 'inventory',
    isLoading: false,
    updateSettings: vi.fn(),
  }),
}));

vi.mock('@/hooks/useUnifiedCOGS', () => ({
  useUnifiedCOGS: () => ({
    breakdown: { inventory: 0, financials: 0 },
    isLoading: false,
  }),
}));

import { COGSPreferenceSettings } from '@/components/settings/COGSPreferenceSettings';

describe('COGSPreferenceSettings', () => {
  it('offers only the inventory and financials methods, not combined', () => {
    render(<COGSPreferenceSettings restaurantId="rest-1" />);

    expect(screen.getByText('Inventory (consumption)')).toBeInTheDocument();
    expect(screen.getByText('Financials (purchases)')).toBeInTheDocument();
    expect(screen.queryByText('Combined')).not.toBeInTheDocument();
    expect(
      screen.getByText(
        'Computes COGS from inventory usage: the cost of ingredients that your recipes consume.',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'Computes COGS from purchases: bank transactions, splits, and pending outflows in COGS categories.',
      ),
    ).toBeInTheDocument();
  });
});
