import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Print-button gate under test (design §5.6): the inline Print button renders
// only when `onPrintCheck && isResolved && hasCapability('edit:pending_outflows')`.
const hasCapabilityMock = vi.fn();
let isResolvedMock = true;
vi.mock('@/hooks/usePermissions', () => ({
  usePermissions: () => ({
    hasCapability: hasCapabilityMock,
    isResolved: isResolvedMock,
  }),
}));

vi.mock('@/contexts/RestaurantContext', () => ({
  useRestaurantContext: () => ({
    selectedRestaurant: { id: 'restaurant-1', restaurant: { name: 'Test Restaurant' }, restaurant_id: 'restaurant-1' },
  }),
}));

vi.mock('@/hooks/usePendingOutflows', () => ({
  usePendingOutflowMutations: () => ({
    voidPendingOutflow: { mutate: vi.fn() },
    deletePendingOutflow: { mutate: vi.fn() },
    updatePendingOutflow: { mutateAsync: vi.fn() },
  }),
  usePendingOutflowMatches: () => ({ data: [] }),
}));

// PrintCheckButton is no longer mocked (design §5.6 removes it from
// PendingOutflowCard's render path), but until that lands, PendingOutflowCard
// still mounts the real PrintCheckButton behind the capability gate. Stub its
// three hooks with valid data so the gate under test is `isResolved` /
// `hasCapability` / `onPrintCheck`, not an unrelated "no check settings yet".
vi.mock('@/hooks/useCheckSettings', () => ({
  useCheckSettings: () => ({
    settings: {
      id: 'set-1',
      restaurant_id: 'restaurant-1',
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
    claimCheckNumbers: { mutateAsync: vi.fn() },
    fetchAccountSecrets: vi.fn(),
  }),
}));

vi.mock('@/hooks/useCheckAuditLog', () => ({
  useCheckAuditLog: () => ({
    logCheckAction: { mutateAsync: vi.fn() },
  }),
}));

// Unrelated to this gate; only mounted when the (unopened) manual-match dialog
// is shown, but it pulls in more hooks than this test needs to stub.
vi.mock('@/components/pending-outflows/ManualMatchDialog', () => ({
  ManualMatchDialog: () => null,
}));

import { PendingOutflowCard } from '@/components/pending-outflows/PendingOutflowCard';
import type { PendingOutflow } from '@/types/pending-outflows';

const baseOutflow: PendingOutflow = {
  id: 'outflow-1',
  restaurant_id: 'restaurant-1',
  vendor_name: 'Acme Produce',
  category_id: null,
  payment_method: 'check',
  amount: 125.5,
  issue_date: '2026-07-01',
  due_date: null,
  notes: null,
  reference_number: null,
  status: 'pending',
  linked_bank_transaction_id: null,
  cleared_at: null,
  voided_at: null,
  voided_reason: null,
  created_at: '2026-07-01T00:00:00.000Z',
  updated_at: '2026-07-01T00:00:00.000Z',
  chart_account: null,
};

const renderCard = (
  outflow: PendingOutflow = baseOutflow,
  onPrintCheck?: (outflow: PendingOutflow) => void,
) => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <PendingOutflowCard outflow={outflow} onPrintCheck={onPrintCheck} />
    </QueryClientProvider>,
  );
};

const findPrintButton = () => screen.queryByRole('button', { name: /^Print check for Acme Produce$/i });

describe('PendingOutflowCard — Print button capability gate (design §5.6)', () => {
  beforeEach(() => {
    hasCapabilityMock.mockReset();
    isResolvedMock = true;
  });

  it('hides the Print button when the capability context has not resolved yet, even if capability would be granted', () => {
    isResolvedMock = false;
    hasCapabilityMock.mockReturnValue(true);

    renderCard(baseOutflow, vi.fn());

    expect(findPrintButton()).not.toBeInTheDocument();
  });

  it('hides the Print button once resolved when the user lacks edit:pending_outflows', () => {
    isResolvedMock = true;
    hasCapabilityMock.mockReturnValue(false);

    renderCard(baseOutflow, vi.fn());

    expect(findPrintButton()).not.toBeInTheDocument();
    expect(hasCapabilityMock).toHaveBeenCalledWith('edit:pending_outflows');
  });

  it('shows the Print button once resolved when the user has edit:pending_outflows', () => {
    isResolvedMock = true;
    hasCapabilityMock.mockReturnValue(true);

    renderCard(baseOutflow, vi.fn());

    expect(findPrintButton()).toBeInTheDocument();
  });

  it('hides the Print button when no onPrintCheck is passed, even with capability granted', () => {
    isResolvedMock = true;
    hasCapabilityMock.mockReturnValue(true);

    renderCard(baseOutflow, undefined);

    expect(findPrintButton()).not.toBeInTheDocument();
  });
});
