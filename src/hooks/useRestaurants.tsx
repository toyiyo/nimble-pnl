import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';
import { useToast } from './use-toast';

export interface Restaurant {
  id: string;
  name: string;
  address?: string;
  phone?: string;
  cuisine_type?: string;
  created_at: string;
  updated_at: string;
}

export interface UserRestaurant {
  id: string;
  user_id: string;
  restaurant_id: string;
  role: 'owner' | 'manager' | 'chef' | 'staff';
  created_at: string;
  restaurant: Restaurant;
}

export function useRestaurants() {
  const [restaurants, setRestaurants] = useState<UserRestaurant[]>([]);
  const [loading, setLoading] = useState(true);
  const { user } = useAuth();
  const { toast } = useToast();

  const fetchRestaurants = async () => {
    if (!user) return;

    try {
      const { data, error } = await supabase
        .from('user_restaurants')
        .select(`
          *,
          restaurant:restaurants(*)
        `)
        .eq('user_id', user.id);

      if (error) throw error;
      setRestaurants((data || []) as UserRestaurant[]);
    } catch (error: any) {
      toast({
        title: "Error fetching restaurants",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const createRestaurant = async (restaurantData: {
    name: string;
    address?: string;
    phone?: string;
    cuisine_type?: string;
  }) => {
    if (!user) return null;

    try {
      const { data, error } = await supabase.rpc('create_restaurant_with_owner', {
        restaurant_name: restaurantData.name,
        restaurant_address: restaurantData.address,
        restaurant_phone: restaurantData.phone,
        restaurant_cuisine_type: restaurantData.cuisine_type,
      });

      if (error) throw error;

      toast({
        title: "Restaurant created!",
        description: `${restaurantData.name} has been added successfully.`,
      });

      // Refresh the list
      await fetchRestaurants();
      return data;
    } catch (error: any) {
      toast({
        title: "Error creating restaurant",
        description: error.message,
        variant: "destructive",
      });
      return null;
    }
  };

  const updateRestaurant = async (restaurantId: string, updates: Partial<Restaurant>) => {
    try {
      const { error } = await supabase
        .from('restaurants')
        .update(updates)
        .eq('id', restaurantId);

      if (error) throw error;

      toast({
        title: "Restaurant updated!",
        description: "Changes have been saved successfully.",
      });

      await fetchRestaurants();
    } catch (error: any) {
      toast({
        title: "Error updating restaurant",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  useEffect(() => {
    fetchRestaurants();
  }, [user]);

  return {
    restaurants,
    loading,
    createRestaurant,
    updateRestaurant,
    refetch: fetchRestaurants,
  };
}