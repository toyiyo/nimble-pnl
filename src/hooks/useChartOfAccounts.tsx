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
        { account_code: '1000', account_name: 'Cash & Cash Equivalents', account_type: 'asset', account_subtype: 'cash', normal_balance: 'debit' },
        { account_code: '1010', account_name: 'Petty Cash', account_type: 'asset', account_subtype: 'cash', normal_balance: 'debit' },
        { account_code: '1020', account_name: 'Checking Account', account_type: 'asset', account_subtype: 'cash', normal_balance: 'debit' },
        { account_code: '1030', account_name: 'Savings Account', account_type: 'asset', account_subtype: 'cash', normal_balance: 'debit' },
        { account_code: '1100', account_name: 'Accounts Receivable', account_type: 'asset', account_subtype: 'accounts_receivable', normal_balance: 'debit' },
        { account_code: '1200', account_name: 'Inventory - Food', account_type: 'asset', account_subtype: 'inventory', normal_balance: 'debit' },
        { account_code: '1210', account_name: 'Inventory - Beverages', account_type: 'asset', account_subtype: 'inventory', normal_balance: 'debit' },
        { account_code: '1220', account_name: 'Inventory - Packaging & Supplies', account_type: 'asset', account_subtype: 'inventory', normal_balance: 'debit' },
        { account_code: '1300', account_name: 'Prepaid Expenses', account_type: 'asset', account_subtype: 'prepaid_expenses', normal_balance: 'debit' },
        { account_code: '1400', account_name: 'Other Current Assets', account_type: 'asset', account_subtype: 'other_assets', normal_balance: 'debit' },
        { account_code: '1500', account_name: 'Kitchen Equipment', account_type: 'asset', account_subtype: 'fixed_assets', normal_balance: 'debit' },
        { account_code: '1510', account_name: 'Furniture & Fixtures', account_type: 'asset', account_subtype: 'fixed_assets', normal_balance: 'debit' },
        { account_code: '1520', account_name: 'Leasehold Improvements', account_type: 'asset', account_subtype: 'fixed_assets', normal_balance: 'debit' },
        { account_code: '1530', account_name: 'Vehicles', account_type: 'asset', account_subtype: 'fixed_assets', normal_balance: 'debit' },
        { account_code: '1540', account_name: 'Accumulated Depreciation', account_type: 'asset', account_subtype: 'accumulated_depreciation', normal_balance: 'credit' },
        { account_code: '1600', account_name: 'Security Deposits', account_type: 'asset', account_subtype: 'other_assets', normal_balance: 'debit' },
        
        // Liabilities (2000-2999)
        { account_code: '2000', account_name: 'Accounts Payable', account_type: 'liability', account_subtype: 'accounts_payable', normal_balance: 'credit' },
        { account_code: '2100', account_name: 'Credit Card Payable', account_type: 'liability', account_subtype: 'credit_card', normal_balance: 'credit' },
        { account_code: '2200', account_name: 'Accrued Payroll', account_type: 'liability', account_subtype: 'payroll_liabilities', normal_balance: 'credit' },
        { account_code: '2210', account_name: 'Accrued Payroll Taxes', account_type: 'liability', account_subtype: 'payroll_liabilities', normal_balance: 'credit' },
        { account_code: '2220', account_name: 'Accrued Sales Tax Payable', account_type: 'liability', account_subtype: 'other_liabilities', normal_balance: 'credit' },
        { account_code: '2300', account_name: 'Deferred Revenue (Gift Cards)', account_type: 'liability', account_subtype: 'deferred_revenue', normal_balance: 'credit' },
        { account_code: '2400', account_name: 'Current Portion of Long-Term Debt', account_type: 'liability', account_subtype: 'loan', normal_balance: 'credit' },
        { account_code: '2500', account_name: 'Notes Payable', account_type: 'liability', account_subtype: 'loan', normal_balance: 'credit' },
        { account_code: '2600', account_name: 'Lease Liability', account_type: 'liability', account_subtype: 'other_liabilities', normal_balance: 'credit' },
        
        // Equity (3000-3999)
        { account_code: '3000', account_name: 'Owner\'s Equity', account_type: 'equity', account_subtype: 'owners_equity', normal_balance: 'credit' },
        { account_code: '3100', account_name: 'Retained Earnings', account_type: 'equity', account_subtype: 'retained_earnings', normal_balance: 'credit' },
        { account_code: '3200', account_name: 'Partner Distributions', account_type: 'equity', account_subtype: 'distributions', normal_balance: 'debit' },
        
        // Revenue (4000-4999)
        { account_code: '4000', account_name: 'Food Sales', account_type: 'revenue', account_subtype: 'food_sales', normal_balance: 'credit' },
        { account_code: '4010', account_name: 'Beverage Sales (Non-Alcoholic)', account_type: 'revenue', account_subtype: 'beverage_sales', normal_balance: 'credit' },
        { account_code: '4020', account_name: 'Alcohol Sales', account_type: 'revenue', account_subtype: 'alcohol_sales', normal_balance: 'credit' },
        { account_code: '4030', account_name: 'Catering Income', account_type: 'revenue', account_subtype: 'catering_income', normal_balance: 'credit' },
        { account_code: '4040', account_name: 'Delivery & Takeout Revenue', account_type: 'revenue', account_subtype: 'food_sales', normal_balance: 'credit' },
        { account_code: '4050', account_name: 'Merchandise Sales', account_type: 'revenue', account_subtype: 'other_income', normal_balance: 'credit' },
        { account_code: '4300', account_name: 'Franchise Rebates', account_type: 'revenue', account_subtype: 'other_income', normal_balance: 'credit' },
        { account_code: '4400', account_name: 'Interest Income', account_type: 'revenue', account_subtype: 'other_income', normal_balance: 'credit' },
        
        // Cost of Goods Sold (5000-5999)
        { account_code: '5000', account_name: 'Food Cost', account_type: 'cogs', account_subtype: 'food_cost', normal_balance: 'debit' },
        { account_code: '5100', account_name: 'Beverage Cost', account_type: 'cogs', account_subtype: 'beverage_cost', normal_balance: 'debit' },
        { account_code: '5200', account_name: 'Packaging & Paper Goods', account_type: 'cogs', account_subtype: 'packaging_cost', normal_balance: 'debit' },
        { account_code: '5300', account_name: 'Kitchen Supplies', account_type: 'cogs', account_subtype: 'food_cost', normal_balance: 'debit' },
        
        // Labor Expenses (6000-6999)
        { account_code: '6000', account_name: 'Salaries - Management', account_type: 'expense', account_subtype: 'labor', normal_balance: 'debit' },
        { account_code: '6100', account_name: 'Wages - Front of House', account_type: 'expense', account_subtype: 'labor', normal_balance: 'debit' },
        { account_code: '6200', account_name: 'Wages - Back of House', account_type: 'expense', account_subtype: 'labor', normal_balance: 'debit' },
        { account_code: '6300', account_name: 'Payroll Taxes', account_type: 'expense', account_subtype: 'labor', normal_balance: 'debit' },
        { account_code: '6400', account_name: 'Employee Benefits', account_type: 'expense', account_subtype: 'labor', normal_balance: 'debit' },
        
        // Operating Expenses (7000-7999)
        { account_code: '7000', account_name: 'Rent', account_type: 'expense', account_subtype: 'rent', normal_balance: 'debit' },
        { account_code: '7010', account_name: 'Utilities', account_type: 'expense', account_subtype: 'utilities', normal_balance: 'debit' },
        { account_code: '7020', account_name: 'Telephone & Internet', account_type: 'expense', account_subtype: 'utilities', normal_balance: 'debit' },
        { account_code: '7100', account_name: 'Repairs & Maintenance', account_type: 'expense', account_subtype: 'repairs_maintenance', normal_balance: 'debit' },
        { account_code: '7300', account_name: 'Cleaning & Sanitation', account_type: 'expense', account_subtype: 'other_expenses', normal_balance: 'debit' },
        { account_code: '7500', account_name: 'Licenses & Permits', account_type: 'expense', account_subtype: 'other_expenses', normal_balance: 'debit' },
        { account_code: '7600', account_name: 'Insurance', account_type: 'expense', account_subtype: 'insurance', normal_balance: 'debit' },
        { account_code: '7700', account_name: 'Marketing & Advertising', account_type: 'expense', account_subtype: 'marketing', normal_balance: 'debit' },
        { account_code: '7900', account_name: 'Software Subscriptions', account_type: 'expense', account_subtype: 'other_expenses', normal_balance: 'debit' },
        
        // General & Administrative (8000-8999)
        { account_code: '8000', account_name: 'Professional Fees', account_type: 'expense', account_subtype: 'professional_fees', normal_balance: 'debit' },
        { account_code: '8100', account_name: 'Bank Charges & Fees', account_type: 'expense', account_subtype: 'other_expenses', normal_balance: 'debit' },
        { account_code: '8300', account_name: 'Depreciation Expense', account_type: 'expense', account_subtype: 'other_expenses', normal_balance: 'debit' },
        
        // Other Income & Expenses (9000-9999)
        { account_code: '9000', account_name: 'Interest Expense', account_type: 'expense', account_subtype: 'other_expenses', normal_balance: 'debit' },
        { account_code: '9100', account_name: 'Uncategorized Expense', account_type: 'expense', account_subtype: 'other_expenses', normal_balance: 'debit', description: 'Default category for unclassified expenses from bank transactions' },
        { account_code: '9200', account_name: 'Uncategorized Income', account_type: 'revenue', account_subtype: 'other_income', normal_balance: 'credit', description: 'Default category for unclassified income from bank transactions' },
      ] as const;

      const accountsToInsert = defaultAccounts.map(acc => ({
        ...acc,
        restaurant_id: restaurantId,
        is_system_account: true,
      })) as any;

      const { error } = await supabase
        .from('chart_of_accounts')
        .insert(accountsToInsert);

      if (error) throw error;

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
