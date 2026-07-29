import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { POSSaleDialog } from '@/components/POSSaleDialog';

vi.mock('@/hooks/useUnifiedSales', () => ({
  useUnifiedSales: () => ({
    createManualSale: vi.fn(),
    createManualSaleWithAdjustments: vi.fn(),
    updateManualSale: vi.fn(),
  }),
}));

vi.mock('@/hooks/useRecipes', () => ({
  useRecipes: () => ({ recipes: [], loading: false }),
}));

vi.mock('@/hooks/usePOSItems', () => ({
  usePOSItems: () => ({
    posItems: [
      {
        item_name: 'House Burger',
        item_id: 'pos-item-1',
        source: 'pos_sales',
        sales_count: 92,
        last_sold: '2026-07-20',
      },
    ],
    loading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

// POSSaleDialog renders its own Dialog, so it can't join the parameterized
// free-standing/nested sweep in scroll-lock-boundary.test.tsx -- there is no
// free-standing case for it. It still owns an inline combobox Popover over a
// scrollable CommandList, which is exactly the configuration react-remove-
// scroll traps, so it needs the same `modal` resolution asserted on its own.
describe('POSSaleDialog — item combobox modal resolution', () => {
  it('opens its item combobox modal so the list escapes the dialog scroll lock', async () => {
    const user = userEvent.setup();

    render(
      <POSSaleDialog
        open
        onOpenChange={vi.fn()}
        restaurantId="rest-1"
        editingSale={null}
      />,
    );

    await user.click(screen.getByRole('combobox'));

    // Same behavioural probe as scroll-lock-boundary.test.tsx: only Radix's
    // modal branch calls `hideOthers()`, and aria-hidden tags the boundary
    // branch root rather than each descendant -- so assert "hidden by some
    // aria-hidden ancestor (or itself)", which is what a screen reader sees.
    expect(
      screen.getByText('Item Name').closest('[aria-hidden="true"]'),
    ).not.toBeNull();
  });
});
