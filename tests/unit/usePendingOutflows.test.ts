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
    info: vi.fn(),
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
    claimedOutflow?: { id: string } | null;
  } = {}
) {
  // The status column is NOT NULL in the database, so the hook always sees
  // one. Default it here so each fixture only sets status when a test
  // exercises the already-matched guard.
  const outflowWithStatus = pendingOutflow
    ? { status: 'pending', ...(pendingOutflow as Record<string, unknown>) }
    : pendingOutflow;

  const mockPendingOutflowBuilder = {
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: outflowWithStatus, error: null }),
    }),
    update: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    // The compare-and-set claim: update().eq().in().select().maybeSingle().
    // `claimedOutflow: null` simulates a lost race (another session already
    // cleared the outflow).
    in: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        maybeSingle: vi.fn().mockResolvedValue({
          data: options.claimedOutflow === undefined ? { id: 'claimed' } : options.claimedOutflow,
          error: null,
        }),
      }),
    }),
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
    // The update chain is update().eq('id').eq('restaurant_id') awaited.
    eq: vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ error: null }),
    }),
  };

  // Backs the pre-RPC "does a journal entry already exist" guard. Hit
  // whenever the bank transaction already carries a category_id, same as
  // the outflow's category or not.
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
    // Codex review finding on PR #777: ManualMatchDialog's own filter only
    // excludes amount >= 0. A transfer, an excluded row, or a split parent
    // must never get a single-category journal entry (the bulk categorize
    // RPC skips all three for the same reason — see
    // supabase/migrations/20260819231210_add_bulk_categorize_bank_transactions.sql).
    // This is the defense-in-depth guard for a stale row list or a direct
    // call that bypasses the dialog's own filter.
    it.each([
      ['a transfer', { is_transfer: true, is_split: false, excluded_reason: null }],
      ['a split parent', { is_transfer: false, is_split: true, excluded_reason: null }],
      ['an excluded row', { is_transfer: false, is_split: false, excluded_reason: 'duplicate' }],
    ])('blocks a match onto %s', async (_label, flags) => {
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
        ...flags,
      };

      const { mockBankTransactionBuilder, mockPendingOutflowBuilder } =
        setupConfirmMatchMocks(mockPendingOutflow, mockBankTransaction);

      const { result } = renderHook(() => usePendingOutflowMutations(), { wrapper: createWrapper() });

      await act(async () => {
        try {
          await result.current.confirmMatch.mutateAsync({
            pendingOutflowId: 'po-123',
            bankTransactionId: 'bt-456',
          });
        } catch {
          // expected: the pre-RPC transfer/split/excluded guard rejects the match
        }
      });

      expect(mockSupabase.rpc).not.toHaveBeenCalled();
      expect(mockBankTransactionBuilder.update).not.toHaveBeenCalled();
      expect(mockPendingOutflowBuilder.update).not.toHaveBeenCalled();
      expect(toast.error).toHaveBeenCalledWith(
        expect.stringContaining('transfer, a split, or excluded')
      );
    });

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

    // Shared by the two guard tests below (block vs. allow): the same
    // different-category pending outflow and bank transaction fixtures.
    // Only the `existingJournalEntry` option passed to
    // setupConfirmMatchMocks differs between them. The transaction
    // already carries a DIFFERENT category, so the RPC would take the
    // reclassification branch here, crediting "existing-cat" — a
    // spurious credit unless a journal entry from the first categorize
    // already debits that account.
    const differentCategoryPendingOutflow = {
      id: 'po-123',
      category_id: 'cat-456',
      notes: 'Expense notes',
      expense_invoice_uploads: [],
    };

    const differentCategoryBankTransaction = {
      notes: null,
      category_id: 'existing-cat',
      suggested_category_id: 'existing-suggested',
    };

    it('blocks a different-category match when the transaction has no journal entry', async () => {
      const { mockPendingOutflowBuilder, mockBankTransactionBuilder, mockJournalEntriesBuilder } =
        setupConfirmMatchMocks(differentCategoryPendingOutflow, differentCategoryBankTransaction, {
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

    it('allows a different-category match when a journal entry already exists', async () => {
      const { mockBankTransactionBuilder } =
        setupConfirmMatchMocks(differentCategoryPendingOutflow, differentCategoryBankTransaction, {
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

    // PR #782 review, P1: two rows can suggest the same pending outflow, so
    // two confirms can race on it. The hook rejects a non-matchable status
    // before the categorize RPC, and the final update is a compare-and-set
    // claim that surfaces a lost race as an error.
    it('rejects an already-cleared outflow before any financial write', async () => {
      const clearedOutflow = {
        id: 'po-123',
        status: 'cleared',
        category_id: 'cat-456',
        notes: null,
        expense_invoice_uploads: [],
      };

      const { mockPendingOutflowBuilder } = setupConfirmMatchMocks(clearedOutflow, {
        notes: null,
        category_id: null,
        suggested_category_id: null,
      });

      const { result } = renderHook(() => usePendingOutflowMutations(), { wrapper: createWrapper() });

      await act(async () => {
        try {
          await result.current.confirmMatch.mutateAsync({
            pendingOutflowId: 'po-123',
            bankTransactionId: 'bt-456',
          });
        } catch {
          // expected: the outflow is not matchable
        }
      });

      expect(mockSupabase.rpc).not.toHaveBeenCalled();
      expect(mockPendingOutflowBuilder.update).not.toHaveBeenCalled();
      expect(toast.error).toHaveBeenCalledWith(
        'Failed to confirm match: This expense is already matched or voided. Refresh the list and try again.'
      );
    });

    it('surfaces a lost compare-and-set race as an error', async () => {
      setupConfirmMatchMocks(
        {
          id: 'po-123',
          category_id: 'cat-456',
          notes: null,
          expense_invoice_uploads: [],
        },
        {
          notes: null,
          category_id: null,
          suggested_category_id: null,
        },
        { claimedOutflow: null }
      );
      mockSupabase.rpc.mockResolvedValue({ data: null, error: null });

      const { result } = renderHook(() => usePendingOutflowMutations(), { wrapper: createWrapper() });

      await act(async () => {
        try {
          await result.current.confirmMatch.mutateAsync({
            pendingOutflowId: 'po-123',
            bankTransactionId: 'bt-456',
          });
        } catch {
          // expected: another session claimed the outflow first
        }
      });

      expect(toast.error).toHaveBeenCalledWith(
        'Failed to confirm match: This expense was matched by another session while this match ran. Check the transaction category on the Banking page.'
      );
    });
  });

  // unlinkMatch (plan task 8): the "Undo match" button on a cleared
  // PendingOutflowCard calls unlink_pending_outflow, invalidates the same
  // six query keys as confirmMatch, and maps category_kept to a toast.
  describe('unlinkMatch', () => {
    it('calls unlink_pending_outflow with the pending outflow id', async () => {
      mockSupabase.rpc.mockResolvedValue({
        data: { category_kept: false, status: 'pending' },
        error: null,
      });

      const { result } = renderHook(() => usePendingOutflowMutations(), { wrapper: createWrapper() });

      await act(async () => {
        await result.current.unlinkMatch.mutateAsync('po-123');
      });

      expect(mockSupabase.rpc).toHaveBeenCalledWith('unlink_pending_outflow', {
        p_pending_outflow_id: 'po-123',
      });
    });

    it('invalidates the same six query keys as confirmMatch', async () => {
      mockSupabase.rpc.mockResolvedValue({
        data: { category_kept: false, status: 'pending' },
        error: null,
      });

      const invalidateSpy = vi.spyOn(QueryClient.prototype, 'invalidateQueries');

      const { result } = renderHook(() => usePendingOutflowMutations(), { wrapper: createWrapper() });

      await act(async () => {
        await result.current.unlinkMatch.mutateAsync('po-123');
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

    it('shows an informational toast when the RPC keeps the categorization', async () => {
      mockSupabase.rpc.mockResolvedValue({
        data: { category_kept: true, status: 'pending' },
        error: null,
      });

      const { result } = renderHook(() => usePendingOutflowMutations(), { wrapper: createWrapper() });

      await act(async () => {
        await result.current.unlinkMatch.mutateAsync('po-123');
      });

      expect(toast.info).toHaveBeenCalledWith(
        'Match undone. The transaction keeps its category.'
      );
      expect(toast.success).not.toHaveBeenCalled();
    });

    it('shows a success toast when the RPC reverts the categorization', async () => {
      mockSupabase.rpc.mockResolvedValue({
        data: { category_kept: false, status: 'pending' },
        error: null,
      });

      const { result } = renderHook(() => usePendingOutflowMutations(), { wrapper: createWrapper() });

      await act(async () => {
        await result.current.unlinkMatch.mutateAsync('po-123');
      });

      expect(toast.success).toHaveBeenCalledWith('Match undone');
      expect(toast.info).not.toHaveBeenCalled();
    });

    it('shows an error toast when the RPC fails', async () => {
      mockSupabase.rpc.mockResolvedValue({
        data: null,
        error: { message: 'boom' },
      });

      const { result } = renderHook(() => usePendingOutflowMutations(), { wrapper: createWrapper() });

      await act(async () => {
        try {
          await result.current.unlinkMatch.mutateAsync('po-123');
        } catch {
          // expected: the RPC rejects
        }
      });

      expect(toast.error).toHaveBeenCalledWith('Failed to undo match: boom');
    });
  });
});
