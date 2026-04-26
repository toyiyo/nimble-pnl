import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// ---------------------------------------------------------------------------
// Mocks (must be hoisted so the vi.mock factories can reference them)
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => {
  const stableSettings = {
    business_name: 'Test',
    business_address_line1: null,
    business_address_line2: null,
    business_city: null,
    business_state: null,
    business_zip: null,
  };

  const stableRestaurant = {
    restaurant_id: 'r1',
    restaurant: {
      id: 'r1',
      name: 'Test R',
      legal_name: 'Test R LLC',
      address_line1: null,
      address_line2: null,
      city: null,
      state: null,
      zip: null,
    },
  };

  return {
    saveAccount: vi.fn(),
    saveAccountSecrets: vi.fn(),
    updateAccountRouting: vi.fn(),
    clearAccountSecrets: vi.fn(),
    deleteAccount: vi.fn(),
    fetchAccountSecrets: vi.fn(),
    saveSettings: vi.fn(),
    stableSettings,
    stableRestaurant,
  };
});

vi.mock('@/hooks/useCheckSettings', () => ({
  useCheckSettings: () => ({
    settings: mocks.stableSettings,
    saveSettings: { mutateAsync: mocks.saveSettings, isPending: false },
  }),
}));

vi.mock('@/hooks/useCheckBankAccounts', () => ({
  useCheckBankAccounts: () => ({
    accounts: [],
    saveAccount: { mutateAsync: mocks.saveAccount, isPending: false },
    saveAccountSecrets: { mutateAsync: mocks.saveAccountSecrets, isPending: false },
    updateAccountRouting: { mutateAsync: mocks.updateAccountRouting, isPending: false },
    clearAccountSecrets: { mutateAsync: mocks.clearAccountSecrets, isPending: false },
    deleteAccount: { mutateAsync: mocks.deleteAccount, isPending: false },
    fetchAccountSecrets: mocks.fetchAccountSecrets,
  }),
}));

vi.mock('@/contexts/RestaurantContext', () => ({
  useRestaurantContext: () => ({
    selectedRestaurant: mocks.stableRestaurant,
  }),
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

import { CheckSettingsDialog } from '@/components/checks/CheckSettingsDialog';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return React.createElement(QueryClientProvider, { client: qc }, children);
}

beforeEach(() => {
  mocks.saveAccount.mockReset();
  mocks.saveAccount.mockResolvedValue({ id: 'new-id', account_name: 'Operating' });
  mocks.saveAccountSecrets.mockReset();
  mocks.saveAccountSecrets.mockResolvedValue(undefined);
  mocks.updateAccountRouting.mockReset();
  mocks.updateAccountRouting.mockResolvedValue(undefined);
  mocks.clearAccountSecrets.mockReset();
  mocks.clearAccountSecrets.mockResolvedValue(undefined);
  mocks.deleteAccount.mockReset();
  mocks.fetchAccountSecrets.mockReset();
  mocks.saveSettings.mockReset();
});

function openAddForm() {
  fireEvent.click(screen.getByRole('button', { name: /add account/i }));
}

function togglePrintBankInfo() {
  fireEvent.click(screen.getByLabelText(/print bank name and account info/i));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CheckSettingsDialog — Bank info for printing', () => {
  it('hides routing and account inputs when toggle is off', () => {
    render(
      React.createElement(CheckSettingsDialog, { open: true, onOpenChange: () => {} }),
      { wrapper },
    );
    openAddForm();
    expect(screen.queryByLabelText(/routing number/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/^account number$/i)).not.toBeInTheDocument();
  });

  it('shows routing and account inputs when toggle is on', () => {
    render(
      React.createElement(CheckSettingsDialog, { open: true, onOpenChange: () => {} }),
      { wrapper },
    );
    openAddForm();
    togglePrintBankInfo();
    expect(screen.getByLabelText(/routing number/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^account number$/i)).toBeInTheDocument();
  });

  it('strips non-digits from routing input', () => {
    render(
      React.createElement(CheckSettingsDialog, { open: true, onOpenChange: () => {} }),
      { wrapper },
    );
    openAddForm();
    togglePrintBankInfo();
    const input = screen.getByLabelText(/routing number/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: '111-000-614' } });
    expect(input.value).toBe('111000614');
  });

  it('shows checksum error for invalid 9-digit routing', () => {
    render(
      React.createElement(CheckSettingsDialog, { open: true, onOpenChange: () => {} }),
      { wrapper },
    );
    openAddForm();
    togglePrintBankInfo();
    fireEvent.change(screen.getByLabelText(/routing number/i), {
      target: { value: '111000615' },
    });
    expect(screen.getByRole('alert')).toHaveTextContent(/invalid/i);
  });

  it('saves both account and secrets when MICR is enabled and inputs valid', async () => {
    render(
      React.createElement(CheckSettingsDialog, { open: true, onOpenChange: () => {} }),
      { wrapper },
    );
    openAddForm();
    fireEvent.change(screen.getByLabelText(/account name/i), {
      target: { value: 'Operating' },
    });
    fireEvent.change(screen.getByLabelText(/^bank name$/i), {
      target: { value: 'Chase' },
    });
    togglePrintBankInfo();
    fireEvent.change(screen.getByLabelText(/routing number/i), {
      target: { value: '111000614' },
    });
    fireEvent.change(screen.getByLabelText(/^account number$/i), {
      target: { value: '2907959096' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^add$/i }));

    await waitFor(() => {
      expect(mocks.saveAccount).toHaveBeenCalledWith(
        expect.objectContaining({
          account_name: 'Operating',
          bank_name: 'Chase',
          print_bank_info: true,
        }),
      );
    });
    await waitFor(() => {
      expect(mocks.saveAccountSecrets).toHaveBeenCalledWith({
        id: 'new-id',
        routing: '111000614',
        account: '2907959096',
      });
    });
  });

  it('blocks save and skips secrets when routing checksum is invalid', async () => {
    render(
      React.createElement(CheckSettingsDialog, { open: true, onOpenChange: () => {} }),
      { wrapper },
    );
    openAddForm();
    fireEvent.change(screen.getByLabelText(/account name/i), {
      target: { value: 'Operating' },
    });
    togglePrintBankInfo();
    fireEvent.change(screen.getByLabelText(/routing number/i), {
      target: { value: '111000615' },
    });
    fireEvent.change(screen.getByLabelText(/^account number$/i), {
      target: { value: '2907959096' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^add$/i }));

    // Give any async handlers a chance to fire.
    await new Promise((r) => setTimeout(r, 50));
    expect(mocks.saveAccount).not.toHaveBeenCalled();
    expect(mocks.saveAccountSecrets).not.toHaveBeenCalled();
  });
});
