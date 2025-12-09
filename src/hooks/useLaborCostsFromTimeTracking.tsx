import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useEmployees } from './useEmployees';
import { TimePunch } from '@/types/timeTracking';
import { format, eachDayOfInterval } from 'date-fns';
import { 
  calculateEmployeePay, 
  ManualPayment 
} from '@/utils/payrollCalculations';

export interface LaborCostData {
  date: string;
  total_labor_cost: number;
  hourly_wages: number;
  salary_wages: number;
  contractor_payments: number;
  total_hours: number;
}

export interface LaborCostsFromTimeTrackingResult {
  dailyCosts: LaborCostData[];
  totalCost: number;
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
}

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

interface ManualPaymentDB {
  id: string;
  employee_id: string;
  date: string;
  allocated_cost: number;
  notes: string | null;
}

/**
 * Calculate labor costs directly from source data (time punches + employee configs).
 * This follows the same pattern as usePayroll - query source tables and calculate on-demand.
 * 
 * ✅ Use this hook for Dashboard labor cost calculations
 * ❌ Do NOT use daily_labor_allocations aggregation table (except for per-job source records)
 * 
 * Data flow:
 * 1. Fetch time_punches for the period
 * 2. Fetch employees with compensation configs
 * 3. Fetch per-job contractor payments (from daily_labor_allocations source='per-job')
 * 4. Calculate costs by employee and date using payrollCalculations.ts logic
 * 
 * @param restaurantId - Restaurant ID to filter costs
 * @param dateFrom - Start date for the period
 * @param dateTo - End date for the period
 * @returns Labor cost data calculated from source tables
 */
export function useLaborCostsFromTimeTracking(
  restaurantId: string | null,
  dateFrom: Date,
  dateTo: Date
): LaborCostsFromTimeTrackingResult {
  const { employees } = useEmployees(restaurantId);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['labor-costs-from-time-tracking', restaurantId, format(dateFrom, 'yyyy-MM-dd'), format(dateTo, 'yyyy-MM-dd')],
    queryFn: async (): Promise<{ dailyCosts: LaborCostData[]; totalCost: number }> => {
      if (!restaurantId) {
        return { dailyCosts: [], totalCost: 0 };
      }

      // 1. Fetch time punches for the period
      const { data: punches, error: punchesError } = await supabase
        .from('time_punches')
        .select('*')
        .eq('restaurant_id', restaurantId)
        .gte('punch_time', dateFrom.toISOString())
        .lte('punch_time', dateTo.toISOString())
        .order('punch_time', { ascending: true });

      if (punchesError) throw punchesError;

      // 2. Fetch per-job contractor payments (source records only)
      const { data: manualPaymentsData, error: manualPaymentsError } = await supabase
        .from('daily_labor_allocations')
        .select('*')
        .eq('restaurant_id', restaurantId)
        .eq('source', 'per-job') // Only per-job source records, not auto-generated
        .gte('date', format(dateFrom, 'yyyy-MM-dd'))
        .lte('date', format(dateTo, 'yyyy-MM-dd'));

      if (manualPaymentsError) throw manualPaymentsError;

      // 3. Group punches by employee
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

      // 4. Group manual payments by employee
      const manualPaymentsPerEmployee = new Map<string, ManualPayment[]>();
      (manualPaymentsData || []).forEach((payment: ManualPaymentDB) => {
        if (!manualPaymentsPerEmployee.has(payment.employee_id)) {
          manualPaymentsPerEmployee.set(payment.employee_id, []);
        }
        const paymentsList = manualPaymentsPerEmployee.get(payment.employee_id);
        if (paymentsList) {
          paymentsList.push({
            id: payment.id,
            date: payment.date,
            amount: payment.allocated_cost, // Already in cents
            description: payment.notes || undefined,
          });
        }
      });

      // 5. Calculate pay for each employee for the entire period
      const activeEmployees = employees.filter(e => e.status === 'active');
      const employeePayData = activeEmployees.map(employee => {
        const employeePunches = punchesPerEmployee.get(employee.id) || [];
        const manualPayments = manualPaymentsPerEmployee.get(employee.id) || [];
        
        return calculateEmployeePay(
          employee,
          employeePunches,
          0, // tips (not included in labor cost for dashboard)
          dateFrom,
          dateTo,
          manualPayments
        );
      });

      // 6. Group costs by date
      const allDates = eachDayOfInterval({ start: dateFrom, end: dateTo });
      const dateMap = new Map<string, LaborCostData>();

      // Initialize all dates with zero costs
      allDates.forEach(date => {
        const dateStr = format(date, 'yyyy-MM-dd');
        dateMap.set(dateStr, {
          date: dateStr,
          total_labor_cost: 0,
          hourly_wages: 0,
          salary_wages: 0,
          contractor_payments: 0,
          total_hours: 0,
        });
      });

      // Distribute employee pay across dates in the period
      employeePayData.forEach(employeePay => {
        const daysInPeriod = allDates.length;
        const employee = activeEmployees.find(e => e.id === employeePay.employeeId);
        
        if (!employee) return;

        // For hourly employees: calculate hours/pay per day from time punches
        if (employee.compensation_type === 'hourly') {
          const employeePunches = punchesPerEmployee.get(employee.id) || [];
          
          // Group punches by date
          employeePunches.forEach(punch => {
            const punchDate = format(new Date(punch.punch_time), 'yyyy-MM-dd');
            const dayData = dateMap.get(punchDate);
            if (dayData) {
              // Hours are calculated by calculateEmployeePay, but we need per-day
              // For now, distribute evenly (in future, could parse punches per day)
              const dailyHourlyPay = (employeePay.regularPay + employeePay.overtimePay) / daysInPeriod;
              const dailyHours = (employeePay.regularHours + employeePay.overtimeHours) / daysInPeriod;
              
              dayData.hourly_wages += dailyHourlyPay / 100; // Convert cents to dollars
              dayData.total_hours += dailyHours;
              dayData.total_labor_cost += dailyHourlyPay / 100;
            }
          });
        } 
        // For salary employees: distribute evenly across period
        else if (employee.compensation_type === 'salary') {
          const dailySalary = employeePay.salaryPay / daysInPeriod;
          allDates.forEach(date => {
            const dateStr = format(date, 'yyyy-MM-dd');
            const dayData = dateMap.get(dateStr);
            if (dayData) {
              dayData.salary_wages += dailySalary / 100; // Convert cents to dollars
              dayData.total_labor_cost += dailySalary / 100;
            }
          });
        }
        // For contractors: use manual payments directly (already distributed by date)
        else if (employee.compensation_type === 'contractor') {
          employeePay.manualPayments.forEach(payment => {
            const dayData = dateMap.get(payment.date);
            if (dayData) {
              dayData.contractor_payments += payment.amount / 100; // Convert cents to dollars
              dayData.total_labor_cost += payment.amount / 100;
            }
          });
        }
      });

      const dailyCosts = Array.from(dateMap.values()).sort((a, b) => a.date.localeCompare(b.date));
      const totalCost = dailyCosts.reduce((sum, day) => sum + day.total_labor_cost, 0);

      return { dailyCosts, totalCost };
    },
    enabled: !!restaurantId && !!employees.length,
    staleTime: 30000, // 30 seconds
    refetchOnWindowFocus: true,
  });

  return {
    dailyCosts: data?.dailyCosts || [],
    totalCost: data?.totalCost || 0,
    isLoading,
    error,
    refetch: () => { refetch(); },
  };
}
