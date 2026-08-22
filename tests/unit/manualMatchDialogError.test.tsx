import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Design doc: confirmMatch can reject (a guard error, a network error). The
// dialog must stay open on a failed confirm, and the rejection must not
// escape as an unhandled promise rejection from the click handler.

// jsdom never runs layout, so every element's offsetHeight is 0.
// @tanstack/react-virtual measures its scroll container via `offsetHeight`
// and only computes a visible range when that size is > 0 — without this
// stub, getVirtualItems() always returns [] and the row never renders.
// Same pattern as tests/unit/VirtualizedProductGrid.test.tsx.
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

vi.mock('@/hooks/useBankTransactions', () => ({
  useBankTransactionsWithRelations: () => ({
    data: [
      {
        id: 'txn-1',
        restaurant_id: 'rest-1',
        connected_bank_id: 'bank-1',
        transaction_date: '2026-05-20',
        posted_date: '2026-05-20',
        amount: -100,
        description: 'Vendor payment',
        merchant_name: 'Acme Supply',
        normalized_payee: 'acme supply',
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
      },
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

const capturedRejections: unknown[] = [];
function captureRejection(reason: unknown): void {
  capturedRejections.push(reason);
}

beforeEach(() => {
  confirmMatchMutateAsync.mockReset();
  capturedRejections.length = 0;
  process.on('unhandledRejection', captureRejection);
});

afterEach(() => {
  process.off('unhandledRejection', captureRejection);
});

describe('ManualMatchDialog — error handling on a failed confirm', () => {
  it('keeps the dialog open when the match fails', async () => {
    confirmMatchMutateAsync.mockRejectedValue(new Error('closed fiscal period'));
    const onClose = vi.fn();
    const user = userEvent.setup();

    render(
      <ManualMatchDialog
        isOpen
        onClose={onClose}
        pendingOutflow={pendingOutflow}
        restaurantId="rest-1"
      />,
    );

    await user.click(screen.getByRole('button', { name: /Acme Supply/ }));
    await user.click(screen.getByRole('button', { name: 'Confirm Match' }));

    // Flush the macrotask queue so Node's unhandledRejection check (which
    // runs after the microtask queue drains) has a chance to fire before
    // the assertion below reads capturedRejections.
    await new Promise((resolve) => setImmediate(resolve));

    expect(confirmMatchMutateAsync).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(capturedRejections).toHaveLength(0);
  });
});
