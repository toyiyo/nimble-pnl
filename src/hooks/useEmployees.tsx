import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Employee } from '@/types/scheduling';
import { useToast } from '@/hooks/use-toast';

export const useEmployees = (restaurantId: string | null) => {
  const { toast } = useToast();

  const { data, isLoading, error } = useQuery({
    queryKey: ['employees', restaurantId],
    queryFn: async () => {
      if (!restaurantId) return [];

      const { data, error } = await supabase
        .from('employees')
        .select('*')
        .eq('restaurant_id', restaurantId)
        .order('name');

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
