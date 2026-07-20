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

// Returns a referentially-STABLE object (computed once, not re-created per
// call). NotificationChannelMatrix's sync-guard effect depends on `[settings]`
// by reference — a mock that returns a fresh `{ settings: new Map(), ... }`
// literal on every render would make that dependency "change" every render,
// spinning the component into an infinite render loop (setLocal -> re-render
// -> new settings reference -> effect fires -> setLocal -> ...).
const channelSettingsMock = vi.hoisted(() => ({
  settings: new Map(),
  isLoading: false,
  isError: false,
  error: null,
  refetch: vi.fn(),
  saveChanges: vi.fn(),
  isSaving: false,
}));

vi.mock('@/hooks/useNotificationChannelSettings', () => ({
  useNotificationChannelSettings: () => channelSettingsMock,
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
