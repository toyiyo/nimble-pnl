/**
 * Tests for `ViewModeProvider` / `useViewMode` — the React context that reads
 * the `viewModeStore` module singleton via `useSyncExternalStore`, computes
 * eligibility (`computeCanUseWorkView`), and derives the *effective* view
 * mode using the optimistic rule from
 * docs/superpowers/specs/2026-07-24-admin-work-view-mode-design.md
 * ("State model" section):
 *
 *   storeSaysWork = store.mode === 'work' && store.restaurantId != null
 *   confirmedWrongRestaurant =
 *     !!selectedRestaurant && selectedRestaurant.restaurant_id !== store.restaurantId
 *   confirmedIneligible = !employeeLoading && !canUseWorkView
 *   effectiveViewMode =
 *     storeSaysWork && !confirmedWrongRestaurant && !confirmedIneligible
 *       ? 'work' : 'admin'
 *
 * The point of the "confirmed" gating is to avoid a chrome flash on the
 * remount that `enterWorkMode()`'s navigate() triggers: we must NOT downgrade
 * to admin just because `selectedRestaurant` or employee data hasn't loaded
 * yet.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import {
  enterWorkMode as storeEnterWorkMode,
  getSnapshot,
  __resetStore,
} from '@/contexts/viewModeStore';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

const mockUseCurrentEmployee = vi.fn();
vi.mock('@/hooks/useCurrentEmployee', () => ({
  useCurrentEmployee: (restaurantId: string | null) => mockUseCurrentEmployee(restaurantId),
}));

const mockUseRestaurantContext = vi.fn();
vi.mock('@/contexts/RestaurantContext', () => ({
  useRestaurantContext: () => mockUseRestaurantContext(),
}));

import { ViewModeProvider, useViewMode } from '@/contexts/ViewModeContext';

function Harness() {
  const { viewMode, canUseWorkView, enterWorkMode, exitWorkMode } = useViewMode();
  return (
    <div>
      <span data-testid="viewMode">{viewMode}</span>
      <span data-testid="canUseWorkView">{String(canUseWorkView)}</span>
      <button onClick={() => enterWorkMode()}>Enter</button>
      <button onClick={() => exitWorkMode()}>Exit</button>
    </div>
  );
}

function renderHarness(initialPath = '/dashboard') {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <ViewModeProvider>
        <Harness />
      </ViewModeProvider>
    </MemoryRouter>
  );
}

const eligibleEmployee = { id: 'emp-1', user_id: 'user-1', status: 'active' };

describe('ViewModeProvider / useViewMode', () => {
  beforeEach(() => {
    __resetStore();
    mockNavigate.mockClear();
    mockUseCurrentEmployee.mockReset();
    mockUseRestaurantContext.mockReset();
  });

  it('exposes { viewMode, canUseWorkView, enterWorkMode, exitWorkMode }', () => {
    mockUseRestaurantContext.mockReturnValue({
      selectedRestaurant: { restaurant_id: 'rest-1', role: 'owner' },
    });
    mockUseCurrentEmployee.mockReturnValue({ currentEmployee: eligibleEmployee, loading: false });

    renderHarness();

    expect(screen.getByTestId('viewMode')).toBeInTheDocument();
    expect(screen.getByTestId('canUseWorkView')).toHaveTextContent('true');
    expect(screen.getByRole('button', { name: 'Enter' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Exit' })).toBeInTheDocument();
  });

  it('defaults to admin when the store says admin, even when eligible', () => {
    mockUseRestaurantContext.mockReturnValue({
      selectedRestaurant: { restaurant_id: 'rest-1', role: 'owner' },
    });
    mockUseCurrentEmployee.mockReturnValue({ currentEmployee: eligibleEmployee, loading: false });

    renderHarness();

    expect(screen.getByTestId('viewMode')).toHaveTextContent('admin');
  });

  it('is work when the store says work, restaurant matches, and eligibility is confirmed', () => {
    storeEnterWorkMode('rest-1', '/dashboard');
    mockUseRestaurantContext.mockReturnValue({
      selectedRestaurant: { restaurant_id: 'rest-1', role: 'owner' },
    });
    mockUseCurrentEmployee.mockReturnValue({ currentEmployee: eligibleEmployee, loading: false });

    renderHarness();

    expect(screen.getByTestId('viewMode')).toHaveTextContent('work');
  });

  it('downgrades to admin on a confirmed restaurant mismatch', () => {
    storeEnterWorkMode('rest-1', '/dashboard');
    mockUseRestaurantContext.mockReturnValue({
      // Selected restaurant is a *different*, already-resolved restaurant.
      selectedRestaurant: { restaurant_id: 'rest-2', role: 'owner' },
    });
    mockUseCurrentEmployee.mockReturnValue({ currentEmployee: eligibleEmployee, loading: false });

    renderHarness();

    expect(screen.getByTestId('viewMode')).toHaveTextContent('admin');
  });

  it('downgrades to admin on confirmed ineligibility (no linked employee, not loading)', () => {
    storeEnterWorkMode('rest-1', '/dashboard');
    mockUseRestaurantContext.mockReturnValue({
      selectedRestaurant: { restaurant_id: 'rest-1', role: 'owner' },
    });
    mockUseCurrentEmployee.mockReturnValue({ currentEmployee: null, loading: false });

    renderHarness();

    expect(screen.getByTestId('viewMode')).toHaveTextContent('admin');
    expect(screen.getByTestId('canUseWorkView')).toHaveTextContent('false');
  });

  it('stays work while employee eligibility is still loading', () => {
    storeEnterWorkMode('rest-1', '/dashboard');
    mockUseRestaurantContext.mockReturnValue({
      selectedRestaurant: { restaurant_id: 'rest-1', role: 'owner' },
    });
    // currentEmployee not resolved yet — must NOT be treated as "confirmed ineligible".
    mockUseCurrentEmployee.mockReturnValue({ currentEmployee: null, loading: true });

    renderHarness();

    expect(screen.getByTestId('viewMode')).toHaveTextContent('work');
  });

  it('stays work optimistically while selectedRestaurant has not re-hydrated yet', () => {
    // Simulates the remount RestaurantProvider goes through right after
    // enterWorkMode()'s navigate(): selectedRestaurant briefly null.
    storeEnterWorkMode('rest-1', '/dashboard');
    mockUseRestaurantContext.mockReturnValue({ selectedRestaurant: null });
    mockUseCurrentEmployee.mockReturnValue({ currentEmployee: null, loading: true });

    renderHarness();

    expect(screen.getByTestId('viewMode')).toHaveTextContent('work');
  });

  it('stays work optimistically when selectedRestaurant is null AND the (disabled) employee query reports loading=false', () => {
    // Real-world shape: useCurrentEmployee(null) is a `enabled: !!restaurantId`
    // React Query query. A *disabled* query never fetches, so React Query v5
    // reports isLoading===false (isLoading = isPending && isFetching) even
    // though no data has ever resolved. The remount-timing window right after
    // enterWorkMode()'s navigate() has selectedRestaurant briefly null — this
    // must NOT be treated as confirmed ineligibility just because
    // employeeLoading happens to be false.
    storeEnterWorkMode('rest-1', '/dashboard');
    mockUseRestaurantContext.mockReturnValue({ selectedRestaurant: null });
    mockUseCurrentEmployee.mockReturnValue({ currentEmployee: null, loading: false });

    renderHarness();

    expect(screen.getByTestId('viewMode')).toHaveTextContent('work');
  });

  it('enterWorkMode() stashes the current path, sets store to work, and navigates to /employee/schedule', () => {
    mockUseRestaurantContext.mockReturnValue({
      selectedRestaurant: { restaurant_id: 'rest-1', role: 'owner' },
    });
    mockUseCurrentEmployee.mockReturnValue({ currentEmployee: eligibleEmployee, loading: false });

    renderHarness('/dashboard');
    fireEvent.click(screen.getByRole('button', { name: 'Enter' }));

    const snapshot = getSnapshot();
    expect(snapshot.mode).toBe('work');
    expect(snapshot.restaurantId).toBe('rest-1');
    expect(snapshot.returnPath).toBe('/dashboard');
    expect(mockNavigate).toHaveBeenCalledWith('/employee/schedule');
  });

  it('enterWorkMode() is a no-op while already in (effective) work mode — does not clobber the stashed returnPath', () => {
    // Regression: clicking "My Work" again while already in work mode (e.g.
    // from an employee-only page reachable via the persona card, which is
    // gated only on canUseWorkView, not viewMode) must not re-stash the
    // current employee-page path over the originally-stashed admin route.
    storeEnterWorkMode('rest-1', '/dashboard');
    mockUseRestaurantContext.mockReturnValue({
      selectedRestaurant: { restaurant_id: 'rest-1', role: 'owner' },
    });
    mockUseCurrentEmployee.mockReturnValue({ currentEmployee: eligibleEmployee, loading: false });

    // Render as if currently on an employee-only page — enterWorkMode() would
    // otherwise stash THIS path as returnPath if it re-ran.
    renderHarness('/employee/pay');
    expect(screen.getByTestId('viewMode')).toHaveTextContent('work');

    fireEvent.click(screen.getByRole('button', { name: 'Enter' }));

    const snapshot = getSnapshot();
    expect(snapshot.returnPath).toBe('/dashboard');
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('exitWorkMode() sets store to admin and navigates to the stashed return path', () => {
    storeEnterWorkMode('rest-1', '/dashboard');
    mockUseRestaurantContext.mockReturnValue({
      selectedRestaurant: { restaurant_id: 'rest-1', role: 'owner' },
    });
    mockUseCurrentEmployee.mockReturnValue({ currentEmployee: eligibleEmployee, loading: false });

    renderHarness('/employee/schedule');
    fireEvent.click(screen.getByRole('button', { name: 'Exit' }));

    expect(getSnapshot().mode).toBe('admin');
    expect(mockNavigate).toHaveBeenCalledWith('/dashboard');
  });

  it('exitWorkMode() navigates to "/" when no return path was stashed', () => {
    storeEnterWorkMode('rest-1', '');
    mockUseRestaurantContext.mockReturnValue({
      selectedRestaurant: { restaurant_id: 'rest-1', role: 'owner' },
    });
    mockUseCurrentEmployee.mockReturnValue({ currentEmployee: eligibleEmployee, loading: false });

    renderHarness('/employee/schedule');
    fireEvent.click(screen.getByRole('button', { name: 'Exit' }));

    expect(mockNavigate).toHaveBeenCalledWith('/');
  });

  it('throws when useViewMode is used outside a ViewModeProvider', () => {
    const ConsoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    function Bare() {
      useViewMode();
      return null;
    }
    expect(() => render(<Bare />)).toThrow(/ViewModeProvider/);
    ConsoleErrorSpy.mockRestore();
  });
});
