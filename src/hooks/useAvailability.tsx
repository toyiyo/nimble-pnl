import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { EmployeeAvailability, AvailabilityException } from '@/types/scheduling';
import { useCreateEntity, useUpdateEntity, useDeleteEntity } from './useCRUDEntity';

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
  return useCreateEntity<EmployeeAvailability>({
    tableName: 'employee_availability',
    queryKey: 'employee-availability',
    entityName: 'Availability',
    getRestaurantId: (data) => data.restaurant_id,
  });
};

export const useUpdateAvailability = () => {
  return useUpdateEntity<EmployeeAvailability>({
    tableName: 'employee_availability',
    queryKey: 'employee-availability',
    entityName: 'Availability',
    getRestaurantId: (data) => data.restaurant_id,
  });
};

export const useDeleteAvailability = () => {
  return useDeleteEntity<EmployeeAvailability>({
    tableName: 'employee_availability',
    queryKey: 'employee-availability',
    entityName: 'Availability',
    getRestaurantId: (data) => data.restaurant_id,
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
  return useCreateEntity<AvailabilityException>({
    tableName: 'availability_exceptions',
    queryKey: 'availability-exceptions',
    entityName: 'Exception',
    getRestaurantId: (data) => data.restaurant_id,
  });
};

export const useUpdateAvailabilityException = () => {
  return useUpdateEntity<AvailabilityException>({
    tableName: 'availability_exceptions',
    queryKey: 'availability-exceptions',
    entityName: 'Exception',
    getRestaurantId: (data) => data.restaurant_id,
  });
};

export const useDeleteAvailabilityException = () => {
  return useDeleteEntity<AvailabilityException>({
    tableName: 'availability_exceptions',
    queryKey: 'availability-exceptions',
    entityName: 'Exception',
    getRestaurantId: (data) => data.restaurant_id,
  });
};
