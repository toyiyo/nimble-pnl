import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useScheduledLaborCosts } from '@/hooks/useScheduledLaborCosts';
import { useEmployees } from '@/hooks/useEmployees';
import { Shift } from '@/types/scheduling';

// Mock the useEmployees hook
vi.mock('@/hooks/useEmployees', () => ({
  useEmployees: vi.fn(),
}));

describe('useScheduledLaborCosts', () => {
  const mockRestaurantId = 'restaurant-123';
  const dateFrom = new Date('2025-01-01T00:00:00Z');
  const dateTo = new Date('2025-01-07T23:59:59Z'); // 7 days

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Hourly Employee Calculations', () => {
    it('calculates hourly employee cost from scheduled shifts', () => {
      const mockEmployees = [
        {
          id: 'emp-1',
          first_name: 'John',
          last_name: 'Doe',
          compensation_type: 'hourly' as const,
          hourly_rate: 1500, // $15.00/hr in cents
          status: 'active' as const,
        },
      ];

      const mockShifts: Shift[] = [
        {
          id: 'shift-1',
          employee_id: 'emp-1',
          start_time: '2025-01-01T09:00:00Z',
          end_time: '2025-01-01T17:00:00Z', // 8 hours
          break_duration: 30, // 30 min break = 7.5 net hours
          status: 'scheduled',
        } as Shift,
      ];

      vi.mocked(useEmployees).mockReturnValue({
        employees: mockEmployees,
        loading: false,
        error: null,
        refetch: vi.fn(),
      } as any);

      const { result } = renderHook(() =>
        useScheduledLaborCosts(mockShifts, dateFrom, dateTo, mockRestaurantId)
      );

      // 7.5 hours × $15/hr = $112.50
      expect(result.current.breakdown.hourly.cost).toBeCloseTo(112.5, 2);
      expect(result.current.breakdown.hourly.hours).toBeCloseTo(7.5, 2);
      expect(result.current.totalCost).toBeCloseTo(112.5, 2);
    });

    it('handles multiple shifts for same employee on same day', () => {
      const mockEmployees = [
        {
          id: 'emp-1',
          compensation_type: 'hourly' as const,
          hourly_rate: 2000, // $20.00/hr
          status: 'active' as const,
        },
      ];

      const mockShifts: Shift[] = [
        {
          id: 'shift-1',
          employee_id: 'emp-1',
          start_time: '2025-01-01T06:00:00Z',
          end_time: '2025-01-01T12:00:00Z', // 6 hours
          break_duration: 0,
          status: 'scheduled',
        } as Shift,
        {
          id: 'shift-2',
          employee_id: 'emp-1',
          start_time: '2025-01-01T18:00:00Z',
          end_time: '2025-01-01T22:00:00Z', // 4 hours
          break_duration: 0,
          status: 'scheduled',
        } as Shift,
      ];

      vi.mocked(useEmployees).mockReturnValue({
        employees: mockEmployees,
        loading: false,
      } as any);

      const { result } = renderHook(() =>
        useScheduledLaborCosts(mockShifts, dateFrom, dateTo, mockRestaurantId)
      );

      // 10 hours × $20/hr = $200
      expect(result.current.breakdown.hourly.hours).toBeCloseTo(10, 2);
      expect(result.current.breakdown.hourly.cost).toBeCloseTo(200, 2);
    });

    it('handles shifts with breaks correctly', () => {
      const mockEmployees = [
        {
          id: 'emp-1',
          compensation_type: 'hourly' as const,
          hourly_rate: 1000, // $10.00/hr
          status: 'active' as const,
        },
      ];

      const mockShifts: Shift[] = [
        {
          id: 'shift-1',
          employee_id: 'emp-1',
          start_time: '2025-01-01T09:00:00Z',
          end_time: '2025-01-01T18:00:00Z', // 9 hours
          break_duration: 60, // 1 hour break = 8 net hours
          status: 'scheduled',
        } as Shift,
      ];

      vi.mocked(useEmployees).mockReturnValue({
        employees: mockEmployees,
        loading: false,
      } as any);

      const { result } = renderHook(() =>
        useScheduledLaborCosts(mockShifts, dateFrom, dateTo, mockRestaurantId)
      );

      // 8 hours × $10/hr = $80
      expect(result.current.breakdown.hourly.hours).toBeCloseTo(8, 2);
      expect(result.current.breakdown.hourly.cost).toBeCloseTo(80, 2);
    });
  });

  describe('Salary Employee Calculations', () => {
    it('prorates salary cost for scheduled days', () => {
      const mockEmployees = [
        {
          id: 'emp-1',
          compensation_type: 'salary' as const,
          salary_amount: 304400, // $3,044/month = $100/day (using 30.44 days/month)
          pay_period_type: 'monthly' as const,
          status: 'active' as const,
        },
      ];

      const mockShifts: Shift[] = [
        {
          id: 'shift-1',
          employee_id: 'emp-1',
          start_time: '2025-01-01T09:00:00Z',
          end_time: '2025-01-01T17:00:00Z',
          break_duration: 0,
          status: 'scheduled',
        } as Shift,
        {
          id: 'shift-2',
          employee_id: 'emp-1',
          start_time: '2025-01-02T09:00:00Z',
          end_time: '2025-01-02T17:00:00Z',
          break_duration: 0,
          status: 'scheduled',
        } as Shift,
      ];

      vi.mocked(useEmployees).mockReturnValue({
        employees: mockEmployees,
        loading: false,
      } as any);

      const { result } = renderHook(() =>
        useScheduledLaborCosts(mockShifts, dateFrom, dateTo, mockRestaurantId)
      );

      // $3,044/month ÷ 30.44 days = $100/day × 2 days = $200
      expect(result.current.breakdown.salary.cost).toBeCloseTo(200, 2);
      expect(result.current.breakdown.salary.estimatedDays).toBe(2);
    });

    it('does not count salary for days employee is not scheduled', () => {
      const mockEmployees = [
        {
          id: 'emp-1',
          compensation_type: 'salary' as const,
          salary_amount: 304400, // $3,044/month = $100/day
          pay_period_type: 'monthly' as const,
          status: 'active' as const,
        },
      ];

      const mockShifts: Shift[] = [
        {
          id: 'shift-1',
          employee_id: 'emp-1',
          start_time: '2025-01-01T09:00:00Z',
          end_time: '2025-01-01T17:00:00Z',
          break_duration: 0,
          status: 'scheduled',
        } as Shift,
        // No shift on Jan 2
      ];

      vi.mocked(useEmployees).mockReturnValue({
        employees: mockEmployees,
        loading: false,
      } as any);

      const { result } = renderHook(() =>
        useScheduledLaborCosts(mockShifts, dateFrom, dateTo, mockRestaurantId)
      );

      // Only 1 day scheduled
      expect(result.current.breakdown.salary.estimatedDays).toBe(1);
      expect(result.current.breakdown.salary.cost).toBeCloseTo(100, 2);
    });
  });

  describe('Mixed Compensation Types', () => {
    it('calculates combined hourly and salary costs', () => {
      const mockEmployees = [
        {
          id: 'emp-hourly',
          compensation_type: 'hourly' as const,
          hourly_rate: 1500, // $15/hr
          status: 'active' as const,
        },
        {
          id: 'emp-salary',
          compensation_type: 'salary' as const,
          salary_amount: 304400, // $3,044/month = $100/day
          pay_period_type: 'monthly' as const,
          status: 'active' as const,
        },
      ];

      const mockShifts: Shift[] = [
        {
          id: 'shift-1',
          employee_id: 'emp-hourly',
          start_time: '2025-01-01T09:00:00Z',
          end_time: '2025-01-01T17:00:00Z', // 8 hours
          break_duration: 0,
          status: 'scheduled',
        } as Shift,
        {
          id: 'shift-2',
          employee_id: 'emp-salary',
          start_time: '2025-01-01T09:00:00Z',
          end_time: '2025-01-01T17:00:00Z',
          break_duration: 0,
          status: 'scheduled',
        } as Shift,
      ];

      vi.mocked(useEmployees).mockReturnValue({
        employees: mockEmployees,
        loading: false,
      } as any);

      const { result } = renderHook(() =>
        useScheduledLaborCosts(mockShifts, dateFrom, dateTo, mockRestaurantId)
      );

      // Hourly: 8hrs × $15 = $120
      // Salary: 1 day × $100 = $100
      // Total: $220
      expect(result.current.breakdown.hourly.cost).toBeCloseTo(120, 2);
      expect(result.current.breakdown.salary.cost).toBeCloseTo(100, 2);
      expect(result.current.totalCost).toBeCloseTo(220, 2);
    });
  });

  describe('Edge Cases', () => {
    it('returns zero costs when no restaurant selected', () => {
      vi.mocked(useEmployees).mockReturnValue({
        employees: [],
        loading: false,
      } as any);

      const { result } = renderHook(() =>
        useScheduledLaborCosts([], dateFrom, dateTo, null)
      );

      expect(result.current.totalCost).toBe(0);
      expect(result.current.breakdown.hourly.cost).toBe(0);
      expect(result.current.breakdown.salary.cost).toBe(0);
      expect(result.current.breakdown.contractor.cost).toBe(0);
    });

    it('returns zero costs when no employees exist', () => {
      vi.mocked(useEmployees).mockReturnValue({
        employees: [],
        loading: false,
      } as any);

      const { result } = renderHook(() =>
        useScheduledLaborCosts([], dateFrom, dateTo, mockRestaurantId)
      );

      expect(result.current.totalCost).toBe(0);
      expect(result.current.breakdown.hourly.cost).toBe(0);
    });

    it('returns zero costs when no shifts scheduled', () => {
      const mockEmployees = [
        {
          id: 'emp-1',
          compensation_type: 'hourly' as const,
          hourly_rate: 1500,
          status: 'active' as const,
        },
      ];

      vi.mocked(useEmployees).mockReturnValue({
        employees: mockEmployees,
        loading: false,
      } as any);

      const { result } = renderHook(() =>
        useScheduledLaborCosts([], dateFrom, dateTo, mockRestaurantId)
      );

      expect(result.current.totalCost).toBe(0);
      expect(result.current.breakdown.hourly.cost).toBe(0);
      expect(result.current.breakdown.hourly.hours).toBe(0);
    });

    it('ignores inactive employees', () => {
      const mockEmployees = [
        {
          id: 'emp-active',
          compensation_type: 'hourly' as const,
          hourly_rate: 1500,
          status: 'active' as const,
        },
        {
          id: 'emp-inactive',
          compensation_type: 'hourly' as const,
          hourly_rate: 1500,
          status: 'inactive' as const,
        },
      ];

      const mockShifts: Shift[] = [
        {
          id: 'shift-1',
          employee_id: 'emp-active',
          start_time: '2025-01-01T09:00:00Z',
          end_time: '2025-01-01T17:00:00Z', // 8 hours
          break_duration: 0,
          status: 'scheduled',
        } as Shift,
        {
          id: 'shift-2',
          employee_id: 'emp-inactive',
          start_time: '2025-01-01T09:00:00Z',
          end_time: '2025-01-01T17:00:00Z', // Should be ignored
          break_duration: 0,
          status: 'scheduled',
        } as Shift,
      ];

      vi.mocked(useEmployees).mockReturnValue({
        employees: mockEmployees,
        loading: false,
      } as any);

      const { result } = renderHook(() =>
        useScheduledLaborCosts(mockShifts, dateFrom, dateTo, mockRestaurantId)
      );

      // Only active employee's 8 hours × $15 = $120
      expect(result.current.breakdown.hourly.hours).toBeCloseTo(8, 2);
      expect(result.current.breakdown.hourly.cost).toBeCloseTo(120, 2);
    });

    it('handles shifts without matching employee', () => {
      const mockEmployees = [
        {
          id: 'emp-1',
          compensation_type: 'hourly' as const,
          hourly_rate: 1500,
          status: 'active' as const,
        },
      ];

      const mockShifts: Shift[] = [
        {
          id: 'shift-1',
          employee_id: 'emp-nonexistent', // Employee not in list
          start_time: '2025-01-01T09:00:00Z',
          end_time: '2025-01-01T17:00:00Z',
          break_duration: 0,
          status: 'scheduled',
        } as Shift,
      ];

      vi.mocked(useEmployees).mockReturnValue({
        employees: mockEmployees,
        loading: false,
      } as any);

      const { result } = renderHook(() =>
        useScheduledLaborCosts(mockShifts, dateFrom, dateTo, mockRestaurantId)
      );

      // Should ignore shift without employee
      expect(result.current.totalCost).toBe(0);
    });
  });

  describe('Daily Cost Distribution', () => {
    it('distributes costs across correct dates', () => {
      const mockEmployees = [
        {
          id: 'emp-1',
          compensation_type: 'hourly' as const,
          hourly_rate: 1000, // $10/hr
          status: 'active' as const,
        },
      ];

      const mockShifts: Shift[] = [
        {
          id: 'shift-1',
          employee_id: 'emp-1',
          start_time: '2025-01-01T10:00:00Z',
          end_time: '2025-01-01T14:00:00Z', // 4 hours = $40
          break_duration: 0,
          status: 'scheduled',
        } as Shift,
        {
          id: 'shift-2',
          employee_id: 'emp-1',
          start_time: '2025-01-03T10:00:00Z',
          end_time: '2025-01-03T16:00:00Z', // 6 hours = $60
          break_duration: 0,
          status: 'scheduled',
        } as Shift,
      ];

      vi.mocked(useEmployees).mockReturnValue({
        employees: mockEmployees,
        loading: false,
      } as any);

      const { result } = renderHook(() =>
        useScheduledLaborCosts(mockShifts, dateFrom, dateTo, mockRestaurantId)
      );

      // Check daily costs
      const jan1 = result.current.dailyCosts.find(d => d.date === '2025-01-01');
      const jan2 = result.current.dailyCosts.find(d => d.date === '2025-01-02');
      const jan3 = result.current.dailyCosts.find(d => d.date === '2025-01-03');

      expect(jan1?.total_labor_cost).toBeCloseTo(40, 2);
      expect(jan2?.total_labor_cost).toBe(0); // No shifts
      expect(jan3?.total_labor_cost).toBeCloseTo(60, 2);
      expect(result.current.totalCost).toBeCloseTo(100, 2);
    });

    it('returns empty daily costs when no employees (early return optimization)', () => {
      vi.mocked(useEmployees).mockReturnValue({
        employees: [],
        loading: false,
      } as any);

      const { result } = renderHook(() =>
        useScheduledLaborCosts([], dateFrom, dateTo, mockRestaurantId)
      );

      // When no employees exist, returns empty array (optimization)
      // The UI can handle this by checking if employees exist first
      expect(result.current.dailyCosts).toHaveLength(0);
      expect(result.current.totalCost).toBe(0);
    });
  });
});
