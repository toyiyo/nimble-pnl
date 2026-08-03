import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Capability gate under test (design §3.4): `PrintCheckButton` renders only
// when `isResolved && hasCapability('edit:pending_outflows')`.
const hasCapabilityMock = vi.fn();
let isResolvedMock = true;
vi.mock('@/hooks/usePermissions', () => ({
  usePermissions: () => ({
    hasCapability: hasCapabilityMock,
    isResolved: isResolvedMock,
  }),
}));

// Isolate the render-site gate from PrintCheckButton's own hooks/dialog.
vi.mock('@/components/pending-outflows/PrintCheckButton', () => ({
  PrintCheckButton: () => <button data-testid="print-check-button">Print check</button>,
}));

vi.mock('@/contexts/RestaurantContext', () => ({
  useRestaurantContext: () => ({ selectedRestaurant: { id: 'restaurant-1' } }),
}));

vi.mock('@/hooks/usePendingOutflows', () => ({
  usePendingOutflowMutations: () => ({
    voidPendingOutflow: { mutate: vi.fn() },
    deletePendingOutflow: { mutate: vi.fn() },
  }),
  usePendingOutflowMatches: () => ({ data: [] }),
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

const renderCard = (outflow: PendingOutflow = baseOutflow) => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <PendingOutflowCard outflow={outflow} />
    </QueryClientProvider>,
  );
};

describe('PendingOutflowCard — PrintCheckButton capability gate (design §3.4)', () => {
  beforeEach(() => {
    hasCapabilityMock.mockReset();
    isResolvedMock = true;
  });

  it('hides PrintCheckButton when the capability context has not resolved yet, even if capability would be granted', () => {
    isResolvedMock = false;
    hasCapabilityMock.mockReturnValue(true);

    renderCard();

    expect(screen.queryByTestId('print-check-button')).not.toBeInTheDocument();
  });

  it('hides PrintCheckButton once resolved when the user lacks edit:pending_outflows', () => {
    isResolvedMock = true;
    hasCapabilityMock.mockReturnValue(false);

    renderCard();

    expect(screen.queryByTestId('print-check-button')).not.toBeInTheDocument();
    expect(hasCapabilityMock).toHaveBeenCalledWith('edit:pending_outflows');
  });

  it('shows PrintCheckButton once resolved when the user has edit:pending_outflows', () => {
    isResolvedMock = true;
    hasCapabilityMock.mockReturnValue(true);

    renderCard();

    expect(screen.getByTestId('print-check-button')).toBeInTheDocument();
  });
});
