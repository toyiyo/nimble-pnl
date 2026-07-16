import { useQuery, useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

export interface ShiftTrade {
  id: string;
  restaurant_id: string;
  offered_shift_id: string;
  offered_by_employee_id: string;
  requested_shift_id: string | null;
  target_employee_id: string | null;
  accepted_by_employee_id: string | null;
  status: 'open' | 'pending_approval' | 'approved' | 'rejected' | 'cancelled';
  reason: string | null;
  manager_note: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
  // Relations
  offered_shift?: {
    id: string;
    start_time: string;
    end_time: string;
    position: string;
    break_duration: number;
  };
  offered_by?: {
    id: string;
    name: string;
    email: string | null;
    position: string;
    area: string | null;
  };
  accepted_by?: {
    id: string;
    name: string;
    email: string | null;
    position: string;
  };
  target_employee?: {
    id: string;
    name: string;
    position: string;
  };
}

export type ShiftTradeStatus = ShiftTrade['status'];

/**
 * Guard against ghost joins: drop trades whose poster or shift row was deleted.
 * Structurally typed (not `ShiftTrade`) because useMarketplaceTrades filters
 * supabase-inferred rows whose `status: string` is wider than the union.
 */
const hasValidJoins = (t: { offered_by?: unknown; offered_shift?: unknown }) =>
  t.offered_by != null && t.offered_shift != null;

type ShiftTradeNotificationAction =
  | 'created'
  | 'accepted'
  | 'approved'
  | 'rejected'
  | 'cancelled';

const sendShiftTradeNotification = async (
  tradeId: string,
  action: ShiftTradeNotificationAction
) => {
  try {
    await supabase.functions.invoke('send-shift-trade-notification', {
      body: { tradeId, action },
    });
  } catch (emailError) {
    console.error('Failed to send notification:', emailError);
  }
};

const executeShiftTradeAction = async ({
  rpc,
  params,
  tradeId,
  action,
  failureMessage,
}: {
  rpc: 'accept_shift_trade' | 'approve_shift_trade' | 'reject_shift_trade' | 'cancel_shift_trade';
  params: Record<string, unknown>;
  tradeId: string;
  action: Exclude<ShiftTradeNotificationAction, 'created'>;
  failureMessage: string;
}) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await supabase.rpc(rpc, params as any);

  if (error) throw error;

  const result = data as { success?: boolean; error?: string } | null;
  if (!result || !result.success) {
    throw new Error(result?.error || failureMessage);
  }

  await sendShiftTradeNotification(tradeId, action);

  return result;
};

/**
 * Invalidate every shift-trade query family in one place.
 *
 * All trade mutations must call this instead of hand-listing keys — a missed
 * key silently desyncs whichever view reads it (this is how the "My shift
 * trades" card would go stale).
 */
export const invalidateShiftTradeQueries = (queryClient: QueryClient) => {
  queryClient.invalidateQueries({ queryKey: ['shift_trades'] });
  queryClient.invalidateQueries({ queryKey: ['marketplace_trades'] });
  queryClient.invalidateQueries({ queryKey: ['my_trade_activity'] });
};

/**
 * Hook to fetch shift trades for a restaurant
 * @param restaurantId - Restaurant ID
 * @param status - Optional status filter ('open', 'pending_approval', etc.)
 * @param employeeId - Optional employee ID to filter trades involving specific employee
 */
export const useShiftTrades = (
  restaurantId: string | null,
  status?: ShiftTrade['status'] | ShiftTrade['status'][],
  employeeId?: string | null
) => {
  const { data, isLoading, error } = useQuery({
    queryKey: ['shift_trades', restaurantId, status, employeeId],
    queryFn: async () => {
      if (!restaurantId) return [];

      let query = supabase
        .from('shift_trades')
        .select(`
          *,
          offered_shift:shifts!offered_shift_id(
            id,
            start_time,
            end_time,
            position,
            break_duration
          ),
          offered_by:employees!offered_by_employee_id(
            id,
            name,
            email,
            position
          ),
          accepted_by:employees!accepted_by_employee_id(
            id,
            name,
            email,
            position
          ),
          target_employee:employees!target_employee_id(
            id,
            name,
            position
          )
        `)
        .eq('restaurant_id', restaurantId);

      if (status) {
        if (Array.isArray(status)) {
          query = query.in('status', status);
        } else {
          query = query.eq('status', status);
        }
      }

      if (employeeId) {
        query = query.or(
          `offered_by_employee_id.eq.${employeeId},accepted_by_employee_id.eq.${employeeId},target_employee_id.eq.${employeeId}`
        );
      }

      const { data, error } = await query.order('created_at', { ascending: false });

      if (error) throw error;
      return (data as ShiftTrade[]).filter(hasValidJoins);
    },
    enabled: !!restaurantId,
    staleTime: 30000, // 30 seconds
    refetchOnWindowFocus: true,
    refetchOnMount: true,
  });

  return {
    trades: data || [],
    loading: isLoading,
    error,
  };
};

/** Statuses shown in the "My shift trades" activity view. `cancelled` is
 * deliberately excluded — the poster withdrew it themselves. */
const MY_TRADE_ACTIVITY_STATUSES: ShiftTradeStatus[] = [
  'open',
  'pending_approval',
  'approved',
  'rejected',
];

/**
 * Trades the employee is a party to (poster or claimant), across the active
 * lifecycle plus a bounded window of recently-resolved outcomes.
 *
 * @param resolvedWithinDays - approved/rejected trades are included only when
 *   reviewed_at is within this many days (default 7), enforced server-side.
 */
export const useMyTradeActivity = (
  restaurantId: string | null,
  employeeId: string | null,
  resolvedWithinDays = 7
) => {
  const { data, isLoading, isError, error } = useQuery({
    // The cutoff is intentionally NOT in the key: the key stays stable while
    // every refetch recomputes a fresh window inside queryFn.
    queryKey: ['my_trade_activity', restaurantId, employeeId, resolvedWithinDays],
    queryFn: async () => {
      const cutoffIso = new Date(
        Date.now() - resolvedWithinDays * 24 * 60 * 60 * 1000
      ).toISOString();

      const { data, error } = await supabase
        .from('shift_trades')
        .select(`
          id,
          restaurant_id,
          offered_shift_id,
          offered_by_employee_id,
          requested_shift_id,
          target_employee_id,
          accepted_by_employee_id,
          status,
          reason,
          manager_note,
          reviewed_by,
          reviewed_at,
          created_at,
          updated_at,
          offered_shift:shifts!offered_shift_id(
            id,
            start_time,
            end_time,
            position,
            break_duration
          ),
          offered_by:employees!offered_by_employee_id(
            id,
            name,
            email,
            position,
            area
          ),
          accepted_by:employees!accepted_by_employee_id(
            id,
            name,
            email,
            position
          )
        `)
        .eq('restaurant_id', restaurantId!)
        // The two .or() calls below are INTENTIONALLY separate: PostgREST ANDs
        // sibling or= params. Merging them into one comma-joined .or() would
        // silently flip the semantics to a single big OR. Both interpolated
        // values are non-user-controlled (employeeId is a UUID from our own
        // employees table; cutoffIso is Date.toISOString() output), so the
        // comma/paren-sensitive .or() syntax cannot be broken by them.
        .or(
          `offered_by_employee_id.eq.${employeeId},accepted_by_employee_id.eq.${employeeId}`
        )
        .in('status', MY_TRADE_ACTIVITY_STATUSES)
        .or(`reviewed_at.is.null,reviewed_at.gte.${cutoffIso}`)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return (data as ShiftTrade[]).filter(hasValidJoins);
    },
    enabled: !!restaurantId && !!employeeId,
    staleTime: 30000,
    refetchOnWindowFocus: true,
    refetchOnMount: true,
  });

  return {
    trades: data || [],
    loading: isLoading,
    isError,
    error,
  };
};

/**
 * Hook to create a new shift trade request
 */
export const useCreateShiftTrade = () => {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (trade: {
      restaurant_id: string;
      offered_shift_id: string;
      offered_by_employee_id: string;
      target_employee_id?: string | null;
      reason?: string;
    }) => {
      const { data, error } = await supabase
        .from('shift_trades')
        .insert(trade)
        .select(`
          *,
          offered_shift:shifts!offered_shift_id(start_time, end_time, position),
          offered_by:employees!offered_by_employee_id(name, email)
        `)
        .single();

      if (error) throw error;

      // Send notification email (non-blocking for failures)
      await sendShiftTradeNotification(data.id, 'created');

      return data;
    },
    onSuccess: () => {
      invalidateShiftTradeQueries(queryClient);
      queryClient.invalidateQueries({ queryKey: ['shifts'] });
      toast({
        title: 'Shift trade posted',
        description: 'Your shift has been posted to the trade marketplace.',
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Error posting trade',
        description: error.message,
        variant: 'destructive',
      });
    },
  });
};

/**
 * Hook to accept a shift trade (employee accepting marketplace or directed trade)
 */
export const useAcceptShiftTrade = () => {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({
      tradeId,
      acceptingEmployeeId,
    }: {
      tradeId: string;
      acceptingEmployeeId: string;
    }) => {
      return executeShiftTradeAction({
        rpc: 'accept_shift_trade',
        params: {
          p_trade_id: tradeId,
          p_accepting_employee_id: acceptingEmployeeId,
        },
        tradeId,
        action: 'accepted',
        failureMessage: 'Failed to accept trade',
      });
    },
    onSuccess: () => {
      invalidateShiftTradeQueries(queryClient);
      toast({
        title: 'Trade request sent',
        description: 'Your request has been sent to management for approval.',
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Cannot accept trade',
        description: error.message,
        variant: 'destructive',
      });
    },
  });
};

/**
 * Hook to approve a shift trade (manager only)
 */
export const useApproveShiftTrade = () => {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({
      tradeId,
      managerNote,
      managerUserId,
    }: {
      tradeId: string;
      managerNote?: string;
      managerUserId: string;
    }) => {
      return executeShiftTradeAction({
        rpc: 'approve_shift_trade',
        params: {
          p_trade_id: tradeId,
          p_manager_user_id: managerUserId,
          p_manager_note: managerNote || null,
        },
        tradeId,
        action: 'approved',
        failureMessage: 'Failed to approve trade',
      });
    },
    onSuccess: () => {
      invalidateShiftTradeQueries(queryClient);
      queryClient.invalidateQueries({ queryKey: ['shifts'] });
      toast({
        title: 'Trade approved',
        description: 'The shift has been reassigned successfully.',
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Error approving trade',
        description: error.message,
        variant: 'destructive',
      });
    },
  });
};

/**
 * Hook to reject a shift trade (manager only)
 */
export const useRejectShiftTrade = () => {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({
      tradeId,
      managerNote,
      managerUserId,
    }: {
      tradeId: string;
      managerNote?: string;
      managerUserId: string;
    }) => {
      return executeShiftTradeAction({
        rpc: 'reject_shift_trade',
        params: {
          p_trade_id: tradeId,
          p_manager_user_id: managerUserId,
          p_manager_note: managerNote || null,
        },
        tradeId,
        action: 'rejected',
        failureMessage: 'Failed to reject trade',
      });
    },
    onSuccess: () => {
      invalidateShiftTradeQueries(queryClient);
      toast({
        title: 'Trade rejected',
        description: 'The trade request has been rejected.',
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Error rejecting trade',
        description: error.message,
        variant: 'destructive',
      });
    },
  });
};

/**
 * Hook to cancel a shift trade (employee who posted it)
 */
export const useCancelShiftTrade = () => {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ tradeId, employeeId }: { tradeId: string; employeeId: string }) => {
      return executeShiftTradeAction({
        rpc: 'cancel_shift_trade',
        params: {
          p_trade_id: tradeId,
          p_employee_id: employeeId,
        },
        tradeId,
        action: 'cancelled',
        failureMessage: 'Failed to cancel trade',
      });
    },
    onSuccess: () => {
      invalidateShiftTradeQueries(queryClient);
      toast({
        title: 'Trade cancelled',
        description: 'Your shift trade has been cancelled.',
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Error cancelling trade',
        description: error.message,
        variant: 'destructive',
      });
    },
  });
};

/**
 * Hook for managers to hard-delete a stale or expired shift-trade request.
 *
 * Design constraints (see design doc §1):
 * - Only deletes rows whose status is still 'open' or 'pending_approval'.
 *   If a trade was approved between the click and the execute, the `.in()`
 *   filter turns the DELETE into a safe no-op (PostgREST returns no error).
 * - No notification email: removal is janitorial, not a decision that affects
 *   shift ownership (the shift never moved).
 * - No ['shifts'] invalidation: ownership is only transferred in
 *   approve_shift_trade, which is a separate code path.
 */
export const useDeleteShiftTrade = () => {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ tradeId, restaurantId }: { tradeId: string; restaurantId: string }) => {
      const { error } = await supabase
        .from('shift_trades')
        .delete()
        .eq('id', tradeId)
        .eq('restaurant_id', restaurantId)
        // Guard: never hard-delete an approved/rejected audit record, even
        // though the manager DELETE RLS policy technically permits it. If the
        // trade was approved between click and execute, this is a safe no-op.
        .in('status', ['open', 'pending_approval']);
      if (error) throw error;
      return { tradeId };
    },
    onSuccess: () => {
      // The shift never moved (ownership only transfers in approve_shift_trade),
      // so NO ['shifts'] invalidation is needed here.
      invalidateShiftTradeQueries(queryClient);
      toast({ title: 'Trade removed', description: 'The stale trade request was removed.' });
    },
    onError: (error: Error) => {
      toast({ title: 'Error removing trade', description: error.message, variant: 'destructive' });
    },
  });
};

/**
 * Hook to get marketplace trades (available for any employee to accept)
 * Filters out trades where current employee has conflicts
 */
export const useMarketplaceTrades = (
  restaurantId: string | null,
  currentEmployeeId: string | null
) => {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['marketplace_trades', restaurantId, currentEmployeeId],
    queryFn: async () => {
      if (!restaurantId) return [];

      // Get open trades (marketplace or not targeted at specific employee)
      let query = supabase
        .from('shift_trades')
        .select(`
          *,
          offered_shift:shifts!offered_shift_id(
            id,
            start_time,
            end_time,
            position,
            break_duration
          ),
          offered_by:employees!offered_by_employee_id(
            id,
            name,
            position,
            area
          )
        `)
        .eq('restaurant_id', restaurantId)
        .eq('status', 'open');

      // Filter by target employee if provided
      if (currentEmployeeId) {
        query = query.or(`target_employee_id.is.null,target_employee_id.eq.${currentEmployeeId}`);
      } else {
        // If no current employee, only show marketplace trades (no specific target)
        query = query.is('target_employee_id', null);
      }

      const { data: trades, error: tradesError } = await query.order('created_at', { ascending: false });

      if (tradesError) throw tradesError;

      const validTrades = (trades || []).filter(hasValidJoins);

      if (!currentEmployeeId || validTrades.length === 0) {
        return validTrades;
      }

      // Get current employee's shifts to check for conflicts
      const { data: employeeShifts, error: shiftsError } = await supabase
        .from('shifts')
        .select('start_time, end_time')
        .eq('employee_id', currentEmployeeId)
        .in('status', ['scheduled', 'confirmed']);

      if (shiftsError) throw shiftsError;

      // Filter out trades that would create conflicts
      const filteredTrades = validTrades.map((trade) => {
        const hasConflict = employeeShifts?.some((shift) => {
          const tradeStart = new Date(trade.offered_shift.start_time);
          const tradeEnd = new Date(trade.offered_shift.end_time);
          const shiftStart = new Date(shift.start_time);
          const shiftEnd = new Date(shift.end_time);

          // Check for overlap
          return (
            (tradeStart >= shiftStart && tradeStart < shiftEnd) ||
            (tradeEnd > shiftStart && tradeEnd <= shiftEnd) ||
            (tradeStart <= shiftStart && tradeEnd >= shiftEnd)
          );
        });

        return {
          ...trade,
          hasConflict: !!hasConflict,
        };
      });

      return filteredTrades;
    },
    enabled: !!restaurantId,
    staleTime: 30000,
    refetchOnWindowFocus: true,
  });

  return {
    trades: data || [],
    loading: isLoading,
    error,
    refetch,
  };
};
