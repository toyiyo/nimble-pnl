/**
 * T7 (impact-aware-deletion plan): TeamAvailabilityGrid renders a sibling
 * trash `<button>` on filled desktop cells (recurring or exception — never
 * "not-set"), calling `onRequestDelete(target)` with a resolved
 * `AvailabilityDeletionTarget`. The button stops propagation so it never
 * also opens the edit dialog, and it's entirely omitted on the
 * compact/mobile cell (which renders via a separate code path regardless of
 * viewport CSS, so this is testable directly rather than via a media query).
 *
 * System time is pinned via `new Date(y, m, d, ...)` (local-component
 * constructor, not a UTC ISO string) so "today" lands on a known Monday
 * regardless of the CI runner's timezone — mirrors the dynamic-date lesson
 * (avoid hardcoded UTC-anchored fixtures that drift under DST/TZ).
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import { TeamAvailabilityGrid } from '@/components/scheduling/TeamAvailabilityGrid';
import type { Employee, EmployeeAvailability, AvailabilityException } from '@/types/scheduling';

const employee: Employee = {
  id: 'emp-1',
  restaurant_id: 'r1',
  name: 'Ann Employee',
  position: 'Server',
  status: 'active',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

// Monday recurring availability (day_of_week: 1) — a "filled" recurring cell.
// `let` (not `const`) so the split-shift describe block below can swap in
// multiple same-day rows without a second vi.mock/module reset.
let availability: EmployeeAvailability[] = [
  {
    id: 'avail-1',
    restaurant_id: 'r1',
    employee_id: 'emp-1',
    day_of_week: 1,
    start_time: '09:00:00',
    end_time: '17:00:00',
    is_available: true,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  },
];
const SINGLE_MONDAY_AVAILABILITY = availability;

// Two rows for the same employee+day (split shift, e.g. AM + PM) — used by
// the ambiguity describe block below to prove the delete button hides
// itself rather than guessing which row to delete.
const SPLIT_MONDAY_AVAILABILITY: EmployeeAvailability[] = [
  SINGLE_MONDAY_AVAILABILITY[0],
  {
    id: 'avail-2',
    restaurant_id: 'r1',
    employee_id: 'emp-1',
    day_of_week: 1,
    start_time: '18:00:00',
    end_time: '21:00:00',
    is_available: true,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  },
];

// Tuesday of the mocked "today" week — a "filled" exception cell.
const TUESDAY_LOCAL = new Date(2026, 2, 3, 12, 0, 0);
function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const exceptions: AvailabilityException[] = [
  {
    id: 'exc-1',
    restaurant_id: 'r1',
    employee_id: 'emp-1',
    date: toDateStr(TUESDAY_LOCAL),
    is_available: false,
    reason: 'Doctor appointment',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  },
];

vi.mock('@/hooks/useEmployees', () => ({
  useEmployees: () => ({ employees: [employee], loading: false, error: null }),
}));

vi.mock('@/hooks/useAvailability', () => ({
  useEmployeeAvailability: () => ({ availability, loading: false, error: null }),
  useAvailabilityExceptions: () => ({ exceptions, loading: false, error: null }),
}));

vi.mock('@/contexts/RestaurantContext', () => ({
  useRestaurantContext: () => ({
    selectedRestaurant: { restaurant: { id: 'r1', name: 'Test', timezone: 'UTC' } },
  }),
}));

describe('TeamAvailabilityGrid — delete button (T7)', () => {
  beforeEach(() => {
    // 2026-03-02 local is a Monday — pin "today" so the displayed week is
    // deterministic (constructed via local y/m/d components, so this is a
    // Monday on every machine's local clock regardless of its TZ).
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 2, 2, 12, 0, 0));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function renderGrid(onRequestDelete = vi.fn(), onOpenAvailabilityDialog = vi.fn()) {
    render(
      <TeamAvailabilityGrid
        restaurantId="r1"
        onOpenAvailabilityDialog={onOpenAvailabilityDialog}
        onOpenExceptionDialog={vi.fn()}
        onRequestDelete={onRequestDelete}
      />,
    );
    return { onRequestDelete, onOpenAvailabilityDialog };
  }

  it('renders exactly one delete button per filled cell (recurring Monday + exception Tuesday), none for not-set days', () => {
    renderGrid();
    const table = screen.getByRole('table');
    const deleteButtons = within(table).getAllByRole('button', { name: /^Delete /i });
    expect(deleteButtons).toHaveLength(2);
    // Also confirms it's genuinely absent from the mobile/compact render
    // (which never wires a delete button in), not merely CSS-hidden.
    expect(screen.getAllByRole('button', { name: /^Delete /i })).toHaveLength(2);
  });

  it('calls onRequestDelete with a kind="availability" target for the recurring Monday cell, without opening the editor', () => {
    const { onRequestDelete, onOpenAvailabilityDialog } = renderGrid();
    const table = screen.getByRole('table');

    const mondayDelete = within(table).getByRole('button', {
      name: "Delete Ann Employee's Monday availability",
    });
    fireEvent.click(mondayDelete);

    expect(onRequestDelete).toHaveBeenCalledWith({
      kind: 'availability',
      row: availability[0],
      personName: 'Ann Employee',
    });
    expect(onOpenAvailabilityDialog).not.toHaveBeenCalled();
  });

  it('calls onRequestDelete with a kind="exception" target for the exception Tuesday cell', () => {
    const { onRequestDelete } = renderGrid();
    const table = screen.getByRole('table');

    const tuesdayDelete = within(table).getByRole('button', {
      name: "Delete Ann Employee's Mar 3 availability",
    });
    fireEvent.click(tuesdayDelete);

    expect(onRequestDelete).toHaveBeenCalledWith({
      kind: 'exception',
      row: exceptions[0],
      personName: 'Ann Employee',
    });
  });
});

describe('TeamAvailabilityGrid — split-shift delete ambiguity', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 2, 2, 12, 0, 0));
    availability = SPLIT_MONDAY_AVAILABILITY;
  });

  afterEach(() => {
    vi.useRealTimers();
    availability = SINGLE_MONDAY_AVAILABILITY;
  });

  it('hides the Monday delete button when two availability rows exist for the same employee+day, instead of targeting an arbitrary one', () => {
    render(
      <TeamAvailabilityGrid
        restaurantId="r1"
        onOpenAvailabilityDialog={vi.fn()}
        onOpenExceptionDialog={vi.fn()}
        onRequestDelete={vi.fn()}
      />,
    );
    const table = screen.getByRole('table');
    expect(
      within(table).queryByRole('button', { name: "Delete Ann Employee's Monday availability" }),
    ).not.toBeInTheDocument();
    // The exception-day (Tuesday) delete button is unaffected — only the
    // ambiguous Monday recurring cell is suppressed.
    expect(
      within(table).getByRole('button', { name: "Delete Ann Employee's Mar 3 availability" }),
    ).toBeInTheDocument();
  });
});
