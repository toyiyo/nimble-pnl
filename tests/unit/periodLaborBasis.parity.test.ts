/**
 * Basis parity (single labor engine, Task 8): for the same rows,
 * loadPeriodLaborBasis gives the totalLaborCost and laborBasis of
 * useCostsFromSource. The hook runs with the real labor hooks over a stub
 * client; only the COGS side is stubbed.
 *
 * The dates use local-field constructors and the rows use fixed UTC
 * instants, so the result is the same on every host.
 */
import React, { type ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { makeLaborStubClient, type Row, type StubClient, type TableSource } from './helpers/laborStubClient';
import { loadPeriodLaborBasis } from '../../supabase/functions/_shared/labor/periodLaborBasis';

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
      hourly_rate: 1500, // $15.00 an hour
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

vi.mock('@/hooks/useUnifiedCOGS', () => ({
  useUnifiedCOGS: () => ({
    totalCOGS: 0,
    dailyCOGS: [],
    breakdown: { inventory: 0, financials: 0 },
    method: 'inventory',
    capped: false,
    isLoading: false,
    error: null,
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

const labor = { account_subtype: 'labor' };
const bankRows: Row[] = [
  { id: 'b1', restaurant_id: REST, transaction_date: '2026-07-21', amount: -400, status: 'posted', chart_of_accounts: labor },
];
const pendingRows: Row[] = [
  { id: 'o1', restaurant_id: REST, issue_date: '2026-07-22', amount: -120, status: 'pending', chart_account: labor },
];
const tipRows: Row[] = [
  { id: 't1', amount: 900, employee_id: 'e1', tip_splits: { restaurant_id: REST, split_date: '2026-07-22' } },
];

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children);
  };
};

async function compare(tables: Record<string, TableSource>) {
  stub = makeLaborStubClient(tables);
  const { useCostsFromSource } = await import('@/hooks/useCostsFromSource');
  const { result } = renderHook(
    () => useCostsFromSource(REST, new Date(2026, 6, 20), new Date(2026, 6, 26, 23, 59, 59, 999)),
    { wrapper: createWrapper() },
  );
  await waitFor(() => expect(result.current.isLoading).toBe(false));

  const loaded = await loadPeriodLaborBasis(makeLaborStubClient(tables), {
    restaurantId: REST,
    startDay: '2026-07-20',
    endDay: '2026-07-26',
    timeZone: 'America/Chicago',
    employees: employees as never,
    throughNow: false,
    now: new Date('2026-07-27T12:00:00.000Z'),
  });

  expect(loaded.totalLaborCost).toBe(result.current.totalLaborCost);
  expect(loaded.laborBasis).toBe(result.current.laborBasis);
  expect(loaded.pendingLaborCost).toBe(result.current.pendingLaborCost);
  expect(loaded.actualLaborCost).toBe(result.current.actualLaborCost);
  return loaded;
}

describe('loadPeriodLaborBasis parity with useCostsFromSource', () => {
  beforeEach(() => {
    stub = makeLaborStubClient({});
  });

  it('picks accrued labor when the period has worked hours', async () => {
    const loaded = await compare({
      time_punches: [
        punch('p1', '2026-07-21T14:00:00.000Z', 'clock_in'),
        punch('p2', '2026-07-21T22:00:00.000Z', 'clock_out'),
      ],
      tip_split_items: tipRows,
      bank_transactions: bankRows,
      pending_outflows: pendingRows,
    });
    expect(loaded.laborBasis).toBe('accrued');
    // 8 h at $15 + $9 tips owed.
    expect(loaded.totalLaborCost).toBeCloseTo(129, 6);
    expect(loaded.actualLaborCost).toBe(520);
  });

  it('picks paid labor when the period has only tips owed', async () => {
    const loaded = await compare({
      tip_split_items: tipRows,
      bank_transactions: bankRows,
      pending_outflows: pendingRows,
    });
    expect(loaded.laborBasis).toBe('paid');
    expect(loaded.totalLaborCost).toBe(520);
    expect(loaded.pendingLaborCost).toBeCloseTo(9, 6);
  });

  it('gives zero paid labor when the period has no rows', async () => {
    const loaded = await compare({});
    expect(loaded.laborBasis).toBe('paid');
    expect(loaded.totalLaborCost).toBe(0);
  });
});
