import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockRpc } = vi.hoisted(() => ({ mockRpc: vi.fn() }));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: { rpc: mockRpc, from: vi.fn(() => { throw new Error('from() must not be called'); }) },
}));

import { lookbackSalesQueryOptions } from '@/hooks/useWeekStaffingSuggestions';

describe('lookbackSalesQueryOptions', () => {
  beforeEach(() => {
    mockRpc.mockReset();
  });

  it('reads daily totals from get_hourly_sales_pattern by date', async () => {
    mockRpc.mockResolvedValue({
      data: {
        view: 'by_date',
        days: [
          { date: '2026-09-21', day_of_week: 1, day_total: 1000.5, slots: [] },
          { date: '2026-09-22', day_of_week: 2, day_total: '250', slots: [] },
        ],
      },
      error: null,
    });

    const options = lookbackSalesQueryOptions('r1', 4, 'America/Chicago');
    const rows = await options.queryFn();

    expect(mockRpc).toHaveBeenCalledTimes(1);
    expect(mockRpc).toHaveBeenCalledWith(
      'get_hourly_sales_pattern',
      expect.objectContaining({ p_restaurant_id: 'r1', p_interval_minutes: 60, p_view: 'by_date' }),
    );
    expect(rows).toEqual([
      { sale_date: '2026-09-21', total_price: 1000.5 },
      { sale_date: '2026-09-22', total_price: 250 },
    ]);
  });

  it('does not share the planner weekday cache key', () => {
    const options = lookbackSalesQueryOptions('r1', 4, 'America/Chicago');
    expect(options.queryKey[0]).not.toBe('hourly-sales-all');
    expect(options.queryKey).toEqual(['daily-sales-by-date', 'r1', 4, 'America/Chicago']);
  });

  it('throws the RPC error', async () => {
    mockRpc.mockResolvedValue({ data: null, error: new Error('boom') });
    await expect(lookbackSalesQueryOptions('r1', 4, 'UTC').queryFn()).rejects.toThrow('boom');
  });

  it('returns no rows without a restaurant', async () => {
    const options = lookbackSalesQueryOptions(null, 4, 'UTC');
    expect(options.enabled).toBe(false);
    await expect(options.queryFn()).resolves.toEqual([]);
    expect(mockRpc).not.toHaveBeenCalled();
  });
});
