import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Undo match on a cleared card (plan task 8): the cleared branch shows an
// "Undo match" button gated by edit:pending_outflows, and an "Auto-matched"
// badge when auto_linked_at is set.
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

const unlinkMatchMutate = vi.fn();
let unlinkMatchIsPending = false;
let unlinkMatchVariables: string | undefined;

vi.mock('@/hooks/usePendingOutflows', () => ({
  usePendingOutflowMutations: () => ({
    voidPendingOutflow: { mutate: vi.fn() },
    deletePendingOutflow: { mutate: vi.fn() },
    updatePendingOutflow: { mutateAsync: vi.fn() },
    unlinkMatch: {
      mutate: unlinkMatchMutate,
      isPending: unlinkMatchIsPending,
      variables: unlinkMatchVariables,
    },
  }),
  usePendingOutflowMatches: () => ({ data: [] }),
}));

vi.mock('@/components/pending-outflows/ManualMatchDialog', () => ({
  ManualMatchDialog: () => null,
}));

import { PendingOutflowCard } from '@/components/pending-outflows/PendingOutflowCard';
import type { PendingOutflow } from '@/types/pending-outflows';

const baseClearedOutflow: PendingOutflow = {
  id: 'outflow-1',
  restaurant_id: 'restaurant-1',
  vendor_name: 'Acme Produce',
  category_id: 'category-1',
  payment_method: 'check',
  amount: 125.5,
  issue_date: '2026-07-01',
  due_date: null,
  notes: null,
  reference_number: null,
  status: 'cleared',
  linked_bank_transaction_id: 'bank-txn-1',
  cleared_at: '2026-07-10T00:00:00.000Z',
  voided_at: null,
  voided_reason: null,
  auto_linked_at: null,
  auto_link_suppressed_at: null,
  created_at: '2026-07-01T00:00:00.000Z',
  updated_at: '2026-07-01T00:00:00.000Z',
  chart_account: null,
};

const renderCard = (outflow: PendingOutflow, onEdit?: (outflow: PendingOutflow) => void) => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <PendingOutflowCard outflow={outflow} onEdit={onEdit} />
    </QueryClientProvider>,
  );
};

const findUndoButton = () => screen.queryByRole('button', { name: /undo match/i });

describe('PendingOutflowCard — undo match on a cleared outflow (plan task 8)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hasCapabilityMock.mockReturnValue(true);
    isResolvedMock = true;
    unlinkMatchIsPending = false;
    unlinkMatchVariables = undefined;
  });

  it('shows the Undo match button once resolved when the user has edit:pending_outflows', () => {
    renderCard(baseClearedOutflow);

    expect(findUndoButton()).toBeInTheDocument();
  });

  it('hides the Undo match button when the capability context has not resolved yet', () => {
    isResolvedMock = false;

    renderCard(baseClearedOutflow);

    expect(findUndoButton()).not.toBeInTheDocument();
  });

  it('hides the Undo match button when the user lacks edit:pending_outflows', () => {
    hasCapabilityMock.mockReturnValue(false);

    renderCard(baseClearedOutflow);

    expect(findUndoButton()).not.toBeInTheDocument();
    expect(hasCapabilityMock).toHaveBeenCalledWith('edit:pending_outflows');
  });

  it('calls unlinkMatch.mutate with the outflow id and does not trigger onEdit', async () => {
    const user = userEvent.setup();
    const onEdit = vi.fn();

    renderCard(baseClearedOutflow, onEdit);

    await user.click(findUndoButton()!);

    expect(unlinkMatchMutate).toHaveBeenCalledWith('outflow-1');
    expect(onEdit).not.toHaveBeenCalled();
  });

  it('disables the button while unlinkMatch is pending for this outflow', () => {
    unlinkMatchIsPending = true;
    unlinkMatchVariables = 'outflow-1';

    renderCard(baseClearedOutflow);

    expect(findUndoButton()).toBeDisabled();
  });

  it('does not disable the button when a different outflow is pending', () => {
    unlinkMatchIsPending = true;
    unlinkMatchVariables = 'some-other-outflow';

    renderCard(baseClearedOutflow);

    expect(findUndoButton()).not.toBeDisabled();
  });

  it('shows the Auto-matched badge when auto_linked_at is set', () => {
    renderCard({ ...baseClearedOutflow, auto_linked_at: '2026-07-10T00:00:00.000Z' });

    expect(screen.getByText('Auto-matched')).toBeInTheDocument();
  });

  it('hides the Auto-matched badge when auto_linked_at is null', () => {
    renderCard(baseClearedOutflow);

    expect(screen.queryByText('Auto-matched')).not.toBeInTheDocument();
  });
});
