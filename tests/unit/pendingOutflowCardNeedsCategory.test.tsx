import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Needs-category badge on a cleared match (plan task 6): the cleared branch
// shows a "Needs category" badge beside the cleared date when the outflow
// has no category_id.
vi.mock('@/hooks/usePermissions', () => ({
  usePermissions: () => ({
    hasCapability: vi.fn().mockReturnValue(true),
    isResolved: true,
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
    unlinkMatch: { mutate: vi.fn(), isPending: false, variables: undefined },
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
  category_id: null,
  payment_method: 'check',
  amount: 125.5,
  issue_date: '2026-07-01',
  due_date: null,
  notes: null,
  reference_number: null,
  status: 'cleared',
  linked_bank_transaction_id: 'bank-txn-1',
  cleared_at: '2026-07-10T00:00:00.000Z',
  auto_linked_at: null,
  auto_link_suppressed_at: null,
  voided_at: null,
  voided_reason: null,
  created_at: '2026-07-01T00:00:00.000Z',
  updated_at: '2026-07-01T00:00:00.000Z',
  chart_account: null,
};

const renderCard = (outflow: PendingOutflow) => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <PendingOutflowCard outflow={outflow} />
    </QueryClientProvider>,
  );
};

describe('PendingOutflowCard — needs-category badge on a cleared match (plan task 6)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows the badge on a cleared no-category outflow', () => {
    renderCard(baseClearedOutflow);

    expect(screen.getByText('Needs category')).toBeInTheDocument();
  });

  it('hides the badge on a cleared categorized outflow', () => {
    renderCard({ ...baseClearedOutflow, category_id: 'category-1' });

    expect(screen.queryByText('Needs category')).not.toBeInTheDocument();
  });
});
