import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
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
      return data as ShiftTrade[];
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

      // Send notification email
      try {
        await supabase.functions.invoke('send-shift-trade-notification', {
          body: { tradeId: data.id, action: 'created' },
        });
      } catch (emailError) {
        console.error('Failed to send notification:', emailError);
        // Don't fail the trade creation if email fails
      }

      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['shift_trades'] });
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
      // Call the database function for conflict checking
      const { data, error } = await supabase.rpc('accept_shift_trade', {
        p_trade_id: tradeId,
        p_accepting_employee_id: acceptingEmployeeId,
      });

      if (error) throw error;

      if (!data || !data.success) {
        throw new Error(data?.error || 'Failed to accept trade');
      }

      // Send notification email
      try {
        await supabase.functions.invoke('send-shift-trade-notification', {
          body: { tradeId, action: 'accepted' },
        });
      } catch (emailError) {
        console.error('Failed to send notification:', emailError);
      }

      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['shift_trades'] });
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
      const { data, error } = await supabase.rpc('approve_shift_trade', {
        p_trade_id: tradeId,
        p_manager_user_id: managerUserId,
        p_manager_note: managerNote || null,
      });

      if (error) throw error;

      if (!data || !data.success) {
        throw new Error(data?.error || 'Failed to approve trade');
      }

      // Send notification email
      try {
        await supabase.functions.invoke('send-shift-trade-notification', {
          body: { tradeId, action: 'approved' },
        });
      } catch (emailError) {
        console.error('Failed to send notification:', emailError);
      }

      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['shift_trades'] });
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
      const { data, error } = await supabase.rpc('reject_shift_trade', {
        p_trade_id: tradeId,
        p_manager_user_id: managerUserId,
        p_manager_note: managerNote || null,
      });

      if (error) throw error;

      if (!data || !data.success) {
        throw new Error(data?.error || 'Failed to reject trade');
      }

      // Send notification email
      try {
        await supabase.functions.invoke('send-shift-trade-notification', {
          body: { tradeId, action: 'rejected' },
        });
      } catch (emailError) {
        console.error('Failed to send notification:', emailError);
      }

      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['shift_trades'] });
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
      const { data, error } = await supabase.rpc('cancel_shift_trade', {
        p_trade_id: tradeId,
        p_employee_id: employeeId,
      });

      if (error) throw error;
      if (!data || !data.success) {
        throw new Error(data?.error || 'Failed to cancel trade');
      }

      // Send notification email
      try {
        await supabase.functions.invoke('send-shift-trade-notification', {
          body: { tradeId, action: 'cancelled' },
        });
      } catch (emailError) {
        console.error('Failed to send notification:', emailError);
      }

      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['shift_trades'] });
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
            position
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

      if (!currentEmployeeId || !trades || trades.length === 0) {
        return trades || [];
      }

      // Get current employee's shifts to check for conflicts
      const { data: employeeShifts, error: shiftsError } = await supabase
        .from('shifts')
        .select('start_time, end_time')
        .eq('employee_id', currentEmployeeId)
        .in('status', ['scheduled', 'confirmed']);

      if (shiftsError) throw shiftsError;

      // Filter out trades that would create conflicts
      const filteredTrades = trades.map((trade) => {
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
