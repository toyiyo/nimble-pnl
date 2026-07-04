/**
 * Behavioral tests for src/pages/EmployeeClock.tsx
 *
 * Design spec: docs/superpowers/specs/2026-06-18-employee-clock-remove-break-design.md
 *
 * These tests pin the "remove self-service breaks" requirement:
 *   - Only Clock In / Clock Out buttons render (no Start Break / End Break).
 *   - Only "Clocked In" / "Clocked Out" badges render (no "On Break").
 *   - The external-break edge case (is_clocked_in=false, on_break=true) still
 *     shows Clock In (employee reads as clocked-out per RPC semantics).
 *
 * Mocking pattern mirrors tests/unit/EmployeePin.test.tsx.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import EmployeeClock from '@/pages/EmployeeClock';

// ---------------------------------------------------------------------------
// Hoisted mock factories
// ---------------------------------------------------------------------------
const {
  mutateMock,
  useCurrentEmployeeMock,
  useEmployeePunchStatusMock,
  useCreateTimePunchMock,
  checkLocationMock,
} = vi.hoisted(() => ({
  mutateMock: vi.fn(),
  useCurrentEmployeeMock: vi.fn(),
  useEmployeePunchStatusMock: vi.fn(),
  // `useCreateTimePunch()` mock — most tests only care that `mutate` was
  // invoked with the right payload (isPending: false is the default).
  // Tests that exercise per-call onError/onSuccess/isPending behavior
  // override this via `useCreateTimePunchMock.mockReturnValue(...)`.
  useCreateTimePunchMock: vi.fn(() => ({ mutate: mutateMock, isPending: false })),
  checkLocationMock: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock('@/contexts/RestaurantContext', () => ({
  useRestaurantContext: () => ({
    selectedRestaurant: {
      restaurant_id: 'r1',
      restaurant: { name: 'Test Cafe' },
    },
  }),
}));

vi.mock('@/hooks/useTimePunches', async () => {
  const actual =
    await vi.importActual<typeof import('@/hooks/useTimePunches')>(
      '@/hooks/useTimePunches'
    );
  return {
    ...actual,
    useCurrentEmployee: (...args: unknown[]) => useCurrentEmployeeMock(...args),
    useEmployeePunchStatus: (...args: unknown[]) =>
      useEmployeePunchStatusMock(...args),
    useCreateTimePunch: () => useCreateTimePunchMock(),
    useTimePunches: () => ({ punches: [] }),
  };
});

vi.mock('@/hooks/useGeofenceCheck', () => ({
  useGeofenceCheck: () => ({
    checkLocation: checkLocationMock,
    checking: false,
  }),
}));

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

// punchContext utilities make async calls (geolocation, device info) —
// stub them so tests never hit real browser APIs.
vi.mock('@/utils/punchContext', () => ({
  collectPunchContext: vi.fn().mockResolvedValue(undefined),
  mergePunchLocation: vi.fn().mockReturnValue(undefined),
}));

// ---------------------------------------------------------------------------
// Shared test employee
// ---------------------------------------------------------------------------
const EMPLOYEE = { id: 'e1', name: 'Alice', position: 'Server' };

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------
describe('EmployeeClock — break UI removed', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default employee mock — individual tests override useEmployeePunchStatusMock
    useCurrentEmployeeMock.mockReturnValue({
      employee: EMPLOYEE,
      loading: false,
    });

    // Default geofence: always allow (prevents async geofence dialog path)
    checkLocationMock.mockResolvedValue({ action: 'allow', checked: false });
  });

  // -------------------------------------------------------------------------
  // 1. Clocked Out state
  // -------------------------------------------------------------------------
  it('clocked-out state: shows Clock In button and no break affordances', () => {
    useEmployeePunchStatusMock.mockReturnValue({
      status: { is_clocked_in: false, on_break: false, last_punch_time: null },
      loading: false,
    });

    render(<EmployeeClock />);

    // Clock In must be present
    expect(
      screen.getByRole('button', { name: /clock in/i })
    ).toBeInTheDocument();

    // Status badge: "Clocked Out" must render; "Clocked In" must not
    expect(screen.getByText(/clocked out/i)).toBeInTheDocument();
    expect(screen.queryByText(/clocked in/i)).toBeNull();

    // Break affordances must not exist
    expect(screen.queryByRole('button', { name: /start break/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /end break/i })).toBeNull();
    expect(screen.queryByText(/on break/i)).toBeNull();
  });

  // -------------------------------------------------------------------------
  // 2. Clocked In state
  // -------------------------------------------------------------------------
  it('clocked-in state: shows Clock Out button and no break affordances', () => {
    useEmployeePunchStatusMock.mockReturnValue({
      status: { is_clocked_in: true, on_break: false, last_punch_time: null },
      loading: false,
    });

    render(<EmployeeClock />);

    // Clock Out must be present
    expect(
      screen.getByRole('button', { name: /clock out/i })
    ).toBeInTheDocument();

    // Status badge: "Clocked In" must render; "Clocked Out" must not
    expect(screen.getByText(/clocked in/i)).toBeInTheDocument();
    expect(screen.queryByText(/clocked out/i)).toBeNull();

    // Break affordances must not exist
    expect(screen.queryByRole('button', { name: /start break/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /end break/i })).toBeNull();
    expect(screen.queryByText(/on break/i)).toBeNull();
  });

  // -------------------------------------------------------------------------
  // 3. External break edge case (is_clocked_in=false, on_break=true)
  //
  // Per RPC semantics on_break=true => is_clocked_in=false.
  // The UI must treat this as "Clocked Out" and offer Clock In.
  // This pins the deliberate edge-case behavior from the design doc.
  // -------------------------------------------------------------------------
  it('external-break edge case: shows Clock In button (not break UI)', () => {
    useEmployeePunchStatusMock.mockReturnValue({
      status: { is_clocked_in: false, on_break: true, last_punch_time: null },
      loading: false,
    });

    render(<EmployeeClock />);

    // Must positively assert Clock In is present (employee reads as clocked-out)
    expect(
      screen.getByRole('button', { name: /clock in/i })
    ).toBeInTheDocument();

    // Status badge must show "Clocked Out" (edge-case treated as clocked-out)
    expect(screen.getByText(/clocked out/i)).toBeInTheDocument();

    // Break affordances must still not exist
    expect(screen.queryByRole('button', { name: /start break/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /end break/i })).toBeNull();
    expect(screen.queryByText(/on break/i)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Test suite — BUG-003: persistent punch-failure alert + retry
//
// Design spec: docs/superpowers/specs/2026-07-04-employee-clock-punch-error-surfacing-design.md
//
// `useCreateTimePunch` is mocked so `mutate(payload, { onError, onSuccess })`
// can be driven per-call from the test: invoking the captured `onError`
// synchronously simulates the mutation rejecting, without needing a real
// QueryClient/mutation lifecycle.
// ---------------------------------------------------------------------------
describe('EmployeeClock — persistent punch-failure alert (BUG-003)', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    useCurrentEmployeeMock.mockReturnValue({
      employee: EMPLOYEE,
      loading: false,
    });

    useEmployeePunchStatusMock.mockReturnValue({
      status: { is_clocked_in: false, on_break: false, last_punch_time: null },
      loading: false,
    });

    checkLocationMock.mockResolvedValue({ action: 'allow', checked: false });

    // Default: mutate is a no-op spy; individual tests reassign
    // `mutateMock`'s implementation to synchronously fire onError/onSuccess.
    useCreateTimePunchMock.mockReturnValue({ mutate: mutateMock, isPending: false });
  });

  it('punch failure (per-call onError) shows a role="alert" failure alert with a Try Again button', async () => {
    const user = userEvent.setup();

    // Simulate the mutation rejecting: whenever `mutate` is called with
    // per-call options, invoke `onError` synchronously (as React Query does
    // for a rejected mutationFn, modulo microtask timing which doesn't
    // matter for this assertion).
    mutateMock.mockImplementation((_payload, options) => {
      options?.onError?.(new Error('Network request failed'));
    });

    render(<EmployeeClock />);

    // Clock In → opens the camera dialog → Skip Photo triggers the punch
    // (handleSkipVerification -> handleConfirmPunch -> createPunch.mutate).
    await user.click(screen.getByRole('button', { name: /clock in/i }));
    await user.click(await screen.findByRole('button', { name: /skip photo/i }));

    // The persistent failure alert must render with role="alert" and
    // contain a "Try Again" button. Scope the query to the alert whose
    // accessible name/description mentions the punch failure, to avoid
    // colliding with the pre-existing "Why we verify" informational alert
    // (which also has role="alert" per the shadcn Alert primitive).
    const alerts = await screen.findAllByRole('alert');
    const failureAlert = alerts.find((el) =>
      /didn't go through/i.test(el.textContent || '')
    );
    expect(failureAlert).toBeDefined();

    const tryAgainButton = screen.getByRole('button', { name: /try again/i });
    expect(tryAgainButton).toBeInTheDocument();
  });
});
