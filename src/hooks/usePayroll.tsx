import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useEmployees } from './useEmployees';
import { TimePunch } from '@/types/timeTracking';
import {
  calculatePayrollPeriod,
  PayrollPeriod,
  ManualPayment,
} from '@/utils/payrollCalculations';
import { format } from 'date-fns';
import { useToast } from '@/hooks/use-toast';

interface EmployeeTip {
  employee_id: string;
  tip_amount: number;
}

// Combine tips from tip_split_items and legacy employee_tips (both in cents) into a Map of dollars.
export function aggregateTips(
  tipItems: Array<{ employee_id: string; amount: number }> = [],
  employeeTips: Array<{ employee_id: string; tip_amount: number }> = []
): Map<string, number> {
  const tipsPerEmployee = new Map<string, number>();

  tipItems.forEach(({ employee_id, amount }) => {
    const current = tipsPerEmployee.get(employee_id) || 0;
    tipsPerEmployee.set(employee_id, current + amount / 100);
  });

  employeeTips.forEach(({ employee_id, tip_amount }) => {
    const current = tipsPerEmployee.get(employee_id) || 0;
    tipsPerEmployee.set(employee_id, current + tip_amount / 100);
  });

  return tipsPerEmployee;
}

interface ManualPaymentDB {
  id: string;
  employee_id: string;
  date: string;
  allocated_cost: number;
  notes: string | null;
}

// Type for the time_punches data from Supabase
interface DBTimePunch {
  id: string;
  employee_id: string;
  restaurant_id: string;
  punch_time: string;
  punch_type: string;
  created_at: string;
  updated_at: string;
  shift_id: string | null;
  notes: string | null;
  photo_path: string | null;
  device_info: string | null;
  location: unknown;
  created_by: string | null;
  modified_by: string | null;
}

/**
 * Hook to fetch and calculate payroll for a given period
 */
export const usePayroll = (
  restaurantId: string | null,
  startDate: Date,
  endDate: Date
) => {
  // Fetch ALL employees (including inactive) for historical payroll accuracy
  // An employee deactivated today should still show their past work/salary
  const { employees } = useEmployees(restaurantId, { status: 'all' });
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: payrollPeriod, isLoading, error, refetch } = useQuery({
    queryKey: ['payroll', restaurantId, startDate.toISOString(), endDate.toISOString()],
    queryFn: async (): Promise<PayrollPeriod | null> => {
      if (!restaurantId) return null;

      // Fetch all time punches for the period
      const { data: punches, error: punchesError } = await supabase
        .from('time_punches')
        .select('*')
        .eq('restaurant_id', restaurantId)
        .gte('punch_time', startDate.toISOString())
        .lte('punch_time', endDate.toISOString())
        .order('punch_time', { ascending: true });

      if (punchesError) throw punchesError;

      // Fetch all approved tips for the period from tip_split_items
      // First get the approved tip splits for this period
      const { data: approvedSplits, error: splitsError } = await supabase
        .from('tip_splits')
        .select('id')
        .eq('restaurant_id', restaurantId)
        .eq('status', 'approved')
        .gte('split_date', format(startDate, 'yyyy-MM-dd'))
        .lte('split_date', format(endDate, 'yyyy-MM-dd'));

      if (splitsError) throw splitsError;

      const splitIds = (approvedSplits || []).map(s => s.id);
      
      // Then fetch the tip split items for those splits
      const { data: tips, error: tipsError } = splitIds.length > 0
        ? await supabase
            .from('tip_split_items')
            .select('employee_id, amount')
            .in('tip_split_id', splitIds)
        : { data: [], error: null };

      if (tipsError) throw tipsError;

      // Fetch manual payments (per-job contractor payments) for the period
      const { data: manualPaymentsData, error: manualPaymentsError } = await supabase
        .from('daily_labor_allocations')
        .select('*')
        .eq('restaurant_id', restaurantId)
        .eq('source', 'per-job')
        .gte('date', format(startDate, 'yyyy-MM-dd'))
        .lte('date', format(endDate, 'yyyy-MM-dd'));

      if (manualPaymentsError) throw manualPaymentsError;

      // Group punches by employee
      const punchesPerEmployee = new Map<string, TimePunch[]>();
      (punches || []).forEach((punch: DBTimePunch) => {
        if (!punchesPerEmployee.has(punch.employee_id)) {
          punchesPerEmployee.set(punch.employee_id, []);
        }
        const typedPunch: TimePunch = {
          ...punch,
          punch_type: punch.punch_type as TimePunch['punch_type'],
          location: punch.location && typeof punch.location === 'object' && 'latitude' in punch.location && 'longitude' in punch.location
            ? punch.location as { latitude: number; longitude: number }
            : undefined,
        };
        punchesPerEmployee.get(punch.employee_id)?.push(typedPunch);
      });

      // Include tips from tip_split_items and legacy/other tip entries in employee_tips for the period
      const { data: employeeTips, error: employeeTipsError } = await supabase
        .from('employee_tips')
        .select('employee_id, tip_amount, recorded_at')
        .eq('restaurant_id', restaurantId)
        .gte('recorded_at', startDate.toISOString())
        .lte('recorded_at', endDate.toISOString());

      if (employeeTipsError) throw employeeTipsError;

      const tipsPerEmployee = aggregateTips(
        (tips || []) as Array<{ employee_id: string; amount: number }>,
        (employeeTips || []) as Array<{ employee_id: string; tip_amount: number }>
      );

      // Group manual payments by employee
      const manualPaymentsPerEmployee = new Map<string, ManualPayment[]>();
      (manualPaymentsData || []).forEach((payment) => {
        if (!manualPaymentsPerEmployee.has(payment.employee_id)) {
          manualPaymentsPerEmployee.set(payment.employee_id, []);
        }
        const paymentsList = manualPaymentsPerEmployee.get(payment.employee_id);
        if (paymentsList) {
          paymentsList.push({
            id: payment.id,
            date: payment.date,
            amount: payment.allocated_cost,
            description: payment.notes || undefined,
          });
        }
      });

      // Calculate payroll for all employees who have data in this period
      // Don't filter by active status - historical data should include inactive employees
      const payroll = calculatePayrollPeriod(
        startDate,
        endDate,
        employees, // Include all employees (active and inactive)
        punchesPerEmployee,
        tipsPerEmployee,
        manualPaymentsPerEmployee
      );

      return payroll;
    },
    enabled: !!restaurantId && !!employees.length,
    staleTime: 30000, // 30 seconds
    refetchOnWindowFocus: true,
  });

  // Mutation to add a manual payment
  const addManualPaymentMutation = useMutation({
    mutationFn: async ({
      employeeId,
      date,
      amount,
      description,
    }: {
      employeeId: string;
      date: string;
      amount: number;
      description?: string;
    }) => {
      if (!restaurantId) throw new Error('Restaurant ID required');

      const { data, error } = await supabase
        .from('daily_labor_allocations')
        .insert({
          restaurant_id: restaurantId,
          employee_id: employeeId,
          date,
          allocated_cost: amount,
          compensation_type: 'contractor',
          source: 'per-job',
          notes: description,
        })
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast({
        title: 'Payment added',
        description: 'Manual payment has been recorded.',
      });
      queryClient.invalidateQueries({ 
        queryKey: ['payroll', restaurantId] 
      });
    },
    onError: (error) => {
      toast({
        title: 'Error adding payment',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  // Mutation to delete a manual payment
  const deleteManualPaymentMutation = useMutation({
    mutationFn: async (paymentId: string) => {
      if (!restaurantId) {
        throw new Error('Restaurant ID is required to delete payment');
      }

      const { error } = await supabase
        .from('daily_labor_allocations')
        .delete()
        .eq('id', paymentId)
        .eq('restaurant_id', restaurantId); // Defense-in-depth: only delete records from current restaurant

      if (error) throw error;
    },
    onSuccess: () => {
      toast({
        title: 'Payment deleted',
        description: 'Manual payment has been removed.',
      });
      queryClient.invalidateQueries({ 
        queryKey: ['payroll', restaurantId] 
      });
    },
    onError: (error) => {
      toast({
        title: 'Error deleting payment',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  return {
    payrollPeriod,
    loading: isLoading,
    error,
    refetch,
    addManualPayment: addManualPaymentMutation.mutate,
    isAddingPayment: addManualPaymentMutation.isPending,
    deleteManualPayment: deleteManualPaymentMutation.mutate,
    isDeletingPayment: deleteManualPaymentMutation.isPending,
  };
};
