import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { NOTIFICATION_TYPES } from '@/lib/notificationTypes';

const hookMock = vi.hoisted(() => vi.fn());

vi.mock('@/hooks/useNotificationChannelSettings', () => ({
  useNotificationChannelSettings: hookMock,
}));

import { NotificationChannelMatrix } from '@/components/NotificationChannelMatrix';

function allOnMap() {
  const map = new Map<string, { email: boolean; push: boolean }>();
  for (const type of NOTIFICATION_TYPES) {
    map.set(type.key, { email: true, push: true });
  }
  return map;
}

const setChannelMock = vi.fn();
const refetchMock = vi.fn();

function mockHookReturn(overrides: Partial<ReturnType<typeof hookMock>> = {}) {
  hookMock.mockReturnValue({
    settings: allOnMap(),
    isLoading: false,
    isError: false,
    error: null,
    refetch: refetchMock,
    setChannel: setChannelMock,
    isSaving: false,
    ...overrides,
  });
}

describe('NotificationChannelMatrix', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows a loading skeleton while the query is in flight (never a silent all-ON table)', () => {
    mockHookReturn({ isLoading: true, settings: new Map() });
    render(<NotificationChannelMatrix restaurantId="rest-1" />);

    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.getByLabelText(/loading notification channel settings/i)).toBeInTheDocument();
  });

  it('shows a retry banner on error, not a silent all-ON table', () => {
    mockHookReturn({ isError: true, error: new Error('boom') });
    render(<NotificationChannelMatrix restaurantId="rest-1" />);

    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(refetchMock).toHaveBeenCalledTimes(1);
  });

  it('renders a single aligned table with visible Email and Push column headers', () => {
    mockHookReturn();
    render(<NotificationChannelMatrix restaurantId="rest-1" />);

    // One table for all groups (so the toggle columns line up across sections),
    // not one table per group.
    expect(screen.getAllByRole('table')).toHaveLength(1);

    // The channel columns are labelled visibly (not sr-only) so an admin knows
    // which toggle turns on which delivery method.
    expect(screen.getByRole('columnheader', { name: /notification/i })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: /email/i })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: /push/i })).toBeInTheDocument();
  });

  it('renders a labelled section header for every catalog group, and one row per type', () => {
    mockHookReturn();
    render(<NotificationChannelMatrix restaurantId="rest-1" />);

    const groups = new Set(NOTIFICATION_TYPES.map((t) => t.group));
    for (const group of groups) {
      // Group headers span the row as a colgroup <th>.
      expect(
        screen.getByRole('columnheader', { name: new RegExp(`^${group}$`, 'i') }),
      ).toBeInTheDocument();
    }

    for (const type of NOTIFICATION_TYPES) {
      expect(screen.getByRole('rowheader', { name: type.label })).toBeInTheDocument();
    }
  });

  it('renders a dash (no toggle) for a channel a type does not support', () => {
    mockHookReturn();
    render(<NotificationChannelMatrix restaurantId="rest-1" />);

    // time_off_requested is email-only per the catalog — its Push cell must
    // not expose a live switch.
    const timeOffRow = screen.getByRole('rowheader', { name: 'Time off requested' }).closest('tr')!;
    expect(within(timeOffRow).queryByRole('switch', { name: /push/i })).not.toBeInTheDocument();
    expect(within(timeOffRow).getByRole('switch', { name: /email/i })).toBeInTheDocument();
  });

  it('toggling a switch saves that one channel immediately — no Save button in the UI', () => {
    mockHookReturn();
    render(<NotificationChannelMatrix restaurantId="rest-1" />);

    // Immediate-save: there is no Save/Reset footer to click.
    expect(screen.queryByRole('button', { name: /^save$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /reset/i })).not.toBeInTheDocument();

    const shiftDeletedRow = screen.getByRole('rowheader', { name: 'Shift deleted' }).closest('tr')!;
    const pushSwitch = within(shiftDeletedRow).getByRole('switch', { name: /push/i });
    fireEvent.click(pushSwitch);

    // Currently ON → the flip persists just this (type, channel) as OFF.
    expect(setChannelMock).toHaveBeenCalledTimes(1);
    expect(setChannelMock).toHaveBeenCalledWith('shift_deleted', 'push', false);
  });

  it('reflects the value straight from the hook (no local edit state to drift)', () => {
    const map = allOnMap();
    map.set('shift_deleted', { email: true, push: false });
    mockHookReturn({ settings: map });
    render(<NotificationChannelMatrix restaurantId="rest-1" />);

    const shiftDeletedRow = screen.getByRole('rowheader', { name: 'Shift deleted' }).closest('tr')!;
    expect(within(shiftDeletedRow).getByRole('switch', { name: /push/i })).toHaveAttribute(
      'data-state',
      'unchecked',
    );
    expect(within(shiftDeletedRow).getByRole('switch', { name: /email/i })).toHaveAttribute(
      'data-state',
      'checked',
    );
  });

  it('disables the toggles while a save is in flight', () => {
    mockHookReturn({ isSaving: true });
    render(<NotificationChannelMatrix restaurantId="rest-1" />);

    const shiftDeletedRow = screen.getByRole('rowheader', { name: 'Shift deleted' }).closest('tr')!;
    expect(within(shiftDeletedRow).getByRole('switch', { name: /push/i })).toBeDisabled();
  });
});
