/**
 * Tests for the "will be notified" banner in the open-shift-claim
 * approve/reject confirm dialog (TradeApprovalQueue.tsx).
 *
 * Regression coverage for T7S2 (design: docs/superpowers/specs/2026-07-20-open-shift-claim-notify-design.md):
 * the banner must render for BOTH approve and reject actions, since the
 * claimant is now notified on either decision.
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
    useShiftTrades: vi.fn(() => ({ trades: [], loading: false, error: null })),
    useApproveShiftTrade: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
    useRejectShiftTrade: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
    useDeleteShiftTrade: vi.fn(() => ({ mutate: vi.fn(), mutateAsync: vi.fn().mockResolvedValue(undefined), isPending: false })),
  };
});

const CLAIM = {
  id: 'claim-1',
  restaurant_id: 'rest-1',
  shift_template_id: 'tmpl-1',
  shift_date: '2026-07-25',
  claimed_by_employee_id: 'emp-1',
  status: 'pending_approval' as const,
  resulting_shift_id: null,
  reviewed_by: null,
  reviewed_at: null,
  created_at: '2026-07-01T10:00:00.000Z',
  updated_at: '2026-07-01T10:00:00.000Z',
  shift_template: {
    name: 'Morning Shift',
    start_time: '09:00',
    end_time: '17:00',
    position: 'Server',
  },
  employee: { name: 'Jamie Doe', position: 'Server' },
};

vi.mock('@/hooks/useOpenShiftClaims', () => ({
  useOpenShiftClaims: vi.fn(() => ({ claims: [CLAIM], loading: false })),
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

const NOW = new Date('2026-07-01T12:00:00.000Z');

const BANNER_TEXT = /the employee will be notified of your decision/i;

describe('TradeApprovalQueue — claim decision "will be notified" banner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows the "will be notified" banner when approving a claim', () => {
    render(<TradeApprovalQueue now={NOW} />);
    fireEvent.click(screen.getByRole('button', { name: /^approve$/i }));
    expect(screen.getByText(BANNER_TEXT)).toBeInTheDocument();
  });

  it('shows the "will be notified" banner when rejecting a claim', () => {
    render(<TradeApprovalQueue now={NOW} />);
    fireEvent.click(screen.getByRole('button', { name: /^reject$/i }));
    expect(screen.getByText(BANNER_TEXT)).toBeInTheDocument();
  });
});
