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

const saveChangesMock = vi.fn().mockResolvedValue(undefined);
const refetchMock = vi.fn();

function mockHookReturn(overrides: Partial<ReturnType<typeof hookMock>> = {}) {
  hookMock.mockReturnValue({
    settings: allOnMap(),
    isLoading: false,
    isError: false,
    error: null,
    refetch: refetchMock,
    saveChanges: saveChangesMock,
    isSaving: false,
    ...overrides,
  });
}

describe('NotificationChannelMatrix', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    saveChangesMock.mockResolvedValue(undefined);
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

  it('renders every catalog type grouped into its own table, one row per type', () => {
    mockHookReturn();
    render(<NotificationChannelMatrix restaurantId="rest-1" />);

    const groups = new Set(NOTIFICATION_TYPES.map((t) => t.group));
    const tables = screen.getAllByRole('table');
    expect(tables).toHaveLength(groups.size);

    for (const type of NOTIFICATION_TYPES) {
      expect(screen.getByText(type.label)).toBeInTheDocument();
    }
  });

  it('renders a dash (no toggle) for a channel a type does not support', () => {
    mockHookReturn();
    render(<NotificationChannelMatrix restaurantId="rest-1" />);

    // time_off_requested is email-only per the catalog — its Push cell must
    // not expose a live switch.
    const timeOffRow = screen.getByText('Time off requested').closest('tr')!;
    expect(within(timeOffRow).queryByRole('switch', { name: /push/i })).not.toBeInTheDocument();
    expect(within(timeOffRow).getByRole('switch', { name: /email/i })).toBeInTheDocument();
  });

  it('toggling a switch and clicking Save calls saveChanges with only the changed row (diff-based)', async () => {
    mockHookReturn();
    render(<NotificationChannelMatrix restaurantId="rest-1" />);

    const shiftDeletedRow = screen.getByText('Shift deleted').closest('tr')!;
    const pushSwitch = within(shiftDeletedRow).getByRole('switch', { name: /push/i });
    fireEvent.click(pushSwitch);

    const saveButton = await screen.findByRole('button', { name: /^save$/i });
    fireEvent.click(saveButton);

    expect(saveChangesMock).toHaveBeenCalledTimes(1);
    const [passedMap] = saveChangesMock.mock.calls[0];
    expect(passedMap.get('shift_deleted')).toEqual({ email: true, push: false });
    // Everything else stays untouched in the payload the component builds.
    expect(passedMap.get('pin_reset')).toEqual({ email: true, push: true });
  });

  it('hasChanges (Save/Reset footer) is driven by value comparison, not toggle-count', () => {
    mockHookReturn();
    render(<NotificationChannelMatrix restaurantId="rest-1" />);

    // No footer until something actually differs from the server snapshot.
    expect(screen.queryByRole('button', { name: /^save$/i })).not.toBeInTheDocument();

    const shiftDeletedRow = screen.getByText('Shift deleted').closest('tr')!;
    const pushSwitch = within(shiftDeletedRow).getByRole('switch', { name: /push/i });

    fireEvent.click(pushSwitch);
    expect(screen.getByRole('button', { name: /^save$/i })).toBeInTheDocument();

    // Flip it back — value now matches the snapshot again, footer should hide.
    fireEvent.click(pushSwitch);
    expect(screen.queryByRole('button', { name: /^save$/i })).not.toBeInTheDocument();
  });

  it('Reset discards local edits back to the fetched snapshot', () => {
    mockHookReturn();
    render(<NotificationChannelMatrix restaurantId="rest-1" />);

    const shiftDeletedRow = screen.getByText('Shift deleted').closest('tr')!;
    const pushSwitch = within(shiftDeletedRow).getByRole('switch', { name: /push/i });
    fireEvent.click(pushSwitch);

    fireEvent.click(screen.getByRole('button', { name: /reset/i }));

    expect(screen.queryByRole('button', { name: /^save$/i })).not.toBeInTheDocument();
    expect(within(shiftDeletedRow).getByRole('switch', { name: /push/i })).toHaveAttribute(
      'data-state',
      'checked',
    );
  });
});
