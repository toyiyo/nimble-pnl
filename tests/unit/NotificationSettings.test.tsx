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

    expect(screen.getByText('No approvers configured')).toBeInTheDocument();
  });

  it('hides warning when at least one approver exists', () => {
    notificationSettingsMock.mockReturnValue({
      settings: baseSettings,
      loading: false,
    });
    approverCountMock.mockReturnValue({ data: 2, isLoading: false });

    renderWithClient(<NotificationSettings restaurantId="rest-1" />);

    expect(screen.queryByText('No approvers configured')).not.toBeInTheDocument();
  });

  it('hides warning when notify_managers is off even if approverCount is 0', () => {
    notificationSettingsMock.mockReturnValue({
      settings: { ...baseSettings, time_off_notify_managers: false },
      loading: false,
    });
    approverCountMock.mockReturnValue({ data: 0, isLoading: false });

    renderWithClient(<NotificationSettings restaurantId="rest-1" />);

    expect(screen.queryByText('No approvers configured')).not.toBeInTheDocument();
  });

  it('hides warning while approverCount is still loading', () => {
    notificationSettingsMock.mockReturnValue({
      settings: baseSettings,
      loading: false,
    });
    approverCountMock.mockReturnValue({ data: undefined, isLoading: true });

    renderWithClient(<NotificationSettings restaurantId="rest-1" />);

    expect(screen.queryByText('No approvers configured')).not.toBeInTheDocument();
  });
});
