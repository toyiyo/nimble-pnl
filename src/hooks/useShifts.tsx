import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Shift, RecurrencePattern } from '@/types/scheduling';
import { useToast } from '@/hooks/use-toast';
import { generateRecurringDates } from '@/utils/recurrenceUtils';
import { parseISO } from 'date-fns';
import { Json } from '@/integrations/supabase/types';

export const useShifts = (restaurantId: string | null, startDate?: Date, endDate?: Date) => {
  const { toast } = useToast();

  const { data, isLoading, error } = useQuery({
    queryKey: ['shifts', restaurantId, startDate?.toISOString(), endDate?.toISOString()],
    queryFn: async () => {
      if (!restaurantId) return [];

      let query = supabase
        .from('shifts')
        .select('*, employee:employees(*)')
        .eq('restaurant_id', restaurantId);

      if (startDate) {
        query = query.gte('start_time', startDate.toISOString());
      }
      if (endDate) {
        query = query.lte('start_time', endDate.toISOString());
      }

      const { data, error } = await query.order('start_time');

      if (error) throw error;
      
      // Convert Json to RecurrencePattern
      return data.map(shift => ({
        ...shift,
        recurrence_pattern: shift.recurrence_pattern as unknown as RecurrencePattern | null,
      })) as Shift[];
    },
    enabled: !!restaurantId,
    staleTime: 30000, // 30 seconds
    refetchOnWindowFocus: true,
    refetchOnMount: true,
  });

  return {
    shifts: data || [],
    loading: isLoading,
    error,
  };
};

export const useCreateShift = () => {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (shift: Omit<Shift, 'id' | 'created_at' | 'updated_at' | 'employee'>) => {
      // If shift has recurrence pattern, generate multiple shifts
      if (shift.recurrence_pattern && shift.is_recurring) {
        const startDate = parseISO(shift.start_time);
        const endDate = parseISO(shift.end_time);
        
        // Calculate time difference in milliseconds for accurate preservation
        const timeDiff = endDate.getTime() - startDate.getTime();
        
        // Get time components from original shift
        const startHours = startDate.getHours();
        const startMinutes = startDate.getMinutes();
        const startSeconds = startDate.getSeconds();
        
        // Generate recurring dates
        const recurringDates = generateRecurringDates(startDate, shift.recurrence_pattern);
        
        // Create parent shift (first occurrence)
        const { data: parentShift, error: parentError } = await supabase
          .from('shifts')
          .insert({
            ...shift,
            recurrence_pattern: shift.recurrence_pattern as unknown as Json,
            recurrence_parent_id: null, // This is the parent
          })
          .select()
          .single();

        if (parentError) throw parentError;
        
        // Create child shifts for remaining occurrences
        if (recurringDates.length > 1) {
          const childShifts = recurringDates.slice(1).map(date => {
            // Set the time to match the original shift time
            const childStartTime = new Date(date);
            childStartTime.setHours(startHours, startMinutes, startSeconds);
            
            // Add the duration to get end time
            const childEndTime = new Date(childStartTime.getTime() + timeDiff);
            
            return {
              restaurant_id: shift.restaurant_id,
              employee_id: shift.employee_id,
              start_time: childStartTime.toISOString(),
              end_time: childEndTime.toISOString(),
              break_duration: shift.break_duration,
              position: shift.position,
              status: shift.status,
              notes: shift.notes,
              recurrence_pattern: shift.recurrence_pattern as unknown as Json,
              recurrence_parent_id: parentShift.id,
              is_recurring: true,
            };
          });
          
          const { error: childError } = await supabase
            .from('shifts')
            .insert(childShifts);
            
          if (childError) throw childError;
        }
        
        return {
          ...parentShift,
          recurrence_pattern: parentShift.recurrence_pattern as unknown as RecurrencePattern | null,
        } as Shift;
      } else {
        // Single shift creation
        const { data, error } = await supabase
          .from('shifts')
          .insert({
            ...shift,
            recurrence_pattern: shift.recurrence_pattern as unknown as Json,
          })
          .select()
          .single();

        if (error) throw error;
        return {
          ...data,
          recurrence_pattern: data.recurrence_pattern as unknown as RecurrencePattern | null,
        } as Shift;
      }
    },
    onSuccess: async (data, variables) => {
      await queryClient.invalidateQueries({
        predicate: (query) => query.queryKey[0] === 'shifts' && query.queryKey[1] === data.restaurant_id,
      });
      await queryClient.refetchQueries({
        predicate: (query) => query.queryKey[0] === 'shifts' && query.queryKey[1] === data.restaurant_id,
      });
      
      const message = variables.is_recurring 
        ? 'Recurring shifts created successfully'
        : 'Shift created';
      
      toast({
        title: message,
        description: variables.is_recurring 
          ? 'Multiple shifts have been added to the schedule.'
          : 'The shift has been added to the schedule.',
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Error creating shift',
        description: error.message,
        variant: 'destructive',
      });
    },
  });
};

export const useUpdateShift = () => {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ id, ...updates }: Partial<Shift> & { id: string }) => {
      // Check if shift is locked before allowing update
      const { data: existingShift, error: fetchError } = await supabase
        .from('shifts')
        .select('locked, is_published')
        .eq('id', id)
        .single();

      if (fetchError) throw fetchError;

      if (existingShift.locked) {
        throw new Error('Cannot update a locked shift. The schedule has been published.');
      }

      // Remove employee data from updates if present
      const { employee, ...shiftUpdates } = updates as Partial<Shift>;
      
      const { data, error } = await supabase
        .from('shifts')
        .update({
          ...shiftUpdates,
          recurrence_pattern: shiftUpdates.recurrence_pattern as unknown as Json,
        })
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
      return {
        ...data,
        recurrence_pattern: data.recurrence_pattern as unknown as RecurrencePattern | null,
      } as Shift;
    },
    onSuccess: async (data) => {
      await queryClient.invalidateQueries({
        predicate: (query) => query.queryKey[0] === 'shifts' && query.queryKey[1] === data.restaurant_id,
      });
      await queryClient.refetchQueries({
        predicate: (query) => query.queryKey[0] === 'shifts' && query.queryKey[1] === data.restaurant_id,
      });
      toast({
        title: 'Shift updated',
        description: 'The shift has been updated.',
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Error updating shift',
        description: error.message,
        variant: 'destructive',
      });
    },
  });
};

export const useDeleteShift = () => {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ id, restaurantId }: { id: string; restaurantId: string }) => {
      // Check if shift is locked before allowing deletion
      const { data: existingShift, error: fetchError } = await supabase
        .from('shifts')
        .select('locked, is_published')
        .eq('id', id)
        .single();

      if (fetchError) throw fetchError;

      if (existingShift.locked) {
        throw new Error('Cannot delete a locked shift. The schedule has been published.');
      }

      const { error } = await supabase
        .from('shifts')
        .delete()
        .eq('id', id);

      if (error) throw error;
      return { id, restaurantId };
    },
    onSuccess: async (data) => {
      await queryClient.invalidateQueries({
        predicate: (query) => query.queryKey[0] === 'shifts' && query.queryKey[1] === data.restaurantId,
      });
      await queryClient.refetchQueries({
        predicate: (query) => query.queryKey[0] === 'shifts' && query.queryKey[1] === data.restaurantId,
      });
      toast({
        title: 'Shift deleted',
        description: 'The shift has been removed from the schedule.',
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Error deleting shift',
        description: error.message,
        variant: 'destructive',
      });
    },
  });
};
