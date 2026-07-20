import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const approverCountMock = vi.hoisted(() => vi.fn());
const notificationSettingsMock = vi.hoisted(() => vi.fn());

vi.mock('@/hooks/useApproverCount', () => ({
  useApproverCount: approverCountMock,
}));

vi.mock('@/hooks/useNotificationSettings', () => ({
  useNotificationSettings: notificationSettingsMock,
  useUpdateNotificationSettings: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock('@/hooks/useNotificationPreferences', () => ({
  useNotificationPreferences: () => ({
    preferences: { weekly_brief_email: true },
    updatePreferences: vi.fn(),
    isUpdating: false,
  }),
}));

// Channel-matrix hook stub, keyed by restaurantId so tests can assert the
// matrix shows the right restaurant's data after a restaurantId change. The
// matrix now renders directly from `settings` (immediate optimistic save, no
// local edit state), so there is no sync effect to loop — a fresh object per
// call would be harmless, but keying it lets the restaurant-switch test below
// return distinct values per id.
const channelSettingsByRestaurant = vi.hoisted(() => ({
  'rest-1': {
    settings: new Map([['schedule_published', { email: true, push: false }]]),
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
    setChannel: vi.fn(),
    isSaving: false,
  },
  'rest-2': {
    settings: new Map([['schedule_published', { email: false, push: false }]]),
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
    setChannel: vi.fn(),
    isSaving: false,
  },
}));

vi.mock('@/hooks/useNotificationChannelSettings', () => ({
  useNotificationChannelSettings: (restaurantId: string) =>
    channelSettingsByRestaurant[restaurantId as keyof typeof channelSettingsByRestaurant] ??
    channelSettingsByRestaurant['rest-1'],
}));

import { NotificationSettings } from '@/components/NotificationSettings';

function renderWithClient(ui: React.ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>{ui}</QueryClientProvider>
  );
}

const baseSettings = {
  notify_time_off_request: true,
  notify_time_off_approved: true,
  notify_time_off_rejected: true,
  time_off_notify_managers: true,
  time_off_notify_employee: true,
};

describe('NotificationSettings approver warning', () => {
  beforeEach(() => {
    approverCountMock.mockReset();
    notificationSettingsMock.mockReset();
  });

  it('renders warning when notify_managers is on and approver count is 0', () => {
    notificationSettingsMock.mockReturnValue({
      settings: baseSettings,
      loading: false,
    });
    approverCountMock.mockReturnValue({ data: 0, isLoading: false });

    renderWithClient(<NotificationSettings restaurantId="rest-1" />);

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText('No approvers configured')).toBeInTheDocument();
  });

  it('hides warning when at least one approver exists', () => {
    notificationSettingsMock.mockReturnValue({
      settings: baseSettings,
      loading: false,
    });
    approverCountMock.mockReturnValue({ data: 2, isLoading: false });

    renderWithClient(<NotificationSettings restaurantId="rest-1" />);

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('hides warning when notify_managers is off even if approverCount is 0', () => {
    notificationSettingsMock.mockReturnValue({
      settings: { ...baseSettings, time_off_notify_managers: false },
      loading: false,
    });
    approverCountMock.mockReturnValue({ data: 0, isLoading: false });

    renderWithClient(<NotificationSettings restaurantId="rest-1" />);

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('hides warning while approverCount is still loading', () => {
    notificationSettingsMock.mockReturnValue({
      settings: baseSettings,
      loading: false,
    });
    approverCountMock.mockReturnValue({ data: undefined, isLoading: true });

    renderWithClient(<NotificationSettings restaurantId="rest-1" />);

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('hides warning when the approver count query errors (undefined count should not be treated as zero)', () => {
    notificationSettingsMock.mockReturnValue({
      settings: baseSettings,
      loading: false,
    });
    approverCountMock.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
    });

    renderWithClient(<NotificationSettings restaurantId="rest-1" />);

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('NotificationSettings channel matrix restaurant switching', () => {
  beforeEach(() => {
    approverCountMock.mockReset();
    notificationSettingsMock.mockReset();
    notificationSettingsMock.mockReturnValue({ settings: baseSettings, loading: false });
    approverCountMock.mockReturnValue({ data: 2, isLoading: false });
  });

  it('shows the new restaurant\'s channel settings (not the previous restaurant\'s stale values) when restaurantId changes', () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { rerender } = render(
      <QueryClientProvider client={client}>
        <NotificationSettings restaurantId="rest-1" />
      </QueryClientProvider>
    );

    // rest-1's schedule-published email switch is ON.
    expect(screen.getByRole('switch', { name: /schedule published — email/i })).toBeChecked();

    rerender(
      <QueryClientProvider client={client}>
        <NotificationSettings restaurantId="rest-2" />
      </QueryClientProvider>
    );

    // rest-2's schedule-published email switch is OFF — the matrix reads the
    // value straight from the hook, so a restaurantId change reflects the new
    // restaurant's settings immediately (never rest-1's stale ON value).
    expect(screen.getByRole('switch', { name: /schedule published — email/i })).not.toBeChecked();
  });
});
