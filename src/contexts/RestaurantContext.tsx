import React, { createContext, useContext, useState, useEffect } from 'react';
import { UserRestaurant } from '@/hooks/useRestaurants';

interface RestaurantContextType {
  selectedRestaurant: UserRestaurant | null;
  setSelectedRestaurant: (restaurant: UserRestaurant | null) => void;
}

const RestaurantContext = createContext<RestaurantContextType | undefined>(undefined);

export function RestaurantProvider({ children }: { children: React.ReactNode }) {
  const [selectedRestaurant, setSelectedRestaurant] = useState<UserRestaurant | null>(null);

  // Persist selection in localStorage
  useEffect(() => {
    const stored = localStorage.getItem('selectedRestaurant');
    if (stored) {
      try {
        setSelectedRestaurant(JSON.parse(stored));
      } catch (error) {
        console.error('Failed to parse stored restaurant:', error);
        localStorage.removeItem('selectedRestaurant');
      }
    }
  }, []);

  const handleSetSelectedRestaurant = (restaurant: UserRestaurant | null) => {
    setSelectedRestaurant(restaurant);
    if (restaurant) {
      localStorage.setItem('selectedRestaurant', JSON.stringify(restaurant));
    } else {
      localStorage.removeItem('selectedRestaurant');
    }
  };

  return (
    <RestaurantContext.Provider value={{ 
      selectedRestaurant, 
      setSelectedRestaurant: handleSetSelectedRestaurant 
    }}>
      {children}
    </RestaurantContext.Provider>
  );
}

export function useRestaurantContext() {
  const context = useContext(RestaurantContext);
  if (context === undefined) {
    throw new Error('useRestaurantContext must be used within a RestaurantProvider');
  }
  return context;
}