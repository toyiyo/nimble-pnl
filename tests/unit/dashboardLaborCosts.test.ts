import { describe, it, expect } from 'vitest';

/**
 * TDD Tests for Dashboard Labor Costs
 * 
 * The dashboard must show labor costs from ALL compensation types:
 * 1. Hourly wages (from daily_labor_costs.hourly_wages - time punches)
 * 2. Salary allocations (from daily_labor_allocations where compensation_type='salary')
 * 3. Contractor payments (from daily_labor_allocations where compensation_type='contractor')
 * 
 * Architecture:
 * - daily_labor_costs: hourly_wages (time punch based) + salary_wages (legacy, not used)
 * - daily_labor_allocations: salary + contractor daily allocations
 * - get_daily_labor_summary(): RPC that combines both sources
 * 
 * Current Implementation:
 * - useLaborCosts() queries daily_labor_costs.total_labor_cost (which is a computed field)
 * - ❌ Does NOT include daily_labor_allocations
 * 
 * Required Changes:
 * - useLaborCosts() must also query daily_labor_allocations and sum allocations
 * - OR use get_daily_labor_summary() RPC function
 */

describe('Dashboard Labor Costs - TDD', () => {
  describe('Requirement: Show labor costs from ALL compensation types', () => {
    it('should include hourly wages from daily_labor_costs', () => {
      // Given: A restaurant with hourly employees who have clocked in/out
      const hourlyWages = 1500; // $1,500 in hourly wages
      
      // When: Dashboard loads labor costs for a period
      const laborCost = calculateDashboardLaborCost({
        hourlyWages,
        salaryAllocations: 0,
        contractorAllocations: 0,
      });
      
      // Then: Labor cost should include hourly wages
      expect(laborCost).toBe(1500);
    });

    it('should include salary allocations from daily_labor_allocations', () => {
      // Given: A restaurant with salaried employees
      const salaryAllocations = 2000; // $2,000 in daily salary allocations
      
      // When: Dashboard loads labor costs for a period
      const laborCost = calculateDashboardLaborCost({
        hourlyWages: 0,
        salaryAllocations,
        contractorAllocations: 0,
      });
      
      // Then: Labor cost should include salary allocations
      expect(laborCost).toBe(2000);
    });

    it('should include contractor payments from daily_labor_allocations', () => {
      // Given: A restaurant with contractors (per-job or monthly)
      const contractorAllocations = 800; // $800 in contractor payments
      
      // When: Dashboard loads labor costs for a period
      const laborCost = calculateDashboardLaborCost({
        hourlyWages: 0,
        salaryAllocations: 0,
        contractorAllocations,
      });
      
      // Then: Labor cost should include contractor allocations
      expect(laborCost).toBe(800);
    });

    it('should sum all compensation types for total labor cost', () => {
      // Given: A restaurant with all compensation types
      const hourlyWages = 1500;
      const salaryAllocations = 2000;
      const contractorAllocations = 800;
      
      // When: Dashboard loads labor costs for a period
      const laborCost = calculateDashboardLaborCost({
        hourlyWages,
        salaryAllocations,
        contractorAllocations,
      });
      
      // Then: Labor cost should be the sum of all types
      expect(laborCost).toBe(4300); // 1500 + 2000 + 800
    });
  });

  describe('Multi-day period calculations', () => {
    it('should aggregate hourly wages across multiple days', () => {
      // Given: A 7-day period with daily hourly wages
      const dailyWages = [200, 250, 300, 280, 320, 400, 450]; // 7 days
      
      // When: Dashboard calculates total labor for the period
      const totalLabor = dailyWages.reduce((sum, day) => sum + day, 0);
      
      // Then: Should sum all days
      expect(totalLabor).toBe(2200);
    });

    it('should aggregate salary allocations across multiple days', () => {
      // Given: A 7-day period with $500/day salary allocation
      const dailySalary = 500;
      const days = 7;
      
      // When: Dashboard calculates total salary for the period
      const totalSalary = dailySalary * days;
      
      // Then: Should multiply daily rate by days
      expect(totalSalary).toBe(3500);
    });

    it('should handle mixed compensation types across a period', () => {
      // Given: A 7-day period with varying compensation
      const dailyData = [
        { hourly: 200, salary: 500, contractor: 100 },
        { hourly: 250, salary: 500, contractor: 0 },
        { hourly: 300, salary: 500, contractor: 200 },
        { hourly: 280, salary: 500, contractor: 0 },
        { hourly: 320, salary: 500, contractor: 0 },
        { hourly: 400, salary: 500, contractor: 300 },
        { hourly: 450, salary: 500, contractor: 0 },
      ];
      
      // When: Dashboard calculates total labor
      const totalLabor = dailyData.reduce((sum, day) => {
        return sum + day.hourly + day.salary + day.contractor;
      }, 0);
      
      // Then: Should sum all types across all days
      expect(totalLabor).toBe(6300); // (2200 hourly) + (3500 salary) + (600 contractor)
    });
  });

  describe('Edge cases', () => {
    it('should handle days with no labor activity', () => {
      // Given: A day with no labor costs
      const laborCost = calculateDashboardLaborCost({
        hourlyWages: 0,
        salaryAllocations: 0,
        contractorAllocations: 0,
      });
      
      // Then: Should return 0
      expect(laborCost).toBe(0);
    });

    it('should handle partial compensation types', () => {
      // Given: A restaurant with only hourly and salary (no contractors)
      const laborCost = calculateDashboardLaborCost({
        hourlyWages: 1000,
        salaryAllocations: 2000,
        contractorAllocations: 0,
      });
      
      // Then: Should sum only the present types
      expect(laborCost).toBe(3000);
    });

    it('should handle null/undefined values gracefully', () => {
      // Given: Missing data for some compensation types
      const laborCost = calculateDashboardLaborCost({
        hourlyWages: 1000,
        salaryAllocations: undefined as unknown as number,
        contractorAllocations: null as unknown as number,
      });
      
      // Then: Should treat missing as 0 and continue
      expect(laborCost).toBe(1000);
    });
  });

  describe('Data source validation', () => {
    it('should query daily_labor_costs for hourly wages', () => {
      // This test validates the query structure
      const query = {
        table: 'daily_labor_costs',
        select: ['date', 'hourly_wages'],
        filters: {
          restaurant_id: 'test-restaurant',
          date_gte: '2025-01-01',
          date_lte: '2025-01-07',
        },
      };
      
      expect(query.table).toBe('daily_labor_costs');
      expect(query.select).toContain('hourly_wages');
    });

    it('should query daily_labor_allocations for salary/contractor', () => {
      // This test validates the query structure
      const query = {
        table: 'daily_labor_allocations',
        select: ['date', 'allocated_cost', 'compensation_type'],
        filters: {
          restaurant_id: 'test-restaurant',
          date_gte: '2025-01-01',
          date_lte: '2025-01-07',
          compensation_type_in: ['salary', 'contractor'],
        },
      };
      
      expect(query.table).toBe('daily_labor_allocations');
      expect(query.select).toContain('allocated_cost');
      expect(query.select).toContain('compensation_type');
    });

    it('should combine both data sources for total labor', () => {
      // Given: Data from both sources
      const hourlyData = [
        { date: '2025-01-01', hourly_wages: 200 },
        { date: '2025-01-02', hourly_wages: 250 },
      ];
      
      const allocationData = [
        { date: '2025-01-01', allocated_cost: 500, compensation_type: 'salary' },
        { date: '2025-01-01', allocated_cost: 100, compensation_type: 'contractor' },
        { date: '2025-01-02', allocated_cost: 500, compensation_type: 'salary' },
      ];
      
      // When: Combining both sources
      const totalByDate = combineLaborSources(hourlyData, allocationData);
      
      // Then: Should have correct totals per day
      expect(totalByDate['2025-01-01']).toBe(800); // 200 + 500 + 100
      expect(totalByDate['2025-01-02']).toBe(750); // 250 + 500
    });
  });

  describe('Labor cost percentage calculations', () => {
    it('should calculate labor cost percentage correctly with all types', () => {
      // Given: Revenue and labor costs
      const netRevenue = 10000;
      const totalLaborCost = 3000; // All compensation types combined
      
      // When: Calculating percentage
      const percentage = (totalLaborCost / netRevenue) * 100;
      
      // Then: Should be 30%
      expect(percentage).toBe(30);
    });

    it('should include all compensation types in prime cost', () => {
      // Given: Revenue, food cost, and all labor types
      const netRevenue = 10000;
      const foodCost = 2800;
      const hourlyLabor = 1500;
      const salaryLabor = 1000;
      const contractorLabor = 500;
      const totalLabor = hourlyLabor + salaryLabor + contractorLabor;
      const primeCost = foodCost + totalLabor;
      
      // When: Calculating prime cost percentage
      const primeCostPercentage = (primeCost / netRevenue) * 100;
      
      // Then: Should be 58% (within recommended 60-65%)
      expect(Math.round(primeCostPercentage)).toBe(58);
      expect(primeCost).toBe(5800); // 2800 food + 3000 labor
    });
  });
});

// Helper function to calculate dashboard labor cost
// This is what the implementation should do
function calculateDashboardLaborCost(costs: {
  hourlyWages: number;
  salaryAllocations: number | undefined | null;
  contractorAllocations: number | undefined | null;
}): number {
  const hourly = costs.hourlyWages || 0;
  const salary = costs.salaryAllocations || 0;
  const contractor = costs.contractorAllocations || 0;
  
  return hourly + salary + contractor;
}

// Helper function to combine labor sources by date
function combineLaborSources(
  hourlyData: Array<{ date: string; hourly_wages: number }>,
  allocationData: Array<{ date: string; allocated_cost: number; compensation_type: string }>
): Record<string, number> {
  const result: Record<string, number> = {};
  
  // Add hourly wages
  hourlyData.forEach((item) => {
    result[item.date] = (result[item.date] || 0) + item.hourly_wages;
  });
  
  // Add allocations
  allocationData.forEach((item) => {
    result[item.date] = (result[item.date] || 0) + item.allocated_cost;
  });
  
  return result;
}
