import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchUncategorizedTotals } from '@/hooks/useUncategorizedTotals';

// Build a chainable mock query builder
function createChainableMock(resolvedValue: { data: unknown; error: unknown }) {
  const chain: Record<string, unknown> = {};
  const methods = ['select', 'eq', 'is', 'in', 'lt', 'gt', 'gte', 'lte'];

  for (const method of methods) {
    chain[method] = vi.fn().mockReturnValue(chain);
  }

  chain['maybeSingle'] = vi.fn().mockResolvedValue(resolvedValue);

  return chain;
}

let outflowMock: ReturnType<typeof createChainableMock>;
let inflowMock: ReturnType<typeof createChainableMock>;
let callCount: number;

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: vi.fn(() => {
      // First call is outflows, second call is inflows
      callCount++;
      return callCount <= 1 ? outflowMock : inflowMock;
    }),
  },
}));

beforeEach(() => {
  callCount = 0;
  vi.clearAllMocks();
});

describe('fetchUncategorizedTotals', () => {
  it('returns EMPTY when restaurantId is null', async () => {
    const result = await fetchUncategorizedTotals(null, '2026-01-01', '2026-01-31');

    expect(result).toEqual({
      uncategorizedInflows: 0,
      uncategorizedOutflows: 0,
      uncategorizedCount: 0,
    });
  });

  it('correctly sums inflows and outflows separately', async () => {
    outflowMock = createChainableMock({
      data: { total: -350.5, count: 3 },
      error: null,
    });
    inflowMock = createChainableMock({
      data: { total: 1200, count: 5 },
      error: null,
    });

    const result = await fetchUncategorizedTotals('rest-1', '2026-01-01', '2026-01-31');

    expect(result.uncategorizedInflows).toBe(1200);
    expect(result.uncategorizedOutflows).toBe(350.5);
    expect(result.uncategorizedCount).toBe(8);
  });

  it('takes absolute value of outflows', async () => {
    outflowMock = createChainableMock({
      data: { total: -999.99, count: 2 },
      error: null,
    });
    inflowMock = createChainableMock({
      data: { total: 0, count: 0 },
      error: null,
    });

    const result = await fetchUncategorizedTotals('rest-1', '2026-03-01', '2026-03-31');

    expect(result.uncategorizedOutflows).toBe(999.99);
  });

  it('handles null data gracefully', async () => {
    outflowMock = createChainableMock({ data: null, error: null });
    inflowMock = createChainableMock({ data: null, error: null });

    const result = await fetchUncategorizedTotals('rest-1', '2026-01-01', '2026-01-31');

    expect(result).toEqual({
      uncategorizedInflows: 0,
      uncategorizedOutflows: 0,
      uncategorizedCount: 0,
    });
  });

  it('warns on errors but still returns partial data', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    outflowMock = createChainableMock({
      data: null,
      error: { message: 'db error' },
    });
    inflowMock = createChainableMock({
      data: { total: 500, count: 2 },
      error: null,
    });

    const result = await fetchUncategorizedTotals('rest-1', '2026-01-01', '2026-01-31');

    expect(warnSpy).toHaveBeenCalledOnce();
    expect(result.uncategorizedInflows).toBe(500);
    expect(result.uncategorizedOutflows).toBe(0);
    expect(result.uncategorizedCount).toBe(2);

    warnSpy.mockRestore();
  });
});
