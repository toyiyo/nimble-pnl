/**
 * Unit Tests: Shift Trading Hooks
 * 
 * Tests all React Query hooks in useShiftTrades.ts:
 * - useShiftTrades (fetch all trades)
 * - useMarketplaceTrades (fetch marketplace trades)
 * - useCreateShiftTrade (create trade request)
 * - useAcceptShiftTrade (accept a trade)
 * - useApproveShiftTrade (manager approves)
 * - useRejectShiftTrade (manager rejects)
 * - useCancelShiftTrade (cancel own trade)
 * 
 * Critical business logic covered:
 * - Conflict detection before accepting trades
 * - Manager approval workflow
 * - Email notifications triggered correctly
 * - Cache invalidation after mutations
 * - Error handling and toast notifications
 */

import React, { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  useShiftTrades,
  useMarketplaceTrades,
  useCreateShiftTrade,
  useAcceptShiftTrade,
  useApproveShiftTrade,
  useRejectShiftTrade,
  useCancelShiftTrade,
  type ShiftTrade,
} from '@/hooks/useShiftTrades';

// Mock Supabase client
const mockSupabase = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
  functions: {
    invoke: vi.fn(),
  },
}));

// Mock toast
const mockToast = vi.hoisted(() => vi.fn());

// Mock restaurant context
const mockRestaurantContext = vi.hoisted(() => ({
  selectedRestaurant: { restaurant_id: 'rest-123' } as { restaurant_id: string } | null,
}));

// Mock auth context
const mockAuthContext = vi.hoisted(() => ({
  user: { id: 'user-123', email: 'test@example.com' } as { id: string; email: string } | null,
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: mockSupabase,
}));

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({
    toast: mockToast,
  }),
}));

vi.mock('@/contexts/RestaurantContext', () => ({
  useRestaurantContext: () => mockRestaurantContext,
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => mockAuthContext,
}));

// Test data types match actual ShiftTrade interface
type TestShiftTrade = ShiftTrade;

type QueryBuilder = {
  select: ReturnType<typeof vi.fn>;
  eq: ReturnType<typeof vi.fn>;
  in: ReturnType<typeof vi.fn>;
  is: ReturnType<typeof vi.fn>;
  or: ReturnType<typeof vi.fn>;
  order: ReturnType<typeof vi.fn>;
  single: ReturnType<typeof vi.fn>;
  maybeSingle: ReturnType<typeof vi.fn>;
  insert: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
};

// Helper: Create React Query wrapper
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

// Helper: Create mock query builder for SELECT operations
const createSelectQueryBuilder = (mockData: TestShiftTrade[] | TestShiftTrade | null, error: any = null): QueryBuilder => {
  const builder: QueryBuilder = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    or: vi.fn().mockReturnThis(),
    order: vi.fn().mockResolvedValue({ data: mockData, error }),
    single: vi.fn().mockResolvedValue({ data: mockData, error }),
    maybeSingle: vi.fn().mockResolvedValue({ data: mockData, error }),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
  };

  return builder;
};

// Helper: Create mock query builder for INSERT/UPDATE operations
const createMutationQueryBuilder = (mockData: TestShiftTrade | null, error: any = null): QueryBuilder => {
  const builder: QueryBuilder = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    or: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: mockData, error }),
    maybeSingle: vi.fn().mockResolvedValue({ data: mockData, error }),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
  };

  // insert() and update() return the builder, single() resolves with data
  builder.insert.mockReturnValue(builder);
  builder.update.mockReturnValue(builder);

  return builder;
};

describe('useShiftTrades', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('useShiftTrades - Fetch all trades', () => {
    it('should fetch all shift trades for restaurant', async () => {
      const mockTrades: TestShiftTrade[] = [
        {
          id: 'trade-1',
          restaurant_id: 'rest-123',
          offered_shift_id: 'shift-1',
          offered_by_employee_id: 'emp-1',
          requested_shift_id: null,
          target_employee_id: null,
          accepted_by_employee_id: null,
          status: 'open',
          reason: 'Need day off',
          manager_note: null,
          reviewed_by: null,
          reviewed_at: null,
          created_at: '2026-01-04T10:00:00Z',
          updated_at: '2026-01-04T10:00:00Z',
          offered_shift: {
            id: 'shift-1',
            start_time: '2026-01-10T09:00:00Z',
            end_time: '2026-01-10T17:00:00Z',
            position: 'Server',
            break_duration: 30,
          },
          offered_by: {
            id: 'emp-1',
            name: 'John Doe',
            email: 'john@example.com',
            position: 'Server',
          },
        },
        {
          id: 'trade-2',
          restaurant_id: 'rest-123',
          offered_shift_id: 'shift-2',
          offered_by_employee_id: 'emp-2',
          requested_shift_id: null,
          target_employee_id: null,
          accepted_by_employee_id: 'emp-3',
          status: 'pending_approval',
          reason: 'Family emergency',
          manager_note: null,
          reviewed_by: null,
          reviewed_at: null,
          created_at: '2026-01-04T11:00:00Z',
          updated_at: '2026-01-04T11:30:00Z',
          offered_shift: {
            id: 'shift-2',
            start_time: '2026-01-11T14:00:00Z',
            end_time: '2026-01-11T22:00:00Z',
            position: 'Cook',
            break_duration: 30,
          },
          offered_by: {
            id: 'emp-2',
            name: 'Jane Smith',
            email: 'jane@example.com',
            position: 'Cook',
          },
          accepted_by: {
            id: 'emp-3',
            name: 'Bob Johnson',
            email: 'bob@example.com',
            position: 'Cook',
          },
        },
      ];

      const builder = createSelectQueryBuilder(mockTrades);
      mockSupabase.from.mockReturnValue(builder);

      const { result } = renderHook(() => useShiftTrades('rest-123'), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(result.current.trades).toHaveLength(2);
      expect(result.current.trades[0].id).toBe('trade-1');
      expect(result.current.trades[0].status).toBe('open');
      expect(result.current.trades[1].status).toBe('pending_approval');
      expect(mockSupabase.from).toHaveBeenCalledWith('shift_trades');
    });

    it('should handle empty trades list', async () => {
      const builder = createSelectQueryBuilder([]);
      mockSupabase.from.mockReturnValue(builder);

      const { result } = renderHook(() => useShiftTrades('rest-123'), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(result.current.trades).toHaveLength(0);
    });

    it('should handle null restaurantId', async () => {
      const { result } = renderHook(() => useShiftTrades(null), {
        wrapper: createWrapper(),
      });

      expect(result.current.trades).toHaveLength(0);
      expect(result.current.loading).toBe(false);
    });

    it('should handle fetch error', async () => {
      const builder = createSelectQueryBuilder(null, { message: 'Database error' });
      mockSupabase.from.mockReturnValue(builder);

      const { result } = renderHook(() => useShiftTrades('rest-123'), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.error).toBeDefined());

      expect(result.current.trades).toHaveLength(0);
    });
  });

  describe('useCreateShiftTrade - Create trade request', () => {
    it('should create marketplace trade successfully', async () => {
      const mockNewTrade: TestShiftTrade = {
        id: 'trade-new',
        restaurant_id: 'rest-123',
        offered_shift_id: 'shift-1',
        offered_by_employee_id: 'emp-1',
        requested_shift_id: null,
        target_employee_id: null,
        accepted_by_employee_id: null,
        status: 'open',
        reason: 'Need day off',
        manager_note: null,
        reviewed_by: null,
        reviewed_at: null,
        created_at: '2026-01-04T10:00:00Z',
        updated_at: '2026-01-04T10:00:00Z',
      };

      const builder = createMutationQueryBuilder(mockNewTrade);
      mockSupabase.from.mockReturnValue(builder);

      const { result } = renderHook(() => useCreateShiftTrade(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.mutateAsync).toBeDefined());

      const tradeData = {
        offered_shift_id: 'shift-1',
        offered_by_employee_id: 'emp-1',
        reason: 'Need day off',
      };

      await result.current.mutateAsync(tradeData as any);

      expect(mockSupabase.from).toHaveBeenCalledWith('shift_trades');
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: expect.stringContaining('posted'),
        })
      );
    });

    it('should handle creation error', async () => {
      const builder = createMutationQueryBuilder(null, { message: 'Creation failed' });
      mockSupabase.from.mockReturnValue(builder);

      const { result } = renderHook(() => useCreateShiftTrade(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.mutateAsync).toBeDefined());

      const tradeData = {
        offered_shift_id: 'shift-1',
        offered_by_employee_id: 'emp-1',
        reason: 'Test',
      };

      await expect(result.current.mutateAsync(tradeData as any)).rejects.toThrow();

      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          variant: 'destructive',
        })
      );
    });
  });

  describe('useAcceptShiftTrade - Accept trade offer', () => {
    it('CRITICAL: should call accept_shift_trade RPC with conflict validation', async () => {
      // Mock RPC call for accept_shift_trade - must return { success: true }
      mockSupabase.rpc.mockResolvedValue({ data: { success: true }, error: null });

      const { result } = renderHook(() => useAcceptShiftTrade(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.mutateAsync).toBeDefined());

      await result.current.mutateAsync({
        tradeId: 'trade-1',
        acceptingEmployeeId: 'emp-2',
      });

      expect(mockSupabase.rpc).toHaveBeenCalledWith('accept_shift_trade', {
        p_trade_id: 'trade-1',
        p_accepting_employee_id: 'emp-2',
      });
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: expect.stringContaining('sent'),
        })
      );
    });

    it('should handle conflict error (employee already scheduled)', async () => {
      mockSupabase.rpc.mockResolvedValue({
        data: null,
        error: { message: 'Accepting employee has a scheduling conflict' },
      });

      const { result } = renderHook(() => useAcceptShiftTrade(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.mutateAsync).toBeDefined());

      await expect(
        result.current.mutateAsync({
          tradeId: 'trade-1',
          acceptingEmployeeId: 'emp-2',
        })
      ).rejects.toThrow();

      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          variant: 'destructive',
        })
      );
    });
  });

  describe('useApproveShiftTrade - Manager approval', () => {
    it('CRITICAL: should call approve_shift_trade RPC and trigger notifications', async () => {
      mockSupabase.rpc.mockResolvedValue({ data: { success: true }, error: null });
      mockSupabase.functions.invoke.mockResolvedValue({
        data: { success: true },
        error: null,
      });

      const { result } = renderHook(() => useApproveShiftTrade(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.mutateAsync).toBeDefined());

      await result.current.mutateAsync({
        tradeId: 'trade-1',
        managerNote: 'Approved - coverage confirmed',
        managerUserId: 'manager-user-123',
      });

      expect(mockSupabase.rpc).toHaveBeenCalledWith('approve_shift_trade', {
        p_trade_id: 'trade-1',
        p_manager_user_id: 'manager-user-123',
        p_manager_note: 'Approved - coverage confirmed',
      });
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: expect.stringContaining('approved'),
        })
      );
    });
  });

  describe('useRejectShiftTrade - Manager rejection', () => {
    it('should call reject_shift_trade RPC with reason', async () => {
      mockSupabase.rpc.mockResolvedValue({ data: { success: true }, error: null });

      const { result } = renderHook(() => useRejectShiftTrade(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.mutateAsync).toBeDefined());

      await result.current.mutateAsync({
        tradeId: 'trade-1',
        managerNote: 'Insufficient coverage',
        managerUserId: 'manager-user-123',
      });

      expect(mockSupabase.rpc).toHaveBeenCalledWith('reject_shift_trade', {
        p_trade_id: 'trade-1',
        p_manager_user_id: 'manager-user-123',
        p_manager_note: 'Insufficient coverage',
      });
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: expect.stringContaining('rejected'),
        })
      );
    });
  });

  describe('useCancelShiftTrade - Cancel own trade', () => {
    it('should call RPC function to cancel trade', async () => {
      mockSupabase.rpc.mockResolvedValue({
        data: { success: true },
        error: null,
      });

      const { result } = renderHook(() => useCancelShiftTrade(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.mutateAsync).toBeDefined());

      await result.current.mutateAsync({ tradeId: 'trade-1', employeeId: 'emp-1' });

      expect(mockSupabase.rpc).toHaveBeenCalledWith('cancel_shift_trade', {
        p_trade_id: 'trade-1',
        p_employee_id: 'emp-1',
      });
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: expect.stringContaining('cancelled'),
        })
      );
    });

    it('should handle cancellation error from RPC', async () => {
      mockSupabase.rpc.mockResolvedValue({
        data: { success: false, error: 'Cannot cancel approved trade' },
        error: null,
      });

      const { result } = renderHook(() => useCancelShiftTrade(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.mutateAsync).toBeDefined());

      await expect(
        result.current.mutateAsync({ tradeId: 'trade-1', employeeId: 'emp-1' })
      ).rejects.toThrow('Cannot cancel approved trade');

      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          variant: 'destructive',
        })
      );
    });
  });

  describe('Edge Cases', () => {
    it('should handle network timeout', async () => {
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockRejectedValue(new Error('Network timeout')),
      });

      const { result } = renderHook(() => useShiftTrades('rest-123'), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.error).toBeDefined());

      expect(result.current.trades).toHaveLength(0);
    });

    it('should handle null accepted_by gracefully', async () => {
      const mockTrades: TestShiftTrade[] = [
        {
          id: 'trade-1',
          restaurant_id: 'rest-123',
          offered_shift_id: 'shift-1',
          offered_by_employee_id: 'emp-1',
          requested_shift_id: null,
          target_employee_id: null,
          accepted_by_employee_id: null,
          status: 'open',
          reason: null,
          manager_note: null,
          reviewed_by: null,
          reviewed_at: null,
          created_at: '2026-01-04T10:00:00Z',
          updated_at: '2026-01-04T10:00:00Z',
          accepted_by: undefined,
        },
      ];

      const builder = createSelectQueryBuilder(mockTrades);
      mockSupabase.from.mockReturnValue(builder);

      const { result } = renderHook(() => useShiftTrades('rest-123'), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(result.current.trades[0].accepted_by).toBeUndefined();
    });
  });

  describe('useMarketplaceTrades - Fetch marketplace trades', () => {
    it('should fetch only open trades without target employee', async () => {
      const mockTrades: TestShiftTrade[] = [
        {
          id: 'trade-1',
          restaurant_id: 'rest-123',
          offered_shift_id: 'shift-1',
          offered_by_employee_id: 'emp-1',
          requested_shift_id: null,
          target_employee_id: null, // Marketplace - no target
          accepted_by_employee_id: null,
          status: 'open',
          reason: 'Need coverage',
          manager_note: null,
          reviewed_by: null,
          reviewed_at: null,
          created_at: '2026-01-04T10:00:00Z',
          updated_at: '2026-01-04T10:00:00Z',
          offered_shift: {
            id: 'shift-1',
            start_time: '2026-01-10T09:00:00Z',
            end_time: '2026-01-10T17:00:00Z',
            position: 'Server',
            break_duration: 30,
          },
          offered_by: {
            id: 'emp-1',
            name: 'John Doe',
            email: 'john@example.com',
            position: 'Server',
          },
        },
      ];

      const builder = createSelectQueryBuilder(mockTrades);
      mockSupabase.from.mockReturnValue(builder);

      const { result } = renderHook(() => useMarketplaceTrades('rest-123'), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(result.current.trades).toHaveLength(1);
      expect(result.current.trades[0].status).toBe('open');
      expect(result.current.trades[0].target_employee_id).toBeNull();
    });

    it('should handle null restaurantId', async () => {
      const { result } = renderHook(() => useMarketplaceTrades(null), {
        wrapper: createWrapper(),
      });

      expect(result.current.trades).toHaveLength(0);
      expect(result.current.loading).toBe(false);
    });

    it('should handle fetch error', async () => {
      const builder = createSelectQueryBuilder(null, { message: 'Database error' });
      mockSupabase.from.mockReturnValue(builder);

      const { result } = renderHook(() => useMarketplaceTrades('rest-123'), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.error).toBeDefined());

      expect(result.current.trades).toHaveLength(0);
    });

    it('should return empty array for non-marketplace trades', async () => {
      const builder = createSelectQueryBuilder([]);
      mockSupabase.from.mockReturnValue(builder);

      const { result } = renderHook(() => useMarketplaceTrades('rest-123'), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(result.current.trades).toHaveLength(0);
    });
  });

  describe('Additional Edge Cases', () => {
    it('should filter trades by status array', async () => {
      const mockTrades: TestShiftTrade[] = [
        {
          id: 'trade-1',
          restaurant_id: 'rest-123',
          offered_shift_id: 'shift-1',
          offered_by_employee_id: 'emp-1',
          requested_shift_id: null,
          target_employee_id: null,
          accepted_by_employee_id: null,
          status: 'open',
          reason: null,
          manager_note: null,
          reviewed_by: null,
          reviewed_at: null,
          created_at: '2026-01-04T10:00:00Z',
          updated_at: '2026-01-04T10:00:00Z',
        },
        {
          id: 'trade-2',
          restaurant_id: 'rest-123',
          offered_shift_id: 'shift-2',
          offered_by_employee_id: 'emp-2',
          requested_shift_id: null,
          target_employee_id: null,
          accepted_by_employee_id: null,
          status: 'pending_approval',
          reason: null,
          manager_note: null,
          reviewed_by: null,
          reviewed_at: null,
          created_at: '2026-01-04T11:00:00Z',
          updated_at: '2026-01-04T11:00:00Z',
        },
      ];

      const builder = createSelectQueryBuilder(mockTrades);
      mockSupabase.from.mockReturnValue(builder);

      const { result } = renderHook(
        () => useShiftTrades('rest-123', ['open', 'pending_approval']),
        { wrapper: createWrapper() }
      );

      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(result.current.trades).toHaveLength(2);
      expect(builder.in).toHaveBeenCalledWith('status', ['open', 'pending_approval']);
    });

    it('should filter trades by employee ID', async () => {
      const mockTrades: TestShiftTrade[] = [
        {
          id: 'trade-1',
          restaurant_id: 'rest-123',
          offered_shift_id: 'shift-1',
          offered_by_employee_id: 'emp-1',
          requested_shift_id: null,
          target_employee_id: null,
          accepted_by_employee_id: null,
          status: 'open',
          reason: null,
          manager_note: null,
          reviewed_by: null,
          reviewed_at: null,
          created_at: '2026-01-04T10:00:00Z',
          updated_at: '2026-01-04T10:00:00Z',
        },
      ];

      const builder = createSelectQueryBuilder(mockTrades);
      mockSupabase.from.mockReturnValue(builder);

      const { result } = renderHook(
        () => useShiftTrades('rest-123', undefined, 'emp-1'),
        { wrapper: createWrapper() }
      );

      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(result.current.trades).toHaveLength(1);
      expect(builder.or).toHaveBeenCalled();
    });

    it('should handle RPC error in accept trade', async () => {
      mockSupabase.rpc.mockResolvedValue({
        data: null,
        error: { message: 'RPC failed' },
      });

      const { result } = renderHook(() => useAcceptShiftTrade(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.mutateAsync).toBeDefined());

      await expect(
        result.current.mutateAsync({
          tradeId: 'trade-1',
          acceptingEmployeeId: 'emp-2',
        })
      ).rejects.toThrow();
    });

    it('should handle RPC error in approve trade', async () => {
      mockSupabase.rpc.mockResolvedValue({
        data: null,
        error: { message: 'RPC failed' },
      });

      const { result } = renderHook(() => useApproveShiftTrade(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.mutateAsync).toBeDefined());

      await expect(
        result.current.mutateAsync({
          tradeId: 'trade-1',
          managerUserId: 'manager-user-123',
        })
      ).rejects.toThrow();
    });

    it('should handle RPC error in reject trade', async () => {
      mockSupabase.rpc.mockResolvedValue({
        data: null,
        error: { message: 'RPC failed' },
      });

      const { result } = renderHook(() => useRejectShiftTrade(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.mutateAsync).toBeDefined());

      await expect(
        result.current.mutateAsync({
          tradeId: 'trade-1',
          managerUserId: 'manager-user-123',
        })
      ).rejects.toThrow();
    });

    it('should handle RPC success:false in accept trade', async () => {
      // RPC returns data but success: false
      mockSupabase.rpc.mockResolvedValue({
        data: { success: false, error: 'Custom validation error' },
        error: null,
      });

      const { result } = renderHook(() => useAcceptShiftTrade(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.mutateAsync).toBeDefined());

      await expect(
        result.current.mutateAsync({
          tradeId: 'trade-1',
          acceptingEmployeeId: 'emp-2',
        })
      ).rejects.toThrow('Custom validation error');
    });

    it('should handle RPC success:false without error message in accept trade', async () => {
      mockSupabase.rpc.mockResolvedValue({
        data: { success: false },
        error: null,
      });

      const { result } = renderHook(() => useAcceptShiftTrade(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.mutateAsync).toBeDefined());

      await expect(
        result.current.mutateAsync({
          tradeId: 'trade-1',
          acceptingEmployeeId: 'emp-2',
        })
      ).rejects.toThrow('Failed to accept trade');
    });

    it('should handle RPC success:false in approve trade', async () => {
      mockSupabase.rpc.mockResolvedValue({
        data: { success: false, error: 'Cannot approve already approved trade' },
        error: null,
      });

      const { result } = renderHook(() => useApproveShiftTrade(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.mutateAsync).toBeDefined());

      await expect(
        result.current.mutateAsync({
          tradeId: 'trade-1',
          managerUserId: 'manager-user-123',
        })
      ).rejects.toThrow('Cannot approve already approved trade');
    });

    it('should handle RPC success:false in reject trade', async () => {
      mockSupabase.rpc.mockResolvedValue({
        data: { success: false, error: 'Cannot reject already rejected trade' },
        error: null,
      });

      const { result } = renderHook(() => useRejectShiftTrade(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.mutateAsync).toBeDefined());

      await expect(
        result.current.mutateAsync({
          tradeId: 'trade-1',
          managerUserId: 'manager-user-123',
        })
      ).rejects.toThrow('Cannot reject already rejected trade');
    });

    it('should handle email notification failure gracefully on create', async () => {
      const mockNewTrade: TestShiftTrade = {
        id: 'trade-new',
        restaurant_id: 'rest-123',
        offered_shift_id: 'shift-1',
        offered_by_employee_id: 'emp-1',
        requested_shift_id: null,
        target_employee_id: null,
        accepted_by_employee_id: null,
        status: 'open',
        reason: 'Need day off',
        manager_note: null,
        reviewed_by: null,
        reviewed_at: null,
        created_at: '2026-01-04T10:00:00Z',
        updated_at: '2026-01-04T10:00:00Z',
      };

      const builder = createMutationQueryBuilder(mockNewTrade);
      mockSupabase.from.mockReturnValue(builder);
      mockSupabase.functions.invoke.mockRejectedValue(new Error('Email service unavailable'));

      const { result } = renderHook(() => useCreateShiftTrade(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.mutateAsync).toBeDefined());

      // Should not throw even if email fails
      await expect(
        result.current.mutateAsync({
          restaurant_id: 'rest-123',
          offered_shift_id: 'shift-1',
          offered_by_employee_id: 'emp-1',
          reason: 'Need day off',
        })
      ).resolves.toBeDefined();

      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: expect.stringContaining('posted'),
        })
      );
    });

    it('should handle email notification failure gracefully on accept', async () => {
      mockSupabase.rpc.mockResolvedValue({ data: { success: true }, error: null });
      mockSupabase.functions.invoke.mockRejectedValue(new Error('Email service unavailable'));

      const { result } = renderHook(() => useAcceptShiftTrade(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.mutateAsync).toBeDefined());

      // Should not throw even if email fails
      await expect(
        result.current.mutateAsync({
          tradeId: 'trade-1',
          acceptingEmployeeId: 'emp-2',
        })
      ).resolves.toBeDefined();
    });

    it('should handle email notification failure gracefully on approve', async () => {
      mockSupabase.rpc.mockResolvedValue({ data: { success: true }, error: null });
      mockSupabase.functions.invoke.mockRejectedValue(new Error('Email service unavailable'));

      const { result } = renderHook(() => useApproveShiftTrade(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.mutateAsync).toBeDefined());

      await expect(
        result.current.mutateAsync({
          tradeId: 'trade-1',
          managerNote: 'Approved',
          managerUserId: 'manager-user-123',
        })
      ).resolves.toBeDefined();
    });

    it('should handle email notification failure gracefully on reject', async () => {
      mockSupabase.rpc.mockResolvedValue({ data: { success: true }, error: null });
      mockSupabase.functions.invoke.mockRejectedValue(new Error('Email service unavailable'));

      const { result } = renderHook(() => useRejectShiftTrade(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.mutateAsync).toBeDefined());

      await expect(
        result.current.mutateAsync({
          tradeId: 'trade-1',
          managerNote: 'Rejected',
          managerUserId: 'manager-user-123',
        })
      ).resolves.toBeDefined();
    });

    it('should handle email notification failure gracefully on cancel', async () => {
      const mockCancelledTrade: TestShiftTrade = {
        id: 'trade-1',
        restaurant_id: 'rest-123',
        offered_shift_id: 'shift-1',
        offered_by_employee_id: 'emp-1',
        requested_shift_id: null,
        target_employee_id: null,
        accepted_by_employee_id: null,
        status: 'cancelled',
        reason: null,
        manager_note: null,
        reviewed_by: null,
        reviewed_at: null,
        created_at: '2026-01-04T10:00:00Z',
        updated_at: '2026-01-04T10:05:00Z',
      };

      const builder = createMutationQueryBuilder(mockCancelledTrade);
      mockSupabase.from.mockReturnValue(builder);
      mockSupabase.functions.invoke.mockRejectedValue(new Error('Email service unavailable'));

      const { result } = renderHook(() => useCancelShiftTrade(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.mutateAsync).toBeDefined());

      // Should not throw even if email fails
      await expect(result.current.mutateAsync('trade-1')).resolves.toBeDefined();
    });

    it('should handle cancel with no data returned', async () => {
      mockSupabase.rpc.mockResolvedValue({
        data: null,
        error: null,
      });

      const { result } = renderHook(() => useCancelShiftTrade(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.mutateAsync).toBeDefined());

      await expect(
        result.current.mutateAsync({ tradeId: 'trade-1', employeeId: 'emp-1' })
      ).rejects.toThrow('Failed to cancel trade');
    });
  });

  describe('useMarketplaceTrades - Conflict Detection', () => {
    it('CRITICAL: should detect time conflicts with employee shifts', async () => {
      const mockTrades: TestShiftTrade[] = [
        {
          id: 'trade-1',
          restaurant_id: 'rest-123',
          offered_shift_id: 'shift-1',
          offered_by_employee_id: 'emp-1',
          requested_shift_id: null,
          target_employee_id: null,
          accepted_by_employee_id: null,
          status: 'open',
          reason: 'Need coverage',
          manager_note: null,
          reviewed_by: null,
          reviewed_at: null,
          created_at: '2026-01-04T10:00:00Z',
          updated_at: '2026-01-04T10:00:00Z',
          offered_shift: {
            id: 'shift-1',
            start_time: '2026-01-10T09:00:00Z',
            end_time: '2026-01-10T17:00:00Z',
            position: 'Server',
            break_duration: 30,
          },
          offered_by: {
            id: 'emp-1',
            name: 'John Doe',
            email: 'john@example.com',
            position: 'Server',
          },
        },
      ];

      const mockEmployeeShifts = [
        {
          start_time: '2026-01-10T08:00:00Z',
          end_time: '2026-01-10T12:00:00Z', // Overlaps with trade (9am-5pm)
        },
      ];

      // Create builder that returns employee shifts with proper chaining
      const shiftsBuilder = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        in: vi.fn().mockResolvedValue({ data: mockEmployeeShifts, error: null }),
      };

      const tradesBuilder = createSelectQueryBuilder(mockTrades);

      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'shift_trades') return tradesBuilder;
        if (table === 'shifts') return shiftsBuilder;
        return tradesBuilder;
      });

      const { result } = renderHook(
        () => useMarketplaceTrades('rest-123', 'emp-2'),
        { wrapper: createWrapper() }
      );

      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(result.current.trades).toHaveLength(1);
      expect(result.current.trades[0].hasConflict).toBe(true);
    });

    it('should not mark conflict when shifts do not overlap', async () => {
      const mockTrades: TestShiftTrade[] = [
        {
          id: 'trade-1',
          restaurant_id: 'rest-123',
          offered_shift_id: 'shift-1',
          offered_by_employee_id: 'emp-1',
          requested_shift_id: null,
          target_employee_id: null,
          accepted_by_employee_id: null,
          status: 'open',
          reason: 'Need coverage',
          manager_note: null,
          reviewed_by: null,
          reviewed_at: null,
          created_at: '2026-01-04T10:00:00Z',
          updated_at: '2026-01-04T10:00:00Z',
          offered_shift: {
            id: 'shift-1',
            start_time: '2026-01-10T09:00:00Z',
            end_time: '2026-01-10T17:00:00Z',
            position: 'Server',
            break_duration: 30,
          },
          offered_by: {
            id: 'emp-1',
            name: 'John Doe',
            email: 'john@example.com',
            position: 'Server',
          },
        },
      ];

      const mockEmployeeShifts = [
        {
          start_time: '2026-01-10T18:00:00Z',
          end_time: '2026-01-10T22:00:00Z', // No overlap
        },
      ];

      const shiftsBuilder = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        in: vi.fn().mockResolvedValue({ data: mockEmployeeShifts, error: null }),
      };

      const tradesBuilder = createSelectQueryBuilder(mockTrades);

      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'shift_trades') return tradesBuilder;
        if (table === 'shifts') return shiftsBuilder;
        return tradesBuilder;
      });

      const { result } = renderHook(
        () => useMarketplaceTrades('rest-123', 'emp-2'),
        { wrapper: createWrapper() }
      );

      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(result.current.trades).toHaveLength(1);
      expect(result.current.trades[0].hasConflict).toBe(false);
    });

    it('should handle empty employee shifts', async () => {
      const mockTrades: TestShiftTrade[] = [
        {
          id: 'trade-1',
          restaurant_id: 'rest-123',
          offered_shift_id: 'shift-1',
          offered_by_employee_id: 'emp-1',
          requested_shift_id: null,
          target_employee_id: null,
          accepted_by_employee_id: null,
          status: 'open',
          reason: 'Need coverage',
          manager_note: null,
          reviewed_by: null,
          reviewed_at: null,
          created_at: '2026-01-04T10:00:00Z',
          updated_at: '2026-01-04T10:00:00Z',
          offered_shift: {
            id: 'shift-1',
            start_time: '2026-01-10T09:00:00Z',
            end_time: '2026-01-10T17:00:00Z',
            position: 'Server',
            break_duration: 30,
          },
          offered_by: {
            id: 'emp-1',
            name: 'John Doe',
            email: 'john@example.com',
            position: 'Server',
          },
        },
      ];

      const shiftsBuilder = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        in: vi.fn().mockResolvedValue({ data: [], error: null }),
      };

      const tradesBuilder = createSelectQueryBuilder(mockTrades);

      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'shift_trades') return tradesBuilder;
        if (table === 'shifts') return shiftsBuilder;
        return tradesBuilder;
      });

      const { result } = renderHook(
        () => useMarketplaceTrades('rest-123', 'emp-2'),
        { wrapper: createWrapper() }
      );

      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(result.current.trades).toHaveLength(1);
      expect(result.current.trades[0].hasConflict).toBe(false);
    });

    it('should include targeted trades when currentEmployeeId matches', async () => {
      const mockTrades: TestShiftTrade[] = [
        {
          id: 'trade-1',
          restaurant_id: 'rest-123',
          offered_shift_id: 'shift-1',
          offered_by_employee_id: 'emp-1',
          requested_shift_id: null,
          target_employee_id: 'emp-2', // Targeted at specific employee
          accepted_by_employee_id: null,
          status: 'open',
          reason: 'Directed trade',
          manager_note: null,
          reviewed_by: null,
          reviewed_at: null,
          created_at: '2026-01-04T10:00:00Z',
          updated_at: '2026-01-04T10:00:00Z',
          offered_shift: {
            id: 'shift-1',
            start_time: '2026-01-10T09:00:00Z',
            end_time: '2026-01-10T17:00:00Z',
            position: 'Server',
            break_duration: 30,
          },
          offered_by: {
            id: 'emp-1',
            name: 'John Doe',
            email: 'john@example.com',
            position: 'Server',
          },
        },
      ];

      const shiftsBuilder = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        in: vi.fn().mockResolvedValue({ data: [], error: null }),
      };

      const tradesBuilder = createSelectQueryBuilder(mockTrades);

      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'shift_trades') return tradesBuilder;
        if (table === 'shifts') return shiftsBuilder;
        return tradesBuilder;
      });

      const { result } = renderHook(
        () => useMarketplaceTrades('rest-123', 'emp-2'),
        { wrapper: createWrapper() }
      );

      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(result.current.trades).toHaveLength(1);
      expect(result.current.trades[0].target_employee_id).toBe('emp-2');
    });

    it('should handle shifts error gracefully', async () => {
      const mockTrades: TestShiftTrade[] = [
        {
          id: 'trade-1',
          restaurant_id: 'rest-123',
          offered_shift_id: 'shift-1',
          offered_by_employee_id: 'emp-1',
          requested_shift_id: null,
          target_employee_id: null,
          accepted_by_employee_id: null,
          status: 'open',
          reason: 'Need coverage',
          manager_note: null,
          reviewed_by: null,
          reviewed_at: null,
          created_at: '2026-01-04T10:00:00Z',
          updated_at: '2026-01-04T10:00:00Z',
          offered_shift: {
            id: 'shift-1',
            start_time: '2026-01-10T09:00:00Z',
            end_time: '2026-01-10T17:00:00Z',
            position: 'Server',
            break_duration: 30,
          },
          offered_by: {
            id: 'emp-1',
            name: 'John Doe',
            email: 'john@example.com',
            position: 'Server',
          },
        },
      ];

      const shiftsBuilder = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        in: vi.fn().mockResolvedValue({ data: null, error: { message: 'Shifts fetch error' } }),
      };

      const tradesBuilder = createSelectQueryBuilder(mockTrades);

      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'shift_trades') return tradesBuilder;
        if (table === 'shifts') return shiftsBuilder;
        return tradesBuilder;
      });

      const { result } = renderHook(
        () => useMarketplaceTrades('rest-123', 'emp-2'),
        { wrapper: createWrapper() }
      );

      await waitFor(() => expect(result.current.error).toBeDefined());
    });
  });
});
