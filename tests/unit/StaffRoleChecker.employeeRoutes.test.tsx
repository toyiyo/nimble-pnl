/**
 * `StaffRoleChecker` — employee-route gating for eligible collaborators
 * (Phase 4 task 5). An eligible collaborator (has an employee record, role
 * not staff/kiosk) must reach the `/employee/*` self-service routes without
 * being bounced to their `COLLABORATOR_ROUTES` landing page, while every
 * other route keeps today's behaviour untouched.
 *
 * See docs/superpowers/specs/2026-08-02-collaborator-work-view-design.md
 * ("Route gating") and docs/superpowers/plans/2026-08-02-collaborator-work-view-plan.md
 * (task 5/6).
 *
 * Asserts rendered behaviour (children vs. redirect vs. RouteLoadingScreen),
 * never the presence of a hook call — contrast with the source-text-regex
 * pattern in appRoleGateLoading.test.ts, which this deliberately does not
 * repeat.
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { describe, it, expect, beforeEach, vi } from 'vitest';

import { StaffRoleChecker } from '@/App';

const mocks = vi.hoisted(() => ({
  restaurant: {
    loading: false as boolean,
    selectedRestaurant: {
      role: 'collaborator_operations_manager',
      roleRecord: undefined as unknown,
    } as { role: string; roleRecord?: unknown } | null,
  },
  viewMode: {
    canUseWorkView: true,
    isWorkViewResolved: true,
  },
}));

vi.mock('@/contexts/RestaurantContext', () => ({
  useRestaurantContext: () => mocks.restaurant,
}));

vi.mock('@/contexts/ViewModeContext', () => ({
  useViewMode: () => mocks.viewMode,
}));

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}</div>;
}

function renderChecker(currentPath: string, allowStaff = false) {
  return render(
    <MemoryRouter initialEntries={[currentPath]}>
      <LocationProbe />
      <Routes>
        <Route
          path="*"
          element={
            <StaffRoleChecker allowStaff={allowStaff} currentPath={currentPath}>
              <div data-testid="protected-content">Protected content</div>
            </StaffRoleChecker>
          }
        />
      </Routes>
    </MemoryRouter>
  );
}

describe('StaffRoleChecker — employee route gating for collaborators', () => {
  beforeEach(() => {
    mocks.restaurant = {
      loading: false,
      selectedRestaurant: {
        role: 'collaborator_operations_manager',
        roleRecord: undefined,
      },
    };
    mocks.viewMode = { canUseWorkView: true, isWorkViewResolved: true };
  });

  it('renders children for an eligible collaborator on /employee/schedule, no redirect', () => {
    renderChecker('/employee/schedule');

    expect(screen.getByTestId('protected-content')).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent('/employee/schedule');
  });

  it('redirects to the role landing when the collaborator has no employee record', () => {
    mocks.viewMode = { canUseWorkView: false, isWorkViewResolved: true };

    renderChecker('/employee/schedule');

    expect(screen.queryByTestId('protected-content')).not.toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent('/scheduling');
  });

  it('shows RouteLoadingScreen while eligibility is unresolved, not a redirect', () => {
    mocks.viewMode = { canUseWorkView: false, isWorkViewResolved: false };

    renderChecker('/employee/schedule');

    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.queryByTestId('protected-content')).not.toBeInTheDocument();
    // Still on the requested path — held, not bounced elsewhere.
    expect(screen.getByTestId('location')).toHaveTextContent('/employee/schedule');
  });

  it('does not hold /scheduling on unresolved eligibility (the hold is scoped to /employee/*)', () => {
    mocks.viewMode = { canUseWorkView: false, isWorkViewResolved: false };

    renderChecker('/scheduling');

    expect(screen.getByTestId('protected-content')).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('still redirects an eligible collaborator away from /banking (grant did not widen anything else)', () => {
    mocks.viewMode = { canUseWorkView: true, isWorkViewResolved: true };

    renderChecker('/banking');

    expect(screen.queryByTestId('protected-content')).not.toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent('/scheduling');
  });

  it('leaves staff behaviour on /employee/schedule unchanged', () => {
    mocks.restaurant = {
      loading: false,
      selectedRestaurant: { role: 'staff', roleRecord: undefined },
    };

    renderChecker('/employee/schedule');

    expect(screen.getByTestId('protected-content')).toBeInTheDocument();
  });

  it('still forces kiosk to /kiosk on /employee/schedule (the kiosk check precedes everything)', () => {
    mocks.restaurant = {
      loading: false,
      selectedRestaurant: { role: 'kiosk', roleRecord: undefined },
    };

    renderChecker('/employee/schedule');

    expect(screen.queryByTestId('protected-content')).not.toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent('/kiosk');
  });
});
