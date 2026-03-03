import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Mocks — must be declared before importing the hook under test
// ---------------------------------------------------------------------------

const mockUseFoodCosts = vi.fn();
const mockUseCOGSFromFinancials = vi.fn();
const mockUseFinancialSettings = vi.fn();

vi.mock('@/hooks/useFoodCosts', () => ({
  useFoodCosts: (...args: unknown[]) => mockUseFoodCosts(...args),
}));

vi.mock('@/hooks/useCOGSFromFinancials', () => ({
  useCOGSFromFinancials: (...args: unknown[]) =>
    mockUseCOGSFromFinancials(...args),
}));

vi.mock('@/hooks/useFinancialSettings', () => ({
  useFinancialSettings: (...args: unknown[]) =>
    mockUseFinancialSettings(...args),
}));

// ---------------------------------------------------------------------------
// Import under test — after mocks
// ---------------------------------------------------------------------------

import { useUnifiedCOGS } from '@/hooks/useUnifiedCOGS';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DATE_FROM = new Date('2026-03-01');
const DATE_TO = new Date('2026-03-07');

function inventoryResult(overrides: Record<string, unknown> = {}) {
  return {
    dailyCosts: [
      { date: '2026-03-01', total_cost: 100 },
      { date: '2026-03-02', total_cost: 150 },
    ],
    totalCost: 250,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
    ...overrides,
  };
}

function financialsResult(overrides: Record<string, unknown> = {}) {
  return {
    dailyCosts: [
      { date: '2026-03-02', total_cost: 75 },
      { date: '2026-03-03', total_cost: 125 },
    ],
    totalCost: 200,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
    ...overrides,
  };
}

function settingsResult(overrides: Record<string, unknown> = {}) {
  return {
    cogsMethod: 'inventory' as const,
    isLoading: false,
    settings: null,
    updateSettings: vi.fn(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useUnifiedCOGS', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseFoodCosts.mockReturnValue(inventoryResult());
    mockUseCOGSFromFinancials.mockReturnValue(financialsResult());
    mockUseFinancialSettings.mockReturnValue(settingsResult());
  });

  // -----------------------------------------------------------------------
  // 1. Inventory method
  // -----------------------------------------------------------------------
  it('uses only inventory data when method is "inventory"', () => {
    mockUseFinancialSettings.mockReturnValue(
      settingsResult({ cogsMethod: 'inventory' }),
    );

    const { result } = renderHook(() =>
      useUnifiedCOGS('rest-1', DATE_FROM, DATE_TO),
    );

    expect(result.current.totalCOGS).toBe(250);
    expect(result.current.dailyCOGS).toEqual([
      { date: '2026-03-01', amount: 100 },
      { date: '2026-03-02', amount: 150 },
    ]);
    expect(result.current.method).toBe('inventory');
  });

  // -----------------------------------------------------------------------
  // 2. Financials method
  // -----------------------------------------------------------------------
  it('uses only financial data when method is "financials"', () => {
    mockUseFinancialSettings.mockReturnValue(
      settingsResult({ cogsMethod: 'financials' }),
    );

    const { result } = renderHook(() =>
      useUnifiedCOGS('rest-1', DATE_FROM, DATE_TO),
    );

    expect(result.current.totalCOGS).toBe(200);
    expect(result.current.dailyCOGS).toEqual([
      { date: '2026-03-02', amount: 75 },
      { date: '2026-03-03', amount: 125 },
    ]);
    expect(result.current.method).toBe('financials');
  });

  // -----------------------------------------------------------------------
  // 3. Combined method — totals
  // -----------------------------------------------------------------------
  it('sums both sources when method is "combined"', () => {
    mockUseFinancialSettings.mockReturnValue(
      settingsResult({ cogsMethod: 'combined' }),
    );

    const { result } = renderHook(() =>
      useUnifiedCOGS('rest-1', DATE_FROM, DATE_TO),
    );

    expect(result.current.totalCOGS).toBe(450); // 250 + 200
    expect(result.current.method).toBe('combined');
  });

  // -----------------------------------------------------------------------
  // 4. Combined method — daily merge by date
  // -----------------------------------------------------------------------
  it('merges daily data by date in combined mode', () => {
    mockUseFinancialSettings.mockReturnValue(
      settingsResult({ cogsMethod: 'combined' }),
    );

    const { result } = renderHook(() =>
      useUnifiedCOGS('rest-1', DATE_FROM, DATE_TO),
    );

    // inventory: 03-01 (100), 03-02 (150)
    // financials: 03-02 (75), 03-03 (125)
    // merged: 03-01 (100), 03-02 (225), 03-03 (125)
    expect(result.current.dailyCOGS).toEqual([
      { date: '2026-03-01', amount: 100 },
      { date: '2026-03-02', amount: 225 },
      { date: '2026-03-03', amount: 125 },
    ]);
  });

  // -----------------------------------------------------------------------
  // 5. Breakdown always shows both values
  // -----------------------------------------------------------------------
  it('breakdown always shows both values regardless of method', () => {
    // Test with inventory method
    mockUseFinancialSettings.mockReturnValue(
      settingsResult({ cogsMethod: 'inventory' }),
    );

    const { result: inventoryResult } = renderHook(() =>
      useUnifiedCOGS('rest-1', DATE_FROM, DATE_TO),
    );

    expect(inventoryResult.current.breakdown).toEqual({
      inventory: 250,
      financials: 200,
    });

    // Test with financials method
    mockUseFinancialSettings.mockReturnValue(
      settingsResult({ cogsMethod: 'financials' }),
    );

    const { result: financialsResultHook } = renderHook(() =>
      useUnifiedCOGS('rest-1', DATE_FROM, DATE_TO),
    );

    expect(financialsResultHook.current.breakdown).toEqual({
      inventory: 250,
      financials: 200,
    });

    // Test with combined method
    mockUseFinancialSettings.mockReturnValue(
      settingsResult({ cogsMethod: 'combined' }),
    );

    const { result: combinedResult } = renderHook(() =>
      useUnifiedCOGS('rest-1', DATE_FROM, DATE_TO),
    );

    expect(combinedResult.current.breakdown).toEqual({
      inventory: 250,
      financials: 200,
    });
  });

  // -----------------------------------------------------------------------
  // 6. isLoading is true while any source loads
  // -----------------------------------------------------------------------
  it('isLoading is true when settings are loading', () => {
    mockUseFinancialSettings.mockReturnValue(
      settingsResult({ isLoading: true }),
    );

    const { result } = renderHook(() =>
      useUnifiedCOGS('rest-1', DATE_FROM, DATE_TO),
    );

    expect(result.current.isLoading).toBe(true);
  });

  it('isLoading is true when inventory data is loading', () => {
    mockUseFoodCosts.mockReturnValue(inventoryResult({ isLoading: true }));

    const { result } = renderHook(() =>
      useUnifiedCOGS('rest-1', DATE_FROM, DATE_TO),
    );

    expect(result.current.isLoading).toBe(true);
  });

  it('isLoading is true when financial data is loading', () => {
    mockUseCOGSFromFinancials.mockReturnValue(
      financialsResult({ isLoading: true }),
    );

    const { result } = renderHook(() =>
      useUnifiedCOGS('rest-1', DATE_FROM, DATE_TO),
    );

    expect(result.current.isLoading).toBe(true);
  });

  it('isLoading is false when all sources are done', () => {
    const { result } = renderHook(() =>
      useUnifiedCOGS('rest-1', DATE_FROM, DATE_TO),
    );

    expect(result.current.isLoading).toBe(false);
  });

  // -----------------------------------------------------------------------
  // 7. Null restaurantId — returns zeros
  // -----------------------------------------------------------------------
  it('returns 0 for everything when restaurantId is null', () => {
    mockUseFoodCosts.mockReturnValue(
      inventoryResult({ dailyCosts: [], totalCost: 0 }),
    );
    mockUseCOGSFromFinancials.mockReturnValue(
      financialsResult({ dailyCosts: [], totalCost: 0 }),
    );

    const { result } = renderHook(() =>
      useUnifiedCOGS(null, DATE_FROM, DATE_TO),
    );

    expect(result.current.totalCOGS).toBe(0);
    expect(result.current.dailyCOGS).toEqual([]);
    expect(result.current.breakdown).toEqual({
      inventory: 0,
      financials: 0,
    });
  });

  // -----------------------------------------------------------------------
  // Converts restaurantId null -> undefined for useFinancialSettings
  // -----------------------------------------------------------------------
  it('passes restaurantId as undefined to useFinancialSettings when null', () => {
    mockUseFoodCosts.mockReturnValue(
      inventoryResult({ dailyCosts: [], totalCost: 0 }),
    );
    mockUseCOGSFromFinancials.mockReturnValue(
      financialsResult({ dailyCosts: [], totalCost: 0 }),
    );

    renderHook(() => useUnifiedCOGS(null, DATE_FROM, DATE_TO));

    expect(mockUseFinancialSettings).toHaveBeenCalledWith(undefined);
  });

  // -----------------------------------------------------------------------
  // Error propagation
  // -----------------------------------------------------------------------
  it('propagates inventory error', () => {
    const testError = new Error('inventory fetch failed');
    mockUseFoodCosts.mockReturnValue(
      inventoryResult({ error: testError }),
    );

    const { result } = renderHook(() =>
      useUnifiedCOGS('rest-1', DATE_FROM, DATE_TO),
    );

    expect(result.current.error).toBe(testError);
  });

  it('propagates financial error when inventory has no error', () => {
    const testError = new Error('financials fetch failed');
    mockUseCOGSFromFinancials.mockReturnValue(
      financialsResult({ error: testError }),
    );

    const { result } = renderHook(() =>
      useUnifiedCOGS('rest-1', DATE_FROM, DATE_TO),
    );

    expect(result.current.error).toBe(testError);
  });

  // -----------------------------------------------------------------------
  // Both hooks always called (React rules)
  // -----------------------------------------------------------------------
  it('always calls both data hooks regardless of method', () => {
    mockUseFinancialSettings.mockReturnValue(
      settingsResult({ cogsMethod: 'inventory' }),
    );

    renderHook(() => useUnifiedCOGS('rest-1', DATE_FROM, DATE_TO));

    expect(mockUseFoodCosts).toHaveBeenCalledWith(
      'rest-1',
      DATE_FROM,
      DATE_TO,
    );
    expect(mockUseCOGSFromFinancials).toHaveBeenCalledWith(
      'rest-1',
      DATE_FROM,
      DATE_TO,
    );
  });

  // -----------------------------------------------------------------------
  // Combined mode with non-overlapping dates
  // -----------------------------------------------------------------------
  it('combined mode handles non-overlapping dates correctly', () => {
    mockUseFinancialSettings.mockReturnValue(
      settingsResult({ cogsMethod: 'combined' }),
    );

    mockUseFoodCosts.mockReturnValue(
      inventoryResult({
        dailyCosts: [{ date: '2026-03-01', total_cost: 100 }],
        totalCost: 100,
      }),
    );
    mockUseCOGSFromFinancials.mockReturnValue(
      financialsResult({
        dailyCosts: [{ date: '2026-03-05', total_cost: 50 }],
        totalCost: 50,
      }),
    );

    const { result } = renderHook(() =>
      useUnifiedCOGS('rest-1', DATE_FROM, DATE_TO),
    );

    expect(result.current.totalCOGS).toBe(150);
    expect(result.current.dailyCOGS).toEqual([
      { date: '2026-03-01', amount: 100 },
      { date: '2026-03-05', amount: 50 },
    ]);
  });
});
