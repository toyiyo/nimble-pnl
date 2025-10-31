import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
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

// Optimized hook using React Query with caching
export const useChartOfAccounts = (restaurantId: string | null) => {
  const { toast } = useToast();

  const { data: accounts = [], isLoading: loading } = useQuery({
    queryKey: ['chart-of-accounts', restaurantId],
    queryFn: async () => {
      if (!restaurantId) return [];

      const { data, error } = await supabase
        .from('chart_of_accounts')
        .select('*')
        .eq('restaurant_id', restaurantId)
        .eq('is_active', true)
        .order('account_code');

      if (error) {
        console.error('Error fetching chart of accounts:', error);
        toast({
          title: "Failed to Load Accounts",
          description: error instanceof Error ? error.message : "An error occurred",
          variant: "destructive",
        });
        throw error;
      }

      return data || [];
    },
    enabled: !!restaurantId,
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes
    gcTime: 10 * 60 * 1000, // Keep in cache for 10 minutes
  });

  const fetchAccounts = async () => {
    // This is now handled by React Query automatically
    // Keeping for backward compatibility
  };

  const queryClient = useQueryClient();

  const createDefaultAccounts = async () => {
    if (!restaurantId) return;

    try {
      // Verify user has permission first
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        throw new Error('User not authenticated');
      }

      // Check user_restaurants relationship
      const { data: userRestaurant, error: relationshipError } = await supabase
        .from('user_restaurants')
        .select('role')
        .eq('user_id', user.id)
        .eq('restaurant_id', restaurantId)
        .single();

      if (relationshipError || !userRestaurant) {
        console.error('User restaurant relationship check failed:', relationshipError);
        throw new Error('You do not have permission to manage this restaurant. Please ensure you are the owner or manager.');
      }

      if (!['owner', 'manager'].includes(userRestaurant.role)) {
        throw new Error(`Insufficient permissions. Your role (${userRestaurant.role}) cannot create accounts.`);
      }

      console.log('User permissions verified:', { userId: user.id, restaurantId, role: userRestaurant.role });

      const defaultAccounts = [
        // ASSETS (1000-1999)
        { account_code: '1000', account_name: 'Cash & Cash Equivalents', account_type: 'asset', account_subtype: 'cash', normal_balance: 'debit', description: 'Total liquid funds available' },
        { account_code: '1010', account_name: 'Petty Cash', account_type: 'asset', account_subtype: 'cash', normal_balance: 'debit', description: 'On-site small cash drawer' },
        { account_code: '1020', account_name: 'Checking Account', account_type: 'asset', account_subtype: 'cash', normal_balance: 'debit', description: 'Operating checking account' },
        { account_code: '1030', account_name: 'Savings Account', account_type: 'asset', account_subtype: 'cash', normal_balance: 'debit', description: 'Business savings' },
        { account_code: '1040', account_name: 'Undeposited Funds', account_type: 'asset', account_subtype: 'cash', normal_balance: 'debit', description: 'Deposits not yet banked' },
        { account_code: '1050', account_name: 'Transfer Clearing Account', account_type: 'asset', account_subtype: 'cash', normal_balance: 'debit', description: 'Temporary holding for internal transfers' },
        { account_code: '1200', account_name: 'Accounts Receivable', account_type: 'asset', account_subtype: 'accounts_receivable', normal_balance: 'debit', description: 'Customer balances owed' },
        { account_code: '1202', account_name: 'Prepaid Expenses', account_type: 'asset', account_subtype: 'prepaid_expenses', normal_balance: 'debit', description: 'Paid expenses not yet incurred' },
        { account_code: '1203', account_name: 'Inventory – Food', account_type: 'asset', account_subtype: 'inventory', normal_balance: 'debit', description: 'Inventory for food items' },
        { account_code: '1204', account_name: 'Inventory – Beverages', account_type: 'asset', account_subtype: 'inventory', normal_balance: 'debit', description: 'Inventory for beverages' },
        { account_code: '1205', account_name: 'Inventory – Packaging & Supplies', account_type: 'asset', account_subtype: 'inventory', normal_balance: 'debit', description: 'Takeout packaging, napkins, utensils' },
        { account_code: '1300', account_name: 'Other Current Assets', account_type: 'asset', account_subtype: 'other_assets', normal_balance: 'debit', description: 'Misc short-term assets' },
        { account_code: '1500', account_name: 'Property, Plant & Equipment', account_type: 'asset', account_subtype: 'fixed_assets', normal_balance: 'debit', description: 'Tangible long-term assets' },
        { account_code: '1510', account_name: 'Furniture & Fixtures', account_type: 'asset', account_subtype: 'fixed_assets', normal_balance: 'debit', description: 'Tables, chairs, counters' },
        { account_code: '1511', account_name: 'Accumulated Depreciation – Furniture', account_type: 'asset', account_subtype: 'accumulated_depreciation', normal_balance: 'credit', description: 'Offsets furniture book value', parent_code: '1510' },
        { account_code: '1520', account_name: 'Office Equipment', account_type: 'asset', account_subtype: 'fixed_assets', normal_balance: 'debit', description: 'Computers, printers' },
        { account_code: '1521', account_name: 'Accumulated Depreciation – Office Equipment', account_type: 'asset', account_subtype: 'accumulated_depreciation', normal_balance: 'credit', description: 'Depreciation offset', parent_code: '1520' },
        { account_code: '1530', account_name: 'Kitchen Equipment', account_type: 'asset', account_subtype: 'fixed_assets', normal_balance: 'debit', description: 'Ovens, mixers, fryers' },
        { account_code: '1531', account_name: 'Accumulated Depreciation – Kitchen Equipment', account_type: 'asset', account_subtype: 'accumulated_depreciation', normal_balance: 'credit', description: 'Depreciation offset', parent_code: '1530' },
        { account_code: '1540', account_name: 'Leasehold Improvements', account_type: 'asset', account_subtype: 'fixed_assets', normal_balance: 'debit', description: 'Build-out improvements' },
        { account_code: '1541', account_name: 'Accumulated Depreciation – Leasehold Improvements', account_type: 'asset', account_subtype: 'accumulated_depreciation', normal_balance: 'credit', description: 'Depreciation offset', parent_code: '1540' },
        { account_code: '1550', account_name: 'Vehicles', account_type: 'asset', account_subtype: 'fixed_assets', normal_balance: 'debit', description: 'Delivery or company vehicles' },
        { account_code: '1551', account_name: 'Accumulated Depreciation – Vehicles', account_type: 'asset', account_subtype: 'accumulated_depreciation', normal_balance: 'credit', description: 'Depreciation offset', parent_code: '1550' },
        { account_code: '1600', account_name: 'Security Deposits', account_type: 'asset', account_subtype: 'other_assets', normal_balance: 'debit', description: 'Rent and utility deposits' },
        { account_code: '1700', account_name: 'Intangible Assets', account_type: 'asset', account_subtype: 'other_assets', normal_balance: 'debit', description: 'Franchise fees, permits' },
        { account_code: '1701', account_name: 'Accumulated Amortization – Intangibles', account_type: 'asset', account_subtype: 'accumulated_depreciation', normal_balance: 'credit', description: 'Amortization offset', parent_code: '1700' },
        
        // LIABILITIES (2000-2999)
        { account_code: '2000', account_name: 'Accounts Payable', account_type: 'liability', account_subtype: 'accounts_payable', normal_balance: 'credit', description: 'Vendor bills outstanding' },
        { account_code: '2001', account_name: 'Accrued Expenses', account_type: 'liability', account_subtype: 'other_liabilities', normal_balance: 'credit', description: 'Unpaid operating costs' },
        { account_code: '2002', account_name: 'Credit Card Payables', account_type: 'liability', account_subtype: 'credit_card', normal_balance: 'credit', description: 'Credit card balances' },
        { account_code: '2003', account_name: 'Customer Credit / Gift Card Liability', account_type: 'liability', account_subtype: 'deferred_revenue', normal_balance: 'credit', description: 'Gift card & store credit balance' },
        { account_code: '2004', account_name: 'Sales Tax Payable', account_type: 'liability', account_subtype: 'other_liabilities', normal_balance: 'credit', description: 'Collected sales tax owed' },
        { account_code: '2005', account_name: 'Payroll Taxes Payable', account_type: 'liability', account_subtype: 'payroll_liabilities', normal_balance: 'credit', description: 'Withheld taxes owed' },
        { account_code: '2006', account_name: 'Accrued Payroll', account_type: 'liability', account_subtype: 'payroll_liabilities', normal_balance: 'credit', description: 'Payroll earned not yet paid' },
        { account_code: '2007', account_name: 'Accrued Rent', account_type: 'liability', account_subtype: 'other_liabilities', normal_balance: 'credit', description: 'Rent payable' },
        { account_code: '2010', account_name: 'Income Tax Payable', account_type: 'liability', account_subtype: 'other_liabilities', normal_balance: 'credit', description: 'Income tax owed' },
        { account_code: '2020', account_name: 'Tips Payable', account_type: 'liability', account_subtype: 'payroll_liabilities', normal_balance: 'credit', description: 'Tips owed to staff' },
        { account_code: '2030', account_name: 'Unearned Revenue', account_type: 'liability', account_subtype: 'deferred_revenue', normal_balance: 'credit', description: 'Advance payments' },
        { account_code: '2040', account_name: 'Current Portion of Long-Term Debt', account_type: 'liability', account_subtype: 'loan', normal_balance: 'credit', description: 'Due within 12 months' },
        { account_code: '2500', account_name: 'Notes Payable – Long Term', account_type: 'liability', account_subtype: 'loan', normal_balance: 'credit', description: 'Bank or SBA loans' },
        { account_code: '2600', account_name: 'Lease Liability', account_type: 'liability', account_subtype: 'other_liabilities', normal_balance: 'credit', description: 'Future lease payments' },
        { account_code: '2700', account_name: 'Deferred Tax Liability', account_type: 'liability', account_subtype: 'other_liabilities', normal_balance: 'credit', description: 'Taxes owed in future periods' },
        
        // EQUITY (3000-3999)
        { account_code: '3000', account_name: "Common Stock / Member's Equity", account_type: 'equity', account_subtype: 'owners_equity', normal_balance: 'credit', description: 'Owner or member investment' },
        { account_code: '3001', account_name: 'Opening Balance Equity', account_type: 'equity', account_subtype: 'owners_equity', normal_balance: 'credit', description: 'System balancing account' },
        { account_code: '3002', account_name: 'Retained Earnings', account_type: 'equity', account_subtype: 'retained_earnings', normal_balance: 'credit', description: 'Cumulative profit retained' },
        { account_code: '3003', account_name: "Owner's Draws / Partner Distributions", account_type: 'equity', account_subtype: 'distributions', normal_balance: 'debit', description: 'Withdrawals by owner' },
        { account_code: '3004', account_name: 'Owner Contributions', account_type: 'equity', account_subtype: 'owners_equity', normal_balance: 'credit', description: 'Cash or asset injections' },
        { account_code: '3010', account_name: 'Inter-Account Transfer', account_type: 'equity', account_subtype: 'owners_equity', normal_balance: 'credit', description: 'Equity offset for internal transfers (non-P&L)' },
        { account_code: '3100', account_name: 'Additional Paid-In Capital', account_type: 'equity', account_subtype: 'owners_equity', normal_balance: 'credit', description: 'Equity over par value' },
        
        // REVENUE (4000-4999)
        { account_code: '4000', account_name: 'Sales – Food', account_type: 'revenue', account_subtype: 'food_sales', normal_balance: 'credit', description: 'Food sales' },
        { account_code: '4010', account_name: 'Sales – Beverages (Non-Alcoholic)', account_type: 'revenue', account_subtype: 'beverage_sales', normal_balance: 'credit', description: 'Beverage sales' },
        { account_code: '4020', account_name: 'Sales – Alcohol', account_type: 'revenue', account_subtype: 'alcohol_sales', normal_balance: 'credit', description: 'Alcoholic drinks' },
        { account_code: '4030', account_name: 'Catering Income', account_type: 'revenue', account_subtype: 'catering_income', normal_balance: 'credit', description: 'Catering services' },
        { account_code: '4040', account_name: 'Delivery & Takeout Revenue', account_type: 'revenue', account_subtype: 'food_sales', normal_balance: 'credit', description: 'Online delivery sales' },
        { account_code: '4050', account_name: 'Merchandise Sales', account_type: 'revenue', account_subtype: 'other_income', normal_balance: 'credit', description: 'Retail or branded goods' },
        { account_code: '4060', account_name: 'Gift Card Redemptions', account_type: 'revenue', account_subtype: 'other_income', normal_balance: 'credit', description: 'Redeemed gift cards' },
        { account_code: '4070', account_name: 'Franchise Rebates', account_type: 'revenue', account_subtype: 'other_income', normal_balance: 'credit', description: 'Rebates or incentives from franchisor' },
        { account_code: '4080', account_name: 'Service Charges / Fees', account_type: 'revenue', account_subtype: 'other_income', normal_balance: 'credit', description: 'Gratuity, service charge' },
        { account_code: '4090', account_name: 'Refunds & Returns', account_type: 'revenue', account_subtype: 'other_income', normal_balance: 'debit', description: 'Contra to reduce total sales' },
        { account_code: '4100', account_name: 'Discounts Given', account_type: 'revenue', account_subtype: 'other_income', normal_balance: 'debit', description: 'Promotional discounts' },
        { account_code: '4300', account_name: 'Interest Income', account_type: 'revenue', account_subtype: 'other_income', normal_balance: 'credit', description: 'Bank or other interest' },
        { account_code: '4900', account_name: 'Uncategorized Income', account_type: 'revenue', account_subtype: 'other_income', normal_balance: 'credit', description: 'Temporary system placeholder' },
        
        // COGS (5000-5999)
        { account_code: '5000', account_name: 'Cost of Goods Sold', account_type: 'cogs', account_subtype: 'food_cost', normal_balance: 'debit', description: 'Total food & beverage costs' },
        { account_code: '5100', account_name: 'Food Cost', account_type: 'cogs', account_subtype: 'food_cost', normal_balance: 'debit', description: 'Ingredients, raw materials' },
        { account_code: '5200', account_name: 'Beverage Cost', account_type: 'cogs', account_subtype: 'beverage_cost', normal_balance: 'debit', description: 'Drinks and bar supplies' },
        { account_code: '5300', account_name: 'Packaging & Paper Goods', account_type: 'cogs', account_subtype: 'packaging_cost', normal_balance: 'debit', description: 'Takeout containers, napkins' },
        { account_code: '5400', account_name: 'Kitchen Supplies', account_type: 'cogs', account_subtype: 'food_cost', normal_balance: 'debit', description: 'Cooking tools, disposables' },
        { account_code: '5500', account_name: 'Freight & Delivery Inbound', account_type: 'cogs', account_subtype: 'food_cost', normal_balance: 'debit', description: 'Shipping for food supplies' },
        { account_code: '5600', account_name: 'Waste & Spoilage', account_type: 'cogs', account_subtype: 'food_cost', normal_balance: 'debit', description: 'Lost or expired goods' },
        
        // OPERATING EXPENSES (6000-6999)
        { account_code: '6000', account_name: 'Salaries & Wages – Management', account_type: 'expense', account_subtype: 'labor', normal_balance: 'debit', description: 'Salaries for managers' },
        { account_code: '6001', account_name: 'Salaries & Wages – Front of House', account_type: 'expense', account_subtype: 'labor', normal_balance: 'debit', description: 'Servers, cashiers' },
        { account_code: '6002', account_name: 'Salaries & Wages – Back of House', account_type: 'expense', account_subtype: 'labor', normal_balance: 'debit', description: 'Kitchen staff' },
        { account_code: '6010', account_name: 'Payroll Taxes', account_type: 'expense', account_subtype: 'labor', normal_balance: 'debit', description: 'Employer payroll taxes' },
        { account_code: '6011', account_name: 'Employee Benefits', account_type: 'expense', account_subtype: 'labor', normal_balance: 'debit', description: '401(k), bonuses' },
        { account_code: '6012', account_name: 'Health Insurance', account_type: 'expense', account_subtype: 'insurance', normal_balance: 'debit', description: 'Health coverage' },
        { account_code: '6020', account_name: 'Rent / Lease Expense', account_type: 'expense', account_subtype: 'rent', normal_balance: 'debit', description: 'Rent for premises' },
        { account_code: '6021', account_name: 'Utilities – Electricity & Gas', account_type: 'expense', account_subtype: 'utilities', normal_balance: 'debit', description: 'Energy costs' },
        { account_code: '6022', account_name: 'Utilities – Water & Sewer', account_type: 'expense', account_subtype: 'utilities', normal_balance: 'debit', description: 'Water costs' },
        { account_code: '6023', account_name: 'Telephone & Internet', account_type: 'expense', account_subtype: 'utilities', normal_balance: 'debit', description: 'Communication services' },
        { account_code: '6030', account_name: 'Repairs & Maintenance', account_type: 'expense', account_subtype: 'repairs_maintenance', normal_balance: 'debit', description: 'General maintenance' },
        { account_code: '6031', account_name: 'Cleaning & Sanitation', account_type: 'expense', account_subtype: 'other_expenses', normal_balance: 'debit', description: 'Janitorial services' },
        { account_code: '6040', account_name: 'Licenses & Permits', account_type: 'expense', account_subtype: 'other_expenses', normal_balance: 'debit', description: 'Business permits' },
        { account_code: '6041', account_name: 'Property Insurance', account_type: 'expense', account_subtype: 'insurance', normal_balance: 'debit', description: 'Building insurance' },
        { account_code: '6050', account_name: 'Bank Fees & Merchant Processing', account_type: 'expense', account_subtype: 'other_expenses', normal_balance: 'debit', description: 'Processing and bank fees' },
        { account_code: '6060', account_name: 'Professional Fees', account_type: 'expense', account_subtype: 'professional_fees', normal_balance: 'debit', description: 'Legal, accounting, consulting' },
        { account_code: '6070', account_name: 'Marketing & Advertising', account_type: 'expense', account_subtype: 'marketing', normal_balance: 'debit', description: 'Promotional spend' },
        { account_code: '6072', account_name: 'Software Subscriptions', account_type: 'expense', account_subtype: 'other_expenses', normal_balance: 'debit', description: 'SaaS tools' },
        { account_code: '6073', account_name: 'Office Supplies', account_type: 'expense', account_subtype: 'other_expenses', normal_balance: 'debit', description: 'Stationery, paper' },
        { account_code: '6074', account_name: 'Postage & Shipping', account_type: 'expense', account_subtype: 'other_expenses', normal_balance: 'debit', description: 'Outbound shipping' },
        { account_code: '6075', account_name: 'Meals & Entertainment', account_type: 'expense', account_subtype: 'other_expenses', normal_balance: 'debit', description: 'Business meals' },
        { account_code: '6080', account_name: 'Vehicle Expenses', account_type: 'expense', account_subtype: 'other_expenses', normal_balance: 'debit', description: 'Fuel, repairs' },
        { account_code: '6090', account_name: 'Taxes & Licenses', account_type: 'expense', account_subtype: 'other_expenses', normal_balance: 'debit', description: 'Business taxes' },
        { account_code: '6100', account_name: 'Depreciation Expense', account_type: 'expense', account_subtype: 'other_expenses', normal_balance: 'debit', description: 'Depreciation of assets' },
        { account_code: '6110', account_name: 'Amortization Expense', account_type: 'expense', account_subtype: 'other_expenses', normal_balance: 'debit', description: 'Amortization of intangibles' },
        { account_code: '6120', account_name: 'Franchise Royalties', account_type: 'expense', account_subtype: 'other_expenses', normal_balance: 'debit', description: '% of sales paid to franchisor' },
        { account_code: '6130', account_name: 'Franchise Advertising Fees', account_type: 'expense', account_subtype: 'marketing', normal_balance: 'debit', description: 'Co-op marketing fund' },
        { account_code: '6140', account_name: 'Credit Card Fees', account_type: 'expense', account_subtype: 'other_expenses', normal_balance: 'debit', description: 'POS merchant fees' },
        { account_code: '6150', account_name: 'Dues & Subscriptions', account_type: 'expense', account_subtype: 'other_expenses', normal_balance: 'debit', description: 'Memberships, software' },
        { account_code: '6160', account_name: 'Uniforms', account_type: 'expense', account_subtype: 'other_expenses', normal_balance: 'debit', description: 'Staff uniforms' },
        { account_code: '6170', account_name: 'Donations', account_type: 'expense', account_subtype: 'other_expenses', normal_balance: 'debit', description: 'Charitable giving' },
        { account_code: '6900', account_name: 'Uncategorized Expense', account_type: 'expense', account_subtype: 'other_expenses', normal_balance: 'debit', description: 'Placeholder for misc items' },
        
        // OTHER EXPENSES (9000-9999)
        { account_code: '9000', account_name: 'Interest Expense', account_type: 'expense', account_subtype: 'other_expenses', normal_balance: 'debit', description: 'Loan interest' },
        { account_code: '9100', account_name: 'Depreciation – Extraordinary', account_type: 'expense', account_subtype: 'other_expenses', normal_balance: 'debit', description: 'Major nonrecurring depreciation' },
        { account_code: '9200', account_name: 'Non-Operating Expense', account_type: 'expense', account_subtype: 'other_expenses', normal_balance: 'debit', description: 'Non-core activities' },
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
        .upsert(parentAccountsToInsert, { onConflict: 'restaurant_id,account_code' });

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
        .upsert(childAccountsToInsert, { onConflict: 'restaurant_id,account_code' });

      if (childError) throw childError;

      toast({
        title: "Default Accounts Created",
        description: "Your chart of accounts has been set up with standard restaurant categories",
      });

      // Invalidate the query to refetch accounts
      queryClient.invalidateQueries({ queryKey: ['chart-of-accounts', restaurantId] });
    } catch (error) {
      console.error('Error creating default accounts:', error);
      toast({
        title: "Failed to Create Default Accounts",
        description: error instanceof Error ? error.message : "An error occurred",
        variant: "destructive",
      });
    }
  };

  return {
    accounts,
    loading,
    fetchAccounts,
    createDefaultAccounts,
  };
};
