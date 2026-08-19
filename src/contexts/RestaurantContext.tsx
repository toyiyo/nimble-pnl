import React, { createContext, useContext, useState, useEffect, useMemo, useCallback, ReactNode } from 'react';
import { usePostHog } from 'posthog-js/react';
import { useRestaurants, UserRestaurant } from '@/hooks/useRestaurants';
import { useAuth } from '@/hooks/useAuth';
import { canUserCreateRestaurant } from '@/lib/restaurantPermissions';

interface RestaurantContextType {
  selectedRestaurant: UserRestaurant | null;
  setSelectedRestaurant: (restaurant: UserRestaurant | null) => void;
  restaurants: UserRestaurant[];
  loading: boolean;
  canCreateRestaurant: boolean;
  createRestaurant: (data: {
    name: string;
    address?: string;
    phone?: string;
    cuisine_type?: string;
    timezone?: string;
  }) => Promise<any>;
}

const RestaurantContext = createContext<RestaurantContextType | undefined>(undefined);

export const useRestaurantContext = () => {
  const context = useContext(RestaurantContext);
  if (context === undefined) {
    throw new Error('useRestaurantContext must be used within a RestaurantProvider');
  }
  return context;
};

interface RestaurantProviderProps {
  children: ReactNode;
}

export const RestaurantProvider: React.FC<RestaurantProviderProps> = ({ children }) => {
  const { user } = useAuth();
  const { restaurants, loading, createRestaurant } = useRestaurants();
  // Only an *explicit* pick lives in state. The automatic pick (a saved choice,
  // or the sole membership) is derived during render below.
  const [chosenRestaurantId, setChosenRestaurantId] = useState<string | null>(null);

  const storageKey = user ? `selectedRestaurant_${user.id}` : null;

  // Derived, not stored in an effect, for two reasons:
  //
  // 1. `StaffRoleChecker` (src/App.tsx) holds every protected route until
  //    `loading` clears, then reads `selectedRestaurant?.role` to decide whether
  //    a kiosk / staff / collaborator user belongs on the current path. Setting
  //    the selection from an effect left one commit where `loading` was already
  //    false but the selection was still null — `role` came back `undefined`,
  //    every guard evaluated falsy, and the page those guards exist to block
  //    rendered and fired its queries before the redirect landed.
  // 2. Re-resolving against the freshest `restaurants` keeps the role current.
  //    The old code stored a snapshot object, so an auto-selected membership
  //    kept the role it was fetched with: a demotion picked up by a refetch
  //    never reached the guards without a full reload.
  const selectedRestaurant = useMemo(() => {
    if (!storageKey || restaurants.length === 0) return null;
    const byId = (id: string | null) =>
      (id ? restaurants.find(r => r.restaurant_id === id) : undefined) ?? null;

    return (
      byId(chosenRestaurantId) ??
      byId(localStorage.getItem(storageKey)) ??
      // With several memberships and nothing saved, there is no right answer to
      // guess — Index.tsx renders a "Select or create a restaurant" screen for
      // exactly this state.
      (restaurants.length === 1 ? restaurants[0] : null)
    );
  }, [storageKey, restaurants, chosenRestaurantId]);

  const posthog = usePostHog();

  // Tell PostHog which restaurant the user works in, so a feature flag can
  // target named customers.
  //
  // The group call belongs here, not in `recordAuthEvents`. A user can hold
  // several restaurants, and `recordAuthEvents` runs before any selection.
  //
  // Send the restaurant id only. Never send the restaurant name. See the
  // "PII minimization" rule at `src/lib/analytics.ts:223`.
  useEffect(() => {
    if (!posthog || !selectedRestaurant?.restaurant_id) return;
    posthog.group('restaurant', selectedRestaurant.restaurant_id);
  }, [posthog, selectedRestaurant?.restaurant_id]);

  // Clear selection when user changes
  useEffect(() => {
    if (!user) {
      setChosenRestaurantId(null);
      // Clear all localStorage entries for restaurant selection
      Object.keys(localStorage).forEach(key => {
        if (key.startsWith('selectedRestaurant_')) {
          localStorage.removeItem(key);
        }
      });
    }
  }, [user]);

  // Enhanced setSelectedRestaurant that persists to localStorage
  const handleSetSelectedRestaurant = useCallback((restaurant: UserRestaurant | null) => {
    setChosenRestaurantId(restaurant?.restaurant_id ?? null);
    if (storageKey && restaurant) {
      localStorage.setItem(storageKey, restaurant.restaurant_id);
    } else if (storageKey) {
      localStorage.removeItem(storageKey);
    }
  }, [storageKey]);

  // Centralized logic: Allow creation if user has no restaurants (first-time) OR is an owner
  const canCreateRestaurant = canUserCreateRestaurant(restaurants);

  // Memoize context value to prevent unnecessary re-renders
  const value = useMemo(() => ({
    selectedRestaurant,
    setSelectedRestaurant: handleSetSelectedRestaurant,
    restaurants,
    loading,
    canCreateRestaurant,
    createRestaurant,
  }), [selectedRestaurant, handleSetSelectedRestaurant, restaurants, loading, canCreateRestaurant, createRestaurant]);

  return (
    <RestaurantContext.Provider value={value}>
      {children}
    </RestaurantContext.Provider>
  );
};