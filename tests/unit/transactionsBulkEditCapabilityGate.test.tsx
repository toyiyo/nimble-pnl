import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

// canBulkEditTransactions gate (design: 2026-08-20-bulk-categorize-capability-guard).
// A custom role can hold the `transactions` area at level `view` only. That
// role gets `view:transactions` without `edit:transactions`
// (src/lib/permissions/areas.ts) and can still open `/transactions`
// (src/lib/permissions/routeAreas.ts). The page must hide the two bulk
// entry points — the "Select" button and the bulk action bar — from that
// role, since the server-side RPC guard now rejects the write with
// "Access denied". Fixed in commit 95c307d9.
const hasCapabilityMock = vi.fn();
let isResolvedMock = true;
vi.mock('@/hooks/usePermissions', () => ({
  usePermissions: () => ({
    hasCapability: hasCapabilityMock,
    isResolved: isResolvedMock,
  }),
}));

let hasSelectionMock = false;
const bulkSelectionStub = {
  isSelectionMode: false,
  selectedIds: new Set<string>(),
  selectedCount: 0,
  get hasSelection() {
    return hasSelectionMock;
  },
  toggleSelectionMode: vi.fn(),
  enterSelectionMode: vi.fn(),
  exitSelectionMode: vi.fn(),
  toggleItem: vi.fn(),
  selectItem: vi.fn(),
  deselectItem: vi.fn(),
  selectAll: vi.fn(),
  selectRange: vi.fn(),
  clearSelection: vi.fn(),
  isSelected: vi.fn(),
  getSelectedItems: vi.fn(() => []),
};
vi.mock('@/hooks/useBulkSelection', () => ({
  useBulkSelection: () => bulkSelectionStub,
}));

vi.mock('@/hooks/useBulkTransactionActions', () => ({
  useBulkCategorizeTransactions: () => ({ mutate: vi.fn(), isPending: false }),
  useBulkDeleteTransactions: () => ({ mutate: vi.fn(), isPending: false }),
  useBulkMarkAsTransfer: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock('@/hooks/useBankTransactions', () => ({
  useBankTransactions: () => ({
    transactions: [
      {
        id: 'txn-1',
        restaurant_id: 'restaurant-1',
        connected_bank_id: 'bank-1',
        transaction_date: '2026-08-01',
        posted_date: '2026-08-01',
        amount: -12,
        description: 'Test transaction',
        merchant_name: 'Acme',
        normalized_payee: null,
        category_id: null,
        suggested_category_id: null,
        suggested_payee: null,
        supplier_id: null,
        expense_invoice_upload_id: null,
        status: 'for_review',
        is_categorized: false,
        is_reconciled: false,
        is_split: false,
        is_transfer: false,
        transfer_pair_id: null,
        excluded_reason: null,
        ai_confidence: null,
        ai_reasoning: null,
        notes: null,
        created_at: '2026-08-01T00:00:00.000Z',
        updated_at: '2026-08-01T00:00:00.000Z',
      },
    ],
    totalCount: 1,
    isLoading: false,
    loadingMore: false,
    hasMore: false,
    loadMore: vi.fn(),
    refetch: vi.fn(),
  }),
}));

vi.mock('@/hooks/useChartOfAccounts', () => ({
  useChartOfAccounts: () => ({ accounts: [] }),
}));

vi.mock('@/hooks/useCategorizeTransactions', () => ({
  useCategorizeTransactions: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock('@/hooks/useDateFormat', () => ({
  useDateFormat: () => ({ formatTransactionDate: (d: string) => d }),
}));

vi.mock('@/hooks/use-mobile', () => ({
  useIsMobile: () => false,
}));

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: { rpc: vi.fn() },
}));

vi.mock('@/contexts/RestaurantContext', () => ({
  useRestaurantContext: () => ({
    selectedRestaurant: { id: 'r1', restaurant_id: 'restaurant-1', restaurant: { name: 'Test Restaurant' } },
    setSelectedRestaurant: vi.fn(),
    restaurants: [],
    loading: false,
    createRestaurant: vi.fn(),
    canCreateRestaurant: true,
  }),
}));

vi.mock('@/components/RestaurantSelector', () => ({
  RestaurantSelector: () => null,
}));
vi.mock('@/components/MetricIcon', () => ({
  MetricIcon: () => <div />,
}));
vi.mock('@/components/TransactionFilters', () => ({
  TransactionFiltersSheet: () => <div data-testid="transaction-filters-sheet" />,
}));
vi.mock('@/components/banking/TransactionCard', () => ({
  TransactionCard: () => <div data-testid="transaction-card" />,
}));
vi.mock('@/components/banking/TransactionSkeleton', () => ({
  TransactionSkeleton: () => <div data-testid="transaction-skeleton" />,
}));
vi.mock('@/components/banking/ReconciliationDialog', () => ({
  ReconciliationDialog: () => null,
}));
vi.mock('@/components/banking/BankTransactionList', () => ({
  BankTransactionList: () => <div data-testid="bank-transaction-list" />,
}));
vi.mock('@/components/bulk-edit/BulkActionBar', () => ({
  BulkActionBar: () => <div data-testid="bulk-action-bar" />,
}));
vi.mock('@/components/banking/BulkCategorizeTransactionsPanel', () => ({
  BulkCategorizeTransactionsPanel: () => null,
}));
vi.mock('@/components/bulk-edit/BulkDeleteConfirmDialog', () => ({
  BulkDeleteConfirmDialog: () => null,
}));

import Transactions from '@/pages/Transactions';

const findSelectButton = () => screen.queryByRole('button', { name: /^Select$/i });
const findBulkActionBar = () => screen.queryByTestId('bulk-action-bar');

describe('Transactions page — bulk edit capability gate (canBulkEditTransactions)', () => {
  beforeEach(() => {
    hasCapabilityMock.mockReset();
    isResolvedMock = true;
    hasSelectionMock = false;
  });

  it('hides the Select button and the bulk action bar while permissions are still resolving, even if capability would be granted', () => {
    isResolvedMock = false;
    hasCapabilityMock.mockReturnValue(true);
    hasSelectionMock = true;

    render(<Transactions />);

    expect(findSelectButton()).not.toBeInTheDocument();
    expect(findBulkActionBar()).not.toBeInTheDocument();
  });

  it('hides the Select button and the bulk action bar for a view-only role without edit:transactions', () => {
    isResolvedMock = true;
    hasCapabilityMock.mockReturnValue(false);
    hasSelectionMock = true;

    render(<Transactions />);

    expect(findSelectButton()).not.toBeInTheDocument();
    expect(findBulkActionBar()).not.toBeInTheDocument();
    expect(hasCapabilityMock).toHaveBeenCalledWith('edit:transactions');
  });

  it('shows the Select button for a role with edit:transactions, and shows the bulk action bar once items are selected', () => {
    isResolvedMock = true;
    hasCapabilityMock.mockReturnValue(true);
    hasSelectionMock = true;

    render(<Transactions />);

    expect(findSelectButton()).toBeInTheDocument();
    expect(findBulkActionBar()).toBeInTheDocument();
  });

  it('hides the bulk action bar for an edit-capable role with no active selection', () => {
    isResolvedMock = true;
    hasCapabilityMock.mockReturnValue(true);
    hasSelectionMock = false;

    render(<Transactions />);

    expect(findSelectButton()).toBeInTheDocument();
    expect(findBulkActionBar()).not.toBeInTheDocument();
  });
});
