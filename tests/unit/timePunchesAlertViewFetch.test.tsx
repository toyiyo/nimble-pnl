/**
 * Regression test for a chatgpt-codex-connector P1 finding on PR #830
 * (src/pages/TimePunchesManager.tsx:370): "View punch" on the off-site
 * alert toast searched the local `punches` array only. `useTimePunches`
 * does not poll and can be scoped to another date range or employee, so a
 * punch reported by the live 15s alert poll is often not in that array —
 * the click then silently did nothing.
 *
 * The fix fetches the punch by id from Supabase when it is not found
 * locally, then opens the same Verification Details dialog.
 */
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import userEvent from '@testing-library/user-event';
import TimePunchesManager from '@/pages/TimePunchesManager';

vi.mock('@/contexts/RestaurantContext', () => ({
  useRestaurantContext: () => ({
    selectedRestaurant: {
      restaurant_id: 'r1',
      restaurant_id_: 'r1',
      restaurant: { name: 'Test Cafe', timezone: 'UTC' },
    },
  }),
}));

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'u1', email: 'owner@test.com' } }),
}));

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock('@/hooks/useKioskSession', () => ({
  useKioskSession: () => ({ session: null, startSession: vi.fn(), endSession: vi.fn() }),
}));

vi.mock('@/hooks/useKioskPins', () => ({
  useEmployeePins: () => ({ pins: [], loading: false }),
  useUpsertEmployeePin: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock('@/hooks/useKioskServiceAccount', () => ({
  useKioskServiceAccount: () => ({ account: null, loading: false, createOrRotate: vi.fn() }),
}));

vi.mock('@/hooks/useEmployees', () => ({
  useEmployees: () => ({ employees: [], loading: false }),
}));

// This page's `punches` array never contains the alerted punch — that is
// the whole point of the regression: the fetched-by-id row must come from
// Supabase, not from this list.
vi.mock('@/hooks/useTimePunches', () => ({
  useTimePunches: () => ({ punches: [], loading: false }),
  useDeleteTimePunch: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
  useUpdateTimePunch: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
  useCreateTimePunch: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock('@/components/time-tracking', () => ({
  EmployeeCardView: () => null,
  BarcodeStripeView: () => null,
  PunchStreamView: () => null,
  ReceiptStyleView: () => null,
  ManualTimelineEditor: () => null,
  MobileTimeEntry: () => null,
  TimePunchUploadSheet: () => null,
}));

// Capture the `onViewPunch` callback TimePunchesManager passes in, so the
// test can invoke it directly, the same way the real hook does from the
// toast's "View punch" action.
let capturedOnViewPunch: ((punchId: string) => void) | undefined;
vi.mock('@/hooks/useOffsitePunchAlerts', () => ({
  useOffsitePunchAlerts: (_restaurantId: string | undefined, onViewPunch: (punchId: string) => void) => {
    capturedOnViewPunch = onViewPunch;
    return { data: undefined };
  },
}));

const remotePunch = {
  id: 'remote-punch-1',
  restaurant_id: 'r1',
  employee_id: 'e9',
  punch_type: 'clock_in',
  punch_time: new Date().toISOString(),
  location: { latitude: 9, longitude: 9, distance_meters: 900, within_geofence: false },
  employee: { id: 'e9', name: 'Remote Employee', position: 'Server' },
};

const maybeSingle = vi.fn(() => Promise.resolve({ data: remotePunch, error: null }));
const eq = vi.fn(() => ({ maybeSingle }));
const select = vi.fn(() => ({ eq }));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: vi.fn(() => ({ select })),
    storage: {
      from: vi.fn(() => ({
        createSignedUrl: vi.fn(() => Promise.resolve({ data: null, error: null })),
      })),
    },
  },
}));

describe('TimePunchesManager — off-site alert "View punch"', () => {
  afterEach(() => {
    vi.clearAllMocks();
    capturedOnViewPunch = undefined;
  });

  it('fetches a punch not present locally and opens its Verification Details', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <TimePunchesManager />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(capturedOnViewPunch).toBeTypeOf('function');
    capturedOnViewPunch!('remote-punch-1');

    expect(await screen.findByText('Verification Details')).toBeInTheDocument();
    expect(await screen.findByText('Remote Employee')).toBeInTheDocument();
    expect(select).toHaveBeenCalled();
    expect(eq).toHaveBeenCalledWith('id', 'remote-punch-1');
  });
});
