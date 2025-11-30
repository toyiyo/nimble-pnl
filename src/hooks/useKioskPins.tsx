import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { EmployeePin } from '@/types/timeTracking';
import { useToast } from '@/hooks/use-toast';
import { generateNumericPin, hashString, isSimpleSequence } from '@/utils/kiosk';

export interface EmployeePinWithEmployee extends EmployeePin {
  employee?: {
    id: string;
    name: string;
    position?: string | null;
  };
}

const pinQueryKey = (restaurantId: string | null) => ['employeePins', restaurantId];

export const useEmployeePins = (restaurantId: string | null) => {
  const { data, isLoading, error } = useQuery({
    queryKey: pinQueryKey(restaurantId),
    queryFn: async () => {
      if (!restaurantId) return [];
      const { data, error } = await supabase
        .from('employee_pins')
        .select(`
          id,
          restaurant_id,
          employee_id,
          pin_hash,
          min_length,
          force_reset,
          last_used_at,
          created_at,
          updated_at,
          employee:employees(id, name, position)
        `)
        .eq('restaurant_id', restaurantId)
        .order('updated_at', { ascending: false });

      if (error) throw error;
      return data as EmployeePinWithEmployee[];
    },
    enabled: !!restaurantId,
    staleTime: 15000,
  });

  return {
    pins: data || [],
    loading: isLoading,
    error,
  };
};

type UpsertPinInput = {
  restaurant_id: string;
  employee_id: string;
  pin?: string;
  min_length?: number;
  force_reset?: boolean;
  allowSimpleSequence?: boolean;
};

export const useUpsertEmployeePin = () => {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (payload: UpsertPinInput) => {
      const minLength = Math.min(6, Math.max(payload.min_length || payload.pin?.length || 4, 4));
      const pinToUse = payload.pin || generateNumericPin(minLength);

      if (!payload.allowSimpleSequence && isSimpleSequence(pinToUse)) {
        throw new Error('PIN is too simple. Avoid sequential digits like 1234 or 9876.');
      }
      if (pinToUse.length < minLength) {
        throw new Error(`PIN must be at least ${minLength} digits.`);
      }

      const hashedPin = await hashString(pinToUse);

      const { data, error } = await supabase
        .from('employee_pins')
        .upsert(
          {
            restaurant_id: payload.restaurant_id,
            employee_id: payload.employee_id,
            pin_hash: hashedPin,
            min_length: minLength,
            force_reset: payload.force_reset ?? false,
          },
          { onConflict: 'restaurant_id,employee_id' }
        )
        .select(
          `
          id,
          restaurant_id,
          employee_id,
          pin_hash,
          min_length,
          force_reset,
          last_used_at,
          created_at,
          updated_at
        `
        )
        .single();

      if (error) {
        if (error.message?.toLowerCase().includes('duplicate key value') || error.code === '23505') {
          throw new Error('Another employee is already using that PIN for this location.');
        }
        throw error;
      }

      return { pin: pinToUse, record: data as EmployeePin };
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: pinQueryKey(result.record.restaurant_id) });
      toast({
        title: 'PIN saved',
        description: `New PIN ready to share securely with the employee.`,
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

export const useResetEmployeePin = () => {
  const upsert = useUpsertEmployeePin();
  return useMutation({
    mutationFn: async (payload: Omit<UpsertPinInput, 'pin'>) => {
      return upsert.mutateAsync({ ...payload, pin: undefined });
    },
  });
};

export const useDeleteEmployeePin = () => {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ id, restaurant_id }: { id: string; restaurant_id: string }) => {
      const { error } = await supabase.from('employee_pins').delete().match({ id, restaurant_id });
      if (error) throw error;
      return { restaurant_id };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: pinQueryKey(data.restaurant_id) });
      toast({
        title: 'PIN removed',
        description: 'Employee will need a new PIN before using kiosk mode.',
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Could not delete PIN',
        description: error.message,
        variant: 'destructive',
      });
    },
  });
};

export const verifyPinForRestaurant = async (
  restaurantId: string,
  pin: string
): Promise<EmployeePinWithEmployee | null> => {
  const hashedPin = await hashString(pin);
  const { data, error } = await supabase
    .from('employee_pins')
    .select(
      `
      id,
      restaurant_id,
      employee_id,
      pin_hash,
      min_length,
      force_reset,
      last_used_at,
      created_at,
      updated_at,
      employee:employees(id, name, position)
    `
    )
    .eq('restaurant_id', restaurantId)
    .eq('pin_hash', hashedPin)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data as EmployeePinWithEmployee | null;
};
