import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { useRestaurants, UserRestaurant } from '@/hooks/useRestaurants';
import { useAuth } from '@/hooks/useAuth';

interface RestaurantContextType {
  selectedRestaurant: UserRestaurant | null;
  setSelectedRestaurant: (restaurant: UserRestaurant | null) => void;
  restaurants: UserRestaurant[];
  loading: boolean;
  createRestaurant: (data: {
    name: string;
    address?: string;
    phone?: string;
    cuisine_type?: string;
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
  const [selectedRestaurant, setSelectedRestaurant] = useState<UserRestaurant | null>(null);

  // Auto-select first restaurant if only one exists and none is selected
  useEffect(() => {
    if (restaurants.length === 1 && !selectedRestaurant) {
      setSelectedRestaurant(restaurants[0]);
    }
  }, [restaurants, selectedRestaurant]);

  // Clear selection when user changes
  useEffect(() => {
    if (!user) {
      setSelectedRestaurant(null);
    }
  }, [user]);

  const value = {
    selectedRestaurant,
    setSelectedRestaurant,
    restaurants,
    loading,
    createRestaurant,
  };

  return (
    <RestaurantContext.Provider value={value}>
      {children}
    </RestaurantContext.Provider>
  );
};