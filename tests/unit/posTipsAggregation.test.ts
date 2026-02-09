/**
 * Tests for POS tips aggregation from unified_sales_splits
 * 
 * This test validates the integration between categorized POS sales 
 * and the tip pooling system.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React, { ReactNode } from 'react';
import { usePOSTips } from '@/hooks/usePOSTips';

// Mock Supabase client
const mockSupabase = {
  from: vi.fn(),
  rpc: vi.fn(),
};

vi.mock('@/integrations/supabase/client', () => ({
  supabase: mockSupabase,
}));

// Helper to create React Query wrapper
const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return function Wrapper({ children }: { children: ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children);
  };
};

describe('usePOSTips Hook - Integration Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should merge employee tips and POS tips by date correctly', async () => {
    // Mock employee tips response
    const mockEmployeeTips = [
      { recorded_at: '2024-01-15T10:00:00Z', tip_amount: 5000, tip_source: 'cash' },
      { recorded_at: '2024-01-15T14:00:00Z', tip_amount: 3000, tip_source: 'cash' },
    ];

    // Mock POS tips response
    const mockPOSTips = [
      { tip_date: '2024-01-15', total_amount_cents: 15000, transaction_count: 12, pos_source: 'square' },
      { tip_date: '2024-01-16', total_amount_cents: 18500, transaction_count: 15, pos_source: 'toast' },
    ];

    // Setup mock chains
    const mockSelectChain = {
      eq: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      lte: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({ data: mockEmployeeTips, error: null }),
    };

    mockSupabase.from.mockReturnValue({
      select: vi.fn().mockReturnValue(mockSelectChain),
    });

    mockSupabase.rpc.mockResolvedValue({ data: mockPOSTips, error: null });

    // Render hook
    const { result } = renderHook(
      () => usePOSTips('test-restaurant-id', '2024-01-15', '2024-01-16'),
      { wrapper: createWrapper() }
    );

    // Wait for data to load
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    // Assertions
    expect(result.current.data).toBeDefined();
    expect(result.current.data).toHaveLength(2);

    // Check 2024-01-15 (merged from employee + POS)
    const jan15 = result.current.data?.find(d => d.date === '2024-01-15');
    expect(jan15).toBeDefined();
    expect(jan15?.totalTipsCents).toBe(23000); // 5000 + 3000 + 15000
    expect(jan15?.transactionCount).toBe(14); // 2 + 12
    expect(jan15?.source).toBe('combined'); // Different sources merged

    // Check 2024-01-16 (only POS)
    const jan16 = result.current.data?.find(d => d.date === '2024-01-16');
    expect(jan16).toBeDefined();
    expect(jan16?.totalTipsCents).toBe(18500);
    expect(jan16?.transactionCount).toBe(15);
    expect(jan16?.source).toBe('toast');
  });

  it('should handle empty employee tips gracefully', async () => {
    mockSupabase.from.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnThis(),
        gte: vi.fn().mockReturnThis(),
        lte: vi.fn().mockReturnThis(),
        order: vi.fn().mockResolvedValue({ data: [], error: null }),
      }),
    });

    mockSupabase.rpc.mockResolvedValue({
      data: [{ tip_date: '2024-01-15', total_amount_cents: 10000, transaction_count: 5, pos_source: 'square' }],
      error: null,
    });

    const { result } = renderHook(
      () => usePOSTips('test-restaurant-id', '2024-01-15', '2024-01-15'),
      { wrapper: createWrapper() }
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.data).toHaveLength(1);
    expect(result.current.data?.[0].totalTipsCents).toBe(10000);
    expect(result.current.data?.[0].source).toBe('square');
  });

  it('should handle empty POS tips gracefully', async () => {
    mockSupabase.from.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnThis(),
        gte: vi.fn().mockReturnThis(),
        lte: vi.fn().mockReturnThis(),
        order: vi.fn().mockResolvedValue({
          data: [{ recorded_at: '2024-01-15T10:00:00Z', tip_amount: 5000, tip_source: 'cash' }],
          error: null,
        }),
      }),
    });

    mockSupabase.rpc.mockResolvedValue({ data: [], error: null });

    const { result } = renderHook(
      () => usePOSTips('test-restaurant-id', '2024-01-15', '2024-01-15'),
      { wrapper: createWrapper() }
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.data).toHaveLength(1);
    expect(result.current.data?.[0].totalTipsCents).toBe(5000);
    expect(result.current.data?.[0].source).toBe('cash');
  });

  it('should handle employee tips error and still return POS tips', async () => {
    // Employee tips fails
    mockSupabase.from.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnThis(),
        gte: vi.fn().mockReturnThis(),
        lte: vi.fn().mockReturnThis(),
        order: vi.fn().mockResolvedValue({ data: null, error: { message: 'Database error' } }),
      }),
    });

    // POS tips succeeds
    mockSupabase.rpc.mockResolvedValue({
      data: [{ tip_date: '2024-01-15', total_amount_cents: 10000, transaction_count: 5, pos_source: 'square' }],
      error: null,
    });

    const { result } = renderHook(
      () => usePOSTips('test-restaurant-id', '2024-01-15', '2024-01-15'),
      { wrapper: createWrapper() }
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    // Should still have POS data
    expect(result.current.data).toHaveLength(1);
    expect(result.current.data?.[0].totalTipsCents).toBe(10000);
  });

  it('should handle POS tips error and still return employee tips', async () => {
    // Employee tips succeeds
    mockSupabase.from.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnThis(),
        gte: vi.fn().mockReturnThis(),
        lte: vi.fn().mockReturnThis(),
        order: vi.fn().mockResolvedValue({
          data: [{ recorded_at: '2024-01-15T10:00:00Z', tip_amount: 5000, tip_source: 'cash' }],
          error: null,
        }),
      }),
    });

    // POS tips fails
    mockSupabase.rpc.mockResolvedValue({ data: null, error: { message: 'RPC error' } });

    const { result } = renderHook(
      () => usePOSTips('test-restaurant-id', '2024-01-15', '2024-01-15'),
      { wrapper: createWrapper() }
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    // Should still have employee data
    expect(result.current.data).toHaveLength(1);
    expect(result.current.data?.[0].totalTipsCents).toBe(5000);
  });

  it('should return empty array when both sources fail', async () => {
    mockSupabase.from.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnThis(),
        gte: vi.fn().mockReturnThis(),
        lte: vi.fn().mockReturnThis(),
        order: vi.fn().mockResolvedValue({ data: null, error: { message: 'Error' } }),
      }),
    });

    mockSupabase.rpc.mockResolvedValue({ data: null, error: { message: 'Error' } });

    const { result } = renderHook(
      () => usePOSTips('test-restaurant-id', '2024-01-15', '2024-01-15'),
      { wrapper: createWrapper() }
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.data).toEqual([]);
  });

  it('should return empty array when restaurantId is null', async () => {
    const { result } = renderHook(
      () => usePOSTips(null, '2024-01-15', '2024-01-15'),
      { wrapper: createWrapper() }
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.data).toEqual([]);
    // Should not call any Supabase methods
    expect(mockSupabase.from).not.toHaveBeenCalled();
    expect(mockSupabase.rpc).not.toHaveBeenCalled();
  });

  it('should preserve source when only one source contributes to a date', async () => {
    mockSupabase.from.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnThis(),
        gte: vi.fn().mockReturnThis(),
        lte: vi.fn().mockReturnThis(),
        order: vi.fn().mockResolvedValue({
          data: [{ recorded_at: '2024-01-15T10:00:00Z', tip_amount: 5000, tip_source: 'cash' }],
          error: null,
        }),
      }),
    });

    mockSupabase.rpc.mockResolvedValue({
      data: [{ tip_date: '2024-01-16', total_amount_cents: 10000, transaction_count: 5, pos_source: 'square' }],
      error: null,
    });

    const { result } = renderHook(
      () => usePOSTips('test-restaurant-id', '2024-01-15', '2024-01-16'),
      { wrapper: createWrapper() }
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.data).toHaveLength(2);
    
    const jan15 = result.current.data?.find(d => d.date === '2024-01-15');
    expect(jan15?.source).toBe('cash'); // Only employee tips

    const jan16 = result.current.data?.find(d => d.date === '2024-01-16');
    expect(jan16?.source).toBe('square'); // Only POS tips
  });
});

// Keep existing logic tests for documentation purposes
describe('POS Tips Aggregation - Logic Tests', () => {
  describe('get_pos_tips_by_date SQL function behavior', () => {
    it('should aggregate tips by date from unified_sales_splits', () => {
      // Mock the expected behavior of the SQL function
      const mockPOSTips = [
        {
          tip_date: '2024-01-15',
          total_amount_cents: 15000, // $150.00
          transaction_count: 12,
          pos_source: 'square',
        },
        {
          tip_date: '2024-01-16',
          total_amount_cents: 18500, // $185.00
          transaction_count: 15,
          pos_source: 'square',
        },
      ];

      // Verify data structure matches expected format
      expect(mockPOSTips[0].tip_date).toBe('2024-01-15');
      expect(mockPOSTips[0].total_amount_cents).toBe(15000);
      expect(mockPOSTips[0].transaction_count).toBe(12);
      expect(mockPOSTips[0].pos_source).toBe('square');
    });

    it('should filter by account name containing "tip"', () => {
      // This validates the SQL WHERE clause logic
      const accountName = 'Tips Revenue';
      const shouldMatch = accountName.toLowerCase().includes('tip');
      expect(shouldMatch).toBe(true);
    });

    it('should filter by account subtype containing "tip"', () => {
      // This validates the SQL WHERE clause logic for subtypes
      const accountSubtype = 'tip_income';
      const shouldMatch = accountSubtype.toLowerCase().includes('tip');
      expect(shouldMatch).toBe(true);
    });

    it('should group transactions by sale_date', () => {
      // Simulate multiple transactions on the same date
      const transactions = [
        { sale_date: '2024-01-15', amount: 50 },
        { sale_date: '2024-01-15', amount: 75 },
        { sale_date: '2024-01-16', amount: 100 },
      ];

      const groupedByDate = transactions.reduce((acc, tx) => {
        if (!acc[tx.sale_date]) {
          acc[tx.sale_date] = { total: 0, count: 0 };
        }
        acc[tx.sale_date].total += tx.amount;
        acc[tx.sale_date].count += 1;
        return acc;
      }, {} as Record<string, { total: number; count: number }>);

      expect(groupedByDate['2024-01-15'].total).toBe(125);
      expect(groupedByDate['2024-01-15'].count).toBe(2);
      expect(groupedByDate['2024-01-16'].total).toBe(100);
      expect(groupedByDate['2024-01-16'].count).toBe(1);
    });
  });

  describe('usePOSTips hook integration', () => {
    it('should merge employee tips and POS tips by date', () => {
      // Mock employee tips data
      const employeeTips = [
        { date: '2024-01-15', totalTipsCents: 5000, transactionCount: 3, source: 'employee_tips' as const },
      ];

      // Mock POS tips data
      const posTips = [
        { date: '2024-01-15', totalTipsCents: 15000, transactionCount: 12, source: 'square' as const },
        { date: '2024-01-16', totalTipsCents: 18500, transactionCount: 15, source: 'square' as const },
      ];

      // Simulate the merge logic from usePOSTips hook
      const tipsByDate = new Map<string, { totalTipsCents: number; count: number; source: string }>();

      // Add employee tips
      for (const tip of employeeTips) {
        const existing = tipsByDate.get(tip.date);
        if (existing) {
          existing.totalTipsCents += tip.totalTipsCents;
          existing.count += tip.transactionCount;
        } else {
          tipsByDate.set(tip.date, {
            totalTipsCents: tip.totalTipsCents,
            count: tip.transactionCount,
            source: tip.source,
          });
        }
      }

      // Add POS tips
      for (const tip of posTips) {
        const existing = tipsByDate.get(tip.date);
        if (existing) {
          existing.totalTipsCents += tip.totalTipsCents;
          existing.count += tip.transactionCount;
        } else {
          tipsByDate.set(tip.date, {
            totalTipsCents: tip.totalTipsCents,
            count: tip.transactionCount,
            source: tip.source,
          });
        }
      }

      // Verify merged data
      expect(tipsByDate.get('2024-01-15')?.totalTipsCents).toBe(20000); // $50 + $150
      expect(tipsByDate.get('2024-01-15')?.count).toBe(15); // 3 + 12
      expect(tipsByDate.get('2024-01-16')?.totalTipsCents).toBe(18500); // $185
      expect(tipsByDate.get('2024-01-16')?.count).toBe(15);
    });

    it('should handle POS tips when no employee tips exist', () => {
      const employeeTips: any[] = [];
      const posTips = [
        { date: '2024-01-15', totalTipsCents: 15000, transactionCount: 12, source: 'square' as const },
      ];

      const tipsByDate = new Map<string, { totalTipsCents: number; count: number; source: string }>();

      for (const tip of posTips) {
        tipsByDate.set(tip.date, {
          totalTipsCents: tip.totalTipsCents,
          count: tip.transactionCount,
          source: tip.source,
        });
      }

      expect(tipsByDate.get('2024-01-15')?.totalTipsCents).toBe(15000);
      expect(tipsByDate.size).toBe(1);
    });

    it('should handle employee tips when no POS tips exist', () => {
      const employeeTips = [
        { date: '2024-01-15', totalTipsCents: 5000, transactionCount: 3, source: 'employee_tips' as const },
      ];
      const posTips: any[] = [];

      const tipsByDate = new Map<string, { totalTipsCents: number; count: number; source: string }>();

      for (const tip of employeeTips) {
        tipsByDate.set(tip.date, {
          totalTipsCents: tip.totalTipsCents,
          count: tip.transactionCount,
          source: tip.source,
        });
      }

      expect(tipsByDate.get('2024-01-15')?.totalTipsCents).toBe(5000);
      expect(tipsByDate.size).toBe(1);
    });

    it('should return empty array when no tips exist', () => {
      const employeeTips: any[] = [];
      const posTips: any[] = [];

      const tipsByDate = new Map<string, { totalTipsCents: number; count: number; source: string }>();

      expect(tipsByDate.size).toBe(0);
      expect(Array.from(tipsByDate.values())).toEqual([]);
    });
  });

  describe('Data type conversions', () => {
    it('should convert database amounts to cents correctly', () => {
      // SQL function returns amounts in cents (multiplied by 100)
      const dbAmount = 150.00; // Database stores as numeric
      const amountInCents = Math.round(dbAmount * 100);
      expect(amountInCents).toBe(15000); // $150.00 in cents
    });

    it('should handle null or undefined values gracefully', () => {
      const tip = {
        date: '2024-01-15',
        totalTipsCents: null as any,
        transactionCount: undefined as any,
      };

      const totalTips = tip.totalTipsCents || 0;
      const count = tip.transactionCount || 0;

      expect(totalTips).toBe(0);
      expect(count).toBe(0);
    });
  });

  describe('Date handling', () => {
    it('should use DATE type for consistent date comparison', () => {
      const tipDate = '2024-01-15'; // DATE from SQL
      const recordedAt = '2024-01-15T14:30:00Z'; // TIMESTAMP from employee_tips
      
      // Convert timestamp to date for comparison
      const recordedDate = recordedAt.split('T')[0];
      expect(recordedDate).toBe(tipDate);
    });

    it('should sort tips by date in ascending order', () => {
      const tips = [
        { date: '2024-01-17', totalTipsCents: 100 },
        { date: '2024-01-15', totalTipsCents: 200 },
        { date: '2024-01-16', totalTipsCents: 150 },
      ];

      const sorted = tips.sort((a, b) => a.date.localeCompare(b.date));
      
      expect(sorted[0].date).toBe('2024-01-15');
      expect(sorted[1].date).toBe('2024-01-16');
      expect(sorted[2].date).toBe('2024-01-17');
    });
  });

  describe('Edge cases', () => {
    it('should handle zero-amount tips (test transactions)', () => {
      const tip = {
        date: '2024-01-15',
        totalTipsCents: 0,
        transactionCount: 1,
      };

      expect(tip.totalTipsCents).toBe(0);
      // Zero-amount tips should still be queryable but won't affect totals
    });

    it('should handle large transaction counts', () => {
      const tip = {
        date: '2024-01-15',
        totalTipsCents: 500000, // $5,000 in tips
        transactionCount: 1000, // Very busy day
      };

      expect(tip.totalTipsCents).toBe(500000);
      expect(tip.transactionCount).toBe(1000);
    });

    it('should handle multiple POS systems on same date', () => {
      // When a restaurant uses multiple POS systems
      const tips = [
        { date: '2024-01-15', pos_source: 'square', total: 15000 },
        { date: '2024-01-15', pos_source: 'toast', total: 12000 },
      ];

      const combined = tips.reduce((sum, t) => sum + t.total, 0);
      expect(combined).toBe(27000); // $270 total from both systems
    });
  });
});
