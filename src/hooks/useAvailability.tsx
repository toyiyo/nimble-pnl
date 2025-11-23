import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { EmployeeAvailability, AvailabilityException } from '@/types/scheduling';
import { useToast } from '@/hooks/use-toast';

// Hook for managing recurring availability
export const useEmployeeAvailability = (restaurantId: string | null, employeeId?: string) => {
  const { data, isLoading, error } = useQuery({
    queryKey: ['employee-availability', restaurantId, employeeId],
    queryFn: async () => {
      if (!restaurantId) return [];

      let query = supabase
        .from('employee_availability')
        .select('*')
        .eq('restaurant_id', restaurantId);

      if (employeeId) {
        query = query.eq('employee_id', employeeId);
      }

      const { data, error } = await query.order('day_of_week');

      if (error) throw error;
      return data as EmployeeAvailability[];
    },
    enabled: !!restaurantId,
    staleTime: 30000, // 30 seconds
    refetchOnWindowFocus: true,
    refetchOnMount: true,
  });

  return {
    availability: data || [],
    loading: isLoading,
    error,
  };
};

export const useCreateAvailability = () => {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (availability: Omit<EmployeeAvailability, 'id' | 'created_at' | 'updated_at'>) => {
      const { data, error } = await supabase
        .from('employee_availability')
        .insert(availability)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['employee-availability', data.restaurant_id] });
      toast({
        title: 'Availability saved',
        description: 'Employee availability has been updated.',
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Error saving availability',
        description: error.message,
        variant: 'destructive',
      });
    },
  });
};

export const useUpdateAvailability = () => {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ id, ...updates }: Partial<EmployeeAvailability> & { id: string }) => {
      const { data, error } = await supabase
        .from('employee_availability')
        .update(updates)
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['employee-availability', data.restaurant_id] });
      toast({
        title: 'Availability updated',
        description: 'Employee availability has been updated.',
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Error updating availability',
        description: error.message,
        variant: 'destructive',
      });
    },
  });
};

export const useDeleteAvailability = () => {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ id, restaurantId }: { id: string; restaurantId: string }) => {
      const { error } = await supabase
        .from('employee_availability')
        .delete()
        .eq('id', id);

      if (error) throw error;
      return { id, restaurantId };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['employee-availability', data.restaurantId] });
      toast({
        title: 'Availability deleted',
        description: 'Employee availability has been removed.',
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Error deleting availability',
        description: error.message,
        variant: 'destructive',
      });
    },
  });
};

// Hook for managing availability exceptions
export const useAvailabilityExceptions = (restaurantId: string | null, employeeId?: string) => {
  const { data, isLoading, error } = useQuery({
    queryKey: ['availability-exceptions', restaurantId, employeeId],
    queryFn: async () => {
      if (!restaurantId) return [];

      let query = supabase
        .from('availability_exceptions')
        .select('*')
        .eq('restaurant_id', restaurantId);

      if (employeeId) {
        query = query.eq('employee_id', employeeId);
      }

      const { data, error } = await query.order('date');

      if (error) throw error;
      return data as AvailabilityException[];
    },
    enabled: !!restaurantId,
    staleTime: 30000, // 30 seconds
    refetchOnWindowFocus: true,
    refetchOnMount: true,
  });

  return {
    exceptions: data || [],
    loading: isLoading,
    error,
  };
};

export const useCreateAvailabilityException = () => {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (exception: Omit<AvailabilityException, 'id' | 'created_at' | 'updated_at'>) => {
      const { data, error } = await supabase
        .from('availability_exceptions')
        .insert(exception)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['availability-exceptions', data.restaurant_id] });
      toast({
        title: 'Exception saved',
        description: 'Availability exception has been added.',
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Error saving exception',
        description: error.message,
        variant: 'destructive',
      });
    },
  });
};

export const useUpdateAvailabilityException = () => {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ id, ...updates }: Partial<AvailabilityException> & { id: string }) => {
      const { data, error } = await supabase
        .from('availability_exceptions')
        .update(updates)
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['availability-exceptions', data.restaurant_id] });
      toast({
        title: 'Exception updated',
        description: 'Availability exception has been updated.',
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Error updating exception',
        description: error.message,
        variant: 'destructive',
      });
    },
  });
};

export const useDeleteAvailabilityException = () => {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ id, restaurantId }: { id: string; restaurantId: string }) => {
      const { error } = await supabase
        .from('availability_exceptions')
        .delete()
        .eq('id', id);

      if (error) throw error;
      return { id, restaurantId };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['availability-exceptions', data.restaurantId] });
      toast({
        title: 'Exception deleted',
        description: 'Availability exception has been removed.',
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Error deleting exception',
        description: error.message,
        variant: 'destructive',
      });
    },
  });
};
