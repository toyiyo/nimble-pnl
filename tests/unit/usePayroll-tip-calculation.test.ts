import { describe, it, expect } from 'vitest';
import { aggregateTips, computeTipTotals } from '@/hooks/usePayroll';
import type { Employee } from '@/types/scheduling';

describe('Tip Calculation Bug Fix - Multiple Splits Same Date', () => {
  it('should sum multiple tip splits for the same date correctly', () => {
    // Scenario from production bug:
    // 7 tip splits on 2025-12-16, each $500 (50000 cents)
    // Employee "Jon" should get all 7 × $500 = $3500
    
    const employee: Employee = {
      id: 'jon-id',
      restaurant_id: 'rest-1',
      name: 'Jon',
      position: 'Server',
      status: 'active',
      compensation_type: 'hourly',
      hourly_rate: 1000, // $10/hr
      is_active: true,
      tip_eligible: true,
      created_at: '2025-01-01T00:00:00Z',
      updated_at: '2025-01-01T00:00:00Z',
    };

    // No tip_split_items exist (they weren't created)
    const tipItems: Array<{ employee_id: string; amount: number; tip_split_id?: string }> = [];
    
    // No legacy employee_tips
    const employeeTips: Array<{ employee_id: string; tip_amount: number }> = [];
    
    // 7 approved tip splits on same date (from production DB)
    const tipSplits = [
      { id: '193e243a-2832-4735-a961-ab20df6fd5ad', total_amount: 50000 },
      { id: '3389c5d1-f7e1-4f4f-a720-25e8d69ba72c', total_amount: 50000 },
      { id: '8a027615-9b17-459b-8f47-a57b6d90fbe8', total_amount: 50000 },
      { id: '9ef06905-52f5-46ae-a41c-250b20da1344', total_amount: 50000 },
      { id: 'c3f62a8c-1650-49e3-a390-9e3e94faf1e7', total_amount: 50000 },
      { id: 'ee970409-f7ac-4b50-93d6-c534d0231021', total_amount: 50000 },
      { id: 'f40892c8-ad17-4e0e-b206-d6e83c10870a', total_amount: 50000 },
    ];

    const result = computeTipTotals(tipItems, employeeTips, tipSplits, [employee]);

    // Expected: 7 splits × $500 each = $3,500 = 350000 cents
    expect(result.get('jon-id')).toBe(350000);
  });

  it('should handle multiple employees with multiple splits', () => {
    const employees: Employee[] = [
      {
        id: 'emp1',
        restaurant_id: 'rest-1',
        name: 'Alice',
        position: 'Server',
        status: 'active',
        compensation_type: 'hourly',
        hourly_rate: 1000,
        is_active: true,
        tip_eligible: true,
        created_at: '2025-01-01T00:00:00Z',
        updated_at: '2025-01-01T00:00:00Z',
      },
      {
        id: 'emp2',
        restaurant_id: 'rest-1',
        name: 'Bob',
        position: 'Bartender',
        status: 'active',
        compensation_type: 'hourly',
        hourly_rate: 1200,
        is_active: true,
        tip_eligible: true,
        created_at: '2025-01-01T00:00:00Z',
        updated_at: '2025-01-01T00:00:00Z',
      },
    ];

    const tipItems: Array<{ employee_id: string; amount: number; tip_split_id?: string }> = [];
    const employeeTips: Array<{ employee_id: string; tip_amount: number }> = [];
    
    // 3 splits, each should be divided between 2 employees
    const tipSplits = [
      { id: 's1', total_amount: 100000 }, // $1000
      { id: 's2', total_amount: 100000 }, // $1000
      { id: 's3', total_amount: 100000 }, // $1000
    ];

    const result = computeTipTotals(tipItems, employeeTips, tipSplits, employees);

    // Each split: $1000 / 2 employees = $500 each = 50000 cents
    // Total per employee: 3 × 50000 = 150000 cents ($1500)
    expect(result.get('emp1')).toBe(150000);
    expect(result.get('emp2')).toBe(150000);
  });

  it('should correctly handle splits with tip_split_items vs splits without', () => {
    const employee: Employee = {
      id: 'emp1',
      restaurant_id: 'rest-1',
      name: 'Charlie',
      position: 'Server',
      status: 'active',
      compensation_type: 'hourly',
      hourly_rate: 1000,
      is_active: true,
      tip_eligible: true,
      created_at: '2025-01-01T00:00:00Z',
      updated_at: '2025-01-01T00:00:00Z',
    };

    // Split s1 has detailed items (should use those, not fallback)
    const tipItems = [
      { employee_id: 'emp1', amount: 25000, tip_split_id: 's1' }, // $250
    ];
    
    const employeeTips: Array<{ employee_id: string; tip_amount: number }> = [];
    
    // Split s1 has items (should NOT fallback to total_amount)
    // Split s2 has NO items (SHOULD fallback to total_amount)
    const tipSplits = [
      { id: 's1', total_amount: 50000 }, // Has items, use items ($250)
      { id: 's2', total_amount: 50000 }, // No items, fallback to total ($500)
    ];

    const result = computeTipTotals(tipItems, employeeTips, tipSplits, [employee]);

    // Expected: $250 (25000 cents from items) + $500 (50000 cents from fallback) = $750 = 75000 cents
    expect(result.get('emp1')).toBe(75000);
  });

  it('should preserve rounding when allocating to last employee', () => {
    const employees: Employee[] = [
      { id: 'e1', status: 'active' } as Employee,
      { id: 'e2', status: 'active' } as Employee,
      { id: 'e3', status: 'active' } as Employee,
    ];

    const tipItems: Array<{ employee_id: string; amount: number; tip_split_id?: string }> = [];
    const employeeTips: Array<{ employee_id: string; tip_amount: number }> = [];
    
    // Amount that doesn't divide evenly: $100.01 (10001 cents)
    const tipSplits = [{ id: 's1', total_amount: 10001 }];

    const result = computeTipTotals(tipItems, employeeTips, tipSplits, employees);

    const e1 = result.get('e1') || 0;
    const e2 = result.get('e2') || 0;
    const e3 = result.get('e3') || 0;

    // Total should equal exactly 10001 cents ($100.01)
    expect(e1 + e2 + e3).toBe(10001);
    
    // Last employee should get remainder
    expect(e3).toBeGreaterThanOrEqual(e1);
    expect(e3).toBeGreaterThanOrEqual(e2);
  });

  it('should only allocate to active employees when both active and terminated exist', () => {
    const employees: Employee[] = [
      { id: 'e1', status: 'active' } as Employee,
      { id: 'e2', status: 'terminated' } as Employee,
      { id: 'e3', status: 'active' } as Employee,
    ];

    const tipItems: Array<{ employee_id: string; amount: number; tip_split_id?: string }> = [];
    const employeeTips: Array<{ employee_id: string; tip_amount: number }> = [];
    const tipSplits = [{ id: 's1', total_amount: 100000 }]; // $1000

    const result = computeTipTotals(tipItems, employeeTips, tipSplits, employees);

    // Should only split between e1 and e3 (active), not e2 (terminated)
    // $1000 = 100000 cents / 2 = 50000 cents each ($500)
    expect(result.get('e1')).toBe(50000);
    expect(result.get('e2')).toBeUndefined(); // Terminated, shouldn't get tips
    expect(result.get('e3')).toBe(50000);
  });

  it('should handle all terminated employees by falling back to all employees', () => {
    const employees: Employee[] = [
      { id: 'e1', status: 'terminated' } as Employee,
      { id: 'e2', status: 'terminated' } as Employee,
    ];

    const tipItems: Array<{ employee_id: string; amount: number; tip_split_id?: string }> = [];
    const employeeTips: Array<{ employee_id: string; tip_amount: number }> = [];
    const tipSplits = [{ id: 's1', total_amount: 100000 }]; // $1000

    const result = computeTipTotals(tipItems, employeeTips, tipSplits, employees);

    // When all are terminated, should still allocate (historical payroll)
    // $1000 = 100000 cents / 2 = 50000 cents each ($500)
    expect(result.get('e1')).toBe(50000);
    expect(result.get('e2')).toBe(50000);
  });
});

describe('Date Range Filtering', () => {
  it('should explain why tips might not show if splits are filtered by date in usePayroll query', () => {
    // This test documents a critical behavior:
    // The usePayroll hook filters tip_splits by split_date using the payroll date range
    // If split_date is outside the payroll period, those tips won't be included
    
    // Example: Payroll period Jan 12-18, 2025
    // Tip splits dated Dec 15-16, 2025 → EXCLUDED from query
    
    // This is EXPECTED behavior, but can be confusing when:
    // 1. Tips are created with a different split_date than the payroll period
    // 2. User views payroll for a period that doesn't match tip split dates
    
    // To debug: Check that split_date in tip_splits table matches payroll period
    expect(true).toBe(true);
  });
});

describe('Edge Cases', () => {
  it('should handle zero amount splits', () => {
    const employee: Employee = { id: 'e1', status: 'active' } as Employee;
    const tipSplits = [{ id: 's1', total_amount: 0 }];

    const result = computeTipTotals([], [], tipSplits, [employee]);

    expect(result.get('e1')).toBe(0);
  });

  it('should handle empty tip splits array', () => {
    const employee: Employee = { id: 'e1', status: 'active' } as Employee;

    const result = computeTipTotals([], [], [], [employee]);

    expect(result.size).toBe(0);
  });

  it('should combine tip_split_items, employee_tips, and split fallbacks', () => {
    const employee: Employee = { id: 'e1', status: 'active' } as Employee;

    const tipItems = [
      { employee_id: 'e1', amount: 10000, tip_split_id: 's1' }, // $100 from split s1
    ];

    const employeeTips = [
      { employee_id: 'e1', tip_amount: 5000 }, // $50 from legacy tips
    ];

    const tipSplits = [
      { id: 's1', total_amount: 50000 }, // Has items, won't fallback
      { id: 's2', total_amount: 20000 }, // No items, will fallback ($200)
    ];

    const result = computeTipTotals(tipItems, employeeTips, tipSplits, [employee]);

    // Expected: $100 (10000 cents from items) + $50 (5000 cents from legacy) + $200 (20000 cents from fallback) = $350 = 35000 cents
    expect(result.get('e1')).toBe(35000);
  });
});
