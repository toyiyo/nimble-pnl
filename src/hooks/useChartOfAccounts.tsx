import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { createDefaultChartOfAccounts } from '@/lib/chartOfAccountsUtils';

export type AccountType = 'asset' | 'liability' | 'equity' | 'revenue' | 'expense' | 'cogs';

export interface ChartAccount {
  id: string;
  restaurant_id: string;
  account_code: string;
  account_name: string;
  account_type: AccountType;
  account_subtype: string | null;
  parent_account_id: string | null;
  parent_account?: {
    id: string;
    account_name: string;
    account_code: string;
    account_type: AccountType;
  };
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
        .select(`
          *,
          parent_account:chart_of_accounts!parent_account_id(
            id,
            account_name,
            account_code,
            account_type
          )
        `)
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

      console.log('[useChartOfAccounts] Fetched accounts:', data);
      console.log('[useChartOfAccounts] Sample account with parent:', data?.find(a => a.parent_account_id));

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

      await createDefaultChartOfAccounts(supabase, restaurantId);

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
