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
        { account_code: '1000', account_name: 'Cash & Bank Accounts', account_type: 'asset', account_subtype: 'cash', normal_balance: 'debit' },
        { account_code: '1100', account_name: 'Accounts Receivable', account_type: 'asset', account_subtype: 'accounts_receivable', normal_balance: 'debit' },
        { account_code: '1200', account_name: 'Inventory - Food', account_type: 'asset', account_subtype: 'inventory', normal_balance: 'debit' },
        { account_code: '1210', account_name: 'Inventory - Beverages', account_type: 'asset', account_subtype: 'inventory', normal_balance: 'debit' },
        { account_code: '1500', account_name: 'Equipment & Fixtures', account_type: 'asset', account_subtype: 'fixed_assets', normal_balance: 'debit' },
        
        // Liabilities (2000-2999)
        { account_code: '2000', account_name: 'Accounts Payable', account_type: 'liability', account_subtype: 'accounts_payable', normal_balance: 'credit' },
        { account_code: '2100', account_name: 'Credit Cards', account_type: 'liability', account_subtype: 'credit_card', normal_balance: 'credit' },
        { account_code: '2200', account_name: 'Loans Payable', account_type: 'liability', account_subtype: 'loan', normal_balance: 'credit' },
        
        // Equity (3000-3999)
        { account_code: '3000', account_name: 'Owner\'s Equity', account_type: 'equity', account_subtype: 'owners_equity', normal_balance: 'credit' },
        
        // Revenue (4000-4999)
        { account_code: '4000', account_name: 'Food Sales', account_type: 'revenue', account_subtype: 'food_sales', normal_balance: 'credit' },
        { account_code: '4100', account_name: 'Beverage Sales', account_type: 'revenue', account_subtype: 'beverage_sales', normal_balance: 'credit' },
        
        // Cost of Goods Sold (5000-5999)
        { account_code: '5000', account_name: 'Food Purchases', account_type: 'cogs', account_subtype: 'food_purchases', normal_balance: 'debit' },
        { account_code: '5100', account_name: 'Beverage Purchases', account_type: 'cogs', account_subtype: 'beverage_purchases', normal_balance: 'debit' },
        
        // Operating Expenses (6000-6999)
        { account_code: '6000', account_name: 'Labor - Wages & Salaries', account_type: 'expense', account_subtype: 'labor', normal_balance: 'debit' },
        { account_code: '6100', account_name: 'Rent', account_type: 'expense', account_subtype: 'rent', normal_balance: 'debit' },
        { account_code: '6200', account_name: 'Utilities', account_type: 'expense', account_subtype: 'utilities', normal_balance: 'debit' },
        { account_code: '6300', account_name: 'Marketing & Advertising', account_type: 'expense', account_subtype: 'marketing', normal_balance: 'debit' },
        { account_code: '6400', account_name: 'Insurance', account_type: 'expense', account_subtype: 'other', normal_balance: 'debit' },
        { account_code: '6500', account_name: 'Repairs & Maintenance', account_type: 'expense', account_subtype: 'other', normal_balance: 'debit' },
        { account_code: '6600', account_name: 'Supplies - Disposables', account_type: 'expense', account_subtype: 'other', normal_balance: 'debit' },
        { account_code: '6700', account_name: 'Professional Services', account_type: 'expense', account_subtype: 'other', normal_balance: 'debit' },
        { account_code: '6800', account_name: 'Other Operating Expenses', account_type: 'expense', account_subtype: 'other', normal_balance: 'debit' },
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
