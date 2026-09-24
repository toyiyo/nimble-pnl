import { describe, it, expect, vi } from 'vitest';

// Both hook modules import the supabase client at the top level. Mock it so
// this pure-function test does not construct a real client.
vi.mock('@/integrations/supabase/client', () => ({
  supabase: { rpc: vi.fn() },
}));

import { inventoryUsageByDayKey } from '@/hooks/useInventoryUsageByDay';
import { cogsFinancialsKey } from '@/hooks/useCOGSFromFinancials';

// These builders back the useIsFetching filters in useCostsFromSource. Each
// must return the exact array the owning hook uses as its queryKey, or the
// `exact: true` match in useCostsFromSource silently stops counting fetches.

describe('inventoryUsageByDayKey', () => {
  it('builds the exact key for a known date pair', () => {
    const dateFrom = new Date(2026, 7, 1); // 2026-08-01
    const dateTo = new Date(2026, 7, 27); // 2026-08-27
    const built = inventoryUsageByDayKey('rest-1', dateFrom, dateTo);
    expect(built.key).toEqual([
      'inventory-usage-by-day',
      'rest-1',
      '2026-08-01',
      '2026-08-27',
    ]);
    expect(built.fromStr).toBe(built.key[2]);
    expect(built.toStr).toBe(built.key[3]);
  });

  it('keeps a null restaurantId in the key', () => {
    const dateFrom = new Date(2026, 7, 1);
    const dateTo = new Date(2026, 7, 27);
    expect(inventoryUsageByDayKey(null, dateFrom, dateTo).key).toEqual([
      'inventory-usage-by-day',
      null,
      '2026-08-01',
      '2026-08-27',
    ]);
  });
});

describe('cogsFinancialsKey', () => {
  it('builds the exact key for a known date pair', () => {
    const dateFrom = new Date(2026, 7, 1); // 2026-08-01
    const dateTo = new Date(2026, 7, 27); // 2026-08-27
    const built = cogsFinancialsKey('rest-1', dateFrom, dateTo);
    expect(built.key).toEqual([
      'cogs-financials',
      'rest-1',
      '2026-08-01',
      '2026-08-27',
    ]);
    expect(built.fromStr).toBe(built.key[2]);
    expect(built.toStr).toBe(built.key[3]);
  });

  it('keeps a null restaurantId in the key', () => {
    const dateFrom = new Date(2026, 7, 1);
    const dateTo = new Date(2026, 7, 27);
    expect(cogsFinancialsKey(null, dateFrom, dateTo).key).toEqual([
      'cogs-financials',
      null,
      '2026-08-01',
      '2026-08-27',
    ]);
  });
});
