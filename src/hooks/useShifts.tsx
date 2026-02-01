import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Shift, RecurrencePattern } from '@/types/scheduling';
import { useToast } from '@/hooks/use-toast';
import { generateRecurringDates } from '@/utils/recurrenceUtils';
import { parseISO } from 'date-fns';
import { Json } from '@/integrations/supabase/types';
import { RecurringActionScope, getSeriesParentId } from '@/utils/recurringShiftHelpers';

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
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['shifts', data.restaurant_id] });
      
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
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['shifts', data.restaurant_id] });
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
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['shifts', data.restaurantId] });
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

/**
 * Delete multiple shifts in a series based on scope
 * - 'this': Delete only the specified shift (detach from series)
 * - 'following': Delete this shift and all future shifts in the series
 * - 'all': Delete all shifts in the series
 */
export const useDeleteShiftSeries = () => {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({
      shift,
      scope,
      restaurantId,
    }: {
      shift: Shift;
      scope: RecurringActionScope;
      restaurantId: string;
    }) => {
      const parentId = getSeriesParentId(shift);
      let deletedCount = 0;
      let lockedCount = 0;

      if (scope === 'this') {
        // Delete only this shift if not locked
        if (shift.locked) {
          throw new Error('Cannot delete a locked shift. The schedule has been published.');
        }

        const { error } = await supabase
          .from('shifts')
          .delete()
          .eq('id', shift.id);

        if (error) throw error;
        deletedCount = 1;
      } else if (scope === 'following') {
        // Delete this shift and all future shifts in the series (unlocked only)
        const shiftStartTime = shift.start_time;

        // First, count locked shifts for feedback
        const { count: locked } = await supabase
          .from('shifts')
          .select('*', { count: 'exact', head: true })
          .or(`id.eq.${parentId},recurrence_parent_id.eq.${parentId}`)
          .gte('start_time', shiftStartTime)
          .eq('locked', true)
          .eq('restaurant_id', restaurantId);

        lockedCount = locked || 0;

        // Delete unlocked shifts >= this shift's start time
        const { data: deleted, error } = await supabase
          .from('shifts')
          .delete()
          .or(`id.eq.${parentId},recurrence_parent_id.eq.${parentId}`)
          .gte('start_time', shiftStartTime)
          .eq('locked', false)
          .eq('restaurant_id', restaurantId)
          .select('id');

        if (error) throw error;
        deletedCount = deleted?.length || 0;
      } else if (scope === 'all') {
        // Delete all shifts in the series (unlocked only)

        // First, count locked shifts for feedback
        const { count: locked } = await supabase
          .from('shifts')
          .select('*', { count: 'exact', head: true })
          .or(`id.eq.${parentId},recurrence_parent_id.eq.${parentId}`)
          .eq('locked', true)
          .eq('restaurant_id', restaurantId);

        lockedCount = locked || 0;

        // Delete all unlocked shifts in the series
        const { data: deleted, error } = await supabase
          .from('shifts')
          .delete()
          .or(`id.eq.${parentId},recurrence_parent_id.eq.${parentId}`)
          .eq('locked', false)
          .eq('restaurant_id', restaurantId)
          .select('id');

        if (error) throw error;
        deletedCount = deleted?.length || 0;
      }

      return { deletedCount, lockedCount, restaurantId };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['shifts', data.restaurantId] });

      let description = `${data.deletedCount} shift${data.deletedCount !== 1 ? 's' : ''} deleted.`;
      if (data.lockedCount > 0) {
        description += ` ${data.lockedCount} locked shift${data.lockedCount !== 1 ? 's were' : ' was'} preserved.`;
      }

      toast({
        title: 'Shifts deleted',
        description,
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Error deleting shifts',
        description: error.message,
        variant: 'destructive',
      });
    },
  });
};

/**
 * Update multiple shifts in a series based on scope
 * - 'this': Update only the specified shift (detach from series if significant change)
 * - 'following': Update this shift and all future shifts in the series
 * - 'all': Update all shifts in the series
 */
export const useUpdateShiftSeries = () => {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({
      shift,
      scope,
      updates,
      restaurantId,
    }: {
      shift: Shift;
      scope: RecurringActionScope;
      updates: Partial<Omit<Shift, 'id' | 'created_at' | 'updated_at' | 'employee'>>;
      restaurantId: string;
    }) => {
      const parentId = getSeriesParentId(shift);
      let updatedCount = 0;
      let lockedCount = 0;

      // Remove employee data from updates if present
      const { employee, recurrence_pattern, ...shiftUpdates } = updates as Partial<Shift>;

      // Convert recurrence_pattern if present
      const dbUpdates = {
        ...shiftUpdates,
        ...(recurrence_pattern !== undefined && {
          recurrence_pattern: recurrence_pattern as unknown as Json,
        }),
      };

      if (scope === 'this') {
        // Update only this shift if not locked
        if (shift.locked) {
          throw new Error('Cannot update a locked shift. The schedule has been published.');
        }

        // When editing "this only", detach from series
        const { data, error } = await supabase
          .from('shifts')
          .update({
            ...dbUpdates,
            recurrence_parent_id: null, // Detach from series
            is_recurring: false,
            recurrence_pattern: null,
          })
          .eq('id', shift.id)
          .select();

        if (error) throw error;
        updatedCount = data?.length || 0;
      } else if (scope === 'following') {
        // Update this shift and all future shifts in the series (unlocked only)
        const shiftStartTime = shift.start_time;

        // First, count locked shifts for feedback
        const { count: locked } = await supabase
          .from('shifts')
          .select('*', { count: 'exact', head: true })
          .or(`id.eq.${parentId},recurrence_parent_id.eq.${parentId}`)
          .gte('start_time', shiftStartTime)
          .eq('locked', true)
          .eq('restaurant_id', restaurantId);

        lockedCount = locked || 0;

        // Update unlocked shifts >= this shift's start time
        const { data: updated, error } = await supabase
          .from('shifts')
          .update(dbUpdates)
          .or(`id.eq.${parentId},recurrence_parent_id.eq.${parentId}`)
          .gte('start_time', shiftStartTime)
          .eq('locked', false)
          .eq('restaurant_id', restaurantId)
          .select('id');

        if (error) throw error;
        updatedCount = updated?.length || 0;
      } else if (scope === 'all') {
        // Update all shifts in the series (unlocked only)

        // First, count locked shifts for feedback
        const { count: locked } = await supabase
          .from('shifts')
          .select('*', { count: 'exact', head: true })
          .or(`id.eq.${parentId},recurrence_parent_id.eq.${parentId}`)
          .eq('locked', true)
          .eq('restaurant_id', restaurantId);

        lockedCount = locked || 0;

        // Update all unlocked shifts in the series
        const { data: updated, error } = await supabase
          .from('shifts')
          .update(dbUpdates)
          .or(`id.eq.${parentId},recurrence_parent_id.eq.${parentId}`)
          .eq('locked', false)
          .eq('restaurant_id', restaurantId)
          .select('id');

        if (error) throw error;
        updatedCount = updated?.length || 0;
      }

      return { updatedCount, lockedCount, restaurantId };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['shifts', data.restaurantId] });

      let description = `${data.updatedCount} shift${data.updatedCount !== 1 ? 's' : ''} updated.`;
      if (data.lockedCount > 0) {
        description += ` ${data.lockedCount} locked shift${data.lockedCount !== 1 ? 's were' : ' was'} unchanged.`;
      }

      toast({
        title: 'Shifts updated',
        description,
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Error updating shifts',
        description: error.message,
        variant: 'destructive',
      });
    },
  });
};
