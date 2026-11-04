import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';

// Codex review finding on PR #777: ManualMatchDialog filtered candidates by
// amount < 0 only. A transfer, an excluded row, or a split parent must never
// get a single-category journal entry (the bulk categorize RPC skips all
// three for the same reason — see
// supabase/migrations/20260819231210_add_bulk_categorize_bank_transactions.sql).
// This proves the dialog hides all three states from the picker list.

// jsdom never runs layout, so every element's offsetHeight is 0.
// @tanstack/react-virtual measures its scroll container via `offsetHeight`
// and only computes a visible range when that size is > 0 — without this
// stub, getVirtualItems() always returns [] and no row renders. Same
// pattern as tests/unit/manualMatchDialogError.test.tsx.
let offsetHeightSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  offsetHeightSpy = vi
    .spyOn(HTMLElement.prototype, 'offsetHeight', 'get')
    .mockReturnValue(800);
});

afterEach(() => {
  offsetHeightSpy.mockRestore();
});

const confirmMatchMutateAsync = vi.fn();

vi.mock('@/hooks/usePendingOutflows', () => ({
  usePendingOutflowMutations: () => ({
    confirmMatch: { mutateAsync: confirmMatchMutateAsync, isPending: false },
  }),
}));

const baseTransaction = {
  restaurant_id: 'rest-1',
  connected_bank_id: 'bank-1',
  transaction_date: '2026-05-20',
  posted_date: '2026-05-20',
  amount: -100,
  description: 'Vendor payment',
  merchant_name: null,
  normalized_payee: null,
  category_id: null,
  suggested_category_id: null,
  suggested_payee: null,
  supplier_id: null,
  expense_invoice_upload_id: null,
  status: 'active',
  is_categorized: false,
  is_reconciled: false,
  is_split: false,
  is_transfer: false,
  transfer_pair_id: null,
  excluded_reason: null,
  ai_confidence: null,
  ai_reasoning: null,
  notes: null,
  created_at: '2026-05-20T00:00:00Z',
  updated_at: '2026-05-20T00:00:00Z',
  connected_bank: { id: 'bank-1', institution_name: 'First National' },
};

vi.mock('@/hooks/useBankTransactions', () => ({
  useBankTransactionsWithRelations: () => ({
    data: [
      { ...baseTransaction, id: 'txn-postable', merchant_name: 'Postable Vendor' },
      { ...baseTransaction, id: 'txn-transfer', merchant_name: 'Transfer Vendor', is_transfer: true },
      { ...baseTransaction, id: 'txn-split', merchant_name: 'Split Vendor', is_split: true },
      { ...baseTransaction, id: 'txn-excluded', merchant_name: 'Excluded Vendor', excluded_reason: 'duplicate' },
    ],
    isLoading: false,
  }),
}));

import { ManualMatchDialog } from '@/components/pending-outflows/ManualMatchDialog';
import type { PendingOutflow } from '@/types/pending-outflows';

const pendingOutflow: PendingOutflow = {
  id: 'pof-1',
  restaurant_id: 'rest-1',
  vendor_name: 'Acme Supply',
  category_id: null,
  payment_method: 'check',
  amount: 100,
  issue_date: '2026-05-22',
  due_date: null,
  notes: null,
  reference_number: null,
  status: 'pending',
  linked_bank_transaction_id: null,
  cleared_at: null,
  voided_at: null,
  voided_reason: null,
  created_at: '2026-05-22T00:00:00Z',
  updated_at: '2026-05-22T00:00:00Z',
  chart_account: null,
};

describe('ManualMatchDialog — non-postable transaction filter', () => {
  it('shows a postable transaction and hides a transfer, a split, and an excluded row', () => {
    render(
      <ManualMatchDialog
        isOpen
        onClose={vi.fn()}
        pendingOutflow={pendingOutflow}
        restaurantId="rest-1"
      />,
    );

    expect(screen.getByRole('button', { name: /Postable Vendor/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Transfer Vendor/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Split Vendor/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Excluded Vendor/ })).not.toBeInTheDocument();
  });
});
