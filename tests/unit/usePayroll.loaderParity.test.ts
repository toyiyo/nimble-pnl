/**
 * usePayroll returns the loadPayrollPeriod period for the same input
 * (single labor engine, Task 9). The hook runs over a stub client.
 */
import React, { type ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { makeLaborStubClient, type Row, type StubClient } from './helpers/laborStubClient';
import { loadPayrollPeriod } from '../../supabase/functions/_shared/labor/payrollPeriod';

const REST = 'rest-1';

const { employees } = vi.hoisted(() => ({
  employees: [
    {
      id: 'e1',
      restaurant_id: 'rest-1',
      name: 'E1',
      position: 'Cook',
      status: 'active',
      is_active: true,
      compensation_type: 'hourly',
      hourly_rate: 2000,
    },
  ],
}));

vi.mock('@/hooks/useEmployees', () => ({
  useEmployees: () => ({ employees, loading: false }),
}));

vi.mock('@/contexts/RestaurantContext', () => ({
  useRestaurantContext: () => ({
    selectedRestaurant: { restaurant: { timezone: 'America/Chicago' } },
  }),
}));

let stub: StubClient = makeLaborStubClient({});
vi.mock('@/integrations/supabase/client', () => ({
  supabase: { from: (table: string) => stub.from(table) },
}));

function punch(id: string, time: string, type: string): Row {
  return {
    id,
    employee_id: 'e1',
    restaurant_id: REST,
    punch_time: time,
    punch_type: type,
    created_at: time,
    updated_at: time,
    shift_id: null,
    notes: null,
    photo_path: null,
    device_info: null,
    location: null,
    created_by: null,
    modified_by: null,
  };
}

describe('usePayroll loader parity', () => {
  it('returns the loader period for the same rows', async () => {
    const rows = {
      time_punches: [
        // Sun Mar 8 20:00 CDT to Mon Mar 9 03:00 CDT: an overnight shift at
        // the end of the week, in the +18 h buffer.
        punch('p1', '2026-03-09T01:00:00.000Z', 'clock_in'),
        punch('p2', '2026-03-09T08:00:00.000Z', 'clock_out'),
        punch('p3', '2026-03-04T15:00:00.000Z', 'clock_in'),
        punch('p4', '2026-03-04T23:30:00.000Z', 'clock_out'),
      ],
      tip_splits: [{ id: 's1', restaurant_id: REST, status: 'approved', split_date: '2026-03-04', total_amount: 900 }],
      tip_split_items: [
        { id: 'i1', employee_id: 'e1', amount: 900, tip_split_id: 's1', tip_splits: { split_date: '2026-03-04' } },
      ],
    };
    stub = makeLaborStubClient(rows);
    const { usePayroll } = await import('@/hooks/usePayroll');

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
    });
    const wrapper = ({ children }: { children: ReactNode }) =>
      React.createElement(QueryClientProvider, { client: queryClient }, children);

    // The Payroll page passes startOfWeek / endOfWeek (local fields).
    const startDate = new Date(2026, 2, 2);
    const endDate = new Date(2026, 2, 8, 23, 59, 59, 999);
    const { result } = renderHook(() => usePayroll(REST, startDate, endDate), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    const { period } = await loadPayrollPeriod(makeLaborStubClient(rows), {
      restaurantId: REST,
      startDay: '2026-03-02',
      endDay: '2026-03-08',
      timeZone: 'America/Chicago',
      employees: employees as never,
    });

    expect(result.current.payrollPeriod).toEqual(period);
    expect(period.employees[0].regularHours).toBeCloseTo(15.5, 6);
    expect(period.employees[0].totalTips).toBe(900);
    // The hook keeps its query key, with the admin segment.
    const keys = queryClient.getQueryCache().getAll().map((q) => q.queryKey);
    expect(keys).toContainEqual([
      'payroll',
      REST,
      startDate.toISOString(),
      endDate.toISOString(),
      'America/Chicago',
      'admin',
    ]);
  });
});
