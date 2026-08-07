import React, { createContext, useCallback, useContext, useMemo, useSyncExternalStore } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { useCurrentEmployee } from '@/hooks/useCurrentEmployee';
import { useRestaurantContext } from '@/contexts/RestaurantContext';
import { computeCanUseWorkView } from '@/lib/viewModeEligibility';
import {
  enterWorkMode as storeEnterWorkMode,
  exitWorkMode as storeExitWorkMode,
  getSnapshot,
  subscribe,
  type ViewMode,
} from '@/contexts/viewModeStore';

/**
 * `ViewModeProvider` / `useViewMode` — the Admin ↔ My Work view-mode lens.
 *
 * Reads the `viewModeStore` module singleton via `useSyncExternalStore` and
 * derives the *effective* `viewMode` optimistically so that entering work
 * mode (which navigates and remounts `RestaurantProvider`) never flashes the
 * admin chrome while `selectedRestaurant` / `currentEmployee` are still
 * resolving. It only downgrades to `'admin'` once a mismatch or ineligibility
 * is *confirmed* (not merely "not yet loaded").
 *
 * `viewMode` is a display lens only — it never mutates `role`, and every RLS
 * policy / permission check is untouched.
 *
 * See docs/superpowers/specs/2026-07-24-admin-work-view-mode-design.md
 * ("State model" section).
 */

interface ViewModeContextValue {
  viewMode: ViewMode;
  canUseWorkView: boolean;
  isWorkViewResolved: boolean;
  enterWorkMode: () => void;
  exitWorkMode: () => void;
}

const ViewModeContext = createContext<ViewModeContextValue | undefined>(undefined);

export function useViewMode(): ViewModeContextValue {
  const context = useContext(ViewModeContext);
  if (context === undefined) {
    throw new Error('useViewMode must be used within a ViewModeProvider');
  }
  return context;
}

interface ViewModeProviderProps {
  children: React.ReactNode;
}

export function ViewModeProvider({ children }: ViewModeProviderProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const { selectedRestaurant } = useRestaurantContext();
  const restaurantId = selectedRestaurant?.restaurant_id ?? null;
  const { currentEmployee, loading: employeeLoading } = useCurrentEmployee(restaurantId);
  const store = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const canUseWorkView = computeCanUseWorkView({
    currentEmployee,
    role: selectedRestaurant?.role,
  });

  // selectedRestaurant re-hydrates from localStorage async, so it is briefly
  // null right after enterWorkMode()'s navigate() remounts RestaurantProvider.
  // Downgrade to 'admin' ONLY once we can confirm a real mismatch/ineligibility
  // — never while restaurant context or employee eligibility is still loading.
  const storeSaysWork = store.mode === 'work' && store.restaurantId != null;
  const confirmedWrongRestaurant =
    !!selectedRestaurant && selectedRestaurant.restaurant_id !== store.restaurantId;
  // `useCurrentEmployee` is a React Query `enabled: !!restaurantId` query. A
  // *disabled* query never fetches, so `isLoading` (isPending && isFetching)
  // reports false even though eligibility has never actually resolved. Guard
  // with `!!selectedRestaurant` so the brief remount window — where
  // selectedRestaurant is null and the query is therefore disabled — is never
  // mistaken for a confirmed "not eligible" result.
  const isWorkViewResolved = !!selectedRestaurant && !employeeLoading;
  const confirmedIneligible = isWorkViewResolved && !canUseWorkView;

  const viewMode: ViewMode =
    storeSaysWork && !confirmedWrongRestaurant && !confirmedIneligible ? 'work' : 'admin';

  const enterWorkMode = useCallback(() => {
    // Guard against re-entry while already in (effective) work mode: without
    // this, clicking "My Work" again from an employee page (e.g. after
    // enterWorkMode() already navigated once) would re-stash the current
    // employee-page path as returnPath, clobbering the original admin route
    // that exitWorkMode should return to.
    if (!restaurantId || viewMode === 'work') return;
    // Stash pathname + search + hash (not just pathname) so filters, tab
    // selection, etc. survive the round trip back via exitWorkMode().
    storeEnterWorkMode(restaurantId, location.pathname + location.search + location.hash);
    navigate('/employee/schedule');
  }, [restaurantId, location.pathname, location.search, location.hash, navigate, viewMode]);

  const exitWorkMode = useCallback(() => {
    // Symmetric with enterWorkMode's re-entry guard: if the effective
    // viewMode is already 'admin', clicking the already-active "Admin"
    // segment must not navigate to a possibly-stale stashed returnPath.
    if (viewMode === 'admin') return;
    storeExitWorkMode();
    navigate(getSnapshot().returnPath || '/');
  }, [navigate, viewMode]);

  const value = useMemo<ViewModeContextValue>(
    () => ({ viewMode, canUseWorkView, isWorkViewResolved, enterWorkMode, exitWorkMode }),
    [viewMode, canUseWorkView, isWorkViewResolved, enterWorkMode, exitWorkMode]
  );

  return <ViewModeContext.Provider value={value}>{children}</ViewModeContext.Provider>;
}
