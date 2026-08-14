/**
 * Tests for the tentative-draft badge in TradeApprovalQueue.
 *
 * A pending trade whose offered shift is still a draft (`is_published ===
 * false`) shows the "Tentative — draft" badge on its card in the approval
 * queue. A trade for a published shift shows no badge.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Hoisted mocks — must appear before any import that uses them
// ---------------------------------------------------------------------------

vi.mock('@/hooks/useShiftTrades', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/useShiftTrades')>();
  return {
    ...actual,
    useShiftTrades: vi.fn(),
    useApproveShiftTrade: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
    useRejectShiftTrade: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
    useDeleteShiftTrade: vi.fn(() => ({ mutate: vi.fn(), mutateAsync: vi.fn().mockResolvedValue(undefined), isPending: false })),
  };
});

vi.mock('@/hooks/useOpenShiftClaims', () => ({
  useOpenShiftClaims: vi.fn(() => ({ claims: [], loading: false })),
  useApproveClaimMutation: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useRejectClaimMutation: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
}));

vi.mock('@/contexts/RestaurantContext', () => ({
  useRestaurantContext: vi.fn(() => ({
    selectedRestaurant: { restaurant_id: 'rest-1' },
  })),
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'mgr-1' } } }) },
  },
}));

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

// ---------------------------------------------------------------------------
// Imports — after vi.mock calls so mocks take effect
// ---------------------------------------------------------------------------

import { TradeApprovalQueue } from '@/components/schedule/TradeApprovalQueue';
import { useShiftTrades } from '@/hooks/useShiftTrades';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const NOW = new Date('2026-07-01T12:00:00.000Z');

/** A normal pending trade (future shift, has accepted_by) awaiting approval. */
function makePendingTrade(isPublished: boolean) {
  return {
    id: 'trade-1',
    restaurant_id: 'rest-1',
    offered_shift_id: 'shift-1',
    offered_by_employee_id: 'emp-1',
    requested_shift_id: null,
    target_employee_id: null,
    accepted_by_employee_id: 'acc-1',
    status: 'pending_approval' as const,
    reason: null,
    manager_note: null,
    reviewed_by: null,
    reviewed_at: null,
    created_at: '2026-06-01T10:00:00.000Z',
    updated_at: '2026-06-01T10:00:00.000Z',
    offered_shift: {
      id: 'shift-1',
      start_time: '2026-07-10T10:00:00.000Z', // future relative to NOW
      end_time: '2026-07-10T18:00:00.000Z',
      position: 'Server',
      break_duration: 0,
      is_published: isPublished,
    },
    offered_by: {
      id: 'emp-1',
      name: 'Employee One',
      email: null,
      position: 'Server',
    },
    accepted_by: {
      id: 'acc-1',
      name: 'Accepter One',
      email: null,
      position: 'Server',
    },
  };
}

/** An open trade posted to the marketplace (no accepted_by yet). */
function makeOpenTrade(isPublished: boolean) {
  return {
    id: 'trade-open-1',
    restaurant_id: 'rest-1',
    offered_shift_id: 'shift-open-1',
    offered_by_employee_id: 'emp-2',
    requested_shift_id: null,
    target_employee_id: null,
    accepted_by_employee_id: null,
    status: 'open' as const,
    reason: null,
    manager_note: null,
    reviewed_by: null,
    reviewed_at: null,
    created_at: '2026-06-01T10:00:00.000Z',
    updated_at: '2026-06-01T10:00:00.000Z',
    offered_shift: {
      id: 'shift-open-1',
      start_time: '2026-07-10T10:00:00.000Z', // future relative to NOW
      end_time: '2026-07-10T18:00:00.000Z',
      position: 'Server',
      break_duration: 0,
      is_published: isPublished,
    },
    offered_by: {
      id: 'emp-2',
      name: 'Employee Two',
      email: null,
      position: 'Server',
    },
    accepted_by: undefined,
  };
}

/** A stale pending trade whose accepter no longer exists (ghost row). */
function makeGhostPendingTrade(isPublished: boolean) {
  return {
    id: 'trade-ghost-1',
    restaurant_id: 'rest-1',
    offered_shift_id: 'shift-ghost-1',
    offered_by_employee_id: 'emp-3',
    requested_shift_id: null,
    target_employee_id: null,
    accepted_by_employee_id: null,
    status: 'pending_approval' as const,
    reason: null,
    manager_note: null,
    reviewed_by: null,
    reviewed_at: null,
    created_at: '2026-06-01T10:00:00.000Z',
    updated_at: '2026-06-01T10:00:00.000Z',
    offered_shift: {
      id: 'shift-ghost-1',
      start_time: '2026-07-10T10:00:00.000Z', // future relative to NOW
      end_time: '2026-07-10T18:00:00.000Z',
      position: 'Server',
      break_duration: 0,
      is_published: isPublished,
    },
    offered_by: {
      id: 'emp-3',
      name: 'Employee Three',
      email: null,
      position: 'Server',
    },
    accepted_by: undefined,
  };
}

// ---------------------------------------------------------------------------
// Helper: set up hook mocks and render the component
// ---------------------------------------------------------------------------

function setup(
  pendingTrades: ReturnType<typeof makePendingTrade>[],
  openTrades: (ReturnType<typeof makeOpenTrade> | ReturnType<typeof makeGhostPendingTrade>)[] = [],
) {
  const mockUseShiftTrades = vi.mocked(useShiftTrades);

  // useShiftTrades is called twice in TradeApprovalQueue:
  //   1st call: pendingTrades (status='pending_approval')
  //   2nd call: openTrades (status='open')
  let callCount = 0;
  mockUseShiftTrades.mockImplementation(() => {
    callCount += 1;
    if (callCount === 1) {
      return { trades: pendingTrades, loading: false, error: null };
    }
    return { trades: openTrades, loading: false, error: null };
  });

  render(<TradeApprovalQueue now={NOW} />);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TradeApprovalQueue — tentative draft badge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows the tentative-draft badge on a pending trade for a draft shift', () => {
    setup([makePendingTrade(false)]);
    expect(screen.getByText('Tentative — draft')).toBeInTheDocument();
  });

  it('hides the tentative-draft badge on a pending trade for a published shift', () => {
    setup([makePendingTrade(true)]);
    expect(screen.queryByText('Tentative — draft')).not.toBeInTheDocument();
  });

  it('shows the tentative-draft badge in the approve/reject dialog for a draft shift', () => {
    setup([makePendingTrade(false)]);
    fireEvent.click(screen.getByRole('button', { name: /^approve/i }));

    const badgesInDialog = screen
      .getAllByText('Tentative — draft')
      .filter((el) => el.closest('[role="dialog"]'));
    expect(badgesInDialog).toHaveLength(1);
  });

  it('shows the tentative-draft badge on an active open trade for a draft shift', () => {
    setup([], [makeOpenTrade(false)]);
    expect(screen.getByText('Tentative — draft')).toBeInTheDocument();
  });

  it('hides the tentative-draft badge on an active open trade for a published shift', () => {
    setup([], [makeOpenTrade(true)]);
    expect(screen.queryByText('Tentative — draft')).not.toBeInTheDocument();
  });

  it('shows the tentative-draft badge on a stale (ghost) pending trade row', () => {
    setup([makeGhostPendingTrade(false)], []);
    expect(screen.getByText('Tentative — draft')).toBeInTheDocument();
  });

  it('shows the tentative-draft badge in the cleanup-confirm dialog for a draft shift', () => {
    setup([makeGhostPendingTrade(false)], []);
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));

    const badgesInDialog = screen
      .getAllByText('Tentative — draft')
      .filter((el) => el.closest('[role="dialog"]'));
    expect(badgesInDialog).toHaveLength(1);
  });
});
