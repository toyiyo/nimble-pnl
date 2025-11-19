import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useEmployees } from './useEmployees';
import { TimePunch } from '@/types/timeTracking';
import {
  calculatePayrollPeriod,
  PayrollPeriod,
} from '@/utils/payrollCalculations';

interface EmployeeTip {
  employee_id: string;
  tip_amount: number;
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

      // Group punches by employee
      const punchesPerEmployee = new Map<string, TimePunch[]>();
      (punches || []).forEach((punch: TimePunch) => {
        if (!punchesPerEmployee.has(punch.employee_id)) {
          punchesPerEmployee.set(punch.employee_id, []);
        }
        punchesPerEmployee.get(punch.employee_id)!.push(punch);
      });

      // Sum tips by employee
      const tipsPerEmployee = new Map<string, number>();
      (tips || []).forEach((tip: EmployeeTip) => {
        const currentTips = tipsPerEmployee.get(tip.employee_id) || 0;
        tipsPerEmployee.set(tip.employee_id, currentTips + tip.tip_amount);
      });

      // Calculate payroll
      const payroll = calculatePayrollPeriod(
        startDate,
        endDate,
        employees.filter(e => e.status === 'active'),
        punchesPerEmployee,
        tipsPerEmployee
      );

      return payroll;
    },
    enabled: !!restaurantId && !!employees.length,
    staleTime: 30000, // 30 seconds
    refetchOnWindowFocus: true,
  });

  return {
    payrollPeriod,
    loading: isLoading,
    error,
    refetch,
  };
};
