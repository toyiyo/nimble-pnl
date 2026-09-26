import { describe, it, expect, vi } from 'vitest';

// The hook module imports the supabase client at the top level. Mock it so
// this pure-function test does not construct a real client.
vi.mock('@/integrations/supabase/client', () => ({
  supabase: { rpc: vi.fn() },
}));

import { mapUsageRows } from '@/hooks/useInventoryUsageByDay';

describe('mapUsageRows', () => {
  it('maps RPC rows to dailyCosts and sums totalCost', () => {
    const result = mapUsageRows([
      { day: '2026-08-01', food_cost: 10.5 },
      { day: '2026-08-02', food_cost: 4.5 },
    ]);
    expect(result.dailyCosts).toEqual([
      { date: '2026-08-01', total_cost: 10.5 },
      { date: '2026-08-02', total_cost: 4.5 },
    ]);
    expect(result.totalCost).toBe(15);
  });

  it('returns empty data for zero rows', () => {
    const result = mapUsageRows([]);
    expect(result.dailyCosts).toEqual([]);
    expect(result.totalCost).toBe(0);
  });
});
