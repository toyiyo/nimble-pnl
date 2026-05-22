import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const claimForAccountMutateAsync = vi.fn();
const fetchAccountSecretsMock = vi.fn();
const updatePendingOutflowMutateAsync = vi.fn();
const logCheckActionMutateAsync = vi.fn();

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
    accounts: [{
      id: 'acct-1',
      account_name: 'Operating',
      bank_name: 'First National',
      next_check_number: 1001,
      print_bank_info: false,
      routing_number: null,
      account_number_last4: null,
      is_default: true,
    }],
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
  usePendingOutflowMutations: () => ({
    updatePendingOutflow: { mutateAsync: updatePendingOutflowMutateAsync },
  }),
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
  const actual = await vi.importActual<any>('@/utils/checkPrinting');
  return {
    ...actual,
    generateCheckPDF: vi.fn().mockReturnValue({ save: vi.fn() }),
    generateCheckPDFAsync: vi.fn().mockResolvedValue({ save: vi.fn() }),
  };
});

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { PrintCheckButton } from '@/components/pending-outflows/PrintCheckButton';
import type { PendingOutflow } from '@/types/pending-outflows';

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

beforeEach(() => {
  claimForAccountMutateAsync.mockReset().mockResolvedValue(1001);
  fetchAccountSecretsMock.mockReset().mockResolvedValue(null);
  updatePendingOutflowMutateAsync.mockReset().mockResolvedValue({});
  logCheckActionMutateAsync.mockReset().mockResolvedValue(undefined);
});

describe('PrintCheckButton — Category field', () => {
  it('passes the newly picked category_id when the expense was uncategorized', async () => {
    const user = userEvent.setup();
    render(<PrintCheckButton expense={makeExpense()} />);

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
    const user = userEvent.setup();
    render(<PrintCheckButton expense={makeExpense({ category_id: 'acc-preexisting' })} />);

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
    const user = userEvent.setup();
    render(<PrintCheckButton expense={makeExpense({ category_id: 'acc-old' })} />);

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
});
