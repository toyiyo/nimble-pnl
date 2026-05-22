import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const claimCheckNumbersMock = vi.fn();
const createPendingOutflowMock = vi.fn();
const logCheckActionMock = vi.fn();

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
    isLoading: false,
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
    isLoading: false,
    claimCheckNumbers: { mutateAsync: claimCheckNumbersMock },
    fetchAccountSecrets: vi.fn(),
  }),
}));

vi.mock('@/hooks/useCheckAuditLog', () => ({
  useCheckAuditLog: () => ({
    auditLog: [],
    isLoading: false,
    logCheckAction: { mutateAsync: logCheckActionMock },
  }),
}));

vi.mock('@/hooks/usePendingOutflows', () => ({
  usePendingOutflowMutations: () => ({
    createPendingOutflow: { mutateAsync: createPendingOutflowMock },
  }),
}));

vi.mock('@/hooks/useSuppliers', () => ({
  useSuppliers: () => ({ suppliers: [] }),
}));

vi.mock('@/components/subscription', () => ({
  FeatureGate: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@/components/checks/CheckSettingsDialog', () => ({
  CheckSettingsDialog: () => null,
}));

vi.mock('@/components/banking/SearchableAccountSelector', () => ({
  SearchableAccountSelector: ({
    onValueChange,
    triggerAriaLabel,
    value,
  }: {
    onValueChange: (value: string) => void;
    triggerAriaLabel?: string;
    value?: string;
  }) => (
    <button
      type="button"
      aria-label={triggerAriaLabel}
      data-current-value={value ?? ''}
      onClick={() => onValueChange('acc-food')}
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

import PrintChecks from '@/pages/PrintChecks';

describe('PrintChecks — per-row Category column', () => {
  beforeEach(() => {
    claimCheckNumbersMock.mockReset().mockResolvedValue(1001);
    createPendingOutflowMock.mockReset().mockResolvedValue({ id: 'outflow-new-1' });
    logCheckActionMock.mockReset().mockResolvedValue(undefined);
  });

  it('renders a Category column header', () => {
    render(<PrintChecks />);
    expect(screen.getByRole('columnheader', { name: /category/i })).toBeInTheDocument();
  });

  it('renders a per-row category selector with a row-scoped aria-label', () => {
    render(<PrintChecks />);
    expect(
      screen.getByRole('button', { name: /category for check row 1/i }),
    ).toBeInTheDocument();
  });

  it('passes the chosen category_id through to createPendingOutflow', async () => {
    const user = userEvent.setup();
    render(<PrintChecks />);

    await user.type(screen.getByPlaceholderText(/vendor name/i), 'Sysco');
    await user.type(screen.getByPlaceholderText('0.00'), '125.50');

    await user.click(screen.getByRole('button', { name: /category for check row 1/i }));

    await user.click(screen.getByRole('button', { name: /^Print 1 Check$/i }));

    await waitFor(() => expect(createPendingOutflowMock).toHaveBeenCalledTimes(1));
    expect(createPendingOutflowMock).toHaveBeenCalledWith(
      expect.objectContaining({
        vendor_name: 'Sysco',
        amount: 125.5,
        category_id: 'acc-food',
      }),
    );
  });

  it('defaults category_id to null when no category is picked', async () => {
    const user = userEvent.setup();
    render(<PrintChecks />);

    await user.type(screen.getByPlaceholderText(/vendor name/i), 'Sysco');
    await user.type(screen.getByPlaceholderText('0.00'), '99.00');

    await user.click(screen.getByRole('button', { name: /^Print 1 Check$/i }));

    await waitFor(() => expect(createPendingOutflowMock).toHaveBeenCalledTimes(1));
    expect(createPendingOutflowMock).toHaveBeenCalledWith(
      expect.objectContaining({ category_id: null }),
    );
  });
});
