// Tax rate types for restaurant tax configuration and calculation

export interface TaxRate {
  id: string;
  restaurant_id: string;
  name: string;
  rate: number; // Percentage (0-100)
  description?: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface TaxRateCategory {
  id: string;
  tax_rate_id: string;
  category_id: string;
  created_at: string;
}

export interface TaxRateWithCategories extends TaxRate {
  categories: Array<{
    id: string;
    account_code: string;
    account_name: string;
    account_type: string;
    account_subtype: string;
  }>;
}

export interface TaxCalculationResult {
  tax_rate_id: string;
  tax_rate_name: string;
  tax_rate: number;
  total_taxable_amount: number;
  calculated_tax: number;
  transaction_count: number;
}

export interface CreateTaxRateInput {
  restaurant_id: string;
  name: string;
  rate: number;
  description?: string;
  category_ids?: string[];
}

export interface UpdateTaxRateInput {
  name?: string;
  rate?: number;
  description?: string;
  is_active?: boolean;
  category_ids?: string[];
}
