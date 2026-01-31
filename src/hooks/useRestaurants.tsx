import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';
import { useToast } from './use-toast';
import { createDefaultChartOfAccounts } from '@/lib/chartOfAccountsUtils';

export interface Restaurant {
  id: string;
  name: string;
  address?: string;
  phone?: string;
  cuisine_type?: string;
  timezone?: string;
  created_at: string;
  updated_at: string;
  // Subscription fields
  subscription_tier?: 'starter' | 'growth' | 'pro';
  subscription_status?: 'trialing' | 'active' | 'past_due' | 'canceled' | 'grandfathered';
  subscription_period?: 'monthly' | 'annual';
  stripe_subscription_customer_id?: string;
  stripe_subscription_id?: string;
  trial_ends_at?: string;
  subscription_ends_at?: string;
  grandfathered_until?: string;
}

export interface UserRestaurant {
  id: string;
  user_id: string;
  restaurant_id: string;
  role: 'owner' | 'manager' | 'chef' | 'staff' | 'kiosk' | 'collaborator_accountant' | 'collaborator_inventory' | 'collaborator_chef';
  created_at: string;
  restaurant: Restaurant;
}

export function useRestaurants() {
  const [restaurants, setRestaurants] = useState<UserRestaurant[]>([]);
  const [loading, setLoading] = useState(true);
  const { user } = useAuth();
  const { toast } = useToast();

  const fetchRestaurants = useCallback(async () => {
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
  }, [user, toast]);

  const createRestaurant = async (restaurantData: {
    name: string;
    address?: string;
    phone?: string;
    cuisine_type?: string;
    timezone?: string;
  }) => {
    if (!user) return null;

    try {
      const { data, error } = await supabase.rpc('create_restaurant_with_owner', {
        restaurant_name: restaurantData.name,
        restaurant_address: restaurantData.address,
        restaurant_phone: restaurantData.phone,
        restaurant_cuisine_type: restaurantData.cuisine_type,
        restaurant_timezone: restaurantData.timezone || 'America/Chicago',
      });

      if (error) throw error;

      // Automatically create default chart of accounts
      try {
        await createDefaultChartOfAccounts(supabase, data);
      } catch (coaError) {
        console.error('Failed to create default chart of accounts:', coaError);
        // Don't block flow, user can try manually later
        toast({
          title: "Setup Note",
          description: "Restaurant created, but default accounts could not be generated automatically. You can add them from the Chart of Accounts page.",
        });
      }

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
  }, [fetchRestaurants]);

  return {
    restaurants,
    loading,
    createRestaurant,
    updateRestaurant,
    refetch: fetchRestaurants,
  };
}
