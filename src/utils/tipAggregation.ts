/**
 * Tip Aggregation Utilities
 * 
 * Provides DRY logic for aggregating tips from multiple sources while preventing double-counting.
 * 
 * @module tipAggregation
 */

export interface TipSplitItem {
  employee_id: string;
  amount: number; // in cents
  split_date?: string;
}

export interface EmployeeTip {
  employee_id: string;
  amount: number; // in cents
  tip_date: string;
  source?: 'cash' | 'credit';
}

export interface AggregatedTip {
  employee_id: string;
  total: number; // in cents
  fromSplit: number; // in cents
  fromDeclaration: number; // in cents
}

/**
 * Get dates that have approved tip splits.
 * These dates should exclude employee-declared tips to prevent double-counting.
 */
export function getDatesWithApprovedSplits(tipItems: TipSplitItem[]): Set<string> {
  const dates = new Set<string>();
  
  for (const item of tipItems) {
    if (item.split_date) {
      dates.add(item.split_date);
    }
  }
  
  return dates;
}

/**
 * Aggregates tips from split items, excluding employee-declared tips for dates
 * that have approved splits to prevent double-counting.
 * 
 * When a manager approves a tip split for a specific date:
 * - tip_split_items contains the authoritative distribution
 * - employee_tips for that date should be excluded (they're already in the split)
 * 
 * @param tipItems - Tip amounts from approved splits (tip_split_items table)
 * @param employeeTips - Tips declared by employees (employee_tips table)
 * @returns Map of employee_id to aggregated tip data
 */
export function aggregateTipsWithDateFiltering(
  tipItems: TipSplitItem[],
  employeeTips: EmployeeTip[]
): Map<string, AggregatedTip> {
  const result = new Map<string, AggregatedTip>();
  
  // Get dates that have approved splits
  const datesWithSplits = getDatesWithApprovedSplits(tipItems);
  
  // Add tips from approved splits
  for (const item of tipItems) {
    const existing = result.get(item.employee_id) || {
      employee_id: item.employee_id,
      total: 0,
      fromSplit: 0,
      fromDeclaration: 0,
    };
    
    existing.fromSplit += item.amount;
    existing.total += item.amount;
    result.set(item.employee_id, existing);
  }
  
  // Add employee-declared tips ONLY for dates without approved splits
  for (const tip of employeeTips) {
    // Skip if this date already has an approved split
    if (datesWithSplits.has(tip.tip_date)) {
      continue;
    }
    
    const existing = result.get(tip.employee_id) || {
      employee_id: tip.employee_id,
      total: 0,
      fromSplit: 0,
      fromDeclaration: 0,
    };
    
    existing.fromDeclaration += tip.amount;
    existing.total += tip.amount;
    result.set(tip.employee_id, existing);
  }
  
  return result;
}

/**
 * Computes total tips for each employee with proper double-counting prevention.
 * 
 * Priority order:
 * 1. Approved splits (tip_split_items with split_date) - authoritative for those dates
 * 2. Employee declarations (employee_tips) - only for dates without approved splits
 * 3. Fallback to POS data if no manual data exists
 * 
 * @param tipItems - Tip amounts from approved splits
 * @param employeeTips - Tips declared by employees
 * @param posTips - Fallback POS tip data
 * @returns Map of employee_id to total tip amount in cents
 */
export function computeTipTotalsWithFiltering(
  tipItems: TipSplitItem[],
  employeeTips: EmployeeTip[],
  posTips?: Map<string, number>
): Map<string, number> {
  // First, aggregate with date filtering
  const aggregated = aggregateTipsWithDateFiltering(tipItems, employeeTips);
  
  // Convert to simple map
  const totals = new Map<string, number>();
  for (const [employeeId, data] of aggregated) {
    totals.set(employeeId, data.total);
  }
  
  // If no manual tips at all, fall back to POS data
  if (totals.size === 0 && posTips) {
    return new Map(posTips);
  }
  
  return totals;
}

/**
 * Legacy function for backward compatibility.
 * Use computeTipTotalsWithFiltering for new code.
 * 
 * @deprecated Use computeTipTotalsWithFiltering instead
 */
export function computeTipTotals(
  tipItems: { employee_id: string; amount: number }[],
  employeeTips: { employee_id: string; amount: number }[],
  posTips?: Map<string, number>
): Map<string, number> {
  // Convert to typed format
  const typedItems: TipSplitItem[] = tipItems.map(item => ({
    employee_id: item.employee_id,
    amount: item.amount,
  }));
  
  const typedEmployeeTips: EmployeeTip[] = employeeTips.map(tip => ({
    employee_id: tip.employee_id,
    amount: tip.amount,
    tip_date: '', // No date = assume all dates are unique
  }));
  
  return computeTipTotalsWithFiltering(typedItems, typedEmployeeTips, posTips);
}
