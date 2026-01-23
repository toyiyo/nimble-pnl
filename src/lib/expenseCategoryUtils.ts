/**
 * Expense Category Utilities
 * 
 * Maps chart of account subtypes to display-friendly labels.
 * This replaces keyword-guessing with actual database values.
 */

// Map account_subtype enum values to display-friendly labels
const SUBTYPE_DISPLAY_NAMES: Record<string, string> = {
  // Expense subtypes
  'labor': 'Labor & Payroll',
  'payroll': 'Labor & Payroll',
  'rent': 'Rent & Occupancy',
  'utilities': 'Utilities',
  'marketing': 'Marketing & Advertising',
  'insurance': 'Insurance',
  'repairs_maintenance': 'Repairs & Maintenance',
  'professional_fees': 'Professional Services',
  'bank_fees': 'Bank & Processing Fees',
  'merchant_fees': 'Bank & Processing Fees',
  'other_expenses': 'Other Expenses',
  'office_expenses': 'Office & Admin',
  'travel': 'Travel & Entertainment',
  'depreciation': 'Depreciation & Amortization',
  'amortization': 'Depreciation & Amortization',
  'interest_expense': 'Interest & Financing',
  'taxes': 'Taxes & Licenses',
  'licenses': 'Taxes & Licenses',
  
  // COGS subtypes
  'food_cost': 'Food Costs',
  'cost_of_goods_sold': 'Cost of Goods Sold',
  'beverage_cost': 'Beverage Costs',
  'packaging_cost': 'Packaging & Supplies',
  'supplies': 'Supplies & Packaging',
  
  // Asset subtypes (for completeness)
  'equipment': 'Equipment & Assets',
  'inventory': 'Inventory',
  
  // Revenue subtypes (rarely used in expense context)
  'sales': 'Sales Revenue',
  'other_income': 'Other Income',
};

/**
 * Formats an account_subtype value into a display-friendly category label.
 * Uses actual chart of account values instead of keyword guessing.
 * 
 * @param accountSubtype - The account_subtype enum value from chart_of_accounts
 * @param accountName - Optional fallback account name (used only for uncategorized display)
 * @returns Display-friendly category label
 */
export function formatExpenseCategory(
  accountSubtype: string | null | undefined,
  accountName?: string | null
): string {
  // If no subtype, mark as uncategorized
  if (!accountSubtype) {
    return 'Uncategorized';
  }
  
  // Look up the display name from our map
  const displayName = SUBTYPE_DISPLAY_NAMES[accountSubtype];
  
  if (displayName) {
    return displayName;
  }
  
  // Fallback: convert snake_case to Title Case
  return toTitleCase(accountSubtype);
}

/**
 * Converts snake_case or kebab-case strings to Title Case
 */
function toTitleCase(str: string): string {
  return str
    .replace(/[_-]/g, ' ')
    .replace(/\b\w/g, char => char.toUpperCase());
}

/**
 * Special category identifiers for tracking specific expense types
 */
export const EXPENSE_CATEGORIES = {
  LABOR: 'Labor & Payroll',
  FOOD_COST: 'Food Costs',
  COGS: 'Cost of Goods Sold',
  UNCATEGORIZED: 'Uncategorized',
} as const;

/**
 * Checks if a category is a labor/payroll category
 */
export function isLaborCategory(category: string): boolean {
  return category === EXPENSE_CATEGORIES.LABOR;
}

/**
 * Checks if a category is a food cost or COGS category
 */
export function isFoodCostCategory(category: string): boolean {
  return category === EXPENSE_CATEGORIES.FOOD_COST || 
         category === EXPENSE_CATEGORIES.COGS ||
         category === 'Beverage Costs';
}

/**
 * Checks if a category represents uncategorized transactions
 */
export function isUncategorized(category: string): boolean {
  return category === EXPENSE_CATEGORIES.UNCATEGORIZED;
}
