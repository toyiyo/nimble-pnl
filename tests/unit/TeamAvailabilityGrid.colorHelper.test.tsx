/**
 * Regression test for Task 3 of the availability-conflict-tz plan:
 * `TeamAvailabilityGrid`'s `AvailabilityCell` must render its cell tint by
 * calling the shared `availabilityColorClasses` helper from
 * `@/lib/effectiveAvailability` — not a local, drift-prone if/else block.
 *
 * This spies on the real helper (rather than asserting class strings, which
 * are identical before/after the refactor by design) so the test fails
 * before the refactor lands and passes once the component is wired to it.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { TeamAvailabilityGrid } from '@/components/scheduling/TeamAvailabilityGrid';
import type { Employee, EmployeeAvailability, AvailabilityException } from '@/types/scheduling';

const employee: Employee = {
  id: 'emp-1',
  restaurant_id: 'r1',
  name: 'Ann Employee',
  position: 'Server',
  status: 'active',
  is_active: true,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

const availability: EmployeeAvailability[] = [
  {
    id: 'avail-1',
    restaurant_id: 'r1',
    employee_id: 'emp-1',
    day_of_week: 1, // Monday
    start_time: '09:00:00',
    end_time: '17:00:00',
    is_available: true,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  },
];

const exceptions: AvailabilityException[] = [];

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

vi.mock('@/lib/effectiveAvailability', async () => {
  const actual = await vi.importActual<typeof import('@/lib/effectiveAvailability')>(
    '@/lib/effectiveAvailability',
  );
  return {
    ...actual,
    availabilityColorClasses: vi.fn(actual.availabilityColorClasses),
  };
});

describe('TeamAvailabilityGrid — shared color helper', () => {
  it('renders AvailabilityCell tints via availabilityColorClasses (not a local duplicate)', async () => {
    const { availabilityColorClasses } = await import('@/lib/effectiveAvailability');

    render(
      <TeamAvailabilityGrid
        restaurantId="r1"
        onOpenAvailabilityDialog={vi.fn()}
        onOpenExceptionDialog={vi.fn()}
        onRequestDelete={vi.fn()}
      />,
    );

    expect(availabilityColorClasses).toHaveBeenCalled();
  });
});
