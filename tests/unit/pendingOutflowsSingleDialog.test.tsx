import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Design doc §5: the print-check dialog and its three hooks move to list
// level. This file proves the list renders one dialog for N rows, calls
// useCheckBankAccounts once, and hides the Print button with no check
// settings.

let bankAccountsHookCalls = 0;

const claimForAccountMutateAsync = vi.fn();
const fetchAccountSecretsMock = vi.fn();
const updatePendingOutflowMutateAsync = vi.fn();
const voidPendingOutflowMutate = vi.fn();
const deletePendingOutflowMutate = vi.fn();
const logCheckActionMutateAsync = vi.fn();

let checkSettingsValue: unknown = {
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
};

vi.mock('@/contexts/RestaurantContext', () => ({
  useRestaurantContext: () => ({
    selectedRestaurant: { restaurant: { name: 'Test Restaurant' }, restaurant_id: 'rest-1' },
  }),
}));

vi.mock('@/hooks/useCheckSettings', () => ({
  useCheckSettings: () => ({ settings: checkSettingsValue }),
}));

vi.mock('@/hooks/useCheckBankAccounts', () => ({
  useCheckBankAccounts: () => {
    bankAccountsHookCalls += 1;
    return {
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
    };
  },
}));

vi.mock('@/hooks/useCheckAuditLog', () => ({
  useCheckAuditLog: () => ({
    logCheckAction: { mutateAsync: logCheckActionMutateAsync },
  }),
}));

vi.mock('@/hooks/usePendingOutflows', () => ({
  usePendingOutflows: () => ({ data: makeOutflows(5), isLoading: false, error: null }),
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
import type { PendingOutflow } from '@/types/pending-outflows';

function makeOutflows(count: number): PendingOutflow[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `pof-${i + 1}`,
    restaurant_id: 'rest-1',
    vendor_name: `Vendor ${i + 1}`,
    category_id: null,
    payment_method: 'check',
    amount: 100 + i,
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
  }));
}

beforeEach(() => {
  bankAccountsHookCalls = 0;
  checkSettingsValue = {
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
  };
  claimForAccountMutateAsync.mockReset().mockResolvedValue(1001);
  fetchAccountSecretsMock.mockReset().mockResolvedValue(null);
  updatePendingOutflowMutateAsync.mockReset().mockResolvedValue({});
  logCheckActionMutateAsync.mockReset().mockResolvedValue(undefined);
});

describe('PendingOutflowsList — single print-check dialog (design §5)', () => {
  it('renders one print-check dialog for a list of five outflows', async () => {
    const user = userEvent.setup();
    render(<PendingOutflowsList onAddClick={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: /^Print check for Vendor 1$/i }));

    expect(screen.getAllByRole('dialog')).toHaveLength(1);
  });

  it('calls useCheckBankAccounts once for a list of five outflows', () => {
    render(<PendingOutflowsList onAddClick={vi.fn()} />);

    expect(bankAccountsHookCalls).toBe(1);
  });

  it('shows no print button when check settings are missing', () => {
    checkSettingsValue = null;

    render(<PendingOutflowsList onAddClick={vi.fn()} />);

    expect(screen.queryByRole('button', { name: /Print check for/i })).toBeNull();
  });
});
