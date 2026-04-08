import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchUncategorizedTotals } from '@/hooks/useUncategorizedTotals';

// Build a chainable mock query builder with pagination support
function createChainableMock(resolvedValue: { data: unknown; error: unknown }) {
  const chain: Record<string, unknown> = {};
  const methods = ['select', 'eq', 'is', 'in', 'gte', 'lte', 'range'];

  for (const method of methods) {
    chain[method] = vi.fn().mockReturnValue(chain);
  }

  // The chain resolves as a thenable when awaited
  chain['then'] = (resolve: (v: unknown) => void) => resolve(resolvedValue);

  return chain;
}

let queryMock: ReturnType<typeof createChainableMock>;

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: vi.fn(() => queryMock),
  },
}));

beforeEach(() => {
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
    queryMock = createChainableMock({
      data: [
        { amount: -100.50 },
        { amount: -250 },
        { amount: 800 },
        { amount: 400 },
        { amount: -50 },
      ],
      error: null,
    });

    const result = await fetchUncategorizedTotals('rest-1', '2026-01-01', '2026-01-31');

    expect(result.uncategorizedInflows).toBe(1200);
    expect(result.uncategorizedOutflows).toBe(400.5);
    expect(result.uncategorizedCount).toBe(5);
  });

  it('takes absolute value of outflows', async () => {
    queryMock = createChainableMock({
      data: [
        { amount: -999.99 },
        { amount: -0.01 },
      ],
      error: null,
    });

    const result = await fetchUncategorizedTotals('rest-1', '2026-03-01', '2026-03-31');

    expect(result.uncategorizedOutflows).toBe(1000);
  });

  it('handles null data gracefully', async () => {
    queryMock = createChainableMock({ data: null, error: null });

    const result = await fetchUncategorizedTotals('rest-1', '2026-01-01', '2026-01-31');

    expect(result).toEqual({
      uncategorizedInflows: 0,
      uncategorizedOutflows: 0,
      uncategorizedCount: 0,
    });
  });

  it('throws on query errors so React Query can handle retries', async () => {
    queryMock = createChainableMock({
      data: null,
      error: { message: 'db error' },
    });

    await expect(fetchUncategorizedTotals('rest-1', '2026-01-01', '2026-01-31'))
      .rejects.toThrow('Failed to fetch uncategorized transactions: db error');
  });
});
