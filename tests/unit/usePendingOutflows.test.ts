import React, { ReactNode } from 'react';
import { renderHook, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { usePendingOutflowMutations } from '@/hooks/usePendingOutflows';
import { toast } from 'sonner';

const mockSupabase = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
}));

const mockRestaurantContext = vi.hoisted(() => ({
  selectedRestaurant: { restaurant_id: 'rest-123' } as { restaurant_id: string } | null,
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: mockSupabase,
}));

vi.mock('@/contexts/RestaurantContext', () => ({
  useRestaurantContext: () => mockRestaurantContext,
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

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

describe('usePendingOutflowMutations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('confirmMatch', () => {
    it('should copy expense data to bank transaction when confirming match', async () => {
      const mockPendingOutflow = {
        id: 'po-123',
        category_id: 'cat-456',
        notes: 'Expense notes',
        expense_invoice_uploads: [{
          id: 'upload-789',
          ai_category: 'Office Supplies',
          ai_confidence: 'high' as const,
          ai_reasoning: 'Based on invoice content',
        }],
      };

      const mockBankTransaction = {
        notes: 'Bank notes',
        category_id: null,
        suggested_category_id: null,
      };

      const mockPendingOutflowSelectBuilder = {
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: mockPendingOutflow,
          error: null,
        }),
      };

      const mockPendingOutflowBuilder = {
        select: vi.fn().mockReturnValue(mockPendingOutflowSelectBuilder),
        update: vi.fn().mockReturnThis(),
        eq: vi.fn().mockResolvedValue({ error: null }),
      };

      const mockBankTransactionSelectBuilder = {
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: mockBankTransaction,
          error: null,
        }),
      };

      const mockBankTransactionBuilder = {
        select: vi.fn().mockReturnValue(mockBankTransactionSelectBuilder),
        update: vi.fn().mockReturnThis(),
        eq: vi.fn().mockResolvedValue({ error: null }),
      };

      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'pending_outflows') {
          return mockPendingOutflowBuilder;
        }
        if (table === 'bank_transactions') {
          return mockBankTransactionBuilder;
        }
        return mockPendingOutflowBuilder; // fallback
      });

      const { result } = renderHook(() => usePendingOutflowMutations(), { wrapper: createWrapper() });

      await act(async () => {
        await result.current.confirmMatch.mutateAsync({
          pendingOutflowId: 'po-123',
          bankTransactionId: 'bt-456',
        });
      });

      // Verify pending outflow was updated
      expect(mockSupabase.from).toHaveBeenCalledWith('pending_outflows');
      expect(mockPendingOutflowBuilder.update).toHaveBeenCalledWith({
        status: 'cleared',
        linked_bank_transaction_id: 'bt-456',
        cleared_at: expect.any(String),
      });

      // Verify bank transaction was updated with copied data
      expect(mockSupabase.from).toHaveBeenCalledWith('bank_transactions');
      expect(mockBankTransactionBuilder.update).toHaveBeenCalledWith({
        is_categorized: true,
        matched_at: expect.any(String),
        category_id: 'cat-456', // copied from pending outflow
        suggested_category_id: 'cat-456', // copied as AI suggestion
        ai_confidence: 'high',
        ai_reasoning: 'Based on invoice content',
        notes: 'Bank notes\n\nExpense notes', // merged notes
        expense_invoice_upload_id: 'upload-789', // linked upload
      });
    });

    it('should handle cases where bank transaction already has category', async () => {
      const mockPendingOutflow = {
        id: 'po-123',
        category_id: 'cat-456',
        notes: 'Expense notes',
        expense_invoice_uploads: [],
      };

      const mockBankTransaction = {
        notes: null,
        category_id: 'existing-cat',
        suggested_category_id: 'existing-suggested',
      };

      const mockPendingOutflowSelectBuilder = {
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: mockPendingOutflow,
          error: null,
        }),
      };

      const mockPendingOutflowBuilder = {
        select: vi.fn().mockReturnValue(mockPendingOutflowSelectBuilder),
        update: vi.fn().mockReturnThis(),
        eq: vi.fn().mockResolvedValue({ error: null }),
      };

      const mockBankTransactionSelectBuilder = {
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: mockBankTransaction,
          error: null,
        }),
      };

      const mockBankTransactionBuilder = {
        select: vi.fn().mockReturnValue(mockBankTransactionSelectBuilder),
        update: vi.fn().mockReturnThis(),
        eq: vi.fn().mockResolvedValue({ error: null }),
      };

      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'pending_outflows') {
          return mockPendingOutflowBuilder;
        }
        if (table === 'bank_transactions') {
          return mockBankTransactionBuilder;
        }
        return mockBankTransactionBuilder;
      });

      const { result } = renderHook(() => usePendingOutflowMutations(), { wrapper: createWrapper() });

      await act(async () => {
        await result.current.confirmMatch.mutateAsync({
          pendingOutflowId: 'po-123',
          bankTransactionId: 'bt-456',
        });
      });

      // Should not overwrite existing category
      expect(mockBankTransactionBuilder.update).toHaveBeenCalledWith({
        is_categorized: true,
        matched_at: expect.any(String),
        notes: 'Expense notes', // only expense notes since bank had none
        // No category_id, suggested_category_id, or expense_invoice_upload_id copied
      });
    });

    it('should handle errors gracefully', async () => {
      const pendingOutflowQuery = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: null,
          error: { message: 'Not found' },
        }),
      };

      mockSupabase.from.mockReturnValue(pendingOutflowQuery);

      const { result } = renderHook(() => usePendingOutflowMutations(), { wrapper: createWrapper() });

      await act(async () => {
        try {
          await result.current.confirmMatch.mutateAsync({
            pendingOutflowId: 'po-123',
            bankTransactionId: 'bt-456',
          });
        } catch (error) {
          expect(error.message).toBe('Not found');
        }
      });

      expect(toast.error).toHaveBeenCalledWith('Failed to confirm match: Not found');
    });
  });
});