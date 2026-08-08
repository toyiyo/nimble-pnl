import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import type { PendingOutflow } from '@/types/pending-outflows';

const claimForAccountMutateAsync = vi.fn();
const fetchAccountSecretsMock = vi.fn();
const updatePendingOutflowMutateAsync = vi.fn();
const voidPendingOutflowMutate = vi.fn();
const deletePendingOutflowMutate = vi.fn();
const logCheckActionMutateAsync = vi.fn();

let outflowsData: PendingOutflow[] = [];

function makeExpense(overrides: Partial<PendingOutflow> = {}): PendingOutflow {
  return {
    id: 'pof-1',
    restaurant_id: 'rest-1',
    vendor_name: 'ACME Rent',
    category_id: null,
    payment_method: 'check',
    amount: 1200,
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
    ...overrides,
  };
}

vi.mock('@/contexts/RestaurantContext', () => ({
  useRestaurantContext: () => ({
    selectedRestaurant: { restaurant: { name: 'Test Restaurant' }, restaurant_id: 'rest-1' },
  }),
}));

vi.mock('@/hooks/useCheckSettings', () => ({
  useCheckSettings: () => ({
    settings: {
      id: 'set-1',
      restaurant_id: 'rest-1',
      business_name: 'Test Restaurant LLC',
      business_address_line1: '123 Main St',
      business_address_line2: null,
      business_city: 'Austin',
      business_state: 'TX',
      business_zip: '78701',
      bank_name: null,
      print_bank_info: false,
      routing_number: null,
      signature_url: null,
    },
  }),
}));

vi.mock('@/hooks/useCheckBankAccounts', () => ({
  useCheckBankAccounts: () => ({
    accounts: [
      {
        id: 'acct-1',
        account_name: 'Operating',
        bank_name: 'First National',
        next_check_number: 1001,
        print_bank_info: false,
        routing_number: null,
        account_number_last4: null,
        is_default: true,
      },
      {
        id: 'acct-2',
        account_name: 'Savings',
        bank_name: 'Second National',
        next_check_number: 2001,
        print_bank_info: false,
        routing_number: null,
        account_number_last4: null,
        is_default: false,
      },
    ],
    defaultAccount: {
      id: 'acct-1',
      account_name: 'Operating',
      bank_name: 'First National',
      next_check_number: 1001,
      print_bank_info: false,
      routing_number: null,
      account_number_last4: null,
      is_default: true,
    },
    claimCheckNumbers: { mutateAsync: claimForAccountMutateAsync },
    fetchAccountSecrets: fetchAccountSecretsMock,
  }),
}));

vi.mock('@/hooks/useCheckAuditLog', () => ({
  useCheckAuditLog: () => ({
    logCheckAction: { mutateAsync: logCheckActionMutateAsync },
  }),
}));

vi.mock('@/hooks/usePendingOutflows', () => ({
  usePendingOutflows: () => ({ data: outflowsData, isLoading: false, error: null }),
  usePendingOutflowMatches: () => ({ data: [] }),
  usePendingOutflowMutations: () => ({
    updatePendingOutflow: { mutateAsync: updatePendingOutflowMutateAsync },
    voidPendingOutflow: { mutate: voidPendingOutflowMutate },
    deletePendingOutflow: { mutate: deletePendingOutflowMutate },
  }),
}));

vi.mock('@/hooks/usePermissions', () => ({
  usePermissions: () => ({
    hasCapability: () => true,
    isResolved: true,
  }),
}));

vi.mock('@/components/pending-outflows/ManualMatchDialog', () => ({
  ManualMatchDialog: () => null,
}));

vi.mock('@/components/banking/SearchableAccountSelector', () => ({
  SearchableAccountSelector: ({
    onValueChange,
    value,
  }: {
    onValueChange: (value: string) => void;
    value?: string;
  }) => (
    <button
      type="button"
      data-testid="category-selector"
      data-current-value={value ?? ''}
      onClick={() => onValueChange('acc-rent')}
    >
      Pick category
    </button>
  ),
}));

vi.mock('@/utils/checkPrinting', async () => {
  const actual = await vi.importActual<typeof import('@/utils/checkPrinting')>('@/utils/checkPrinting');
  return {
    ...actual,
    generateCheckPDF: vi.fn().mockReturnValue({ save: vi.fn() }),
    generateCheckPDFAsync: vi.fn().mockResolvedValue({ save: vi.fn() }),
  };
});

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { PendingOutflowsList } from '@/components/pending-outflows/PendingOutflowsList';

beforeEach(() => {
  claimForAccountMutateAsync.mockReset().mockResolvedValue(1001);
  fetchAccountSecretsMock.mockReset().mockResolvedValue(null);
  updatePendingOutflowMutateAsync.mockReset().mockResolvedValue({});
  logCheckActionMutateAsync.mockReset().mockResolvedValue(undefined);
});

describe('PendingOutflowsList — print-check dialog category field (design §5)', () => {
  it('passes the newly picked category_id when the expense was uncategorized', async () => {
    outflowsData = [makeExpense()];
    const user = userEvent.setup();
    render(<PendingOutflowsList onAddClick={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: /^Print check for ACME Rent$/i }));
    await user.click(screen.getByTestId('category-selector'));
    await user.click(screen.getByRole('button', { name: /^Print Check$/i }));

    await waitFor(() => expect(updatePendingOutflowMutateAsync).toHaveBeenCalledTimes(1));
    expect(updatePendingOutflowMutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'pof-1',
        input: expect.objectContaining({
          payment_method: 'check',
          category_id: 'acc-rent',
        }),
      }),
    );
  });

  it('keeps the existing category_id when the user leaves the field alone', async () => {
    outflowsData = [makeExpense({ category_id: 'acc-preexisting' })];
    const user = userEvent.setup();
    render(<PendingOutflowsList onAddClick={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: /^Print check for ACME Rent$/i }));
    expect(screen.getByTestId('category-selector')).toHaveAttribute(
      'data-current-value',
      'acc-preexisting',
    );

    await user.click(screen.getByRole('button', { name: /^Print Check$/i }));

    await waitFor(() => expect(updatePendingOutflowMutateAsync).toHaveBeenCalledTimes(1));
    expect(updatePendingOutflowMutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({ category_id: 'acc-preexisting' }),
      }),
    );
  });

  it('overrides an existing category_id when the user picks a different one', async () => {
    outflowsData = [makeExpense({ category_id: 'acc-old' })];
    const user = userEvent.setup();
    render(<PendingOutflowsList onAddClick={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: /^Print check for ACME Rent$/i }));
    await user.click(screen.getByTestId('category-selector'));
    await user.click(screen.getByRole('button', { name: /^Print Check$/i }));

    await waitFor(() => expect(updatePendingOutflowMutateAsync).toHaveBeenCalledTimes(1));
    expect(updatePendingOutflowMutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({ category_id: 'acc-rent' }),
      }),
    );
  });

  it('clears the form when the user opens a different row', async () => {
    outflowsData = [
      makeExpense({ id: 'pof-a', vendor_name: 'Vendor A', notes: 'Memo for A' }),
      makeExpense({ id: 'pof-b', vendor_name: 'Vendor B', notes: 'Memo for B' }),
    ];
    const user = userEvent.setup();
    render(<PendingOutflowsList onAddClick={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: /^Print check for Vendor A$/i }));
    const memoInputA = screen.getByLabelText(/memo/i);
    await user.clear(memoInputA);
    await user.type(memoInputA, 'Typed only for A');

    await user.click(screen.getByRole('combobox', { name: /bank account/i }));
    await user.click(await screen.findByRole('option', { name: /Savings/i }));

    await user.click(screen.getByRole('button', { name: /^Cancel$/i }));
    await user.click(screen.getByRole('button', { name: /^Print check for Vendor B$/i }));

    const memoInputB = screen.getByLabelText(/memo/i);
    expect(memoInputB).toHaveValue('Memo for B');
    expect(screen.getByRole('combobox', { name: /bank account/i })).toHaveTextContent('Operating');
  });

  it('clears the form when the user reopens the same row', async () => {
    outflowsData = [makeExpense({ id: 'pof-a', vendor_name: 'Vendor A', notes: 'Original memo' })];
    const user = userEvent.setup();
    render(<PendingOutflowsList onAddClick={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: /^Print check for Vendor A$/i }));
    const memoInput = screen.getByLabelText(/memo/i);
    await user.clear(memoInput);
    await user.type(memoInput, 'Temporary text');

    await user.click(screen.getByRole('button', { name: /^Cancel$/i }));
    await user.click(screen.getByRole('button', { name: /^Print check for Vendor A$/i }));

    expect(screen.getByLabelText(/memo/i)).toHaveValue('Original memo');
  });

  it('keeps the typed memo when the query refetches the same row', async () => {
    outflowsData = [makeExpense({ id: 'pof-a', vendor_name: 'Vendor A', notes: 'Original memo' })];
    const user = userEvent.setup();
    const { rerender } = render(<PendingOutflowsList onAddClick={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: /^Print check for Vendor A$/i }));
    const memoInput = screen.getByLabelText(/memo/i);
    await user.clear(memoInput);
    await user.type(memoInput, 'Keep me through a refetch');

    outflowsData = [
      { ...outflowsData[0], notes: 'Server-side change nobody typed', updated_at: '2026-05-22T01:00:00Z' },
    ];
    rerender(<PendingOutflowsList onAddClick={vi.fn()} />);

    expect(screen.getByLabelText(/memo/i)).toHaveValue('Keep me through a refetch');
  });
});
