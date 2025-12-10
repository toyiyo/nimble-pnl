import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Employee } from '@/types/scheduling';
import { useToast } from '@/hooks/use-toast';

export type EmployeeStatusFilter = 'active' | 'inactive' | 'all';

interface UseEmployeesOptions {
  status?: EmployeeStatusFilter;
}

const defaultOptions: UseEmployeesOptions = { status: 'active' };

export const useEmployees = (
  restaurantId: string | null,
  options: UseEmployeesOptions = defaultOptions
) => {
  const { status = 'active' } = options;

  const { data, isLoading, error } = useQuery({
    queryKey: ['employees', restaurantId, status],
    queryFn: async () => {
      if (!restaurantId) return [];

      let query = supabase
        .from('employees')
        .select('*')
        .eq('restaurant_id', restaurantId);

      // Apply status filter
      if (status === 'active') {
        query = query.eq('is_active', true);
      } else if (status === 'inactive') {
        query = query.eq('is_active', false);
      }
      // 'all' = no filter

      query = query.order('name');

      const { data, error } = await query;

      if (error) throw error;
      return data as Employee[];
    },
    enabled: !!restaurantId,
    staleTime: 30000, // 30 seconds
    refetchOnWindowFocus: true,
    refetchOnMount: true,
  });

  return {
    employees: data || [],
    loading: isLoading,
    error,
  };
};

export const useCreateEmployee = () => {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (employee: Omit<Employee, 'id' | 'created_at' | 'updated_at'>) => {
      const { data, error } = await supabase
        .from('employees')
        .insert(employee)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['employees', data.restaurant_id] });
      toast({
        title: 'Employee created',
        description: `${data.name} has been added to the team.`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Error creating employee',
        description: error.message,
        variant: 'destructive',
      });
    },
  });
};

export const useUpdateEmployee = () => {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ id, ...updates }: Partial<Employee> & { id: string }) => {
      const { data, error } = await supabase
        .from('employees')
        .update(updates)
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['employees', data.restaurant_id] });
      toast({
        title: 'Employee updated',
        description: `${data.name}'s information has been updated.`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Error updating employee',
        description: error.message,
        variant: 'destructive',
      });
    },
  });
};

export const useDeleteEmployee = () => {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ id, restaurantId }: { id: string; restaurantId: string }) => {
      const { error } = await supabase
        .from('employees')
        .delete()
        .eq('id', id);

      if (error) throw error;
      return { id, restaurantId };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['employees', data.restaurantId] });
      toast({
        title: 'Employee deleted',
        description: 'The employee has been removed.',
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Error deleting employee',
        description: error.message,
        variant: 'destructive',
      });
    },
  });
};

export interface DeactivateEmployeeParams {
  employeeId: string;
  reason?: string;
  removeFromSchedules?: boolean;
}

export const useDeactivateEmployee = () => {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ employeeId, reason, removeFromSchedules = true }: DeactivateEmployeeParams) => {
      // Get current user
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('User not authenticated');

      // Call the database function for deactivation
      const { data, error } = await supabase.rpc('deactivate_employee', {
        p_employee_id: employeeId,
        p_deactivated_by: user.id,
        p_reason: reason || null,
        p_remove_from_future_shifts: removeFromSchedules,
      });

      if (error) throw error;
      return data;
    },
    onSuccess: (data, variables) => {
      // Invalidate all employee queries for this restaurant
      queryClient.invalidateQueries({ queryKey: ['employees'] });
      toast({
        title: 'Employee deactivated',
        description: 'The employee has been deactivated and will no longer appear in active lists.',
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Error deactivating employee',
        description: error.message,
        variant: 'destructive',
      });
    },
  });
};

export interface ReactivateEmployeeParams {
  employeeId: string;
  hourlyRate?: number; // Optional: update rate during reactivation
  confirmPin?: boolean; // Whether PIN should remain active (for UI flow)
}

export const useReactivateEmployee = () => {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ employeeId, hourlyRate }: ReactivateEmployeeParams) => {
      // Get current user
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('User not authenticated');

      // Call the database function for reactivation
      const { data, error } = await supabase.rpc('reactivate_employee', {
        p_employee_id: employeeId,
        p_reactivated_by: user.id,
        p_new_hourly_rate: hourlyRate || null,
      });

      if (error) throw error;
      return data;
    },
    onSuccess: (data, variables) => {
      // Invalidate all employee queries
      queryClient.invalidateQueries({ queryKey: ['employees'] });
      toast({
        title: 'Employee reactivated',
        description: 'The employee has been reactivated and can now log in, punch, and be scheduled.',
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Error reactivating employee',
        description: error.message,
        variant: 'destructive',
      });
    },
  });
};
