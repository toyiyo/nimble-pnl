import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const availabilityRow = {
  id: 'a1',
  restaurant_id: 'rest-1',
  employee_id: 'emp-1',
  day_of_week: 1,
  start_time: '14:00:00', // legacy UTC, would show 09:00 in New York
  end_time: '22:00:00',
  start_time_local: '10:00:00',
  end_time_local: '18:00:00',
  is_available: true,
  created_at: '',
  updated_at: '',
};

vi.mock('@/contexts/RestaurantContext', () => ({
  useRestaurantContext: () => ({
    selectedRestaurant: { restaurant_id: 'rest-1', restaurant: { timezone: 'America/New_York' } },
  }),
}));
vi.mock('@/hooks/useCurrentEmployee', () => ({
  useCurrentEmployee: () => ({ currentEmployee: { id: 'emp-1', name: 'Jo' }, loading: false }),
}));
vi.mock('@/hooks/useTimeOffRequests', () => ({
  useTimeOffRequests: () => ({ timeOffRequests: [], loading: false }),
  useDeleteTimeOffRequest: () => ({ mutate: vi.fn() }),
}));
vi.mock('@/hooks/useAvailability', () => ({
  useEmployeeAvailability: () => ({ availability: [availabilityRow], loading: false }),
  useAvailabilityExceptions: () => ({ exceptions: [], loading: false }),
}));
vi.mock('@/components/TimeOffRequestDialog', () => ({ TimeOffRequestDialog: () => null }));
vi.mock('@/components/AvailabilityDialog', () => ({ AvailabilityDialog: () => null }));
vi.mock('@/components/AvailabilityExceptionDialog', () => ({ AvailabilityExceptionDialog: () => null }));
vi.mock('@/components/EnableNotificationsBanner', () => ({ EnableNotificationsBanner: () => null }));

import EmployeePortal from '@/pages/EmployeePortal';

describe('EmployeePortal recurring availability', () => {
  it('shows the local window and not the legacy UTC conversion', async () => {
    render(<EmployeePortal />);
    const tab = screen.queryByRole('tab', { name: /availability/i });
    if (tab) await userEvent.click(tab);
    expect(await screen.findByText(/10:00 AM - 6:00 PM/)).toBeInTheDocument();
    expect(screen.queryByText(/09:00|9:00 AM/)).not.toBeInTheDocument();
  });
});
