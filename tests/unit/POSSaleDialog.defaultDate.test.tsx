import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
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
  usePOSItems: () => ({ posItems: [], loading: false, refetch: vi.fn() }),
}));

vi.mock('@/hooks/useRecipes', () => ({
  useRecipes: () => ({ recipes: [], loading: false }),
}));

function renderDialog(open: boolean, timezone: string) {
  return (
    <POSSaleDialog
      open={open}
      onOpenChange={vi.fn()}
      restaurantId="r-1"
      editingSale={null}
      timezone={timezone}
    />
  );
}

function dateInput(): HTMLInputElement {
  return document.querySelector('input[name="saleDate"]') as HTMLInputElement;
}

describe('POSSaleDialog default sale date', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('uses the restaurant day, not the UTC day', () => {
    // 02:30 UTC on 4 Nov is 21:30 on 3 Nov in New York.
    vi.setSystemTime(new Date('2026-11-04T02:30:00Z'));
    render(renderDialog(true, 'America/New_York'));
    expect(dateInput().value).toBe('2026-11-03');
  });

  it('shows the new default when the dialog opens on a later day', () => {
    vi.setSystemTime(new Date('2026-11-03T15:00:00Z'));
    const { rerender } = render(renderDialog(false, 'America/New_York'));
    rerender(renderDialog(true, 'America/New_York'));
    expect(dateInput().value).toBe('2026-11-03');

    rerender(renderDialog(false, 'America/New_York'));
    vi.setSystemTime(new Date('2026-11-04T15:00:00Z'));
    rerender(renderDialog(true, 'America/New_York'));
    expect(dateInput().value).toBe('2026-11-04');
    expect(screen.getByRole('dialog')).toBeTruthy();
  });
});
