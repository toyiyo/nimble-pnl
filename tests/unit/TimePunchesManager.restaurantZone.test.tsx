/**
 * Regression test for CodeRabbit review, PR #682: TimePunchesManager's Punch
 * List rows (~line 873-874) used to render a punch instant with
 *   format(new Date(punch.punch_time), pattern)
 * which reads the instant in the VIEWER's host timezone, not the
 * restaurant's. The fix routes every punch-instant display site through the
 * restaurant clock instead:
 *   clock.formatInstant(punch.punch_time, pattern)
 *
 * This test mounts the real page (not a logic-only pin) with the restaurant
 * timezone set to Pacific/Auckland while the test host runs under TZ=UTC —
 * a fixed, non-zero UTC offset (+12h/+13h) that guarantees the wall-clock
 * hour rendered by `clock.formatInstant` (restaurant-zone) never coincides
 * with the wall-clock hour the pre-fix `format(new Date(x), ...)` would have
 * rendered under the host's UTC clock, regardless of what "now" is when the
 * suite runs.
 *
 * The punch's instant is pinned to the current moment (`new Date()` at test
 * time) specifically so it always falls inside the page's default "day" view
 * window ([startOfDay(now), endOfDay(now)] in the host TZ) — that window
 * computation itself is a separate, already-known, explicitly out-of-scope
 * issue (see brief item 5 / dateRange, lines ~283-290) and is deliberately
 * left untouched here.
 */
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import userEvent from '@testing-library/user-event';
import { formatInstant } from '@/lib/restaurantClock';
import TimePunchesManager from '@/pages/TimePunchesManager';

const RESTAURANT_TZ = 'Pacific/Auckland';

vi.mock('@/contexts/RestaurantContext', () => ({
  useRestaurantContext: () => ({
    selectedRestaurant: {
      restaurant_id: 'r1',
      restaurant_id_: 'r1',
      restaurant: { name: 'Test Cafe', timezone: RESTAURANT_TZ },
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
  useKioskSession: () => ({
    session: null,
    startSession: vi.fn(),
    endSession: vi.fn(),
  }),
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

let punchTimeIso = '';

vi.mock('@/hooks/useTimePunches', () => ({
  useTimePunches: () => ({
    punches: [
      {
        id: 'p1',
        restaurant_id: 'r1',
        employee_id: 'e1',
        punch_type: 'clock_in',
        punch_time: punchTimeIso,
        created_at: punchTimeIso,
        updated_at: punchTimeIso,
        employee: { id: 'e1', name: 'Jamie Rivera', position: 'Server' },
      },
    ],
    loading: false,
  }),
  useDeleteTimePunch: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
  useUpdateTimePunch: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
  useCreateTimePunch: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
}));

// These sibling view/editor components are irrelevant to the fix under test
// (Punch List rows on the page itself) and pull in their own data hooks
// (useCreateEmployee, useBulkCreateTimePunches, ...) that would otherwise
// have to be mocked transitively for no benefit to this regression test.
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

const ORIGINAL_TZ = process.env.TZ;

describe('TimePunchesManager Punch List — renders punch instants in the restaurant zone', () => {
  afterEach(() => {
    process.env.TZ = ORIGINAL_TZ;
    vi.clearAllMocks();
  });

  it('shows the restaurant-zone (Pacific/Auckland) time, not the host-zone (UTC) time', async () => {
    process.env.TZ = 'UTC';
    // Pin the punch to "now" so it always lands inside the page's default
    // day-view window, whatever day the suite happens to run on.
    const now = new Date();
    punchTimeIso = now.toISOString();

    const expectedTime = formatInstant(punchTimeIso, RESTAURANT_TZ, 'h:mm a');
    // What the pre-fix `format(new Date(punch.punch_time), 'h:mm a')` would
    // have rendered under the host's TZ=UTC clock -- the viewer-zone value
    // the fix must NOT show.
    const hostZoneTime = formatInstant(punchTimeIso, 'UTC', 'h:mm a');
    // Pacific/Auckland is UTC+12 or UTC+13 (never UTC+0), so these can never
    // collide -- the assertion doesn't depend on what moment the suite runs.
    expect(expectedTime).not.toBe(hostZoneTime);

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

    // Punch List is a closed Collapsible by default; open it.
    await user.click(screen.getByText(/Punch List/));

    const row = (await screen.findByText('Jamie Rivera')).closest('div.flex.items-center.justify-between');
    expect(row).toBeTruthy();
    expect(row?.textContent).toContain(expectedTime);
    expect(row?.textContent).not.toContain(hostZoneTime);
  });
});
