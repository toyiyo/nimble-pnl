/**
 * Tests for manager cleanup UI in TradeApprovalQueue
 *
 * Covers:
 * (1) OpenTradeCard shows "Expired" badge + "Remove" button when `expired=true`
 * (2) OpenTradeCard hides remove UI when `expired=false`
 * (3) Partition: expired open trades render in Expired group with Remove button
 * (4) Partition: stale pending (ghost/expired) render with "Needs cleanup" Remove
 * (5) Bulk "Remove all expired" button is present when expired trades exist
 * (6) Confirm dialog discriminated union — single shows trade info, bulk shows count
 *
 * The component is rendered in isolation from Supabase / React Query by mocking
 * the hook calls.
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
import { useShiftTrades, useDeleteShiftTrade } from '@/hooks/useShiftTrades';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const NOW = new Date('2026-07-01T12:00:00.000Z');

/** Build a ShiftTrade fixture with sensible defaults */
function makeTrade(
  id: string,
  overrides: {
    status?: 'open' | 'pending_approval';
    startTime?: string;
    acceptedById?: string | null;
    acceptedByName?: string | null;
  } = {},
) {
  const {
    status = 'open',
    startTime = '2026-07-10T10:00:00.000Z', // future
    acceptedById = null,
    acceptedByName = null,
  } = overrides;

  return {
    id,
    restaurant_id: 'rest-1',
    offered_shift_id: `shift-${id}`,
    offered_by_employee_id: `emp-${id}`,
    requested_shift_id: null,
    target_employee_id: null,
    accepted_by_employee_id: acceptedById,
    status,
    reason: null,
    manager_note: null,
    reviewed_by: null,
    reviewed_at: null,
    created_at: '2026-06-01T10:00:00.000Z',
    updated_at: '2026-06-01T10:00:00.000Z',
    offered_shift: {
      id: `shift-${id}`,
      start_time: startTime,
      end_time: '2026-07-10T18:00:00.000Z',
      position: 'Server',
      break_duration: 0,
    },
    offered_by: {
      id: `emp-${id}`,
      name: `Employee ${id}`,
      email: null,
      position: 'Server',
    },
    accepted_by: acceptedById
      ? {
          id: acceptedById,
          name: acceptedByName ?? 'Accepter',
          email: null,
          position: 'Server',
        }
      : undefined,
  };
}

// Convenience: an expired open trade (shift in the past)
const EXPIRED_OPEN = makeTrade('exp-1', {
  status: 'open',
  startTime: '2026-06-01T08:00:00.000Z', // past relative to NOW
});

// Convenience: a live (non-expired) open trade
const ACTIVE_OPEN = makeTrade('act-1', {
  status: 'open',
  startTime: '2026-07-10T10:00:00.000Z', // future
});

// Ghost: pending_approval but accepted_by is null (deleted employee)
const GHOST_PENDING = makeTrade('ghost-1', {
  status: 'pending_approval',
  startTime: '2026-07-10T10:00:00.000Z',
  acceptedById: null,
});

// Expired pending: past shift + has accepted_by
const EXPIRED_PENDING = makeTrade('expp-1', {
  status: 'pending_approval',
  startTime: '2026-06-01T08:00:00.000Z', // past
  acceptedById: 'acc-1',
  acceptedByName: 'Alice',
});

// Normal pending: future + has accepted_by
const NORMAL_PENDING = makeTrade('norm-1', {
  status: 'pending_approval',
  startTime: '2026-07-10T10:00:00.000Z',
  acceptedById: 'acc-2',
  acceptedByName: 'Bob',
});

// ---------------------------------------------------------------------------
// Helper: set up hook mocks and render the component
// ---------------------------------------------------------------------------

function setup(
  openTrades: ReturnType<typeof makeTrade>[],
  pendingTrades: ReturnType<typeof makeTrade>[],
) {
  const mockUseShiftTrades = vi.mocked(useShiftTrades);
  const mockDeleteFn = vi.fn().mockResolvedValue(undefined);
  const mockUseDeleteShiftTrade = vi.mocked(useDeleteShiftTrade);

  mockUseDeleteShiftTrade.mockReturnValue({
    mutate: vi.fn(),
    mutateAsync: mockDeleteFn,
    isPending: false,
    isIdle: true,
    isSuccess: false,
    isError: false,
    error: null,
    data: undefined,
    variables: undefined,
    context: undefined,
    failureCount: 0,
    failureReason: null,
    status: 'idle',
    submittedAt: 0,
    reset: vi.fn(),
  } as unknown as ReturnType<typeof useDeleteShiftTrade>);

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

  return { mockDeleteFn };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TradeApprovalQueue — manager cleanup UI', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('OpenTradeCard with expired=true', () => {
    it('shows "Expired" badge when the offered shift is in the past', () => {
      setup([EXPIRED_OPEN], []);
      // Use getAllByText since the section header also says "Expired"
      const expiredElements = screen.getAllByText('Expired');
      // At least one should be a badge (inline-flex element), not the section header
      const hasBadge = expiredElements.some((el) =>
        el.tagName === 'DIV' || el.className.includes('inline-flex')
      );
      expect(hasBadge).toBe(true);
    });

    it('shows a Remove button for expired open trades', () => {
      setup([EXPIRED_OPEN], []);
      // There should be at least one remove button (trade card + bulk button)
      const removeButtons = screen.getAllByRole('button', { name: /remove/i });
      expect(removeButtons.length).toBeGreaterThanOrEqual(1);
      // At least one has text "Remove" (not "Remove all expired...")
      const singleRemoveBtn = removeButtons.find(
        (btn) => btn.textContent?.trim() === 'Remove',
      );
      expect(singleRemoveBtn).toBeDefined();
    });
  });

  describe('OpenTradeCard with expired=false', () => {
    it('does NOT show "Expired" badge for a future open trade', () => {
      setup([ACTIVE_OPEN], []);
      expect(screen.queryByText('Expired')).not.toBeInTheDocument();
    });

    it('does NOT show a Remove button for a non-expired open trade', () => {
      setup([ACTIVE_OPEN], []);
      expect(screen.queryByRole('button', { name: /remove/i })).not.toBeInTheDocument();
    });
  });

  describe('Partition — open trades into expired and active groups', () => {
    it('renders both expired and active trades when both exist', () => {
      setup([EXPIRED_OPEN, ACTIVE_OPEN], []);
      // Both employees are rendered
      expect(screen.getByText('Employee exp-1')).toBeInTheDocument();
      expect(screen.getByText('Employee act-1')).toBeInTheDocument();
    });

    it('only expired trade gets a per-row Remove button, not the active trade', () => {
      setup([EXPIRED_OPEN, ACTIVE_OPEN], []);
      const removeButtons = screen.getAllByRole('button', { name: /remove/i });
      // Buttons with text exactly "Remove" (the per-row ones, not "Remove all expired...")
      const perRowRemoveButtons = removeButtons.filter(
        (btn) => btn.textContent?.trim() === 'Remove',
      );
      // Only 1 per-row Remove button (for the expired trade)
      expect(perRowRemoveButtons).toHaveLength(1);
    });
  });

  describe('Stale pending trades — ghost and expired', () => {
    it('renders a Remove action for a ghost pending trade (null accepted_by)', () => {
      setup([], [GHOST_PENDING]);
      // At least one Remove button should exist (per-row or bulk)
      const removeButtons = screen.getAllByRole('button', { name: /remove/i });
      expect(removeButtons.length).toBeGreaterThanOrEqual(1);
      // Per-row Remove button (exact text "Remove")
      const perRowBtn = removeButtons.find((btn) => btn.textContent?.trim() === 'Remove');
      expect(perRowBtn).toBeDefined();
    });

    it('renders a Remove action for an expired pending trade', () => {
      setup([], [EXPIRED_PENDING]);
      const removeButtons = screen.getAllByRole('button', { name: /remove/i });
      const perRowBtn = removeButtons.find((btn) => btn.textContent?.trim() === 'Remove');
      expect(perRowBtn).toBeDefined();
    });

    it('does NOT render a Remove action for a normal pending trade', () => {
      setup([], [NORMAL_PENDING]);
      expect(screen.queryByRole('button', { name: /remove/i })).not.toBeInTheDocument();
    });

    it('partitions correctly: ghost removed from the approve/reject flow', () => {
      setup([], [GHOST_PENDING, NORMAL_PENDING]);
      // Normal pending trade shows Approve/Reject; ghost does not appear in that section
      const approveButtons = screen.getAllByRole('button', { name: /^approve/i });
      // Only NORMAL_PENDING gets an approve button (ghost is not in approvals list)
      expect(approveButtons).toHaveLength(1);
    });
  });

  describe('Bulk "Remove all expired" button', () => {
    it('shows "Remove all expired" button when expired trades exist', () => {
      setup([EXPIRED_OPEN], []);
      expect(
        screen.getByRole('button', { name: /remove all expired/i }),
      ).toBeInTheDocument();
    });

    it('does NOT show "Remove all expired" button when no expired trades exist', () => {
      setup([ACTIVE_OPEN], []);
      expect(
        screen.queryByRole('button', { name: /remove all expired/i }),
      ).not.toBeInTheDocument();
    });

    it('includes count in the bulk button label', () => {
      setup([EXPIRED_OPEN], [GHOST_PENDING]);
      const bulkBtn = screen.getByRole('button', { name: /remove all expired/i });
      expect(bulkBtn.textContent).toMatch(/\d+/);
    });
  });

  describe('Confirm dialog', () => {
    it('opens confirm dialog when per-row Remove is clicked for a single expired open trade', () => {
      setup([EXPIRED_OPEN], []);
      // Click the per-row "Remove" button (not the bulk "Remove all expired" button)
      const removeButtons = screen.getAllByRole('button', { name: /remove/i });
      const perRowBtn = removeButtons.find((btn) => btn.textContent?.trim() === 'Remove');
      expect(perRowBtn).toBeDefined();
      fireEvent.click(perRowBtn!);
      // Dialog should appear — look for the dialog's confirm "Remove" button inside a dialog
      // The dialog title contains "stale trade" text
      expect(screen.getByText(/remove stale trade/i)).toBeInTheDocument();
    });

    it('dialog shows the trade poster when single remove is triggered', () => {
      setup([EXPIRED_OPEN], []);
      const removeButtons = screen.getAllByRole('button', { name: /remove/i });
      const perRowBtn = removeButtons.find((btn) => btn.textContent?.trim() === 'Remove');
      fireEvent.click(perRowBtn!);
      // Should display "Posted by: Employee exp-1" in the dialog
      expect(screen.getByText(/Posted by:/i)).toBeInTheDocument();
    });

    it('bulk confirm dialog shows a count in the title', () => {
      setup([EXPIRED_OPEN], []);
      fireEvent.click(screen.getByRole('button', { name: /remove all expired/i }));
      // The dialog title should mention "1 stale trade" or similar
      expect(screen.getByText(/remove 1 stale trade/i)).toBeInTheDocument();
    });
  });
});
