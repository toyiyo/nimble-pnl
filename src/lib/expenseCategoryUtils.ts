/**
 * Expense Category Utilities
 * 
 * Maps chart of account subtypes to display-friendly labels.
 * This replaces keyword-guessing with actual database values.
 */

// Map account_subtype enum values to display-friendly labels
// Based on actual account_subtype_enum from database
const SUBTYPE_DISPLAY_NAMES: Record<string, string> = {
  // Asset subtypes
  'cash': 'Cash',
  'bank': 'Bank Accounts',
  'accounts_receivable': 'Accounts Receivable',
  'inventory': 'Inventory',
  'fixed_assets': 'Fixed Assets',
  'other_current_assets': 'Other Current Assets',
  'other_assets': 'Other Assets',
  'prepaid_expenses': 'Prepaid Expenses',
  'accumulated_depreciation': 'Accumulated Depreciation',
  
  // Liability subtypes
  'accounts_payable': 'Accounts Payable',
  'credit_card': 'Credit Card',
  'loan': 'Loans',
  'other_current_liabilities': 'Other Current Liabilities',
  'long_term_liabilities': 'Long Term Liabilities',
  'payroll_liabilities': 'Payroll Liabilities',
  'deferred_revenue': 'Deferred Revenue',
  'other_liabilities': 'Other Liabilities',
  
  // Equity subtypes
  'owners_equity': 'Owner\'s Equity',
  'retained_earnings': 'Retained Earnings',
  'distributions': 'Distributions',
  
  // Revenue subtypes
  'sales': 'Sales Revenue',
  'other_income': 'Other Income',
  'food_sales': 'Food Sales',
  'beverage_sales': 'Beverage Sales',
  'alcohol_sales': 'Alcohol Sales',
  'catering_income': 'Catering Income',
  
  // COGS subtypes
  'cost_of_goods_sold': 'Cost of Goods Sold',
  'food_cost': 'Food Costs',
  'beverage_cost': 'Beverage Costs',
  'packaging_cost': 'Packaging & Supplies',
  
  // Expense subtypes
  'operating_expenses': 'Operating Expenses',
  'payroll': 'Payroll',
  'labor': 'Labor & Payroll',
  'tax_expense': 'Taxes',
  'other_expenses': 'Other Expenses',
  'rent': 'Rent & Occupancy',
  'utilities': 'Utilities',
  'marketing': 'Marketing & Advertising',
  'insurance': 'Insurance',
  'repairs_maintenance': 'Repairs & Maintenance',
  'professional_fees': 'Professional Services',
  
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
  return category === EXPENSE_CATEGORIES.LABOR || category === 'Payroll';
}

/**
 * Checks if a category is a food cost or COGS category
 */
export function isFoodCostCategory(category: string): boolean {
  return category === EXPENSE_CATEGORIES.FOOD_COST || 
         category === EXPENSE_CATEGORIES.COGS ||
         category === 'Beverage Costs' ||
         category === 'Packaging & Supplies';
}

/**
 * Checks if a category represents uncategorized transactions
 */
export function isUncategorized(category: string): boolean {
  return category === EXPENSE_CATEGORIES.UNCATEGORIZED;
}
