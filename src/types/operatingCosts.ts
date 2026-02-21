// Types for restaurant operating costs and break-even analysis

export type CostType = 'fixed' | 'semi_variable' | 'variable' | 'custom';
export type EntryType = 'value' | 'percentage';

export interface OperatingCost {
  id: string;
  restaurantId: string;
  costType: CostType;
  category: string;
  name: string;
  entryType: EntryType;
  monthlyValue: number; // in cents
  percentageValue: number; // decimal (0.05 = 5%)
  isAutoCalculated: boolean;
  manualOverride: boolean;
  averagingMonths: number;
  displayOrder: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface OperatingCostInput {
  costType: CostType;
  category: string;
  name: string;
  entryType: EntryType;
  monthlyValue?: number;
  percentageValue?: number;
  isAutoCalculated?: boolean;
  manualOverride?: boolean;
  averagingMonths?: number;
  displayOrder?: number;
}

export interface CostBreakdownItem {
  id: string;
  name: string;
  category: string;
  daily: number;
  monthly: number;
  percentage?: number;
  isPercentage: boolean;
  source: 'manual' | 'calculated';
}

export interface BreakEvenData {
  // Core daily number
  dailyBreakEven: number;
  
  // Today's comparison
  todaySales: number;
  todayStatus: 'above' | 'at' | 'below';
  todayDelta: number;
  
  // Cost breakdown by type
  fixedCosts: {
    items: CostBreakdownItem[];
    totalDaily: number;
  };
  semiVariableCosts: {
    items: CostBreakdownItem[];
    totalDaily: number;
    monthsAveraged: number;
  };
  variableCosts: {
    items: CostBreakdownItem[];
    totalDaily: number;
    avgDailySales: number;
  };
  customCosts: {
    items: CostBreakdownItem[];
    totalDaily: number;
  };
  
  // Historical comparison (configurable days)
  history: {
    date: string;
    sales: number;
    breakEven: number;
    delta: number;
    status: 'above' | 'at' | 'below';
  }[];
  
  // Summary stats
  daysAbove: number;
  daysBelow: number;
  avgSurplus: number;
  avgShortfall: number;
}

// Default cost items to seed for new restaurants
export const DEFAULT_OPERATING_COSTS: OperatingCostInput[] = [
  // Fixed costs
  { costType: 'fixed', category: 'rent', name: 'Rent / Lease', entryType: 'value', monthlyValue: 0, displayOrder: 1 },
  { costType: 'fixed', category: 'insurance', name: 'Property Insurance', entryType: 'value', monthlyValue: 0, displayOrder: 2 },
  { costType: 'fixed', category: 'pos_software', name: 'POS / Software', entryType: 'value', monthlyValue: 0, displayOrder: 3 },
  { costType: 'fixed', category: 'internet', name: 'Phone & Internet', entryType: 'value', monthlyValue: 0, displayOrder: 4 },
  
  // Semi-variable (utilities - auto-calculated from bank transactions)
  { costType: 'semi_variable', category: 'electricity', name: 'Electricity', entryType: 'value', monthlyValue: 0, isAutoCalculated: true, displayOrder: 1 },
  { costType: 'semi_variable', category: 'water', name: 'Water & Sewer', entryType: 'value', monthlyValue: 0, isAutoCalculated: true, displayOrder: 2 },
  { costType: 'semi_variable', category: 'gas', name: 'Gas', entryType: 'value', monthlyValue: 0, isAutoCalculated: true, displayOrder: 3 },
  
  // Variable costs (percentage-based)
  { costType: 'variable', category: 'food_cost', name: 'Food Cost Target', entryType: 'percentage', percentageValue: 0.28, displayOrder: 1 },
  { costType: 'variable', category: 'labor', name: 'Labor Target', entryType: 'percentage', percentageValue: 0.32, displayOrder: 2 },
  { costType: 'variable', category: 'processing_fees', name: 'Payment Processing', entryType: 'percentage', percentageValue: 0.025, displayOrder: 3 },
];

// Expense suggestion from bank transaction / payroll analysis
export interface ExpenseSuggestion {
  id: string;              // deterministic key: "{normalized_payee}:{account_subtype}"
  payeeName: string;       // "ABC Landlord LLC"
  suggestedName: string;   // "Rent / Lease" (mapped from category)
  costType: CostType;      // which cost block it belongs in
  monthlyAmount: number;   // average monthly amount in cents
  confidence: number;      // 0-1 based on months matched + variance
  source: 'bank' | 'payroll';
  matchedMonths: number;   // how many months the pattern was detected
}

export type SuggestionAction = 'dismissed' | 'snoozed' | 'accepted';
