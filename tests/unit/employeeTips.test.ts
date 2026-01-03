import { describe, it, expect } from 'vitest';
import { calculateEmployeeTipTotal, groupTipsByDate } from '@/hooks/useEmployeeTips';
import type { EmployeeTip } from '@/hooks/useEmployeeTips';

describe('useEmployeeTips utilities', () => {
  describe('calculateEmployeeTipTotal', () => {
    it('calculates total from multiple tips', () => {
      const tips: EmployeeTip[] = [
        {
          id: '1',
          restaurant_id: 'rest1',
          employee_id: 'emp1',
          tip_amount: 5000, // $50.00
          tip_source: 'cash',
          recorded_at: '2024-01-15T12:00:00Z',
          created_at: '2024-01-15T12:00:00Z',
          updated_at: '2024-01-15T12:00:00Z',
        },
        {
          id: '2',
          restaurant_id: 'rest1',
          employee_id: 'emp1',
          tip_amount: 3500, // $35.00
          tip_source: 'credit',
          recorded_at: '2024-01-15T18:00:00Z',
          created_at: '2024-01-15T18:00:00Z',
          updated_at: '2024-01-15T18:00:00Z',
        },
      ];

      const total = calculateEmployeeTipTotal(tips);
      expect(total).toBe(8500); // $85.00
    });

    it('returns zero for empty array', () => {
      expect(calculateEmployeeTipTotal([])).toBe(0);
    });

    it('handles single tip', () => {
      const tips: EmployeeTip[] = [
        {
          id: '1',
          restaurant_id: 'rest1',
          employee_id: 'emp1',
          tip_amount: 2500,
          tip_source: 'cash',
          recorded_at: '2024-01-15T12:00:00Z',
          created_at: '2024-01-15T12:00:00Z',
          updated_at: '2024-01-15T12:00:00Z',
        },
      ];

      expect(calculateEmployeeTipTotal(tips)).toBe(2500);
    });

    it('handles large amounts correctly', () => {
      const tips: EmployeeTip[] = [
        {
          id: '1',
          restaurant_id: 'rest1',
          employee_id: 'emp1',
          tip_amount: 100000, // $1,000
          tip_source: 'cash',
          recorded_at: '2024-01-15T12:00:00Z',
          created_at: '2024-01-15T12:00:00Z',
          updated_at: '2024-01-15T12:00:00Z',
        },
      ];

      expect(calculateEmployeeTipTotal(tips)).toBe(100000);
    });
  });

  describe('groupTipsByDate', () => {
    it('groups tips by date correctly', () => {
      const tips: EmployeeTip[] = [
        {
          id: '1',
          restaurant_id: 'rest1',
          employee_id: 'emp1',
          tip_amount: 5000,
          tip_source: 'cash',
          recorded_at: '2024-01-15T12:00:00Z',
          created_at: '2024-01-15T12:00:00Z',
          updated_at: '2024-01-15T12:00:00Z',
        },
        {
          id: '2',
          restaurant_id: 'rest1',
          employee_id: 'emp1',
          tip_amount: 3500,
          tip_source: 'credit',
          recorded_at: '2024-01-15T18:00:00Z',
          created_at: '2024-01-15T18:00:00Z',
          updated_at: '2024-01-15T18:00:00Z',
        },
        {
          id: '3',
          restaurant_id: 'rest1',
          employee_id: 'emp1',
          tip_amount: 4500,
          tip_source: 'cash',
          recorded_at: '2024-01-16T12:00:00Z',
          created_at: '2024-01-16T12:00:00Z',
          updated_at: '2024-01-16T12:00:00Z',
        },
      ];

      const grouped = groupTipsByDate(tips);
      
      expect(grouped.size).toBe(2);
      expect(grouped.get('2024-01-15')?.length).toBe(2);
      expect(grouped.get('2024-01-16')?.length).toBe(1);
    });

    it('handles empty array', () => {
      const grouped = groupTipsByDate([]);
      expect(grouped.size).toBe(0);
    });

    it('handles single date with multiple tips', () => {
      const tips: EmployeeTip[] = [
        {
          id: '1',
          restaurant_id: 'rest1',
          employee_id: 'emp1',
          tip_amount: 1000,
          tip_source: 'cash',
          recorded_at: '2024-01-15T10:00:00Z',
          created_at: '2024-01-15T10:00:00Z',
          updated_at: '2024-01-15T10:00:00Z',
        },
        {
          id: '2',
          restaurant_id: 'rest1',
          employee_id: 'emp1',
          tip_amount: 2000,
          tip_source: 'credit',
          recorded_at: '2024-01-15T14:00:00Z',
          created_at: '2024-01-15T14:00:00Z',
          updated_at: '2024-01-15T14:00:00Z',
        },
        {
          id: '3',
          restaurant_id: 'rest1',
          employee_id: 'emp1',
          tip_amount: 3000,
          tip_source: 'cash',
          recorded_at: '2024-01-15T18:00:00Z',
          created_at: '2024-01-15T18:00:00Z',
          updated_at: '2024-01-15T18:00:00Z',
        },
      ];

      const grouped = groupTipsByDate(tips);
      
      expect(grouped.size).toBe(1);
      expect(grouped.get('2024-01-15')?.length).toBe(3);
      
      const dayTips = grouped.get('2024-01-15')!;
      expect(calculateEmployeeTipTotal(dayTips)).toBe(6000);
    });

    it('preserves tip details in grouped results', () => {
      const tips: EmployeeTip[] = [
        {
          id: '1',
          restaurant_id: 'rest1',
          employee_id: 'emp1',
          tip_amount: 5000,
          tip_source: 'cash',
          recorded_at: '2024-01-15T12:00:00Z',
          notes: 'Lunch shift',
          created_at: '2024-01-15T12:00:00Z',
          updated_at: '2024-01-15T12:00:00Z',
        },
      ];

      const grouped = groupTipsByDate(tips);
      const dayTips = grouped.get('2024-01-15')!;
      
      expect(dayTips[0].id).toBe('1');
      expect(dayTips[0].tip_source).toBe('cash');
      expect(dayTips[0].notes).toBe('Lunch shift');
    });
  });

  describe('Edge Cases & Validation', () => {
    it('handles zero tip amounts', () => {
      const tips: EmployeeTip[] = [
        {
          id: '1',
          restaurant_id: 'rest1',
          employee_id: 'emp1',
          tip_amount: 0,
          tip_source: 'cash',
          recorded_at: '2024-01-15T12:00:00Z',
          created_at: '2024-01-15T12:00:00Z',
          updated_at: '2024-01-15T12:00:00Z',
        },
      ];

      expect(calculateEmployeeTipTotal(tips)).toBe(0);
    });

    it('groups tips across time zones correctly', () => {
      const tips: EmployeeTip[] = [
        {
          id: '1',
          restaurant_id: 'rest1',
          employee_id: 'emp1',
          tip_amount: 1000,
          tip_source: 'cash',
          recorded_at: '2024-01-15T23:59:59Z', // End of day UTC
          created_at: '2024-01-15T23:59:59Z',
          updated_at: '2024-01-15T23:59:59Z',
        },
        {
          id: '2',
          restaurant_id: 'rest1',
          employee_id: 'emp1',
          tip_amount: 2000,
          tip_source: 'credit',
          recorded_at: '2024-01-16T00:00:01Z', // Start of next day UTC
          created_at: '2024-01-16T00:00:01Z',
          updated_at: '2024-01-16T00:00:01Z',
        },
      ];

      const grouped = groupTipsByDate(tips);
      
      // Should be separate days
      expect(grouped.size).toBe(2);
      expect(grouped.get('2024-01-15')?.length).toBe(1);
      expect(grouped.get('2024-01-16')?.length).toBe(1);
    });

    it('maintains order within grouped tips', () => {
      const tips: EmployeeTip[] = [
        {
          id: '1',
          restaurant_id: 'rest1',
          employee_id: 'emp1',
          tip_amount: 1000,
          tip_source: 'cash',
          recorded_at: '2024-01-15T18:00:00Z',
          created_at: '2024-01-15T18:00:00Z',
          updated_at: '2024-01-15T18:00:00Z',
        },
        {
          id: '2',
          restaurant_id: 'rest1',
          employee_id: 'emp1',
          tip_amount: 2000,
          tip_source: 'credit',
          recorded_at: '2024-01-15T12:00:00Z',
          created_at: '2024-01-15T12:00:00Z',
          updated_at: '2024-01-15T12:00:00Z',
        },
      ];

      const grouped = groupTipsByDate(tips);
      const dayTips = grouped.get('2024-01-15')!;
      
      // Order should be preserved as provided
      expect(dayTips[0].id).toBe('1');
      expect(dayTips[1].id).toBe('2');
    });
  });
});
