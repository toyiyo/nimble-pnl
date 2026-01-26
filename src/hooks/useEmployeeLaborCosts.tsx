import { useMemo } from 'react';
import { Shift, Employee } from '@/types/scheduling';

export interface EmployeeLaborCost {
  id: string;
  name: string;
  position: string;
  hours: number;
  rate: number; // Effective hourly rate in dollars
  cost: number; // Total cost in dollars
  compensationType: string;
  isOutlier: boolean;
  outlierLevel: 'none' | 'warning' | 'critical';
}

export interface LaborCostSummary {
  totalCost: number;
  totalHours: number;
  averageHourlyRate: number;
  isAverageHigh: boolean;
  employeeCosts: EmployeeLaborCost[];
}

// Rate thresholds for outlier detection (in dollars)
const RATE_WARNING_THRESHOLD = 25; // Yellow indicator
const RATE_CRITICAL_THRESHOLD = 50; // Red indicator - likely a typo

/**
 * Calculate per-employee labor costs with outlier detection.
 * This hook provides visibility into which employees are driving labor costs
 * and flags unusually high rates that may be data entry errors.
 */
export function useEmployeeLaborCosts(
  shifts: Shift[],
  employees: Employee[]
): LaborCostSummary {
  return useMemo(() => {
    if (!employees.length) {
      return {
        totalCost: 0,
        totalHours: 0,
        averageHourlyRate: 0,
        isAverageHigh: false,
        employeeCosts: [],
      };
    }

    // Calculate shift hours helper
    const calculateShiftHours = (shift: Shift): number => {
      const start = new Date(shift.start_time);
      const end = new Date(shift.end_time);
      const totalMinutes = (end.getTime() - start.getTime()) / (1000 * 60);
      const netMinutes = Math.max(totalMinutes - shift.break_duration, 0);
      return netMinutes / 60;
    };

    // Calculate per-employee costs
    const employeeCostsMap = new Map<string, EmployeeLaborCost>();

    employees.forEach(emp => {
      const empShifts = shifts.filter(s => s.employee_id === emp.id);
      if (empShifts.length === 0) return;

      const hours = empShifts.reduce((sum, s) => sum + calculateShiftHours(s), 0);
      
      // Calculate effective rate based on compensation type
      let rate = 0;
      let cost = 0;
      
      switch (emp.compensation_type) {
        case 'hourly':
          rate = (emp.hourly_rate || 0) / 100; // Convert cents to dollars
          cost = hours * rate;
          break;
        case 'salary':
          // For salary, show the estimated daily cost divided by hours
          if (emp.salary_amount && emp.pay_period_type) {
            const weeksPerPeriod = emp.pay_period_type === 'weekly' ? 1 
              : emp.pay_period_type === 'bi-weekly' ? 2 
              : emp.pay_period_type === 'semi-monthly' ? 2.17 
              : 4.33;
            const dailyCost = (emp.salary_amount / 100) / (weeksPerPeriod * 7);
            const daysWorked = new Set(empShifts.map(s => s.start_time.split('T')[0])).size;
            cost = dailyCost * daysWorked;
            rate = hours > 0 ? cost / hours : 0;
          }
          break;
        case 'daily_rate':
          if (emp.daily_rate_amount) {
            const dailyRate = emp.daily_rate_amount / 100;
            const daysWorked = new Set(empShifts.map(s => s.start_time.split('T')[0])).size;
            cost = dailyRate * daysWorked;
            rate = hours > 0 ? cost / hours : 0;
          }
          break;
        case 'contractor':
          if (emp.contractor_payment_amount && emp.contractor_payment_interval) {
            const daysPerInterval = emp.contractor_payment_interval === 'weekly' ? 7 
              : emp.contractor_payment_interval === 'bi-weekly' ? 14 
              : emp.contractor_payment_interval === 'monthly' ? 30 
              : 7;
            const dailyCost = (emp.contractor_payment_amount / 100) / daysPerInterval;
            const daysWorked = new Set(empShifts.map(s => s.start_time.split('T')[0])).size;
            cost = dailyCost * daysWorked;
            rate = hours > 0 ? cost / hours : 0;
          }
          break;
      }

      // Determine outlier level
      let outlierLevel: 'none' | 'warning' | 'critical' = 'none';
      if (rate > RATE_CRITICAL_THRESHOLD) {
        outlierLevel = 'critical';
      } else if (rate > RATE_WARNING_THRESHOLD) {
        outlierLevel = 'warning';
      }

      employeeCostsMap.set(emp.id, {
        id: emp.id,
        name: emp.name,
        position: emp.position,
        hours,
        rate,
        cost,
        compensationType: emp.compensation_type || 'hourly',
        isOutlier: outlierLevel !== 'none',
        outlierLevel,
      });
    });

    // Convert to sorted array (by cost descending)
    const employeeCosts = Array.from(employeeCostsMap.values())
      .filter(e => e.hours > 0)
      .sort((a, b) => b.cost - a.cost);

    // Calculate totals (only from hourly employees for meaningful average)
    const hourlyEmployees = employeeCosts.filter(e => e.compensationType === 'hourly');
    const totalHourlyCost = hourlyEmployees.reduce((sum, e) => sum + e.cost, 0);
    const totalHourlyHours = hourlyEmployees.reduce((sum, e) => sum + e.hours, 0);
    
    const totalCost = employeeCosts.reduce((sum, e) => sum + e.cost, 0);
    const totalHours = employeeCosts.reduce((sum, e) => sum + e.hours, 0);
    
    // Average hourly rate is only meaningful for hourly employees
    const averageHourlyRate = totalHourlyHours > 0 ? totalHourlyCost / totalHourlyHours : 0;
    
    // Flag if average is unusually high for restaurant industry
    const isAverageHigh = averageHourlyRate > 35;

    return {
      totalCost,
      totalHours,
      averageHourlyRate,
      isAverageHigh,
      employeeCosts,
    };
  }, [shifts, employees]);
}

/**
 * Suggest likely typo corrections for an unusually high hourly rate.
 * Returns potential corrections by moving the decimal point.
 */
export function suggestRateCorrections(rateInDollars: number): { value: number; label: string }[] {
  const suggestions: { value: number; label: string }[] = [];
  
  if (rateInDollars >= 100) {
    // Likely missing decimal: $213 -> $21.30 or $2.13
    const tenthRate = rateInDollars / 10;
    const hundredthRate = rateInDollars / 100;
    
    if (tenthRate >= 10 && tenthRate <= 50) {
      suggestions.push({ value: tenthRate, label: `$${tenthRate.toFixed(2)}` });
    }
    if (hundredthRate >= 2 && hundredthRate <= 25) {
      suggestions.push({ value: hundredthRate, label: `$${hundredthRate.toFixed(2)}` });
    }
  }
  
  return suggestions;
}
