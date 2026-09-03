/**
 * Regression test: the Trade Marketplace card and accept-confirm dialog
 * mark a trade whose offered shift is a draft (is_published: false) as
 * tentative. A published offered shift shows no badge.
 */

import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockUseMarketplaceTrades = vi.hoisted(() => vi.fn());
const mockUseAcceptShiftTrade = vi.hoisted(() => vi.fn());
const mockUseCurrentEmployee = vi.hoisted(() => vi.fn());

// Shift Protection reads run through React Query in the real hook; these
// component tests render without a QueryClientProvider, so stub the hook
// family with everything-off defaults.
vi.mock('@/hooks/useShiftProtection', () => ({
  shiftProtectionQueryKey: (id: string | null) => ['shift-protection', id],
  useShiftProtection: () => ({
    protection: {
      trade_deadline_mode: 'off',
      trade_deadline_hours: 24,
      trade_auto_expire: false,
      timeoff_notice_mode: 'off',
      timeoff_notice_days: 7,
      timeoff_sameday_mode: 'off',
      timeoff_sameday_limit: 2,
      coverage_floor_mode: 'off',
    },
    isLoading: false,
    error: null,
  }),
  useInvalidateShiftProtection: () => () => {},
  useTimeoffDayCounts: () => ({ data: [], isLoading: false, error: null }),
  useTimeoffCoverageImpact: () => ({ data: null, isLoading: false, error: null }),
}));

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
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getAllByText('Tentative — draft')).toHaveLength(1);
  });
});
