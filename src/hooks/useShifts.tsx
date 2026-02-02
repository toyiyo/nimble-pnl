import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

import { supabase } from '@/integrations/supabase/client';

import { useToast } from '@/hooks/use-toast';
import { RecurringActionScope, getSeriesParentId } from '@/utils/recurringShiftHelpers';
import { generateRecurringDates } from '@/utils/recurrenceUtils';

import { Shift, RecurrencePattern } from '@/types/scheduling';
import { Json } from '@/integrations/supabase/types';

import { parseISO } from 'date-fns';

/**
 * Convert database shift to typed Shift with proper RecurrencePattern
 */
function toTypedShift(shift: Record<string, unknown>): Shift {
  return {
    ...shift,
    recurrence_parent_id: (shift.recurrence_parent_id as string) ?? null,
    is_recurring: (shift.is_recurring as boolean) ?? false,
    recurrence_pattern: shift.recurrence_pattern as unknown as RecurrencePattern | null,
  } as Shift;
}

/**
 * Build a human-readable description for shift change operations
 */
export function buildShiftChangeDescription(
  changeCount: number,
  lockedCount: number,
  action: 'deleted' | 'updated'
): string {
  const shiftLabel = changeCount === 1 ? 'shift' : 'shifts';
  let description = `${changeCount} ${shiftLabel} ${action}.`;

  if (lockedCount > 0) {
    const lockedShiftLabel = lockedCount === 1 ? 'locked shift was' : 'locked shifts were';
    const lockedOutcome = action === 'deleted' ? 'preserved' : 'unchanged';
    description += ` ${lockedCount} ${lockedShiftLabel} ${lockedOutcome}.`;
  }

  return description;
}

export function useShifts(
  restaurantId: string | null,
  startDate?: Date,
  endDate?: Date
): { shifts: Shift[]; loading: boolean; error: Error | null } {
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

      return data.map(toTypedShift);
    },
    enabled: !!restaurantId,
    staleTime: 30000,
    refetchOnWindowFocus: true,
    refetchOnMount: true,
  });

  return {
    shifts: data || [],
    loading: isLoading,
    error,
  };
}

type ShiftInput = Omit<Shift, 'id' | 'created_at' | 'updated_at' | 'employee'>;

export function useCreateShift() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (shift: ShiftInput) => {
      if (shift.recurrence_pattern && shift.is_recurring) {
        return createRecurringShifts(shift);
      }
      return createSingleShift(shift);
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['shifts', data.restaurant_id] });

      const isRecurring = data.is_recurring && data.recurrence_parent_id === null;
      toast({
        title: isRecurring ? 'Recurring shifts created successfully' : 'Shift created',
        description: isRecurring
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
}

async function createSingleShift(shift: ShiftInput): Promise<Shift> {
  const { data, error } = await supabase
    .from('shifts')
    .insert({
      ...shift,
      recurrence_pattern: shift.recurrence_pattern as unknown as Json,
    })
    .select()
    .single();

  if (error) throw error;
  return toTypedShift(data);
}

async function createRecurringShifts(shift: ShiftInput): Promise<Shift> {
  const startDate = parseISO(shift.start_time);
  const endDate = parseISO(shift.end_time);
  const durationMs = endDate.getTime() - startDate.getTime();

  const recurringDates = generateRecurringDates(startDate, shift.recurrence_pattern!);

  const { data: parentShift, error: parentError } = await supabase
    .from('shifts')
    .insert({
      ...shift,
      recurrence_pattern: shift.recurrence_pattern as unknown as Json,
      recurrence_parent_id: null,
    })
    .select()
    .single();

  if (parentError) throw parentError;

  if (recurringDates.length > 1) {
    const childShifts = recurringDates.slice(1).map((date) => {
      const childStartTime = new Date(date);
      childStartTime.setHours(startDate.getHours(), startDate.getMinutes(), startDate.getSeconds());
      const childEndTime = new Date(childStartTime.getTime() + durationMs);

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

    const { error: childError } = await supabase.from('shifts').insert(childShifts);
    if (childError) throw childError;
  }

  return toTypedShift(parentShift);
}

export function useUpdateShift() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ id, ...updates }: Partial<Shift> & { id: string }) => {
      await assertShiftNotLocked(id);

      const { employee: _employee, ...shiftUpdates } = updates;

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
      return toTypedShift(data);
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
}

async function assertShiftNotLocked(shiftId: string): Promise<void> {
  const { data: existingShift, error: fetchError } = await supabase
    .from('shifts')
    .select('locked')
    .eq('id', shiftId)
    .single();

  if (fetchError) throw fetchError;

  if (existingShift.locked) {
    throw new Error('Cannot modify a locked shift. The schedule has been published.');
  }
}

export function useDeleteShift() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ id, restaurantId }: { id: string; restaurantId: string }) => {
      await assertShiftNotLocked(id);

      const { error } = await supabase.from('shifts').delete().eq('id', id);

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
}

interface SeriesOperationParams {
  shift: Shift;
  scope: RecurringActionScope;
  restaurantId: string;
}

interface SeriesOperationResult {
  deletedCount?: number;
  updatedCount?: number;
  lockedCount: number;
  restaurantId: string;
}

/**
 * Delete multiple shifts in a series based on scope
 * - 'this': Delete only the specified shift (detach from series)
 * - 'following': Delete this shift and all future shifts in the series
 * - 'all': Delete all shifts in the series
 */
export function useDeleteShiftSeries() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ shift, scope, restaurantId }: SeriesOperationParams): Promise<SeriesOperationResult> => {
      if (scope === 'this') {
        if (shift.locked) {
          throw new Error('Cannot delete a locked shift. The schedule has been published.');
        }

        const { error } = await supabase
          .from('shifts')
          .delete()
          .eq('id', shift.id)
          .eq('restaurant_id', restaurantId);

        if (error) throw error;
        return { deletedCount: 1, lockedCount: 0, restaurantId };
      }

      const parentId = getSeriesParentId(shift);
      const { data, error } = await supabase.rpc('delete_shift_series', {
        p_parent_id: parentId,
        p_restaurant_id: restaurantId,
        p_scope: scope,
        p_from_time: scope === 'following' ? shift.start_time : null,
      });

      if (error) throw error;

      const result = data?.[0];
      return {
        deletedCount: result?.deleted_count || 0,
        lockedCount: result?.locked_count || 0,
        restaurantId,
      };
    },
    onMutate: async ({ shift, scope, restaurantId }) => {
      await queryClient.cancelQueries({ queryKey: ['shifts', restaurantId] });

      const previousData = queryClient.getQueriesData<Shift[]>({ queryKey: ['shifts', restaurantId] });
      const parentId = getSeriesParentId(shift);
      const shiftStartTime = new Date(shift.start_time).getTime();

      queryClient.setQueriesData<Shift[]>({ queryKey: ['shifts', restaurantId] }, (old) => {
        if (!old) return old;

        return old.filter((s) => {
          if (s.locked) return true;

          const isInSeries = s.id === parentId || s.recurrence_parent_id === parentId;
          if (!isInSeries) return true;

          switch (scope) {
            case 'this':
              return s.id !== shift.id;
            case 'following':
              return new Date(s.start_time).getTime() < shiftStartTime;
            case 'all':
              return false;
          }
        });
      });

      return { previousData };
    },
    onError: (error: Error, _variables, context) => {
      if (context?.previousData) {
        context.previousData.forEach(([queryKey, data]) => {
          queryClient.setQueryData(queryKey, data);
        });
      }
      toast({
        title: 'Error deleting shifts',
        description: error.message,
        variant: 'destructive',
      });
    },
    onSettled: (data) => {
      if (data?.restaurantId) {
        queryClient.invalidateQueries({ queryKey: ['shifts', data.restaurantId] });
        queryClient.invalidateQueries({ queryKey: ['series-info'] });
      }
    },
    onSuccess: (data) => {
      toast({
        title: 'Shifts deleted',
        description: buildShiftChangeDescription(data.deletedCount || 0, data.lockedCount, 'deleted'),
      });
    },
  });
}

interface SeriesUpdateParams extends SeriesOperationParams {
  updates: Partial<Omit<Shift, 'id' | 'created_at' | 'updated_at' | 'employee'>>;
}

/**
 * Calculate time delta in PostgreSQL interval format
 */
function calculateTimeDelta(originalTime: string, newTime: string): string {
  const deltaMs = new Date(newTime).getTime() - new Date(originalTime).getTime();
  return `${deltaMs} milliseconds`;
}

/**
 * Update multiple shifts in a series based on scope
 * - 'this': Update only the specified shift (detach from series if significant change)
 * - 'following': Update this shift and all future shifts in the series
 * - 'all': Update all shifts in the series
 */
export function useUpdateShiftSeries() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ shift, scope, updates, restaurantId }: SeriesUpdateParams): Promise<SeriesOperationResult> => {
      const {
        employee: _employee,
        recurrence_pattern,
        start_time,
        end_time,
        ...shiftUpdates
      } = updates as Partial<Shift>;

      const dbUpdates = {
        ...shiftUpdates,
        ...(scope === 'this' && start_time !== undefined && { start_time }),
        ...(scope === 'this' && end_time !== undefined && { end_time }),
        ...(recurrence_pattern !== undefined && {
          recurrence_pattern: recurrence_pattern as unknown as Json,
        }),
      };

      if (scope === 'this') {
        if (shift.locked) {
          throw new Error('Cannot update a locked shift. The schedule has been published.');
        }

        const { data, error } = await supabase
          .from('shifts')
          .update({
            ...dbUpdates,
            recurrence_parent_id: null,
            is_recurring: false,
            recurrence_pattern: null,
          })
          .eq('id', shift.id)
          .eq('restaurant_id', restaurantId)
          .select();

        if (error) throw error;
        return { updatedCount: data?.length || 0, lockedCount: 0, restaurantId };
      }

      const parentId = getSeriesParentId(shift);
      const startTimeDelta = start_time !== undefined ? calculateTimeDelta(shift.start_time, start_time) : null;
      const endTimeDelta = end_time !== undefined ? calculateTimeDelta(shift.end_time, end_time) : null;

      const { data, error } = await supabase.rpc('update_shift_series', {
        p_parent_id: parentId,
        p_restaurant_id: restaurantId,
        p_scope: scope,
        p_updates: dbUpdates,
        p_from_time: scope === 'following' ? shift.start_time : null,
        p_start_time_delta: startTimeDelta,
        p_end_time_delta: endTimeDelta,
      });

      if (error) throw error;

      const result = data?.[0];
      return {
        updatedCount: result?.updated_count || 0,
        lockedCount: result?.locked_count || 0,
        restaurantId,
      };
    },
    onMutate: async ({ shift, scope, updates, restaurantId }) => {
      await queryClient.cancelQueries({ queryKey: ['shifts', restaurantId] });

      const previousData = queryClient.getQueriesData<Shift[]>({ queryKey: ['shifts', restaurantId] });
      const parentId = getSeriesParentId(shift);
      const shiftStartTime = new Date(shift.start_time).getTime();

      const {
        employee: _employee,
        recurrence_pattern: _recurrence_pattern,
        start_time,
        end_time,
        ...shiftUpdates
      } = updates as Partial<Shift>;

      const optimisticUpdates = {
        ...shiftUpdates,
        ...(scope === 'this' && start_time !== undefined && { start_time }),
        ...(scope === 'this' && end_time !== undefined && { end_time }),
      };

      queryClient.setQueriesData<Shift[]>({ queryKey: ['shifts', restaurantId] }, (old) => {
        if (!old) return old;

        return old.map((s) => {
          if (s.locked) return s;

          const isInSeries = s.id === parentId || s.recurrence_parent_id === parentId;
          if (!isInSeries) return s;

          switch (scope) {
            case 'this':
              if (s.id === shift.id) {
                return {
                  ...s,
                  ...optimisticUpdates,
                  recurrence_parent_id: null,
                  is_recurring: false,
                  recurrence_pattern: null,
                };
              }
              return s;
            case 'following':
              if (new Date(s.start_time).getTime() >= shiftStartTime) {
                return { ...s, ...optimisticUpdates };
              }
              return s;
            case 'all':
              return { ...s, ...optimisticUpdates };
          }
        });
      });

      return { previousData };
    },
    onError: (error: Error, _variables, context) => {
      if (context?.previousData) {
        context.previousData.forEach(([queryKey, data]) => {
          queryClient.setQueryData(queryKey, data);
        });
      }
      toast({
        title: 'Error updating shifts',
        description: error.message,
        variant: 'destructive',
      });
    },
    onSettled: (data) => {
      if (data?.restaurantId) {
        queryClient.invalidateQueries({ queryKey: ['shifts', data.restaurantId] });
        queryClient.invalidateQueries({ queryKey: ['series-info'] });
      }
    },
    onSuccess: (data) => {
      toast({
        title: 'Shifts updated',
        description: buildShiftChangeDescription(data.updatedCount || 0, data.lockedCount, 'updated'),
      });
    },
  });
}

interface SeriesInfo {
  seriesCount: number;
  lockedCount: number;
  loading: boolean;
  error: Error | null;
}

/**
 * Fetch full series information from the server (not limited to current week)
 * Used to show accurate counts in the recurring action dialog
 */
export function useSeriesInfo(shift: Shift | null, restaurantId: string | null): SeriesInfo {
  const { data, isLoading, error } = useQuery({
    queryKey: ['series-info', shift?.id, restaurantId],
    queryFn: async () => {
      if (!shift || !restaurantId) return { seriesCount: 0, lockedCount: 0 };

      const parentId = getSeriesParentId(shift);
      const { data: rpcData, error: rpcError } = await supabase.rpc('get_shift_series_info', {
        p_parent_id: parentId,
        p_restaurant_id: restaurantId,
      });

      if (rpcError) throw rpcError;

      const result = rpcData?.[0];
      return {
        seriesCount: result?.series_count || 0,
        lockedCount: result?.locked_count || 0,
      };
    },
    enabled: !!shift && !!restaurantId && shift.is_recurring === true,
    staleTime: 30000,
  });

  return {
    seriesCount: data?.seriesCount || 0,
    lockedCount: data?.lockedCount || 0,
    loading: isLoading,
    error,
  };
}
