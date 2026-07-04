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

  it('Try Again re-invokes mutate with the identical payload; alert clears on per-call onSuccess', async () => {
    const user = userEvent.setup();

    // First call: fail (captures the payload for the alert). Second call
    // (the retry): succeed via onSuccess, which must clear the alert.
    mutateMock.mockImplementationOnce((_payload, options) => {
      options?.onError?.(new Error('Network request failed'));
    });
    mutateMock.mockImplementationOnce((_payload, options) => {
      options?.onSuccess?.();
    });

    render(<EmployeeClock />);

    await user.click(screen.getByRole('button', { name: /clock in/i }));
    await user.click(await screen.findByRole('button', { name: /skip photo/i }));

    // Alert must be showing before retry.
    const alertsBeforeRetry = await screen.findAllByRole('alert');
    expect(
      alertsBeforeRetry.some((el) => /didn't go through/i.test(el.textContent || ''))
    ).toBe(true);
    expect(mutateMock).toHaveBeenCalledTimes(1);
    const [firstPayload] = mutateMock.mock.calls[0];

    await user.click(screen.getByRole('button', { name: /try again/i }));

    // mutate must be re-invoked with the identical payload object (same
    // punch_time, ids, etc. — no re-collection of context/geofence/photo).
    expect(mutateMock).toHaveBeenCalledTimes(2);
    const [secondPayload] = mutateMock.mock.calls[1];
    expect(secondPayload).toEqual(firstPayload);

    // The per-call onSuccess from the retry must clear the persistent alert.
    await screen.findByRole('button', { name: /clock in/i });
    const alertsAfterRetry = screen.queryAllByRole('alert');
    expect(
      alertsAfterRetry.some((el) => /didn't go through/i.test(el.textContent || ''))
    ).toBe(false);
    expect(screen.queryByRole('button', { name: /try again/i })).toBeNull();
  });

  it('moves focus to the main Clock In/Out button when the alert unmounts after a successful retry, if focus was inside the alert', async () => {
    const user = userEvent.setup();

    // First call: fail (captures the payload, renders the alert + Try Again
    // button). Second call (the retry, triggered by clicking Try Again):
    // succeed via onSuccess, which unmounts the alert.
    mutateMock.mockImplementationOnce((_payload, options) => {
      options?.onError?.(new Error('Network request failed'));
    });
    mutateMock.mockImplementationOnce((_payload, options) => {
      options?.onSuccess?.();
    });

    render(<EmployeeClock />);

    await user.click(screen.getByRole('button', { name: /clock in/i }));
    await user.click(await screen.findByRole('button', { name: /skip photo/i }));

    const tryAgainButton = await screen.findByRole('button', { name: /try again/i });
    // Focus must be inside the alert (on the Try Again button) before the
    // retry — this is the precondition the design calls out: "if focus was
    // inside it". Clicking the button with userEvent already focuses it,
    // but assert explicitly so the precondition is unambiguous.
    tryAgainButton.focus();
    expect(tryAgainButton).toHaveFocus();

    await user.click(tryAgainButton);

    // The retry succeeded (per-call onSuccess), so the alert (and the Try
    // Again button that was focused) unmounts. Focus must not be dropped to
    // <body> — it must land on the main Clock In/Out action button.
    const clockInOutButton = await screen.findByRole('button', { name: /clock in/i });
    expect(clockInOutButton).toHaveFocus();
  });

  it('Try Again button is disabled while createPunch.isPending is true', async () => {
    const user = userEvent.setup();

    // First call fails, producing the persistent alert + Try Again button.
    mutateMock.mockImplementation((_payload, options) => {
      options?.onError?.(new Error('Network request failed'));
    });

    const { rerender } = render(<EmployeeClock />);

    await user.click(screen.getByRole('button', { name: /clock in/i }));
    await user.click(await screen.findByRole('button', { name: /skip photo/i }));

    const tryAgainButton = await screen.findByRole('button', { name: /try again/i });
    expect(tryAgainButton).toBeEnabled();

    // Simulate the retry mutation now being in flight: isPending flips true.
    useCreateTimePunchMock.mockReturnValue({ mutate: mutateMock, isPending: true });
    // Re-render the SAME component instance (not a fresh mount) so its
    // `failedPunch` state (set by onError above) survives; a fresh `render()`
    // call would mount a brand-new instance with reset state, leaving no
    // Try Again button at all in that tree. `rerender` is what forces the
    // existing instance to read the updated mock value.
    rerender(<EmployeeClock />);

    const tryAgainButtons = screen.getAllByRole('button', { name: /try again/i });
    expect(tryAgainButtons[tryAgainButtons.length - 1]).toBeDisabled();
  });

  it('Try Again on a payload older than RETRY_MAX_AGE_MS (5 min) discards it and restarts the punch flow instead of mutating with a stale payload', async () => {
    const user = userEvent.setup();

    // Fail on the first (and only, from this test's perspective) mutate call
    // so the alert + Try Again button render with a captured `failedAt`.
    mutateMock.mockImplementation((_payload, options) => {
      options?.onError?.(new Error('Network request failed'));
    });

    // Freeze the clock so `failedAt` (captured via Date.now() in onError) is
    // deterministic, then move it past the 5-minute freshness window before
    // clicking Try Again.
    const dateNowSpy = vi.spyOn(Date, 'now').mockReturnValue(1_000_000);

    render(<EmployeeClock />);

    await user.click(screen.getByRole('button', { name: /clock in/i }));
    await user.click(await screen.findByRole('button', { name: /skip photo/i }));

    await screen.findByRole('button', { name: /try again/i });
    expect(mutateMock).toHaveBeenCalledTimes(1);

    // Advance the injected clock past RETRY_MAX_AGE_MS (5 min = 300_000ms).
    dateNowSpy.mockReturnValue(1_000_000 + 5 * 60 * 1000 + 1);

    await user.click(screen.getByRole('button', { name: /try again/i }));

    // The stale payload must be discarded, not re-sent to mutate — Try Again
    // must NOT re-invoke mutate a second time with the old payload.
    expect(mutateMock).toHaveBeenCalledTimes(1);

    // Instead, the normal punch flow restarts: the camera dialog reopens
    // (handleInitiatePunch(punchType) with a fresh timestamp), evidenced by
    // the "Skip Photo" / verification dialog reappearing.
    expect(
      await screen.findByRole('button', { name: /skip photo/i })
    ).toBeInTheDocument();

    // The stale failure alert must no longer be showing once the flow has
    // restarted (it's been discarded, not just left dangling).
    const alertsAfterRestart = screen.queryAllByRole('alert');
    expect(
      alertsAfterRestart.some((el) => /didn't go through/i.test(el.textContent || ''))
    ).toBe(false);

    dateNowSpy.mockRestore();
  });

  it('opening and cancelling the camera dialog does NOT clear a stale failure alert; a newly confirmed punch (mutate firing) does', async () => {
    const user = userEvent.setup();

    // First punch attempt fails, producing the persistent alert.
    mutateMock.mockImplementationOnce((_payload, options) => {
      options?.onError?.(new Error('Network request failed'));
    });

    render(<EmployeeClock />);

    await user.click(screen.getByRole('button', { name: /clock in/i }));
    await user.click(await screen.findByRole('button', { name: /skip photo/i }));

    // Alert must be showing after the first failed punch.
    const alertsAfterFailure = await screen.findAllByRole('alert');
    expect(
      alertsAfterFailure.some((el) => /didn't go through/i.test(el.textContent || ''))
    ).toBe(true);
    expect(mutateMock).toHaveBeenCalledTimes(1);

    // Now open the camera dialog again and cancel it (via the dialog's
    // onOpenChange close path) WITHOUT confirming a punch. Merely
    // initiating and cancelling a new attempt must not clear the stale
    // failure alert — it clears only when `mutate` actually fires again.
    await user.click(screen.getByRole('button', { name: /clock in/i }));
    await screen.findByRole('button', { name: /skip photo/i });
    // Close the dialog without clicking Skip Photo / Take Photo (simulates
    // the user backing out, e.g. pressing Escape or the dialog's close
    // affordance) by firing the Dialog's onOpenChange(false) via Escape.
    await user.keyboard('{Escape}');
    // The camera dialog should be closed and the "Skip Photo" button gone.
    expect(screen.queryByRole('button', { name: /skip photo/i })).toBeNull();
    // mutate must NOT have been called again just from opening/cancelling.
    expect(mutateMock).toHaveBeenCalledTimes(1);
    // The stale failure alert must still be present.
    const alertsAfterCancel = screen.queryAllByRole('alert');
    expect(
      alertsAfterCancel.some((el) => /didn't go through/i.test(el.textContent || ''))
    ).toBe(true);
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();

    // Now drive a fresh, newly-confirmed punch (mutate firing again) — this
    // must clear the stale alert once the per-call onSuccess fires, even
    // though the payload/attempt is a brand new one, not a Try Again retry.
    mutateMock.mockImplementationOnce((_payload, options) => {
      options?.onSuccess?.();
    });

    await user.click(screen.getByRole('button', { name: /clock in/i }));
    await user.click(await screen.findByRole('button', { name: /skip photo/i }));

    expect(mutateMock).toHaveBeenCalledTimes(2);

    await screen.findByRole('button', { name: /clock in/i });
    const alertsAfterNewPunch = screen.queryAllByRole('alert');
    expect(
      alertsAfterNewPunch.some((el) => /didn't go through/i.test(el.textContent || ''))
    ).toBe(false);
    expect(screen.queryByRole('button', { name: /try again/i })).toBeNull();
  });

  it('shows a "Recording punch…" pending indicator while createPunch.isPending is true', async () => {
    // Not pending: no indicator.
    useCreateTimePunchMock.mockReturnValue({ mutate: mutateMock, isPending: false });
    const { rerender } = render(<EmployeeClock />);

    expect(screen.queryByText(/recording punch/i)).toBeNull();

    // Flip to pending (mutation in flight) — indicator must appear.
    useCreateTimePunchMock.mockReturnValue({ mutate: mutateMock, isPending: true });
    rerender(<EmployeeClock />);

    expect(await screen.findByText(/recording punch/i)).toBeInTheDocument();

    // Flip back to settled — indicator must disappear.
    useCreateTimePunchMock.mockReturnValue({ mutate: mutateMock, isPending: false });
    rerender(<EmployeeClock />);

    expect(screen.queryByText(/recording punch/i)).toBeNull();
  });
});
