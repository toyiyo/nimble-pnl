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

// Every confirmMatch test stubs the same pair of `supabase.from` tables and
// routes them through `mockSupabase.from.mockImplementation`. This helper
// builds both builders once so each test only supplies the fixture data (and,
// rarely, a call-order hook) instead of ~20 lines of mock plumbing.
function setupConfirmMatchMocks(
  pendingOutflow: unknown,
  bankTransaction: unknown,
  options: {
    onBankUpdate?: () => void;
    existingJournalEntry?: { id: string } | null;
  } = {}
) {
  const mockPendingOutflowBuilder = {
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: pendingOutflow, error: null }),
    }),
    update: vi.fn().mockReturnThis(),
    eq: vi.fn().mockResolvedValue({ error: null }),
  };

  const mockBankTransactionBuilder: {
    select: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    eq: ReturnType<typeof vi.fn>;
  } = {
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: bankTransaction, error: null }),
    }),
    update: vi.fn((_payload: unknown) => {
      options.onBankUpdate?.();
      return mockBankTransactionBuilder;
    }),
    eq: vi.fn().mockResolvedValue({ error: null }),
  };

  // Backs the pre-RPC "does a journal entry already exist" guard. Only hit
  // when the outflow's category matches the transaction's existing category.
  const journalEntriesQuery = {
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({
      data: options.existingJournalEntry ?? null,
      error: null,
    }),
  };
  const mockJournalEntriesBuilder = {
    select: vi.fn().mockReturnValue(journalEntriesQuery),
  };

  mockSupabase.from.mockImplementation((table: string) => {
    if (table === 'pending_outflows') return mockPendingOutflowBuilder;
    if (table === 'bank_transactions') return mockBankTransactionBuilder;
    if (table === 'journal_entries') return mockJournalEntriesBuilder;
    return mockPendingOutflowBuilder;
  });

  return { mockPendingOutflowBuilder, mockBankTransactionBuilder, mockJournalEntriesBuilder };
}

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
          raw_file_url: 'https://example.com/file.pdf',
          file_name: 'invoice.pdf',
          raw_ocr_data: { ai_category: 'Office Supplies', ai_confidence: 'high', ai_reasoning: 'Based on invoice content' },
          field_confidence: { vendor_name: 0.95, total_amount: 0.98 }
        }],
      };

      const mockBankTransaction = {
        notes: 'Bank notes',
        category_id: null,
        suggested_category_id: null,
      };

      const { mockPendingOutflowBuilder, mockBankTransactionBuilder } =
        setupConfirmMatchMocks(mockPendingOutflow, mockBankTransaction);
      mockSupabase.rpc.mockResolvedValue({ data: null, error: null });

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

      // Verify the RPC applied the category and the merged notes
      expect(mockSupabase.rpc).toHaveBeenCalledWith('categorize_bank_transaction', {
        p_transaction_id: 'bt-456',
        p_category_id: 'cat-456',
        p_description: 'Bank notes\n\nExpense notes',
        p_normalized_payee: null,
        p_supplier_id: null,
      });

      // Verify bank transaction got a metadata-only update
      expect(mockSupabase.from).toHaveBeenCalledWith('bank_transactions');
      expect(mockBankTransactionBuilder.update).toHaveBeenCalledWith({
        matched_at: expect.any(String),
        suggested_category_id: 'cat-456', // copied as AI suggestion
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

      const { mockBankTransactionBuilder } =
        setupConfirmMatchMocks(mockPendingOutflow, mockBankTransaction);
      mockSupabase.rpc.mockResolvedValue({ data: null, error: null });

      const { result } = renderHook(() => usePendingOutflowMutations(), { wrapper: createWrapper() });

      await act(async () => {
        await result.current.confirmMatch.mutateAsync({
          pendingOutflowId: 'po-123',
          bankTransactionId: 'bt-456',
        });
      });

      // The category is applied through the RPC, not a direct column write
      expect(mockSupabase.rpc).toHaveBeenCalledWith('categorize_bank_transaction', {
        p_transaction_id: 'bt-456',
        p_category_id: 'cat-456',
        p_description: 'Expense notes',
        p_normalized_payee: null,
        p_supplier_id: null,
      });

      expect(mockBankTransactionBuilder.update).toHaveBeenCalledWith({
        matched_at: expect.any(String),
        suggested_category_id: 'cat-456', // expense category overrides existing
      });
    });

    it('calls categorize_bank_transaction with the outflow category and the merged notes', async () => {
      const mockPendingOutflow = {
        id: 'po-123',
        category_id: 'cat-456',
        notes: 'Expense notes',
        expense_invoice_uploads: [],
      };

      const mockBankTransaction = {
        notes: 'Bank notes',
        category_id: null,
        suggested_category_id: null,
      };

      setupConfirmMatchMocks(mockPendingOutflow, mockBankTransaction);
      mockSupabase.rpc.mockResolvedValue({ data: null, error: null });

      const { result } = renderHook(() => usePendingOutflowMutations(), { wrapper: createWrapper() });

      await act(async () => {
        await result.current.confirmMatch.mutateAsync({
          pendingOutflowId: 'po-123',
          bankTransactionId: 'bt-456',
        });
      });

      expect(mockSupabase.rpc).toHaveBeenCalledWith('categorize_bank_transaction', {
        p_transaction_id: 'bt-456',
        p_category_id: 'cat-456',
        p_description: 'Bank notes\n\nExpense notes',
        p_normalized_payee: null,
        p_supplier_id: null,
      });
    });

    it('calls the RPC before the bank_transactions update', async () => {
      const callOrder: string[] = [];

      const mockPendingOutflow = {
        id: 'po-123',
        category_id: 'cat-456',
        notes: 'Expense notes',
        expense_invoice_uploads: [],
      };

      const mockBankTransaction = {
        notes: 'Bank notes',
        category_id: null,
        suggested_category_id: null,
      };

      setupConfirmMatchMocks(mockPendingOutflow, mockBankTransaction, {
        onBankUpdate: () => callOrder.push('update'),
      });
      mockSupabase.rpc.mockImplementation(async () => {
        callOrder.push('rpc');
        return { data: null, error: null };
      });

      const { result } = renderHook(() => usePendingOutflowMutations(), { wrapper: createWrapper() });

      await act(async () => {
        await result.current.confirmMatch.mutateAsync({
          pendingOutflowId: 'po-123',
          bankTransactionId: 'bt-456',
        });
      });

      expect(callOrder).toEqual(['rpc', 'update']);
    });

    it('sends a metadata-only update', async () => {
      const mockPendingOutflow = {
        id: 'po-123',
        category_id: 'cat-456',
        notes: 'Expense notes',
        expense_invoice_uploads: [{
          id: 'upload-789',
          raw_file_url: 'https://example.com/file.pdf',
          file_name: 'invoice.pdf',
          raw_ocr_data: null,
          field_confidence: null,
        }],
      };

      const mockBankTransaction = {
        notes: 'Bank notes',
        category_id: null,
        suggested_category_id: null,
      };

      const { mockBankTransactionBuilder } =
        setupConfirmMatchMocks(mockPendingOutflow, mockBankTransaction);
      mockSupabase.rpc.mockResolvedValue({ data: null, error: null });

      const { result } = renderHook(() => usePendingOutflowMutations(), { wrapper: createWrapper() });

      await act(async () => {
        await result.current.confirmMatch.mutateAsync({
          pendingOutflowId: 'po-123',
          bankTransactionId: 'bt-456',
        });
      });

      expect(mockBankTransactionBuilder.update).toHaveBeenCalledWith({
        matched_at: expect.any(String),
        suggested_category_id: 'cat-456',
        expense_invoice_upload_id: 'upload-789',
      });

      const updatePayload = mockBankTransactionBuilder.update.mock.calls[0][0];
      expect(updatePayload).not.toHaveProperty('is_categorized');
      expect(updatePayload).not.toHaveProperty('category_id');
      expect(updatePayload).not.toHaveProperty('notes');
    });

    it('keeps the bank notes unchanged when they already contain the outflow notes', async () => {
      const mockPendingOutflow = {
        id: 'po-123',
        category_id: 'cat-456',
        notes: 'B',
        expense_invoice_uploads: [],
      };

      const mockBankTransaction = {
        notes: 'A\n\nB',
        category_id: null,
        suggested_category_id: null,
      };

      setupConfirmMatchMocks(mockPendingOutflow, mockBankTransaction);
      mockSupabase.rpc.mockResolvedValue({ data: null, error: null });

      const { result } = renderHook(() => usePendingOutflowMutations(), { wrapper: createWrapper() });

      await act(async () => {
        await result.current.confirmMatch.mutateAsync({
          pendingOutflowId: 'po-123',
          bankTransactionId: 'bt-456',
        });
      });

      expect(mockSupabase.rpc).toHaveBeenCalledWith('categorize_bank_transaction', {
        p_transaction_id: 'bt-456',
        p_category_id: 'cat-456',
        p_description: 'A\n\nB',
        p_normalized_payee: null,
        p_supplier_id: null,
      });
    });

    it('blocks a same-category match when the transaction has no journal entry', async () => {
      const mockPendingOutflow = {
        id: 'po-123',
        category_id: 'cat-456',
        notes: null,
        expense_invoice_uploads: [],
      };

      // The transaction already carries this exact category. The RPC would
      // short-circuit here (no journal entry created) — a legacy write path
      // can leave a transaction like this with no journal entry at all.
      const mockBankTransaction = {
        notes: null,
        category_id: 'cat-456',
        suggested_category_id: null,
      };

      const { mockPendingOutflowBuilder, mockBankTransactionBuilder, mockJournalEntriesBuilder } =
        setupConfirmMatchMocks(mockPendingOutflow, mockBankTransaction, {
          existingJournalEntry: null,
        });

      const { result } = renderHook(() => usePendingOutflowMutations(), { wrapper: createWrapper() });

      await act(async () => {
        try {
          await result.current.confirmMatch.mutateAsync({
            pendingOutflowId: 'po-123',
            bankTransactionId: 'bt-456',
          });
        } catch {
          // expected: the pre-RPC journal-entry guard rejects the match
        }
      });

      expect(mockJournalEntriesBuilder.select).toHaveBeenCalledWith('id');
      expect(mockSupabase.rpc).not.toHaveBeenCalled();
      expect(mockBankTransactionBuilder.update).not.toHaveBeenCalled();
      expect(mockPendingOutflowBuilder.update).not.toHaveBeenCalled();
      expect(toast.error).toHaveBeenCalledWith(
        expect.stringContaining('already categorized but has no journal entry')
      );
    });

    it('allows a same-category match when a journal entry already exists', async () => {
      const mockPendingOutflow = {
        id: 'po-123',
        category_id: 'cat-456',
        notes: null,
        expense_invoice_uploads: [],
      };

      const mockBankTransaction = {
        notes: null,
        category_id: 'cat-456',
        suggested_category_id: null,
      };

      setupConfirmMatchMocks(mockPendingOutflow, mockBankTransaction, {
        existingJournalEntry: { id: 'je-1' },
      });
      mockSupabase.rpc.mockResolvedValue({ data: null, error: null });

      const { result } = renderHook(() => usePendingOutflowMutations(), { wrapper: createWrapper() });

      await act(async () => {
        await result.current.confirmMatch.mutateAsync({
          pendingOutflowId: 'po-123',
          bankTransactionId: 'bt-456',
        });
      });

      expect(mockSupabase.rpc).toHaveBeenCalledWith('categorize_bank_transaction', {
        p_transaction_id: 'bt-456',
        p_category_id: 'cat-456',
        p_description: null,
        p_normalized_payee: null,
        p_supplier_id: null,
      });
      expect(toast.success).toHaveBeenCalledWith('Expense matched and cleared');
    });

    it('marks a no-category outflow as categorized when the matched transaction already has a journal entry', async () => {
      const mockPendingOutflow = {
        id: 'po-123',
        category_id: null,
        notes: null,
        expense_invoice_uploads: [],
      };

      const mockBankTransaction = {
        notes: null,
        category_id: 'existing-cat',
        suggested_category_id: null,
      };

      const { mockPendingOutflowBuilder, mockJournalEntriesBuilder } =
        setupConfirmMatchMocks(mockPendingOutflow, mockBankTransaction, {
          existingJournalEntry: { id: 'je-1' },
        });

      const { result } = renderHook(() => usePendingOutflowMutations(), { wrapper: createWrapper() });

      await act(async () => {
        await result.current.confirmMatch.mutateAsync({
          pendingOutflowId: 'po-123',
          bankTransactionId: 'bt-456',
        });
      });

      // No category on the outflow, so the RPC never runs.
      expect(mockSupabase.rpc).not.toHaveBeenCalled();

      // The journal entry check ran before the copy.
      expect(mockJournalEntriesBuilder.select).toHaveBeenCalledWith('id');

      // The outflow copies the transaction's existing category so the
      // "Needs category" badge does not show a false positive.
      expect(mockPendingOutflowBuilder.update).toHaveBeenCalledWith({
        status: 'cleared',
        linked_bank_transaction_id: 'bt-456',
        cleared_at: expect.any(String),
        category_id: 'existing-cat',
      });

      expect(toast.success).toHaveBeenCalledWith('Expense matched and cleared');
    });

    it('does not copy the category onto a no-category outflow when the matched transaction has no journal entry', async () => {
      const mockPendingOutflow = {
        id: 'po-123',
        category_id: null,
        notes: null,
        expense_invoice_uploads: [],
      };

      // The transaction carries a category with no backing journal entry —
      // the same legacy state the same-category RPC guard blocks above.
      const mockBankTransaction = {
        notes: null,
        category_id: 'existing-cat',
        suggested_category_id: null,
      };

      const { mockPendingOutflowBuilder, mockJournalEntriesBuilder } =
        setupConfirmMatchMocks(mockPendingOutflow, mockBankTransaction, {
          existingJournalEntry: null,
        });

      const { result } = renderHook(() => usePendingOutflowMutations(), { wrapper: createWrapper() });

      await act(async () => {
        await result.current.confirmMatch.mutateAsync({
          pendingOutflowId: 'po-123',
          bankTransactionId: 'bt-456',
        });
      });

      expect(mockSupabase.rpc).not.toHaveBeenCalled();
      expect(mockJournalEntriesBuilder.select).toHaveBeenCalledWith('id');

      // No journal entry backs the transaction's category, so the outflow
      // does not copy it — the "Needs category" badge stays accurate.
      expect(mockPendingOutflowBuilder.update).toHaveBeenCalledWith({
        status: 'cleared',
        linked_bank_transaction_id: 'bt-456',
        cleared_at: expect.any(String),
      });
      const outflowUpdatePayload = mockPendingOutflowBuilder.update.mock.calls[0][0];
      expect(outflowUpdatePayload).not.toHaveProperty('category_id');

      expect(toast.success).toHaveBeenCalledWith(
        'Expense matched. Categorize the transaction on the Banking page.'
      );
    });

    it('skips the RPC when the outflow has no category', async () => {
      const mockPendingOutflow = {
        id: 'po-123',
        category_id: null,
        notes: 'Expense notes',
        expense_invoice_uploads: [],
      };

      const mockBankTransaction = {
        notes: 'Bank notes',
        category_id: null,
        suggested_category_id: null,
      };

      const { mockBankTransactionBuilder } =
        setupConfirmMatchMocks(mockPendingOutflow, mockBankTransaction);
      mockSupabase.rpc.mockResolvedValue({ data: null, error: null });

      const { result } = renderHook(() => usePendingOutflowMutations(), { wrapper: createWrapper() });

      await act(async () => {
        await result.current.confirmMatch.mutateAsync({
          pendingOutflowId: 'po-123',
          bankTransactionId: 'bt-456',
        });
      });

      expect(mockSupabase.rpc).not.toHaveBeenCalled();

      expect(mockBankTransactionBuilder.update).toHaveBeenCalledWith({
        matched_at: expect.any(String),
        notes: 'Bank notes\n\nExpense notes',
      });

      const updatePayload = mockBankTransactionBuilder.update.mock.calls[0][0];
      expect(updatePayload).not.toHaveProperty('is_categorized');
      expect(updatePayload).not.toHaveProperty('category_id');
      expect(updatePayload).not.toHaveProperty('suggested_category_id');
    });

    it('shows the categorize reminder on a no-category match', async () => {
      const mockPendingOutflow = {
        id: 'po-123',
        category_id: null,
        notes: null,
        expense_invoice_uploads: [],
      };

      const mockBankTransaction = {
        notes: null,
        category_id: null,
        suggested_category_id: null,
      };

      setupConfirmMatchMocks(mockPendingOutflow, mockBankTransaction);
      mockSupabase.rpc.mockResolvedValue({ data: null, error: null });

      const { result } = renderHook(() => usePendingOutflowMutations(), { wrapper: createWrapper() });

      await act(async () => {
        await result.current.confirmMatch.mutateAsync({
          pendingOutflowId: 'po-123',
          bankTransactionId: 'bt-456',
        });
      });

      expect(toast.success).toHaveBeenCalledWith(
        'Expense matched. Categorize the transaction on the Banking page.'
      );
    });

    it('shows the cleared toast on a categorized match', async () => {
      const mockPendingOutflow = {
        id: 'po-123',
        category_id: 'cat-456',
        notes: null,
        expense_invoice_uploads: [],
      };

      const mockBankTransaction = {
        notes: null,
        category_id: null,
        suggested_category_id: null,
      };

      setupConfirmMatchMocks(mockPendingOutflow, mockBankTransaction);
      mockSupabase.rpc.mockResolvedValue({ data: null, error: null });

      const { result } = renderHook(() => usePendingOutflowMutations(), { wrapper: createWrapper() });

      await act(async () => {
        await result.current.confirmMatch.mutateAsync({
          pendingOutflowId: 'po-123',
          bankTransactionId: 'bt-456',
        });
      });

      expect(toast.success).toHaveBeenCalledWith('Expense matched and cleared');
    });

    it('invalidates the ledger queries on success', async () => {
      const mockPendingOutflow = {
        id: 'po-123',
        category_id: 'cat-456',
        notes: null,
        expense_invoice_uploads: [],
      };

      const mockBankTransaction = {
        notes: null,
        category_id: null,
        suggested_category_id: null,
      };

      setupConfirmMatchMocks(mockPendingOutflow, mockBankTransaction);
      mockSupabase.rpc.mockResolvedValue({ data: null, error: null });

      const invalidateSpy = vi.spyOn(QueryClient.prototype, 'invalidateQueries');

      const { result } = renderHook(() => usePendingOutflowMutations(), { wrapper: createWrapper() });

      await act(async () => {
        await result.current.confirmMatch.mutateAsync({
          pendingOutflowId: 'po-123',
          bankTransactionId: 'bt-456',
        });
      });

      const invalidatedKeys = invalidateSpy.mock.calls.map((call) => call[0]?.queryKey);
      expect(invalidatedKeys).toContainEqual(['pending-outflows']);
      expect(invalidatedKeys).toContainEqual(['bank-transactions']);
      expect(invalidatedKeys).toContainEqual(['pending-outflow-matches']);
      expect(invalidatedKeys).toContainEqual(['income-statement']);
      expect(invalidatedKeys).toContainEqual(['balance-sheet']);
      expect(invalidatedKeys).toContainEqual(['chart-of-accounts']);

      invalidateSpy.mockRestore();
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

    it('maps the reconciled guard', async () => {
      const mockPendingOutflow = {
        id: 'po-123',
        category_id: 'cat-456',
        notes: null,
        expense_invoice_uploads: [],
      };

      const mockBankTransaction = {
        notes: null,
        category_id: null,
        suggested_category_id: null,
      };

      const { mockPendingOutflowBuilder, mockBankTransactionBuilder } =
        setupConfirmMatchMocks(mockPendingOutflow, mockBankTransaction);
      mockSupabase.rpc.mockResolvedValue({
        data: null,
        error: {
          message:
            'Cannot categorize a reconciled transaction. Use reclassification instead by updating the category of an already categorized transaction.',
        },
      });

      const { result } = renderHook(() => usePendingOutflowMutations(), { wrapper: createWrapper() });

      await act(async () => {
        try {
          await result.current.confirmMatch.mutateAsync({
            pendingOutflowId: 'po-123',
            bankTransactionId: 'bt-456',
          });
        } catch {
          // expected: the RPC rejects with the reconciled guard
        }
      });

      expect(toast.error).toHaveBeenCalledWith(
        'This transaction is reconciled. Reclassify it from the Banking page instead.'
      );
      expect(mockBankTransactionBuilder.update).not.toHaveBeenCalled();
      expect(mockPendingOutflowBuilder.update).not.toHaveBeenCalled();
    });

    it('maps the closed-period guard', async () => {
      const mockPendingOutflow = {
        id: 'po-123',
        category_id: 'cat-456',
        notes: null,
        expense_invoice_uploads: [],
      };

      const mockBankTransaction = {
        notes: null,
        category_id: null,
        suggested_category_id: null,
      };

      const { mockPendingOutflowBuilder, mockBankTransactionBuilder } =
        setupConfirmMatchMocks(mockPendingOutflow, mockBankTransaction);
      mockSupabase.rpc.mockResolvedValue({
        data: null,
        error: {
          message: 'Cannot categorize transaction in closed fiscal period. Period closed on 2026-01-01',
        },
      });

      const { result } = renderHook(() => usePendingOutflowMutations(), { wrapper: createWrapper() });

      await act(async () => {
        try {
          await result.current.confirmMatch.mutateAsync({
            pendingOutflowId: 'po-123',
            bankTransactionId: 'bt-456',
          });
        } catch {
          // expected: the RPC rejects with the closed-period guard
        }
      });

      expect(toast.error).toHaveBeenCalledWith(
        'This transaction is in a closed fiscal period. Reopen the period before you match it.'
      );
      expect(mockBankTransactionBuilder.update).not.toHaveBeenCalled();
      expect(mockPendingOutflowBuilder.update).not.toHaveBeenCalled();
    });

    it('keeps the generic copy for other errors', async () => {
      const mockPendingOutflow = {
        id: 'po-123',
        category_id: 'cat-456',
        notes: null,
        expense_invoice_uploads: [],
      };

      const mockBankTransaction = {
        notes: null,
        category_id: null,
        suggested_category_id: null,
      };

      setupConfirmMatchMocks(mockPendingOutflow, mockBankTransaction);
      mockSupabase.rpc.mockResolvedValue({
        data: null,
        error: { message: 'boom' },
      });

      const { result } = renderHook(() => usePendingOutflowMutations(), { wrapper: createWrapper() });

      await act(async () => {
        try {
          await result.current.confirmMatch.mutateAsync({
            pendingOutflowId: 'po-123',
            bankTransactionId: 'bt-456',
          });
        } catch {
          // expected: the RPC rejects with an unrelated error
        }
      });

      expect(toast.error).toHaveBeenCalledWith('Failed to confirm match: boom');
    });
  });
});
