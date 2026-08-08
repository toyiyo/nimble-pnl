import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useAutomaticInventoryDeduction } from '@/hooks/useAutomaticInventoryDeduction';
import { toBusinessDay } from '@/lib/restaurantClock';

const mockSupabase = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: mockSupabase,
}));

const mockUseRestaurantContext = vi.hoisted(() => vi.fn());
vi.mock('@/contexts/RestaurantContext', () => ({
  useRestaurantContext: mockUseRestaurantContext,
}));

const mockToast = vi.hoisted(() => vi.fn());
vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: mockToast }),
}));

const RESTAURANT_TZ = 'Pacific/Auckland';

function setupSupabaseMocks() {
  const settingsChain: Record<string, ReturnType<typeof vi.fn>> = {};
  settingsChain.select = vi.fn().mockReturnThis();
  settingsChain.eq = vi.fn().mockReturnThis();
  settingsChain.maybeSingle = vi.fn().mockResolvedValue({ data: { enabled: true }, error: null });

  const salesChain: Record<string, ReturnType<typeof vi.fn>> = {};
  salesChain.select = vi.fn().mockReturnThis();
  salesChain.eq = vi.fn().mockReturnThis();
  salesChain.gte = vi.fn().mockReturnThis();
  salesChain.order = vi.fn().mockResolvedValue({ data: [], error: null });

  mockSupabase.from.mockImplementation((table: string) => {
    if (table === 'auto_deduction_settings') return settingsChain;
    if (table === 'unified_sales') return salesChain;
    throw new Error(`useAutomaticInventoryDeduction.test: unexpected table "${table}"`);
  });

  return { settingsChain, salesChain };
}

describe('useAutomaticInventoryDeduction — setupAutoDeduction restaurant-zone cutoff', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseRestaurantContext.mockReturnValue({
      selectedRestaurant: { restaurant_id: 'r1', restaurant: { timezone: RESTAURANT_TZ } },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('filters unprocessed sales using the restaurant business day, not the viewer/UTC day', async () => {
    // 23:30 UTC on July 31 is already Aug 1 in Pacific/Auckland (UTC+12,
    // winter/no-DST in July) -- the restaurant's business day differs from
    // the viewer's/UTC calendar day at this instant. setupAutoDeduction
    // buckets its `sale_date >= today` cutoff via toBusinessDay(new Date(), tz)
    // specifically to avoid the UTC-day rollover this fixture is built to
    // exercise (see the comment above `today` in
    // useAutomaticInventoryDeduction.tsx): a viewer/UTC day token here would
    // query sale_date >= '2026-07-31' and silently miss sales already posted
    // under the restaurant's Aug 1 business day, stalling auto-deduction
    // during evening service. `toFake: ['Date']` only fakes `Date`, leaving
    // the real timers `waitFor`/effects rely on untouched.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-07-31T23:30:00Z'));

    const expectedDay = toBusinessDay(new Date(), RESTAURANT_TZ);
    expect(expectedDay).toBe('2026-08-01');

    const { salesChain } = setupSupabaseMocks();

    const { result } = renderHook(() => useAutomaticInventoryDeduction());

    await waitFor(() => expect(result.current.autoDeductionEnabled).toBe(true));

    await act(async () => {
      await result.current.setupAutoDeduction();
    });

    expect(salesChain.gte).toHaveBeenCalledWith('sale_date', '2026-08-01');
    expect(salesChain.gte).not.toHaveBeenCalledWith('sale_date', '2026-07-31');
  });
});
