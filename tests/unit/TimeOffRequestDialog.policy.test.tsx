/**
 * Unit tests: the Shift Protection branches of TimeOffRequestDialog.
 *
 * Contracts pinned here:
 * - warn mode shows the notice finding with the "you can still submit"
 *   line and keeps the submit enabled.
 * - block mode (non-exempt caller) disables the submit and links it to
 *   the panel with aria-describedby.
 * - the same-day count line renders when the limit is hit.
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  SHIFT_PROTECTION_DEFAULTS,
  type ShiftProtectionSettings,
} from '@/lib/shiftProtection';
import type { TimeOffRequest } from '@/types/scheduling';

const policyState = vi.hoisted(() => ({
  protection: {} as Partial<ShiftProtectionSettings>,
  dayCounts: [] as { day: string; approved_count: number }[],
}));

vi.mock('@/hooks/useShiftProtection', () => ({
  shiftProtectionQueryKey: (id: string | null) => ['shift-protection', id],
  useShiftProtection: () => ({
    protection: { ...SHIFT_PROTECTION_DEFAULTS, ...policyState.protection },
    isLoading: false,
    error: null,
  }),
  useInvalidateShiftProtection: () => () => {},
  useTimeoffDayCounts: () => ({
    data: policyState.dayCounts,
    isLoading: false,
    error: null,
  }),
  useTimeoffCoverageImpact: () => ({ data: null, isLoading: false, error: null }),
}));

vi.mock('@/hooks/usePermissions', () => ({
  usePermissions: () => ({ hasCapability: () => false, isResolved: true }),
}));

vi.mock('@/contexts/RestaurantContext', () => ({
  useRestaurantContext: () => ({
    selectedRestaurant: { restaurant_id: 'rest-1', restaurant: { id: 'rest-1', timezone: 'UTC' } },
  }),
}));

vi.mock('@/hooks/useTimeOffRequests', () => ({
  useCreateTimeOffRequest: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateTimeOffRequest: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock('@/hooks/useEmployees', () => ({
  useEmployees: () => ({
    employees: [{ id: 'emp-1', name: 'Riley Server', position: 'Server', is_active: true }],
    loading: false,
    error: null,
  }),
}));

import { TimeOffRequestDialog } from '@/components/TimeOffRequestDialog';

const dateOnly = (daysFromNow: number): string => {
  const d = new Date(Date.now() + daysFromNow * 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
};

const makeRequest = (daysFromNow: number): TimeOffRequest => ({
  id: 'req-1',
  restaurant_id: 'rest-1',
  employee_id: 'emp-1',
  start_date: dateOnly(daysFromNow),
  end_date: dateOnly(daysFromNow),
  status: 'pending',
  requested_at: new Date().toISOString(),
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
});

const renderDialog = (request: TimeOffRequest) =>
  render(
    <TimeOffRequestDialog
      open={true}
      onOpenChange={vi.fn()}
      restaurantId="rest-1"
      request={request}
    />
  );

beforeEach(() => {
  policyState.protection = {};
  policyState.dayCounts = [];
});

describe('TimeOffRequestDialog — Shift Protection branches', () => {
  it('warn mode shows the notice finding and keeps the submit enabled', () => {
    policyState.protection = { timeoff_notice_mode: 'warn', timeoff_notice_days: 7 };
    renderDialog(makeRequest(2));

    const panel = screen.getByRole('status');
    expect(panel).toHaveTextContent('7 days of notice');
    expect(panel).toHaveTextContent('You can still submit.');
    expect(screen.getByRole('button', { name: 'Update Request' })).toBeEnabled();
  });

  it('block mode disables the submit and links the reason', () => {
    policyState.protection = { timeoff_notice_mode: 'block', timeoff_notice_days: 7 };
    renderDialog(makeRequest(2));

    const submit = screen.getByRole('button', { name: 'Update Request' });
    expect(submit).toBeDisabled();
    expect(submit).toHaveAttribute('aria-describedby', 'time-off-policy-warning');
    expect(screen.getByRole('status')).toHaveTextContent(
      'A shift protection rule blocks this request.'
    );
  });

  it('shows the same-day count line at the limit', () => {
    policyState.protection = { timeoff_sameday_mode: 'warn', timeoff_sameday_limit: 2 };
    policyState.dayCounts = [{ day: dateOnly(30), approved_count: 2 }];
    renderDialog(makeRequest(30));

    expect(screen.getByRole('status')).toHaveTextContent(
      '2 coworkers with the same position already have approved time off'
    );
    expect(screen.getByRole('button', { name: 'Update Request' })).toBeEnabled();
  });

  it('renders no panel when every rule is off', () => {
    renderDialog(makeRequest(2));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
