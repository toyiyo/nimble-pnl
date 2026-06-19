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
import React from 'react';
import EmployeeClock from '@/pages/EmployeeClock';

// ---------------------------------------------------------------------------
// Hoisted mock factories
// ---------------------------------------------------------------------------
const {
  mutateMock,
  useCurrentEmployeeMock,
  useEmployeePunchStatusMock,
  checkLocationMock,
} = vi.hoisted(() => ({
  mutateMock: vi.fn(),
  useCurrentEmployeeMock: vi.fn(),
  useEmployeePunchStatusMock: vi.fn(),
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
    useCreateTimePunch: () => ({ mutate: mutateMock, isPending: false }),
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

    // Break affordances must still not exist
    expect(screen.queryByRole('button', { name: /start break/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /end break/i })).toBeNull();
    expect(screen.queryByText(/on break/i)).toBeNull();
  });
});
