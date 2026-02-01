// Types for Assets & Equipment Management

export type AssetStatus = 'active' | 'disposed' | 'fully_depreciated';

export interface Asset {
  id: string;
  restaurant_id: string;

  // Basic Information
  name: string;
  description: string | null;
  category: string;
  serial_number: string | null;

  // Financial Details
  purchase_date: string; // DATE as ISO string
  quantity: number; // Number of identical units (default 1)
  unit_cost: number; // Cost per unit
  purchase_cost: number; // Total cost (unit_cost * quantity) - synced by DB trigger
  salvage_value: number;
  useful_life_months: number;

  // Location
  location_id: string | null;

  // Chart of Accounts Integration
  asset_account_id: string | null;
  accumulated_depreciation_account_id: string | null;
  depreciation_expense_account_id: string | null;

  // Depreciation Tracking
  accumulated_depreciation: number;
  last_depreciation_date: string | null;

  // Status
  status: AssetStatus;
  disposal_date: string | null;
  disposal_proceeds: number | null;
  disposal_notes: string | null;

  // Metadata
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface AssetPhoto {
  id: string;
  asset_id: string;
  restaurant_id: string;

  // File info
  storage_path: string;
  file_name: string;
  file_size: number | null;
  mime_type: string | null;

  // Metadata
  caption: string | null;
  is_primary: boolean;

  created_at: string;
}

export interface AssetDepreciationSchedule {
  id: string;
  asset_id: string;
  restaurant_id: string;

  // Period Information
  period_start_date: string;
  period_end_date: string;

  // Depreciation Amounts
  depreciation_amount: number;
  accumulated_after: number;
  net_book_value: number;

  // Journal Entry Reference
  journal_entry_id: string | null;

  // Metadata
  posted_by: string | null;
  posted_at: string;
}

// Form data types for creating/updating assets
export interface AssetFormData {
  name: string;
  description?: string;
  category: string;
  serial_number?: string;
  purchase_date: string;
  quantity: number; // Number of identical units (default 1)
  unit_cost: number; // Cost per unit
  salvage_value: number;
  useful_life_months: number;
  location_id?: string;
  asset_account_id?: string;
  accumulated_depreciation_account_id?: string;
  depreciation_expense_account_id?: string;
  notes?: string;
}

export interface AssetDisposalData {
  disposal_date: string;
  disposal_proceeds?: number;
  disposal_notes?: string;
}

// Depreciation calculation result (from SQL function)
export interface DepreciationCalculation {
  monthly_depreciation: number;
  months_in_period: number;
  depreciation_amount: number;
  new_accumulated: number;
  net_book_value: number;
  is_fully_depreciated: boolean;
}

// Asset with computed fields for display
export interface AssetWithDetails extends Asset {
  // Computed fields
  net_book_value: number;
  monthly_depreciation: number;
  remaining_useful_life_months: number;
  depreciation_percentage: number;

  // Related data
  location_name?: string;
  primary_photo_url?: string;
  photo_count?: number;
}

// Helper to format quantity display (e.g., "2 × $20,000")
export function formatQuantityWithCost(quantity: number, unitCost: number): string {
  if (quantity === 1) {
    return formatAssetCurrency(unitCost);
  }
  return `${quantity} × ${formatAssetCurrency(unitCost)}`;
}

// Default categories with useful lives
export interface AssetCategory {
  name: string;
  default_useful_life_months: number;
}

export const DEFAULT_ASSET_CATEGORIES: AssetCategory[] = [
  { name: 'Kitchen Equipment', default_useful_life_months: 84 }, // 7 years
  { name: 'Furniture & Fixtures', default_useful_life_months: 84 }, // 7 years
  { name: 'Electronics', default_useful_life_months: 60 }, // 5 years
  { name: 'Vehicles', default_useful_life_months: 60 }, // 5 years
  { name: 'Leasehold Improvements', default_useful_life_months: 120 }, // 10 years or lease term
  { name: 'Office Equipment', default_useful_life_months: 60 }, // 5 years
  { name: 'Signage', default_useful_life_months: 84 }, // 7 years
  { name: 'HVAC Systems', default_useful_life_months: 180 }, // 15 years
  { name: 'Security Systems', default_useful_life_months: 60 }, // 5 years
  { name: 'POS Hardware', default_useful_life_months: 36 }, // 3 years
  { name: 'Other', default_useful_life_months: 60 }, // 5 years default
];

// Helper to get default useful life for a category
export function getDefaultUsefulLife(category: string): number {
  const found = DEFAULT_ASSET_CATEGORIES.find(
    (c) => c.name.toLowerCase() === category.toLowerCase()
  );
  return found?.default_useful_life_months ?? 60;
}

// Helper to calculate net book value
export function calculateNetBookValue(asset: Asset): number {
  return asset.purchase_cost - asset.accumulated_depreciation;
}

// Helper to calculate monthly depreciation (straight-line)
export function calculateMonthlyDepreciation(asset: Asset): number {
  const depreciableAmount = asset.purchase_cost - asset.salvage_value;
  return depreciableAmount / asset.useful_life_months;
}

// Helper to format currency for display
export function formatAssetCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(amount);
}
