import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import { POSSaleDialog } from '@/components/POSSaleDialog';

vi.mock('@/hooks/useUnifiedSales', () => ({
  useUnifiedSales: () => ({
    createManualSale: vi.fn(),
    createManualSaleWithAdjustments: vi.fn(),
    updateManualSale: vi.fn(),
  }),
}));

vi.mock('@/hooks/usePOSItems', () => ({
  usePOSItems: () => ({
    posItems: [],
    loading: false,
    refetch: vi.fn(),
  }),
}));

vi.mock('@/hooks/useRecipes', () => ({
  useRecipes: () => ({
    recipes: [],
    loading: false,
  }),
}));

describe('POSSaleDialog layout — sticky footer', () => {
  it('renders the outer DialogContent with max-h-[85vh] + overflow-hidden + flex flex-col so the box has a height cap and only the inner body scrolls', () => {
    render(
      <POSSaleDialog
        open
        onOpenChange={vi.fn()}
        restaurantId="r-1"
        editingSale={null}
      />,
    );

    const content = screen.getByRole('dialog');
    expect(content.className).toContain('max-h-[85vh]');
    expect(content.className).toContain('overflow-hidden');
    expect(content.className).toContain('flex-col');
  });

  it('wraps the form fields in a scrollable body (flex-1 overflow-y-auto) so long forms scroll within the dialog', () => {
    render(
      <POSSaleDialog
        open
        onOpenChange={vi.fn()}
        restaurantId="r-1"
        editingSale={null}
      />,
    );

    const scrollBody = document.querySelector('[data-testid="pos-sale-scroll-body"]');
    expect(scrollBody).not.toBeNull();
    expect(scrollBody?.className).toContain('flex-1');
    expect(scrollBody?.className).toContain('overflow-y-auto');
  });

  it('pins the footer with flex-shrink-0 and a top border so Cancel and Record Sale are always visible', () => {
    render(
      <POSSaleDialog
        open
        onOpenChange={vi.fn()}
        restaurantId="r-1"
        editingSale={null}
      />,
    );

    const footer = document.querySelector('[data-testid="pos-sale-footer"]');
    expect(footer).not.toBeNull();
    expect(footer?.className).toContain('flex-shrink-0');
    expect(footer?.className).toContain('border-t');

    expect(footer?.querySelector('button[type="button"]')).toHaveTextContent('Cancel');
    expect(footer?.querySelector('button[type="submit"]')).toHaveTextContent('Record Sale');
  });
});
