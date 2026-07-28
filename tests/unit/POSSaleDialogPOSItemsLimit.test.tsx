import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { POSSaleDialog } from '@/components/POSSaleDialog';

vi.mock('@/hooks/useUnifiedSales', () => ({
  useUnifiedSales: () => ({
    createManualSale: vi.fn(),
    createManualSaleWithAdjustments: vi.fn(),
    updateManualSale: vi.fn(),
  }),
}));

vi.mock('@/hooks/useRecipes', () => ({
  useRecipes: () => ({
    recipes: [],
    loading: false,
  }),
}));

// Spy-backed mock so the test can assert exactly what POSSaleDialog passes
// to usePOSItems (design "Decided trade-offs": list mode, limit: 500, no
// search term — Fuse.js does the client-side fuzzy search over that list).
const usePOSItemsMock = vi.fn();
vi.mock('@/hooks/usePOSItems', () => ({
  usePOSItems: (...args: unknown[]) => usePOSItemsMock(...args),
}));

describe('POSSaleDialog — usePOSItems list-mode wiring', () => {
  beforeEach(() => {
    usePOSItemsMock.mockReset();
    usePOSItemsMock.mockReturnValue({
      posItems: [],
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
  });

  it('calls usePOSItems with { limit: 500 } and no search term', () => {
    render(
      <POSSaleDialog
        open
        onOpenChange={vi.fn()}
        restaurantId="rest-1"
        editingSale={null}
      />
    );

    expect(usePOSItemsMock).toHaveBeenCalledWith('rest-1', { limit: 500 });
  });
});
