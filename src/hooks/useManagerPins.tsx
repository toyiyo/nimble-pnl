import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { hashString } from '@/utils/kiosk';
import { useToast } from '@/hooks/use-toast';

export interface ManagerPin {
  id: string;
  restaurant_id: string;
  manager_user_id: string;
  pin_hash: string;
  min_length: number;
  last_used_at?: string | null;
  created_at: string;
  updated_at: string;
}

const managerPinKey = (restaurantId: string | null, userId: string | null | undefined) => [
  'managerPin',
  restaurantId,
  userId,
];

export const useManagerPin = (restaurantId: string | null, userId: string | null | undefined) => {
  const { data, isLoading } = useQuery({
    queryKey: managerPinKey(restaurantId, userId),
    queryFn: async () => {
      if (!restaurantId || !userId) return null;
      const { data, error } = await supabase
        .from('manager_pins')
        .select('*')
        .eq('restaurant_id', restaurantId)
        .eq('manager_user_id', userId)
        .maybeSingle();
      if (error) throw error;
      return (data as ManagerPin) || null;
    },
    enabled: !!restaurantId && !!userId,
    staleTime: 15000,
  });

  return {
    pin: data,
    loading: isLoading,
  };
};

type UpsertInput = {
  restaurant_id: string;
  manager_user_id: string;
  pin: string;
  min_length?: number;
};

export const useUpsertManagerPin = () => {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (payload: UpsertInput) => {
      const minLength = Math.min(6, Math.max(payload.min_length || payload.pin.length, 4));
      if (payload.pin.length < minLength) {
        throw new Error(`PIN must be at least ${minLength} digits.`);
      }
      const hashed = await hashString(payload.pin);
      const { data, error } = await supabase
        .from('manager_pins')
        .upsert(
          {
            restaurant_id: payload.restaurant_id,
            manager_user_id: payload.manager_user_id,
            pin_hash: hashed,
            min_length: minLength,
          },
          { onConflict: 'restaurant_id,manager_user_id' }
        )
        .select('*')
        .single();
      if (error) {
        if (error.message?.toLowerCase().includes('duplicate key')) {
          throw new Error('Another manager PIN is using that code for this location.');
        }
        throw error;
      }
      return data as ManagerPin;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: managerPinKey(data.restaurant_id, data.manager_user_id) });
      toast({
        title: 'Manager PIN saved',
        description: 'Use this PIN to exit kiosk mode on this device.',
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Could not save PIN',
        description: error.message,
        variant: 'destructive',
      });
    },
  });
};

export const verifyManagerPin = async (restaurantId: string, pin: string) => {
  const hashed = await hashString(pin);
  const { data, error } = await supabase
    .from('manager_pins')
    .select('*')
    .eq('restaurant_id', restaurantId)
    .eq('pin_hash', hashed)
    .maybeSingle();
  if (error) throw error;
  return data as ManagerPin | null;
};
