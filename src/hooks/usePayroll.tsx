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
  const { employees } = useEmployees(restaurantId);
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

      // Fetch all tips for the period
      const { data: tips, error: tipsError } = await supabase
        .from('employee_tips')
        .select('employee_id, tip_amount')
        .eq('restaurant_id', restaurantId)
        .gte('recorded_at', startDate.toISOString())
        .lte('recorded_at', endDate.toISOString());

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

      // Sum tips by employee
      const tipsPerEmployee = new Map<string, number>();
      (tips || []).forEach((tip: EmployeeTip) => {
        const currentTips = tipsPerEmployee.get(tip.employee_id) || 0;
        tipsPerEmployee.set(tip.employee_id, currentTips + tip.tip_amount);
      });

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

      // Calculate payroll
      const payroll = calculatePayrollPeriod(
        startDate,
        endDate,
        employees.filter(e => e.status === 'active'),
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
      const { error } = await supabase
        .from('daily_labor_allocations')
        .delete()
        .eq('id', paymentId);

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
