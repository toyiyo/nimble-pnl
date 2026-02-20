import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useEmployees } from './useEmployees';
import { TimePunch } from '@/types/timeTracking';
import {
  calculatePayrollPeriod,
  PayrollPeriod,
  ManualPayment,
  shouldIncludeEmployeeInPayroll,
} from '@/utils/payrollCalculations';
import { format } from 'date-fns';
import { useToast } from '@/hooks/use-toast';
import type { Employee } from '@/types/scheduling';
import {
  computeTipTotalsWithFiltering,
  type TipSplitItem as TipSplitItemForAggregation,
  type EmployeeTip as EmployeeTipForAggregation,
} from '@/utils/tipAggregation';

// Combine tips from tip_split_items and legacy employee_tips (both in cents) into a Map of cents.
export function aggregateTips(
  tipItems: Array<{ employee_id: string; amount: number }> = [],
  employeeTips: Array<{ employee_id: string; tip_amount: number }> = []
): Map<string, number> {
  const tipsPerEmployee = new Map<string, number>();

  tipItems.forEach(({ employee_id, amount }) => {
    const current = tipsPerEmployee.get(employee_id) || 0;
    tipsPerEmployee.set(employee_id, current + amount); // Keep in cents
  });

  employeeTips.forEach(({ employee_id, tip_amount }) => {
    const current = tipsPerEmployee.get(employee_id) || 0;
    tipsPerEmployee.set(employee_id, current + tip_amount); // Keep in cents
  });

  return tipsPerEmployee;
}

type TipSplitForFallback = { id: string; total_amount: number };

/**
 * Combines tips from items + employee_tips, and optionally falls back to split totals
 * when no items exist. Returns tips in CENTS to match what calculateEmployeePay expects.
 */
export function computeTipTotals(
  tipItems: Array<{ employee_id: string; amount: number; tip_split_id?: string }>,
  employeeTips: Array<{ employee_id: string; tip_amount: number }>,
  tipSplits: TipSplitForFallback[],
  employees: Employee[],
): Map<string, number> {
  const base = aggregateTips(tipItems, employeeTips);
  if (!tipSplits.length) return base;

  const itemsBySplit = new Set(tipItems.map(t => t.tip_split_id).filter(Boolean));
  const activeEmployees = employees.filter(e => e.status !== 'terminated');
  const recipients = activeEmployees.length ? activeEmployees : employees;

  tipSplits.forEach(split => {
    if (itemsBySplit.has(split.id)) return; // already detailed by items
    if (!recipients.length) return;

    let remainingCents = split.total_amount;
    const shareCents = Math.floor(remainingCents / recipients.length);

    recipients.forEach((emp, idx) => {
      let cents = shareCents;
      // last employee gets remainder to preserve total
      if (idx === recipients.length - 1) {
        cents = remainingCents;
      } else {
        remainingCents -= cents;
      }
      const current = base.get(emp.id) || 0;
      base.set(emp.id, current + cents); // Keep in cents, don't divide by 100
    });
  });

  return base;
}

interface DBTipSplitItem {
  employee_id: string;
  amount: number;
  tip_splits?: { split_date: string } | null;
}

interface DBEmployeeTip {
  employee_id: string;
  tip_amount: number;
  tip_date: string;
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

      // Fetch all approved/archived tips for the period from tip_split_items
      // Both 'approved' and 'archived' (locked) splits should be included in payroll
      const { data: approvedSplits, error: splitsError } = await supabase
        .from('tip_splits')
        .select('id, total_amount')
        .eq('restaurant_id', restaurantId)
        .in('status', ['approved', 'archived'])
        .gte('split_date', format(startDate, 'yyyy-MM-dd'))
        .lte('split_date', format(endDate, 'yyyy-MM-dd'));

      if (splitsError) throw splitsError;

      const splitIds = (approvedSplits || []).map(s => s.id);
      
      // Then fetch the tip split items for those splits, including split_date from tip_splits
      const { data: tips, error: tipsError } = splitIds.length > 0
        ? await supabase
            .from('tip_split_items')
            .select('employee_id, amount, tip_split_id, tip_splits(split_date)')
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

      // Include tips from tip_split_items and employee_tips for the period
      // We'll use the new utility to prevent double-counting
      const { data: employeeTips, error: employeeTipsError } = await supabase
        .from('employee_tips')
        .select('employee_id, tip_amount, tip_date')
        .eq('restaurant_id', restaurantId)
        .gte('tip_date', format(startDate, 'yyyy-MM-dd'))
        .lte('tip_date', format(endDate, 'yyyy-MM-dd'));

      if (employeeTipsError) throw employeeTipsError;

      // Fetch tip payouts (cash already paid out) for the period
      const { data: tipPayoutsData, error: tipPayoutsError } = await supabase
        .from('tip_payouts')
        .select('employee_id, amount')
        .eq('restaurant_id', restaurantId)
        .gte('payout_date', format(startDate, 'yyyy-MM-dd'))
        .lte('payout_date', format(endDate, 'yyyy-MM-dd'));

      if (tipPayoutsError) throw tipPayoutsError;

      const tipItems: TipSplitItemForAggregation[] = (tips || []).map((item: DBTipSplitItem) => ({
        employee_id: item.employee_id,
        amount: item.amount,
        split_date: item.tip_splits?.split_date,
      }));

      const employeeTipItems: EmployeeTipForAggregation[] = (employeeTips || []).map((tip: DBEmployeeTip) => ({
        employee_id: tip.employee_id,
        amount: tip.tip_amount,
        tip_date: tip.tip_date,
      }));

      // Use the new utility with date filtering to prevent double-counting
      const tipsPerEmployee = computeTipTotalsWithFiltering(
        tipItems,
        employeeTipItems,
        undefined // No POS fallback for now
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

      // Group tip payouts by employee (sum amounts in cents)
      const tipPayoutsPerEmployee = new Map<string, number>();
      (tipPayoutsData || []).forEach((payout: { employee_id: string; amount: number }) => {
        const current = tipPayoutsPerEmployee.get(payout.employee_id) || 0;
        tipPayoutsPerEmployee.set(payout.employee_id, current + payout.amount);
      });

      // Filter employees based on deactivation date vs payroll period
      // Inactive employees are included only through their final week (the week containing their deactivation date)
      const eligibleEmployees = employees.filter(employee => 
        shouldIncludeEmployeeInPayroll(employee, startDate)
      );

      return calculatePayrollPeriod(
        startDate,
        endDate,
        eligibleEmployees,
        punchesPerEmployee,
        tipsPerEmployee,
        manualPaymentsPerEmployee,
        tipPayoutsPerEmployee,
      );
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
