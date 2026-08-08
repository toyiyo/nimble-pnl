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
  usePendingOutflows: () => ({ data: outflowsData, isLoading: false, error: null }),
  usePendingOutflowMatches: () => ({ data: [] }),
  usePendingOutflowMutations: () => ({
    updatePendingOutflow: { mutateAsync: updatePendingOutflowMutateAsync },
    voidPendingOutflow: { mutate: voidPendingOutflowMutate },
    deletePendingOutflow: { mutate: deletePendingOutflowMutate },
  }),
}));

// `capabilityGranted` lets a test flip the user's edit:pending_outflows
// capability, so a test can prove the dialog and its hooks stay unmounted
// for a viewer who can never open the dialog.
let capabilityGranted = true;

vi.mock('@/hooks/usePermissions', () => ({
  usePermissions: () => ({
    hasCapability: () => capabilityGranted,
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

let outflowsData: PendingOutflow[] = makeOutflows(5);

beforeEach(() => {
  bankAccountsHookCalls = 0;
  capabilityGranted = true;
  outflowsData = makeOutflows(5);
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

  // The dialog and its three data hooks (useCheckBankAccounts,
  // useCheckAuditLog, usePendingOutflowMutations) must stay unmounted for a
  // viewer who lacks edit:pending_outflows, the same as the per-row gate on
  // the Print button itself.
  it('does not mount the dialog or its hooks with no edit:pending_outflows capability', () => {
    capabilityGranted = false;

    render(<PendingOutflowsList onAddClick={vi.fn()} />);

    expect(bankAccountsHookCalls).toBe(0);
    expect(screen.queryByRole('button', { name: /Print check for/i })).toBeNull();
  });

  // The active outflow must come from the live query by id, not a frozen
  // snapshot, so a row that leaves the list (voided, cleared, or deleted
  // elsewhere) also closes the dialog.
  it('closes the print-check dialog when the active row leaves the list on refetch', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<PendingOutflowsList onAddClick={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: /^Print check for Vendor 1$/i }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    // Someone else voids row 1; the next refetch drops it from the list.
    outflowsData = outflowsData.filter((outflow) => outflow.id !== 'pof-1');
    rerender(<PendingOutflowsList onAddClick={vi.fn()} />);

    expect(screen.queryByRole('dialog')).toBeNull();
  });

  // usePendingOutflows does not filter by status, so a cleared or voided
  // row still comes back in the same query — it just leaves the printable
  // set. The dialog must close even though the row itself is still
  // present, the same way it closes when the row disappears outright.
  it('closes the print-check dialog when the active row stays in the list but stops being printable', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<PendingOutflowsList onAddClick={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: /^Print check for Vendor 1$/i }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    // Someone else clears row 1 elsewhere; the row stays in the
    // (status-unfiltered) query but its status is no longer printable.
    outflowsData = outflowsData.map((outflow) =>
      outflow.id === 'pof-1' ? { ...outflow, status: 'cleared' as const } : outflow,
    );
    rerender(<PendingOutflowsList onAddClick={vi.fn()} />);

    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
