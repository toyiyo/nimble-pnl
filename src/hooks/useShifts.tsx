import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

import { supabase } from '@/integrations/supabase/client';

import { useToast } from '@/hooks/use-toast';
import { RecurringActionScope, getSeriesParentId } from '@/utils/recurringShiftHelpers';
import { generateRecurringDates } from '@/utils/recurrenceUtils';
import { buildShiftDeletedInvoke, DeletableShift } from '@/lib/shiftDeleteNotification';
import { ShiftInterval, formatLocalDate, formatLocalDateInTz, formatLocalHHMMInTz, localDayOffsetInTz, requireTz } from '@/lib/shiftInterval';

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
): { shifts: Shift[]; loading: boolean; error: Error | null; refetch: () => void } {
  const { data, isLoading, error, refetch } = useQuery({
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
    // Exposed so a failed load can offer Retry rather than an empty grid that
    // reads as "you are not working this week".
    refetch,
  };
}

type ShiftInput = Omit<Shift, 'id' | 'created_at' | 'updated_at' | 'employee'>;

export interface UseCreateShiftOptions {
  /**
   * When true, suppresses the generic "Shift created"/"Recurring shifts
   * created successfully" success toast (the error toast still fires on
   * failure). Used by the Timeline's undo-delete restore flow, which shows
   * its own "Shift restored" toast instead. Defaults to false — every other
   * caller's behavior is unchanged.
   */
  silent?: boolean;
  /**
   * The restaurant's IANA timezone. Only consulted for a recurring create —
   * a single-shift create's `start_time`/`end_time` already arrive as
   * correct UTC instants from the caller (ShiftDialog resolves them via
   * `wallClockToInstant` before calling `mutate`). Required whenever
   * `shift.recurrence_pattern && shift.is_recurring`: every child after the
   * first is rebuilt from the parent's restaurant-local wall clock, and
   * doing that without a real `tz` is exactly the bug this option exists to
   * prevent (see `createRecurringShifts`).
   */
  tz?: string;
}

export function useCreateShift(options: UseCreateShiftOptions = {}) {
  const { silent = false, tz } = options;
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (shift: ShiftInput) => {
      if (shift.recurrence_pattern && shift.is_recurring) {
        requireTz(tz);
        return createRecurringShifts(shift, tz);
      }
      return createSingleShift(shift);
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['shifts', data.restaurant_id] });

      if (silent) return;

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

async function createRecurringShifts(shift: ShiftInput, tz: string): Promise<Shift> {
  const startDate = parseISO(shift.start_time);

  // Seed the recurrence generator with a calendar-only Date built from the
  // restaurant-local calendar date (noon, clear of any host-local DST edge),
  // not `startDate` itself — `generateRecurringDates` steps days/weeks via
  // host-local `Date` getters/setters, so feeding it the raw instant would
  // advance the HOST's calendar day, not the restaurant's. This keeps every
  // occurrence's calendar date anchored to the restaurant regardless of the
  // manager's device timezone.
  const startDateStr = formatLocalDateInTz(startDate, tz);
  const [seedYear, seedMonth, seedDay] = startDateStr.split('-').map(Number);
  const calendarSeed = new Date(seedYear, seedMonth - 1, seedDay, 12, 0, 0);

  const recurringDates = generateRecurringDates(calendarSeed, shift.recurrence_pattern!);
  // The parent's restaurant-local wall clock (HH:MM) — every child keeps
  // this exact wall clock, so a series spanning a DST transition stays at
  // the same local time instead of drifting by the transition's offset.
  const wallClockTime = formatLocalHHMMInTz(shift.start_time, tz);
  // The parent's restaurant-local end wall clock, plus the number of calendar
  // days its end falls past its start. Each child resolves its own start/end
  // via `ShiftInterval.createSpanning` from those three values — rather than
  // reusing the parent's raw millisecond duration.
  //
  // The offset is carried explicitly instead of being re-inferred from
  // `endTime < startTime` (what `ShiftInterval.create` would do), because
  // that inference only ever yields 0 or 1 and is wrong for a parent whose
  // end lands on a later day at an equal-or-later wall clock — ShiftDialog
  // collects start date and end date independently, so a Mon 09:00 -> Tue
  // 17:00 parent is creatable and would otherwise spawn same-day 8h
  // children, and a Mon 09:00 -> Tue 09:00 parent would make every child a
  // zero-length interval and throw.
  //
  // Reusing a captured `durationMs` (end instant − start instant) would be
  // wrong whenever the *parent's own* start–end interval crosses a DST
  // transition: its elapsed instant duration then differs from its
  // wall-clock duration, and every child — even one whose own occurrence
  // never crosses a transition — would inherit that skew (e.g. a nightly
  // 22:00–06:00 Chicago shift created on a spring-forward night has a 7h
  // elapsed duration but an 8h wall-clock duration; naively applying 7h to
  // later children lands them at 05:00, not the intended 06:00).
  const endWallClockTime = formatLocalHHMMInTz(shift.end_time, tz);
  const endDayOffset = localDayOffsetInTz(shift.start_time, shift.end_time, tz);

  // Resolve every child interval BEFORE inserting the parent. These are pure
  // computations that can throw (`ShiftInterval` rejects an unbuildable
  // interval), and a throw after the parent insert has landed would leave an
  // orphan parent in the database while the caller is told the create
  // failed — a half-written series. Doing the arithmetic first makes the
  // create all-or-nothing.
  const childIntervals = recurringDates.slice(1).map((date) =>
    ShiftInterval.createSpanning(formatLocalDate(date), wallClockTime, endWallClockTime, endDayOffset, tz),
  );

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

  if (childIntervals.length > 0) {
    const childShifts = childIntervals.map((childInterval) => ({
      restaurant_id: shift.restaurant_id,
      employee_id: shift.employee_id,
      start_time: childInterval.startAt.toISOString(),
      end_time: childInterval.endAt.toISOString(),
      break_duration: shift.break_duration,
      position: shift.position,
      status: shift.status,
      notes: shift.notes,
      recurrence_pattern: shift.recurrence_pattern as unknown as Json,
      recurrence_parent_id: parentShift.id,
      is_recurring: true,
    }));

    const { error: childError } = await supabase.from('shifts').insert(childShifts);
    if (childError) throw childError;
  }

  return toTypedShift(parentShift);
}

export function useUpdateShift() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({
      id,
      restaurant_id: restaurantId,
      ...updates
    }: Partial<Shift> & { id: string; restaurant_id: string }) => {
      await assertShiftNotLocked(id);

      const { employee: _employee, ...shiftUpdates } = updates;

      const { data, error } = await supabase
        .from('shifts')
        .update({
          ...shiftUpdates,
          recurrence_pattern: shiftUpdates.recurrence_pattern as unknown as Json,
        })
        .eq('id', id)
        .eq('restaurant_id', restaurantId)
        .select()
        .single();

      if (error) throw error;
      return toTypedShift(data);
    },
    onMutate: async ({ id, restaurant_id: restaurantId, ...updates }) => {
      await queryClient.cancelQueries({ queryKey: ['shifts', restaurantId] });

      const previousData = queryClient.getQueriesData<Shift[]>({ queryKey: ['shifts', restaurantId] });

      const { employee: _employee, ...optimisticUpdates } = updates;

      queryClient.setQueriesData<Shift[]>({ queryKey: ['shifts', restaurantId] }, (old) => {
        if (!old) return old;

        return old.map((s) => (s.id === id ? { ...s, ...optimisticUpdates } : s));
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
        title: 'Error updating shift',
        description: error.message,
        variant: 'destructive',
      });
    },
    onSettled: (data, _error, variables) => {
      const restaurantId = data?.restaurant_id ?? variables?.restaurant_id;
      if (restaurantId) {
        queryClient.invalidateQueries({ queryKey: ['shifts', restaurantId] });
      }
    },
    onSuccess: () => {
      toast({
        title: 'Shift updated',
        description: 'The shift has been updated.',
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

export interface UseDeleteShiftOptions {
  /**
   * When true, suppresses the generic "Shift deleted" success toast (the
   * error toast still fires on failure). Used by the Timeline's
   * undo-delete flow, which shows its own "Shift deleted" toast with an
   * Undo action instead. Defaults to false — every other caller's behavior
   * is unchanged.
   */
  silent?: boolean;
}

export function useDeleteShift(options: UseDeleteShiftOptions = {}) {
  const { silent = false } = options;
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({
      id,
      restaurantId,
      shift,
    }: {
      id: string;
      restaurantId: string;
      shift?: DeletableShift;
    }) => {
      const { data: deletedRows, error } = await supabase
        .from('shifts')
        .delete()
        .eq('id', id)
        .eq('restaurant_id', restaurantId)
        .select('id');

      if (error) throw error;

      // Only carry the snapshot forward (→ only notify) when a row was actually
      // removed. A delete against a stale/already-removed row (or one filtered by
      // RLS) returns error:null with zero rows — notifying there would send a
      // false "shift removed" message to the employee.
      const deletedCount = deletedRows?.length ?? 0;
      return { id, restaurantId, shift: deletedCount > 0 ? shift : undefined };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['shifts', data.restaurantId] });

      // Notify FIRST, unconditionally on snapshot presence — fire-and-forget,
      // must sit above the `if (silent) return` below. `silent` (suppress
      // toast) and "should notify" are orthogonal concerns.
      const notifyBody = data.shift ? buildShiftDeletedInvoke(data.shift) : null;
      if (notifyBody) {
        // supabase.functions.invoke resolves with { data, error } on HTTP
        // failures (it does NOT reject), so both branches must be handled —
        // this notification is best-effort and must never surface to the
        // caller of the delete mutation.
        supabase.functions
          .invoke('send-shift-notification', { body: notifyBody })
          .then(({ error }) => {
            if (error) {
              console.warn('shift-deleted notify failed', { shiftId: data.id, error });
            }
          })
          .catch((error) => {
            console.warn('shift-deleted notify failed', { shiftId: data.id, error });
          });
      }

      if (silent) return;

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
  includePublished?: boolean;
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
    mutationFn: async ({ shift, scope, restaurantId, includePublished }: SeriesOperationParams): Promise<SeriesOperationResult> => {
      if (scope === 'this') {
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
        p_include_locked: includePublished ?? false,
      });

      if (error) throw error;

      const result = data?.[0];
      return {
        deletedCount: result?.deleted_count || 0,
        lockedCount: result?.locked_count || 0,
        restaurantId,
      };
    },
    onMutate: async ({ shift, scope, restaurantId, includePublished }) => {
      await queryClient.cancelQueries({ queryKey: ['shifts', restaurantId] });

      const previousData = queryClient.getQueriesData<Shift[]>({ queryKey: ['shifts', restaurantId] });
      const parentId = getSeriesParentId(shift);
      const shiftStartTime = new Date(shift.start_time).getTime();

      queryClient.setQueriesData<Shift[]>({ queryKey: ['shifts', restaurantId] }, (old) => {
        if (!old) return old;

        return old.filter((s) => {
          if (s.locked && !includePublished) return true;

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
