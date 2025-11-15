import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { TimePunch, PunchStatus } from '@/types/timeTracking';
import { useToast } from '@/hooks/use-toast';

export const useTimePunches = (restaurantId: string | null, employeeId?: string, startDate?: Date, endDate?: Date) => {
  const { toast } = useToast();

  const { data, isLoading, error } = useQuery({
    queryKey: ['timePunches', restaurantId, employeeId, startDate?.toISOString(), endDate?.toISOString()],
    queryFn: async () => {
      if (!restaurantId) return [];

      let query = supabase
        .from('time_punches')
        .select('*, employee:employees(id, name, position)')
        .eq('restaurant_id', restaurantId);

      if (employeeId) {
        query = query.eq('employee_id', employeeId);
      }
      if (startDate) {
        query = query.gte('punch_time', startDate.toISOString());
      }
      if (endDate) {
        query = query.lte('punch_time', endDate.toISOString());
      }

      const { data, error } = await query.order('punch_time', { ascending: false });

      if (error) throw error;
      return data as TimePunch[];
    },
    enabled: !!restaurantId,
    staleTime: 10000, // 10 seconds for real-time updates
    refetchOnWindowFocus: true,
    refetchOnMount: true,
  });

  return {
    punches: data || [],
    loading: isLoading,
    error,
  };
};

export const useEmployeePunchStatus = (employeeId: string | null) => {
  const { data, isLoading, error } = useQuery({
    queryKey: ['punchStatus', employeeId],
    queryFn: async () => {
      if (!employeeId) return null;

      const { data, error } = await supabase.rpc('get_employee_punch_status', {
        p_employee_id: employeeId,
      });

      if (error) throw error;
      return data && data.length > 0 ? data[0] as PunchStatus : null;
    },
    enabled: !!employeeId,
    staleTime: 5000, // 5 seconds for very real-time status
    refetchInterval: 30000, // Auto-refresh every 30 seconds
    refetchOnWindowFocus: true,
  });

  return {
    status: data,
    loading: isLoading,
    error,
  };
};

export const useCreateTimePunch = () => {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (punch: Omit<TimePunch, 'id' | 'created_at' | 'updated_at' | 'employee'> & { photoBlob?: Blob }) => {
      const { data: { user } } = await supabase.auth.getUser();
      
      // Upload photo to storage if provided
      let photo_path: string | undefined;
      if (punch.photoBlob) {
        try {
          const timestamp = Date.now();
          const filename = `punch-${timestamp}.jpg`;
          const filePath = `${punch.restaurant_id}/${punch.employee_id}/${filename}`;
          
          const { data: uploadData, error: uploadError } = await supabase.storage
            .from('time-clock-photos')
            .upload(filePath, punch.photoBlob, {
              contentType: 'image/jpeg',
              upsert: false,
            });

          if (uploadError) {
            console.error('Photo upload error:', uploadError);
            // Don't fail the punch if photo upload fails
            toast({
              title: 'Photo upload failed',
              description: 'Punch recorded without photo',
              variant: 'default',
            });
          } else {
            photo_path = uploadData.path;
          }
        } catch (error) {
          console.error('Photo upload exception:', error);
          // Continue without photo
        }
      }
      
      // Remove photoBlob from the punch data and add photo_path
      const { photoBlob, ...punchData } = punch;
      
      const { data, error } = await supabase
        .from('time_punches')
        .insert({
          ...punchData,
          photo_path,
          created_by: user?.id,
        })
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['timePunches', data.restaurant_id] });
      queryClient.invalidateQueries({ queryKey: ['punchStatus', data.employee_id] });
      
      const punchTypeText = data.punch_type.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase());
      toast({
        title: 'Punch recorded',
        description: `${punchTypeText} at ${new Date(data.punch_time).toLocaleTimeString()}`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Error recording punch',
        description: error.message,
        variant: 'destructive',
      });
    },
  });
};

export const useUpdateTimePunch = () => {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ id, ...updates }: Partial<TimePunch> & { id: string }) => {
      const { data: { user } } = await supabase.auth.getUser();
      
      // Remove employee data from updates if present
      const { employee, ...punchUpdates } = updates as Partial<TimePunch>;
      
      const { data, error } = await supabase
        .from('time_punches')
        .update({
          ...punchUpdates,
          modified_by: user?.id,
        })
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['timePunches', data.restaurant_id] });
      queryClient.invalidateQueries({ queryKey: ['punchStatus', data.employee_id] });
      toast({
        title: 'Punch updated',
        description: 'Time punch has been updated.',
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Error updating punch',
        description: error.message,
        variant: 'destructive',
      });
    },
  });
};

export const useDeleteTimePunch = () => {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ id, restaurantId, employeeId }: { id: string; restaurantId: string; employeeId: string }) => {
      const { error } = await supabase
        .from('time_punches')
        .delete()
        .eq('id', id);

      if (error) throw error;
      return { id, restaurantId, employeeId };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['timePunches', data.restaurantId] });
      queryClient.invalidateQueries({ queryKey: ['punchStatus', data.employeeId] });
      toast({
        title: 'Punch deleted',
        description: 'Time punch has been removed.',
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Error deleting punch',
        description: error.message,
        variant: 'destructive',
      });
    },
  });
};

// Hook for getting current employee from auth user
export const useCurrentEmployee = (restaurantId: string | null) => {
  const { data, isLoading, error } = useQuery({
    queryKey: ['currentEmployee', restaurantId],
    queryFn: async () => {
      if (!restaurantId) return null;

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;

      const { data, error } = await supabase
        .from('employees')
        .select('*')
        .eq('restaurant_id', restaurantId)
        .eq('user_id', user.id)
        .single();

      if (error) {
        // If no employee found for this user, return null (not an error)
        if (error.code === 'PGRST116') return null;
        throw error;
      }
      return data;
    },
    enabled: !!restaurantId,
    staleTime: 60000, // 1 minute
  });

  return {
    employee: data,
    loading: isLoading,
    error,
  };
};
