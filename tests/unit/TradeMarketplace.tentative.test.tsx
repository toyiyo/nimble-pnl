/**
 * Regression test: the Trade Marketplace card and accept-confirm dialog
 * mark a trade whose offered shift is a draft (is_published: false) as
 * tentative. A published offered shift shows no badge.
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockUseMarketplaceTrades = vi.hoisted(() => vi.fn());
const mockUseAcceptShiftTrade = vi.hoisted(() => vi.fn());
const mockUseCurrentEmployee = vi.hoisted(() => vi.fn());

vi.mock('@/hooks/useShiftTrades', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/useShiftTrades')>();
  return {
    ...actual,
    useMarketplaceTrades: mockUseMarketplaceTrades,
    useAcceptShiftTrade: mockUseAcceptShiftTrade,
  };
});

vi.mock('@/hooks/useCurrentEmployee', () => ({
  useCurrentEmployee: mockUseCurrentEmployee,
}));

vi.mock('@/contexts/RestaurantContext', () => ({
  useRestaurantContext: () => ({
    selectedRestaurant: { restaurant_id: 'rest-1', restaurant: { id: 'rest-1' } },
  }),
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: { from: vi.fn(), rpc: vi.fn(), functions: { invoke: vi.fn() } },
}));

import { TradeMarketplace } from '@/components/schedule/TradeMarketplace';

const makeTrade = (isPublished: boolean) => ({
  id: 'trade-1',
  offered_shift: {
    id: 'shift-1',
    start_time: '2026-08-20T17:00:00Z',
    end_time: '2026-08-20T23:00:00Z',
    position: 'Server',
    break_duration: 0,
    is_published: isPublished,
  },
  offered_by: { id: 'emp-other', name: 'Mia', position: 'Server' },
  reason: null,
  created_at: '2026-08-14T00:00:00Z',
});

describe('TradeMarketplace tentative badge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseCurrentEmployee.mockReturnValue({ currentEmployee: { id: 'emp-me' } });
    mockUseAcceptShiftTrade.mockReturnValue({ mutate: vi.fn(), isPending: false });
  });

  it('shows the tentative badge on a draft offered shift', () => {
    mockUseMarketplaceTrades.mockReturnValue({ trades: [makeTrade(false)], loading: false });
    render(<TradeMarketplace />);
    expect(screen.getByText('Tentative — draft')).toBeInTheDocument();
  });

  it('hides the tentative badge on a published offered shift', () => {
    mockUseMarketplaceTrades.mockReturnValue({ trades: [makeTrade(true)], loading: false });
    render(<TradeMarketplace />);
    expect(screen.queryByText('Tentative — draft')).not.toBeInTheDocument();
  });

  it('shows the tentative badge in the accept-confirm dialog for a draft shift', () => {
    mockUseMarketplaceTrades.mockReturnValue({ trades: [makeTrade(false)], loading: false });
    render(<TradeMarketplace />);
    fireEvent.click(screen.getByRole('button', { name: /accept shift/i }));
    expect(screen.getAllByText('Tentative — draft').length).toBeGreaterThan(1);
  });
});
