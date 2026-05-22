import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SearchableAccountSelector } from '@/components/banking/SearchableAccountSelector';

vi.mock('@/contexts/RestaurantContext', () => ({
  useRestaurantContext: () => ({
    selectedRestaurant: { restaurant_id: 'rest-1' },
  }),
}));

vi.mock('@/hooks/useChartOfAccounts', () => ({
  useChartOfAccounts: () => ({
    accounts: [
      {
        id: 'acc-1',
        restaurant_id: 'rest-1',
        account_code: '5000',
        account_name: 'Food Costs',
        account_type: 'cogs',
        account_subtype: 'food',
        parent_account_id: null,
        is_active: true,
      },
    ],
    loading: false,
  }),
}));

describe('SearchableAccountSelector — triggerAriaLabel', () => {
  it('forwards triggerAriaLabel to the combobox button when provided', () => {
    render(
      <SearchableAccountSelector
        onValueChange={() => {}}
        triggerAriaLabel="Category for check row 1"
      />,
    );
    const combo = screen.getByRole('combobox', {
      name: 'Category for check row 1',
    });
    expect(combo).toBeInTheDocument();
  });

  it('omits aria-label when prop is not provided (default behaviour unchanged)', () => {
    render(<SearchableAccountSelector onValueChange={() => {}} />);
    const combo = screen.getByRole('combobox');
    expect(combo.getAttribute('aria-label')).toBeNull();
  });
});
