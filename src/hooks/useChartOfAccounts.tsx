import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

export type AccountType = 'asset' | 'liability' | 'equity' | 'revenue' | 'expense' | 'cogs';

export interface ChartAccount {
  id: string;
  restaurant_id: string;
  account_code: string;
  account_name: string;
  account_type: AccountType;
  account_subtype: string;
  parent_account_id: string | null;
  description: string | null;
  is_active: boolean;
  is_system_account: boolean;
  current_balance: number;
  normal_balance: string;
  created_at: string;
  updated_at: string;
}

export const useChartOfAccounts = (restaurantId: string | null) => {
  const [accounts, setAccounts] = useState<ChartAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  const fetchAccounts = async () => {
    if (!restaurantId) {
      setAccounts([]);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('chart_of_accounts')
        .select('*')
        .eq('restaurant_id', restaurantId)
        .eq('is_active', true)
        .order('account_code');

      if (error) throw error;
      setAccounts(data || []);
    } catch (error) {
      console.error('Error fetching chart of accounts:', error);
      toast({
        title: "Failed to Load Accounts",
        description: error instanceof Error ? error.message : "An error occurred",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const createDefaultAccounts = async () => {
    if (!restaurantId) return;

    try {
      const defaultAccounts = [
        // Assets (1000-1999)
        { account_code: '1000', account_name: 'Cash', account_type: 'asset', account_subtype: 'cash', normal_balance: 'debit' },
        { account_code: '1010', account_name: 'Petty Cash', account_type: 'asset', account_subtype: 'cash', normal_balance: 'debit', parent_code: '1000' },
        { account_code: '1020', account_name: 'Checking Account', account_type: 'asset', account_subtype: 'cash', normal_balance: 'debit' },
        { account_code: '1030', account_name: 'Savings Account', account_type: 'asset', account_subtype: 'cash', normal_balance: 'debit' },
        { account_code: '1200', account_name: 'Accounts Receivable', account_type: 'asset', account_subtype: 'accounts_receivable', normal_balance: 'debit' },
        { account_code: '1201', account_name: 'Customer Deposits', account_type: 'asset', account_subtype: 'other_assets', normal_balance: 'debit' },
        { account_code: '1202', account_name: 'Deferred Discounts', account_type: 'asset', account_subtype: 'other_assets', normal_balance: 'debit' },
        { account_code: '1203', account_name: 'Deposits', account_type: 'asset', account_subtype: 'other_assets', normal_balance: 'debit' },
        { account_code: '1204', account_name: 'Prepaid Expenses', account_type: 'asset', account_subtype: 'prepaid_expenses', normal_balance: 'debit' },
        { account_code: '1210', account_name: 'Inventory - Food', account_type: 'asset', account_subtype: 'inventory', normal_balance: 'debit' },
        { account_code: '1211', account_name: 'Inventory - Beverages', account_type: 'asset', account_subtype: 'inventory', normal_balance: 'debit' },
        { account_code: '1212', account_name: 'Inventory - Packaging & Supplies', account_type: 'asset', account_subtype: 'inventory', normal_balance: 'debit' },
        { account_code: '1400', account_name: 'Other Current Assets', account_type: 'asset', account_subtype: 'other_assets', normal_balance: 'debit' },
        { account_code: '1500', account_name: 'Property, Plant, and Equipment', account_type: 'asset', account_subtype: 'fixed_assets', normal_balance: 'debit' },
        { account_code: '1501', account_name: 'Furniture', account_type: 'asset', account_subtype: 'fixed_assets', normal_balance: 'debit', parent_code: '1500' },
        { account_code: '1502', account_name: 'Furniture - Accumulated Depreciation', account_type: 'asset', account_subtype: 'accumulated_depreciation', normal_balance: 'credit', parent_code: '1500' },
        { account_code: '1503', account_name: 'Office Equipment', account_type: 'asset', account_subtype: 'fixed_assets', normal_balance: 'debit', parent_code: '1500' },
        { account_code: '1504', account_name: 'Office Equipment - Accumulated Depreciation', account_type: 'asset', account_subtype: 'accumulated_depreciation', normal_balance: 'credit', parent_code: '1500' },
        { account_code: '1510', account_name: 'Kitchen Equipment', account_type: 'asset', account_subtype: 'fixed_assets', normal_balance: 'debit' },
        { account_code: '1520', account_name: 'Leasehold Improvements', account_type: 'asset', account_subtype: 'fixed_assets', normal_balance: 'debit' },
        { account_code: '1530', account_name: 'Vehicles', account_type: 'asset', account_subtype: 'fixed_assets', normal_balance: 'debit' },
        { account_code: '1600', account_name: 'Security Deposits', account_type: 'asset', account_subtype: 'other_assets', normal_balance: 'debit' },
        
        // Liabilities (2000-2999)
        { account_code: '2000', account_name: 'Accounts Payable', account_type: 'liability', account_subtype: 'accounts_payable', normal_balance: 'credit' },
        { account_code: '2001', account_name: 'Accruals', account_type: 'liability', account_subtype: 'other_liabilities', normal_balance: 'credit' },
        { account_code: '2010', account_name: 'Accrued Payroll', account_type: 'liability', account_subtype: 'payroll_liabilities', normal_balance: 'credit', parent_code: '2001' },
        { account_code: '2011', account_name: 'Accrued Rent', account_type: 'liability', account_subtype: 'other_liabilities', normal_balance: 'credit', parent_code: '2001' },
        { account_code: '2003', account_name: 'Credit Cards', account_type: 'liability', account_subtype: 'credit_card', normal_balance: 'credit' },
        { account_code: '2004', account_name: 'Customer Credit', account_type: 'liability', account_subtype: 'other_liabilities', normal_balance: 'credit' },
        { account_code: '2005', account_name: 'Taxes Payable', account_type: 'liability', account_subtype: 'other_liabilities', normal_balance: 'credit' },
        { account_code: '2050', account_name: 'Income Tax Payable', account_type: 'liability', account_subtype: 'other_liabilities', normal_balance: 'credit', parent_code: '2005' },
        { account_code: '2051', account_name: 'Property Tax Payable', account_type: 'liability', account_subtype: 'other_liabilities', normal_balance: 'credit', parent_code: '2005' },
        { account_code: '2006', account_name: 'Unearned Revenue', account_type: 'liability', account_subtype: 'deferred_revenue', normal_balance: 'credit' },
        { account_code: '2100', account_name: 'Accrued Payroll Taxes', account_type: 'liability', account_subtype: 'payroll_liabilities', normal_balance: 'credit' },
        { account_code: '2200', account_name: 'Accrued Sales Tax Payable', account_type: 'liability', account_subtype: 'other_liabilities', normal_balance: 'credit' },
        { account_code: '2300', account_name: 'Deferred Revenue (Gift Cards)', account_type: 'liability', account_subtype: 'deferred_revenue', normal_balance: 'credit' },
        { account_code: '2400', account_name: 'Current Portion of Long-Term Debt', account_type: 'liability', account_subtype: 'loan', normal_balance: 'credit' },
        { account_code: '2500', account_name: 'Notes Payable', account_type: 'liability', account_subtype: 'loan', normal_balance: 'credit' },
        { account_code: '2600', account_name: 'Lease Liability', account_type: 'liability', account_subtype: 'other_liabilities', normal_balance: 'credit' },
        
        // Equity (3000-3999)
        { account_code: '3000', account_name: 'Common Stock', account_type: 'equity', account_subtype: 'owners_equity', normal_balance: 'credit' },
        { account_code: '3001', account_name: 'Opening Balance', account_type: 'equity', account_subtype: 'owners_equity', normal_balance: 'credit' },
        { account_code: '3010', account_name: 'Opening Balance Adjustments', account_type: 'equity', account_subtype: 'owners_equity', normal_balance: 'credit', parent_code: '3001' },
        { account_code: '3002', account_name: 'Owner\'s Equity', account_type: 'equity', account_subtype: 'owners_equity', normal_balance: 'credit' },
        { account_code: '3003', account_name: 'Retained Earnings', account_type: 'equity', account_subtype: 'retained_earnings', normal_balance: 'credit' },
        { account_code: '3030', account_name: 'Dividends', account_type: 'equity', account_subtype: 'distributions', normal_balance: 'debit', parent_code: '3003' },
        { account_code: '3200', account_name: 'Partner Distributions', account_type: 'equity', account_subtype: 'distributions', normal_balance: 'debit' },
        
        // Revenue (4000-4999)
        { account_code: '4000', account_name: 'Revenue', account_type: 'revenue', account_subtype: 'food_sales', normal_balance: 'credit' },
        { account_code: '4001', account_name: 'Billed Expenses', account_type: 'revenue', account_subtype: 'other_income', normal_balance: 'credit', parent_code: '4000' },
        { account_code: '4002', account_name: 'Discounts', account_type: 'revenue', account_subtype: 'other_income', normal_balance: 'debit', parent_code: '4000' },
        { account_code: '4003', account_name: 'Sales', account_type: 'revenue', account_subtype: 'food_sales', normal_balance: 'credit', parent_code: '4000' },
        { account_code: '4004', account_name: 'Sales Credit', account_type: 'revenue', account_subtype: 'other_income', normal_balance: 'debit', parent_code: '4000' },
        { account_code: '4005', account_name: 'Uncategorized Income', account_type: 'revenue', account_subtype: 'other_income', normal_balance: 'credit', parent_code: '4000', description: 'Default category for unclassified income from bank transactions' },
        { account_code: '4010', account_name: 'Beverage Sales (Non-Alcoholic)', account_type: 'revenue', account_subtype: 'beverage_sales', normal_balance: 'credit' },
        { account_code: '4020', account_name: 'Alcohol Sales', account_type: 'revenue', account_subtype: 'alcohol_sales', normal_balance: 'credit' },
        { account_code: '4030', account_name: 'Catering Income', account_type: 'revenue', account_subtype: 'catering_income', normal_balance: 'credit' },
        { account_code: '4040', account_name: 'Delivery & Takeout Revenue', account_type: 'revenue', account_subtype: 'food_sales', normal_balance: 'credit' },
        { account_code: '4050', account_name: 'Merchandise Sales', account_type: 'revenue', account_subtype: 'other_income', normal_balance: 'credit' },
        { account_code: '4300', account_name: 'Franchise Rebates', account_type: 'revenue', account_subtype: 'other_income', normal_balance: 'credit' },
        { account_code: '4400', account_name: 'Interest Income', account_type: 'revenue', account_subtype: 'other_income', normal_balance: 'credit' },
        
        // Cost of Goods Sold (5000-5999)
        { account_code: '5000', account_name: 'Cost of Goods Sold', account_type: 'cogs', account_subtype: 'food_cost', normal_balance: 'debit' },
        { account_code: '5001', account_name: 'Cost of Billed Expenses', account_type: 'cogs', account_subtype: 'food_cost', normal_balance: 'debit', parent_code: '5000' },
        { account_code: '5002', account_name: 'Cost of Shipping & Handling', account_type: 'cogs', account_subtype: 'food_cost', normal_balance: 'debit', parent_code: '5000' },
        { account_code: '5100', account_name: 'Food Cost', account_type: 'cogs', account_subtype: 'food_cost', normal_balance: 'debit' },
        { account_code: '5200', account_name: 'Beverage Cost', account_type: 'cogs', account_subtype: 'beverage_cost', normal_balance: 'debit' },
        { account_code: '5300', account_name: 'Packaging & Paper Goods', account_type: 'cogs', account_subtype: 'packaging_cost', normal_balance: 'debit' },
        { account_code: '5400', account_name: 'Kitchen Supplies', account_type: 'cogs', account_subtype: 'food_cost', normal_balance: 'debit' },
        
        // Labor Expenses (6000-6099)
        { account_code: '6000', account_name: 'Salaries - Management', account_type: 'expense', account_subtype: 'labor', normal_balance: 'debit' },
        { account_code: '6001', account_name: 'Advertising', account_type: 'expense', account_subtype: 'marketing', normal_balance: 'debit' },
        { account_code: '6002', account_name: 'Car & Truck Expenses', account_type: 'expense', account_subtype: 'other_expenses', normal_balance: 'debit' },
        { account_code: '6020', account_name: 'Gas', account_type: 'expense', account_subtype: 'other_expenses', normal_balance: 'debit', parent_code: '6002' },
        { account_code: '6021', account_name: 'Mileage', account_type: 'expense', account_subtype: 'other_expenses', normal_balance: 'debit', parent_code: '6002' },
        { account_code: '6022', account_name: 'Vehicle Repairs', account_type: 'expense', account_subtype: 'repairs_maintenance', normal_balance: 'debit', parent_code: '6002' },
        { account_code: '6023', account_name: 'Vehicle Insurance', account_type: 'expense', account_subtype: 'insurance', normal_balance: 'debit', parent_code: '6002' },
        { account_code: '6024', account_name: 'Vehicle Licensing', account_type: 'expense', account_subtype: 'other_expenses', normal_balance: 'debit', parent_code: '6002' },
        { account_code: '6003', account_name: 'Contractors', account_type: 'expense', account_subtype: 'other_expenses', normal_balance: 'debit' },
        { account_code: '6004', account_name: 'Education and Training', account_type: 'expense', account_subtype: 'other_expenses', normal_balance: 'debit' },
        { account_code: '6005', account_name: 'Employee Benefits', account_type: 'expense', account_subtype: 'labor', normal_balance: 'debit' },
        { account_code: '6050', account_name: 'Accident Insurance', account_type: 'expense', account_subtype: 'insurance', normal_balance: 'debit', parent_code: '6005' },
        { account_code: '6051', account_name: 'Health Insurance', account_type: 'expense', account_subtype: 'insurance', normal_balance: 'debit', parent_code: '6005' },
        { account_code: '6052', account_name: 'Life Insurance', account_type: 'expense', account_subtype: 'insurance', normal_balance: 'debit', parent_code: '6005' },
        { account_code: '6006', account_name: 'Meals & Entertainment', account_type: 'expense', account_subtype: 'other_expenses', normal_balance: 'debit' },
        { account_code: '6060', account_name: 'Entertainment', account_type: 'expense', account_subtype: 'other_expenses', normal_balance: 'debit', parent_code: '6006' },
        { account_code: '6061', account_name: 'Restaurants/Dining', account_type: 'expense', account_subtype: 'other_expenses', normal_balance: 'debit', parent_code: '6006' },
        { account_code: '6007', account_name: 'Office Expenses & Postage', account_type: 'expense', account_subtype: 'other_expenses', normal_balance: 'debit' },
        { account_code: '6070', account_name: 'Hardware', account_type: 'expense', account_subtype: 'other_expenses', normal_balance: 'debit', parent_code: '6007' },
        { account_code: '6071', account_name: 'Office Supplies', account_type: 'expense', account_subtype: 'other_expenses', normal_balance: 'debit', parent_code: '6007' },
        { account_code: '6072', account_name: 'Packaging', account_type: 'expense', account_subtype: 'other_expenses', normal_balance: 'debit', parent_code: '6007' },
        { account_code: '6073', account_name: 'Postage', account_type: 'expense', account_subtype: 'other_expenses', normal_balance: 'debit', parent_code: '6007' },
        { account_code: '6074', account_name: 'Printing', account_type: 'expense', account_subtype: 'other_expenses', normal_balance: 'debit', parent_code: '6007' },
        { account_code: '6075', account_name: 'Shipping & Couriers', account_type: 'expense', account_subtype: 'other_expenses', normal_balance: 'debit', parent_code: '6007' },
        { account_code: '6076', account_name: 'Software', account_type: 'expense', account_subtype: 'other_expenses', normal_balance: 'debit', parent_code: '6007' },
        { account_code: '6077', account_name: 'Stationery', account_type: 'expense', account_subtype: 'other_expenses', normal_balance: 'debit', parent_code: '6007' },
        { account_code: '6008', account_name: 'Other Expenses', account_type: 'expense', account_subtype: 'other_expenses', normal_balance: 'debit' },
        { account_code: '6080', account_name: 'Bank Fees', account_type: 'expense', account_subtype: 'other_expenses', normal_balance: 'debit', parent_code: '6008' },
        { account_code: '6081', account_name: 'Business Insurance', account_type: 'expense', account_subtype: 'insurance', normal_balance: 'debit', parent_code: '6008' },
        { account_code: '6082', account_name: 'Commissions', account_type: 'expense', account_subtype: 'other_expenses', normal_balance: 'debit', parent_code: '6008' },
        { account_code: '6083', account_name: 'Depreciation', account_type: 'expense', account_subtype: 'other_expenses', normal_balance: 'debit', parent_code: '6008' },
        { account_code: '6084', account_name: 'Interest - Mortgage', account_type: 'expense', account_subtype: 'other_expenses', normal_balance: 'debit', parent_code: '6008' },
        { account_code: '6085', account_name: 'Interest - Other', account_type: 'expense', account_subtype: 'other_expenses', normal_balance: 'debit', parent_code: '6008' },
        { account_code: '6086', account_name: 'Online Services', account_type: 'expense', account_subtype: 'other_expenses', normal_balance: 'debit', parent_code: '6008' },
        { account_code: '6087', account_name: 'Reference Materials', account_type: 'expense', account_subtype: 'other_expenses', normal_balance: 'debit', parent_code: '6008' },
        { account_code: '6088', account_name: 'Repairs & Maintenance', account_type: 'expense', account_subtype: 'repairs_maintenance', normal_balance: 'debit', parent_code: '6008' },
        { account_code: '6089', account_name: 'Subscriptions/Dues/Memberships', account_type: 'expense', account_subtype: 'other_expenses', normal_balance: 'debit', parent_code: '6008' },
        { account_code: '6090', account_name: 'Taxes & Licenses', account_type: 'expense', account_subtype: 'other_expenses', normal_balance: 'debit', parent_code: '6008' },
        { account_code: '6091', account_name: 'Wages', account_type: 'expense', account_subtype: 'labor', normal_balance: 'debit', parent_code: '6008' },
        { account_code: '6009', account_name: 'Personal', account_type: 'expense', account_subtype: 'other_expenses', normal_balance: 'debit' },
        { account_code: '6010', account_name: 'Professional Services', account_type: 'expense', account_subtype: 'professional_fees', normal_balance: 'debit' },
        { account_code: '6100', account_name: 'Accounting', account_type: 'expense', account_subtype: 'professional_fees', normal_balance: 'debit', parent_code: '6010' },
        { account_code: '6101', account_name: 'Legal Fees', account_type: 'expense', account_subtype: 'professional_fees', normal_balance: 'debit', parent_code: '6010' },
        { account_code: '6011', account_name: 'Rent or Lease', account_type: 'expense', account_subtype: 'rent', normal_balance: 'debit' },
        { account_code: '6110', account_name: 'Equipment Rental', account_type: 'expense', account_subtype: 'rent', normal_balance: 'debit', parent_code: '6011' },
        { account_code: '6111', account_name: 'Machinery Rental', account_type: 'expense', account_subtype: 'rent', normal_balance: 'debit', parent_code: '6011' },
        { account_code: '6112', account_name: 'Office Space Rental', account_type: 'expense', account_subtype: 'rent', normal_balance: 'debit', parent_code: '6011' },
        { account_code: '6113', account_name: 'Vehicle Rental', account_type: 'expense', account_subtype: 'rent', normal_balance: 'debit', parent_code: '6011' },
        { account_code: '6012', account_name: 'Supplies', account_type: 'expense', account_subtype: 'other_expenses', normal_balance: 'debit' },
        { account_code: '6013', account_name: 'Travel', account_type: 'expense', account_subtype: 'other_expenses', normal_balance: 'debit' },
        { account_code: '6130', account_name: 'Airfare', account_type: 'expense', account_subtype: 'other_expenses', normal_balance: 'debit', parent_code: '6013' },
        { account_code: '6131', account_name: 'Hotel/Lodging/Accommodation', account_type: 'expense', account_subtype: 'other_expenses', normal_balance: 'debit', parent_code: '6013' },
        { account_code: '6132', account_name: 'Taxi & Parking', account_type: 'expense', account_subtype: 'other_expenses', normal_balance: 'debit', parent_code: '6013' },
        { account_code: '6014', account_name: 'Uncategorized Expenses', account_type: 'expense', account_subtype: 'other_expenses', normal_balance: 'debit', description: 'Default category for unclassified expenses from bank transactions' },
        { account_code: '6015', account_name: 'Utilities', account_type: 'expense', account_subtype: 'utilities', normal_balance: 'debit' },
        { account_code: '6150', account_name: 'Gas & Electrical', account_type: 'expense', account_subtype: 'utilities', normal_balance: 'debit', parent_code: '6015' },
        { account_code: '6151', account_name: 'Phone', account_type: 'expense', account_subtype: 'utilities', normal_balance: 'debit', parent_code: '6015' },
        { account_code: '6016', account_name: 'Sales Taxes Paid', account_type: 'expense', account_subtype: 'other_expenses', normal_balance: 'debit' },
        { account_code: '6200', account_name: 'Wages - Front of House', account_type: 'expense', account_subtype: 'labor', normal_balance: 'debit' },
        { account_code: '6300', account_name: 'Wages - Back of House', account_type: 'expense', account_subtype: 'labor', normal_balance: 'debit' },
        { account_code: '6400', account_name: 'Payroll Taxes', account_type: 'expense', account_subtype: 'labor', normal_balance: 'debit' },
        
        // Additional Operating Expenses (7000-8999)
        { account_code: '7000', account_name: 'Rent', account_type: 'expense', account_subtype: 'rent', normal_balance: 'debit' },
        { account_code: '7010', account_name: 'Telephone & Internet', account_type: 'expense', account_subtype: 'utilities', normal_balance: 'debit' },
        { account_code: '7100', account_name: 'Equipment Repairs & Maintenance', account_type: 'expense', account_subtype: 'repairs_maintenance', normal_balance: 'debit' },
        { account_code: '7300', account_name: 'Cleaning & Sanitation', account_type: 'expense', account_subtype: 'other_expenses', normal_balance: 'debit' },
        { account_code: '7500', account_name: 'Licenses & Permits', account_type: 'expense', account_subtype: 'other_expenses', normal_balance: 'debit' },
        { account_code: '7600', account_name: 'Property Insurance', account_type: 'expense', account_subtype: 'insurance', normal_balance: 'debit' },
        { account_code: '7700', account_name: 'Marketing & Advertising', account_type: 'expense', account_subtype: 'marketing', normal_balance: 'debit' },
        { account_code: '7900', account_name: 'Software Subscriptions', account_type: 'expense', account_subtype: 'other_expenses', normal_balance: 'debit' },
        { account_code: '8000', account_name: 'Professional Fees', account_type: 'expense', account_subtype: 'professional_fees', normal_balance: 'debit' },
        { account_code: '8100', account_name: 'Bank Charges & Fees', account_type: 'expense', account_subtype: 'other_expenses', normal_balance: 'debit' },
        { account_code: '8300', account_name: 'Depreciation Expense', account_type: 'expense', account_subtype: 'other_expenses', normal_balance: 'debit' },
        
        // Other Expenses (9000-9999)
        { account_code: '9000', account_name: 'Interest Expense', account_type: 'expense', account_subtype: 'other_expenses', normal_balance: 'debit' },
        { account_code: '9100', account_name: 'Uncategorized Expense', account_type: 'expense', account_subtype: 'other_expenses', normal_balance: 'debit', description: 'Default category for unclassified expenses from bank transactions' },
        { account_code: '9200', account_name: 'Uncategorized Income', account_type: 'revenue', account_subtype: 'other_income', normal_balance: 'credit', description: 'Default category for unclassified income from bank transactions' },
      ] as const;

      // First pass: insert accounts without parent references
      const accountsWithoutParents = defaultAccounts.filter(acc => !('parent_code' in acc));
      const accountsWithParents = defaultAccounts.filter(acc => 'parent_code' in acc);

      // Create parent accounts first
      const parentAccountsToInsert = accountsWithoutParents.map(acc => ({
        account_code: acc.account_code,
        account_name: acc.account_name,
        account_type: acc.account_type,
        account_subtype: acc.account_subtype,
        normal_balance: acc.normal_balance,
        description: 'description' in acc ? acc.description : null,
        restaurant_id: restaurantId,
        is_system_account: true,
        parent_account_id: null,
      })) as any;

      const { error: parentError } = await supabase
        .from('chart_of_accounts')
        .insert(parentAccountsToInsert);

      if (parentError) throw parentError;

      // Fetch created parent accounts to get their IDs
      const { data: createdParents, error: fetchError } = await supabase
        .from('chart_of_accounts')
        .select('id, account_code')
        .eq('restaurant_id', restaurantId);

      if (fetchError) throw fetchError;

      // Create a map of account_code to id
      const parentMap = new Map(createdParents?.map(p => [p.account_code, p.id]));

      // Second pass: insert child accounts with parent references
      const childAccountsToInsert = accountsWithParents.map(acc => ({
        account_code: acc.account_code,
        account_name: acc.account_name,
        account_type: acc.account_type,
        account_subtype: acc.account_subtype,
        normal_balance: acc.normal_balance,
        description: 'description' in acc ? acc.description : null,
        restaurant_id: restaurantId,
        is_system_account: true,
        parent_account_id: 'parent_code' in acc ? parentMap.get(acc.parent_code as string) : null,
      })) as any;

      const { error: childError } = await supabase
        .from('chart_of_accounts')
        .insert(childAccountsToInsert);

      if (childError) throw childError;

      toast({
        title: "Default Accounts Created",
        description: "Your chart of accounts has been set up with standard restaurant categories",
      });

      await fetchAccounts();
    } catch (error) {
      console.error('Error creating default accounts:', error);
      toast({
        title: "Failed to Create Default Accounts",
        description: error instanceof Error ? error.message : "An error occurred",
        variant: "destructive",
      });
    }
  };

  useEffect(() => {
    fetchAccounts();
  }, [restaurantId]);

  return {
    accounts,
    loading,
    fetchAccounts,
    createDefaultAccounts,
  };
};
