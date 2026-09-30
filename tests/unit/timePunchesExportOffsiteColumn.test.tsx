/**
 * Regression test for a chatgpt-codex-connector finding on PR #830
 * (src/pages/TimePunchesManager.tsx:609): the CSV export wrote
 * `Off-site = No` for any punch that had a location but no off-site flag,
 * including a punch whose restaurant has no configured geofence — the
 * trigger keeps the submitted coordinates but never writes
 * `within_geofence` for that case. Reporting `No` there asserts a
 * server-verified on-site result the server never gave.
 *
 * The fix requires `location.within_geofence === true` for the `No` column,
 * leaving an unassessed location blank.
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

const now = new Date();
const punchTimeIso = now.toISOString();

vi.mock('@/hooks/useTimePunches', () => ({
  useTimePunches: () => ({
    punches: [
      {
        id: 'p-offsite',
        restaurant_id: 'r1',
        employee_id: 'e1',
        punch_type: 'clock_in',
        punch_time: punchTimeIso,
        created_at: punchTimeIso,
        updated_at: punchTimeIso,
        location: { latitude: 1, longitude: 1, distance_meters: 500, within_geofence: false },
        employee: { id: 'e1', name: 'Off Site Employee', position: 'Server' },
      },
      {
        id: 'p-onsite',
        restaurant_id: 'r1',
        employee_id: 'e2',
        punch_type: 'clock_in',
        punch_time: punchTimeIso,
        created_at: punchTimeIso,
        updated_at: punchTimeIso,
        location: { latitude: 2, longitude: 2, distance_meters: 5, within_geofence: true },
        employee: { id: 'e2', name: 'On Site Employee', position: 'Server' },
      },
      {
        id: 'p-unassessed',
        restaurant_id: 'r1',
        employee_id: 'e3',
        punch_type: 'clock_in',
        punch_time: punchTimeIso,
        created_at: punchTimeIso,
        updated_at: punchTimeIso,
        // Coordinates present, but no `within_geofence` value — the shape a
        // restaurant with no configured geofence produces. Must not export
        // as "No".
        location: { latitude: 3, longitude: 3 },
        employee: { id: 'e3', name: 'Unassessed Employee', position: 'Server' },
      },
    ],
    loading: false,
  }),
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

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn(() => Promise.resolve({ data: [], error: null })),
    })),
    storage: {
      from: vi.fn(() => ({
        createSignedUrl: vi.fn(() => Promise.resolve({ data: null, error: null })),
      })),
    },
  },
}));

describe('TimePunchesManager CSV export — Off-site column', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('writes No only for a server-verified on-site punch, and blank for an unassessed location', async () => {
    let capturedTextPromise: Promise<string> = Promise.resolve('');
    vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
      capturedTextPromise = new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error);
        reader.readAsText(blob as Blob);
      });
      return 'blob:mock';
    });
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });

    const user = userEvent.setup();
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <TimePunchesManager />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    await user.click(screen.getByText(/Punch List/));
    await screen.findByText('Off Site Employee');
    await user.click(screen.getByLabelText('Export data'));

    const exportedCsv = await capturedTextPromise;
    const lines = exportedCsv.split('\n');
    const offsiteLine = lines.find((l) => l.includes('Off Site Employee'));
    const onsiteLine = lines.find((l) => l.includes('On Site Employee'));
    const unassessedLine = lines.find((l) => l.includes('Unassessed Employee'));

    expect(offsiteLine?.trim().endsWith('"Yes"')).toBe(true);
    expect(onsiteLine?.trim().endsWith('"No"')).toBe(true);
    expect(unassessedLine?.trim().endsWith('""')).toBe(true);
  });
});
