import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

export interface InventoryLocation {
  id: string;
  restaurant_id: string;
  name: string;
  created_at: string;
}

export const useInventoryLocations = (restaurantId: string | null) => {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Fetch locations
  const { data: locations, isLoading, error } = useQuery({
    queryKey: ['inventory-locations', restaurantId],
    queryFn: async () => {
      if (!restaurantId) return [];

      const { data, error } = await (supabase as any)
        .from('inventory_locations')
        .select('*')
        .eq('restaurant_id', restaurantId)
        .order('name', { ascending: true });

      if (error) throw error;
      return data as InventoryLocation[];
    },
    enabled: !!restaurantId,
    staleTime: 30000, // 30 seconds
  });

  // Create new location
  const createLocationMutation = useMutation({
    mutationFn: async (name: string) => {
      if (!restaurantId) throw new Error('Restaurant ID is required');

      // Check if location already exists (case-insensitive)
      const existing = locations?.find(
        loc => loc.name.toLowerCase() === name.toLowerCase()
      );

      if (existing) {
        return existing; // Return existing location
      }

      const locationData = {
        restaurant_id: restaurantId,
        name: name.trim(),
      };

      const { data, error } = await (supabase as any)
        .from('inventory_locations')
        .insert([{ restaurant_id: restaurantId, name: name.trim() }])
        .select()
        .single();

      if (error) throw error;
      return data as InventoryLocation;
    },
    onSuccess: (newLocation) => {
      queryClient.setQueryData(
        ['inventory-locations', restaurantId],
        (old: InventoryLocation[] | undefined) => {
          if (!old) return [newLocation];
          // Check if already exists to avoid duplicates
          if (old.some(loc => loc.id === newLocation.id)) return old;
          return [...old, newLocation].sort((a, b) => a.name.localeCompare(b.name));
        }
      );
    },
    onError: (error: any) => {
      console.error('Error creating location:', error);
      toast({
        title: 'Error',
        description: 'Failed to create location',
        variant: 'destructive',
      });
    },
  });

  // Delete location
  const deleteLocationMutation = useMutation({
    mutationFn: async (locationId: string) => {
      const { error } = await (supabase as any)
        .from('inventory_locations')
        .delete()
        .eq('id', locationId);

      if (error) throw error;
    },
    onSuccess: (_, locationId) => {
      queryClient.setQueryData(
        ['inventory-locations', restaurantId],
        (old: InventoryLocation[] | undefined) => {
          if (!old) return [];
          return old.filter(loc => loc.id !== locationId);
        }
      );
      toast({
        title: 'Success',
        description: 'Location deleted',
      });
    },
    onError: (error: any) => {
      console.error('Error deleting location:', error);
      toast({
        title: 'Error',
        description: 'Failed to delete location',
        variant: 'destructive',
      });
    },
  });

  return {
    locations: locations || [],
    isLoading,
    error,
    createLocation: createLocationMutation.mutateAsync,
    deleteLocation: deleteLocationMutation.mutateAsync,
    isCreating: createLocationMutation.isPending,
  };
};
