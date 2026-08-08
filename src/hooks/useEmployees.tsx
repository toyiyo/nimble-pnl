import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Employee } from '@/types/scheduling';
import { useToast } from '@/hooks/use-toast';
import { usePermissions } from '@/hooks/usePermissions';
import {
  maskedEmployeeFields,
  stripMaskedEmployeeFields,
} from '@/lib/employeeMaskedFields';

export type EmployeeStatusFilter = 'active' | 'inactive' | 'all';

interface UseEmployeesOptions {
  status?: EmployeeStatusFilter;
  employeeId?: string;
}

const defaultOptions: UseEmployeesOptions = { status: 'active' };

// Stable reference for the "no data yet" case. `data || []` would otherwise
// allocate a fresh empty array on every render while the query is loading,
// which breaks referential equality for any useMemo/useEffect keyed on the
// returned `employees` array — capable of driving an infinite render loop in
// a consumer that both derives from it and writes state back on every change
// (see src/pages/Tips.tsx).
const EMPTY_EMPLOYEES: Employee[] = [];

export const useEmployees = (
  restaurantId: string | null,
  options: UseEmployeesOptions = defaultOptions
) => {
  const { status = 'active', employeeId } = options;

  const { data, isLoading, error } = useQuery({
    queryKey: ['employees', restaurantId, status, employeeId],
    queryFn: async () => {
      if (!restaurantId) return [];

      let query = supabase
        .from('employees')
        .select(`
          *,
          compensation_history:employee_compensation_history(*)
        `)
        .eq('restaurant_id', restaurantId);

      // Apply status filter
      if (status === 'active') {
        query = query.eq('is_active', true);
      } else if (status === 'inactive') {
        query = query.eq('is_active', false);
      }
      // 'all' = no filter

      if (employeeId) {
        query = query.eq('id', employeeId);
      }

      query = query
        .order('name')
        .order('effective_date', { referencedTable: 'employee_compensation_history', ascending: false });

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
    employees: data ?? EMPTY_EMPLOYEES,
    loading: isLoading,
    error,
  };
};

export const useCreateEmployee = () => {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { hasCapability, isResolved } = usePermissions();

  return useMutation({
    mutationFn: async (employee: Omit<Employee, 'id' | 'created_at' | 'updated_at'>) => {
      // A caller with no flag cannot read these columns, so the form holds
      // NULL for them. Writing that NULL back would erase the stored value.
      const masked = maskedEmployeeFields({
        payRates: isResolved && hasCapability('view:pay_rates'),
        employeePii: isResolved && hasCapability('view:employee_pii'),
      });

      const { data, error } = await supabase
        .from('employees')
        .insert(stripMaskedEmployeeFields(employee, masked))
        .select('id, restaurant_id, name')
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
  const { hasCapability, isResolved } = usePermissions();

  return useMutation({
    mutationFn: async ({ id, ...updates }: Partial<Employee> & { id: string }) => {
      const masked = maskedEmployeeFields({
        payRates: isResolved && hasCapability('view:pay_rates'),
        employeePii: isResolved && hasCapability('view:employee_pii'),
      });

      const { data, error } = await supabase
        .from('employees')
        .update(stripMaskedEmployeeFields(updates, masked))
        .eq('id', id)
        .select('id, restaurant_id, name')
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
  terminationDate: string; // CRITICAL: Required for payroll calculations
}

export const useDeactivateEmployee = () => {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ employeeId, reason, removeFromSchedules = true, terminationDate }: DeactivateEmployeeParams) => {
      // Get current user
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('User not authenticated');

      // Call the database function for deactivation
      const { data, error } = await supabase.rpc('deactivate_employee', {
        p_employee_id: employeeId,
        p_deactivated_by: user.id,
        p_reason: reason || null,
        p_remove_from_future_shifts: removeFromSchedules,
        p_termination_date: terminationDate,
      });

      if (error) throw error;
      if (!data) throw new Error('deactivate_employee returned no employee row');
      return data;
    },
    onSuccess: () => {
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
      if (!data) throw new Error('reactivate_employee returned no employee row');
      return data;
    },
    onSuccess: () => {
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
