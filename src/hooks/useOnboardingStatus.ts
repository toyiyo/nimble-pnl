
import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { supabase } from "@/integrations/supabase/client";
import { useRestaurantContext } from '@/contexts/RestaurantContext';

export interface OnboardingStep {
  id: string;
  label: string;
  description: string;
  path: string;
  isCompleted: boolean;
  category: 'operations' | 'inventory' | 'finance';
  ctaText?: string;
}

export interface OnboardingStatus {
  steps: OnboardingStep[];
  completedCount: number;
  totalCount: number;
  percentage: number;
  isLoading: boolean;
  error: unknown | null;
  refetch: () => Promise<unknown>;
}

const checkTableCount = (
  restaurantId: string, 
  table: string, 
  filters?: Record<string, string>
) => {
  // Select only 'id' for minimal data transfer, with count: 'exact' to get the count
  // Use head: false to force a GET request instead of HEAD (avoids 404/network issues)
  // limit(1) is sufficient since we only need the count, not the data
  let query = supabase.from(table as any)
    .select('id', { count: 'exact', head: false })
    .eq('restaurant_id', restaurantId)
    .limit(1);

  if (filters) {
    Object.entries(filters).forEach(([key, value]) => {
      query = query.eq(key, value);
    });
  }

  return query;
};

export const useOnboardingStatus = (): OnboardingStatus => {
  const { selectedRestaurant } = useRestaurantContext();

  const { data: status, isLoading, error, refetch } = useQuery({
    queryKey: ['onboarding-status', selectedRestaurant?.restaurant_id],
    queryFn: async () => {
      console.log('useOnboardingStatus: Starting query', { selectedRestaurantId: selectedRestaurant?.restaurant_id });

      if (!selectedRestaurant?.restaurant_id) {
        console.log('useOnboardingStatus: No restaurant ID');
        return null;
      }

      const restaurantId = selectedRestaurant.restaurant_id;

      try {
        // Run all checks in parallel
        const [
          collaboratorResult,
          employeeResult,
          recipeResult,
          receiptResult,
          inventoryResult,
          inventoryTransactionsResult,
          bankResult,
          bankTransactionsResult,
          squareResult,
          toastResult,
          cloverResult,
          shift4Result,
          invitationResult,
          productResult
        ] = await Promise.all([
          // 1. Collaborators (more than just the owner)
          checkTableCount(restaurantId, 'user_restaurants'),

          // 2. Employees
          checkTableCount(restaurantId, 'employees'),

          // 3. Recipes
          checkTableCount(restaurantId, 'recipes'),

          // 4. Receipt Imports (uploaded receipts)
          checkTableCount(restaurantId, 'receipt_imports'),
          // 6. Bank Account (connected banks via Stripe)
          checkTableCount(restaurantId, 'connected_banks'),
          
          // 6b. Alternative: Bank Transactions (if statements were uploaded)
          checkTableCount(restaurantId, 'bank_transactions'),
            
          // 7. Specific POS Connections
          checkTableCount(restaurantId, 'square_connections'),
          checkTableCount(restaurantId, 'toast_connections'),
          checkTableCount(restaurantId, 'clover_connections'),
          checkTableCount(restaurantId, 'shift4_connections'),

          // 8. Invitations (Pending Collaborators)
          checkTableCount(restaurantId, 'invitations', { status: 'pending' }),

          // 9. Products (Inventory Items)
          checkTableCount(restaurantId, 'products')
        ]);

        // Check for errors
        const results = [
          { name: 'collaborators', ...collaboratorResult },
          { name: 'employees', ...employeeResult },
          { name: 'recipes', ...recipeResult },
          { name: 'receipt_imports', ...receiptResult },
          { name: 'inventory_reconciliations', ...inventoryResult },
          { name: 'inventory_transactions', ...inventoryTransactionsResult },
          { name: 'connected_banks', ...bankResult },
          { name: 'bank_transactions', ...bankTransactionsResult },
          { name: 'square', ...squareResult },
          { name: 'toast', ...toastResult },
          { name: 'clover', ...cloverResult },
          { name: 'shift4', ...shift4Result },
          { name: 'invitations', ...invitationResult },
          { name: 'products', ...productResult }
        ];

        console.log('useOnboardingStatus: Raw query results', results.map(r => ({
          name: r.name,
          count: r.count,
          hasError: !!r.error,
          errorCode: r.error?.code
        })));

        const errors = results.filter(r => r?.error);
        if (errors.length > 0) {
          // Log errors but treat them as 0 counts to prevent blocking the UI
          console.warn('useOnboardingStatus: Some checks failed (defaulting to 0)', errors.map(e => ({
            name: e.name,
            error: e.error?.message || e.error
          })));
          // We DO NOT throw here anymore.
        }

        // Helper to safely get count
        const getCount = (res: any) => {
          if (res?.error) return 0;
          // Handle both null and undefined, default to 0
          return res?.count ?? 0;
        };

        const squareCount = getCount(squareResult);
        const toastCount = getCount(toastResult);
        const cloverCount = getCount(cloverResult);
        const shift4Count = getCount(shift4Result);

        console.log('useOnboardingStatus: POS Counts', { 
          square: squareCount, 
          toast: toastCount, 
          clover: cloverCount, 
          shift4: shift4Count 
        });

        const hasDirectPos = squareCount > 0 || 
                            toastCount > 0 || 
                            cloverCount > 0 || 
                            shift4Count > 0;

        // Helper functions for data detection with fallbacks
        const hasInventoryData = () =>
          getCount(inventoryResult) > 0 || 
          getCount(inventoryTransactionsResult) > 0 || 
          getCount(productResult) > 0;
        
        const hasBankData = () =>
          getCount(bankResult) > 0 || getCount(bankTransactionsResult) > 0;

        console.log('useOnboardingStatus: Detailed Counts', {
          collaborators: getCount(collaboratorResult),
          employees: getCount(employeeResult),
          recipes: getCount(recipeResult),
          receiptImports: getCount(receiptResult),
          inventoryReconciliations: getCount(inventoryResult),
          inventoryTransactions: getCount(inventoryTransactionsResult),
          products: getCount(productResult),
          connectedBanks: getCount(bankResult),
          bankTransactions: getCount(bankTransactionsResult),
          invitations: getCount(invitationResult)
        });

        const finalStatus = {
          hasPos: hasDirectPos,
          hasCollaborators: (getCount(collaboratorResult) > 1) || (getCount(invitationResult) > 0),
          hasEmployees: getCount(employeeResult) > 0,
          hasRecipes: getCount(recipeResult) > 0,
          hasReceipts: getCount(receiptResult) > 0,
          hasInventory: hasInventoryData(),
          hasBank: hasBankData()
        };

        console.log('useOnboardingStatus: Calculated Status', finalStatus);
        return finalStatus;
      } catch (err) {
         console.error('useOnboardingStatus: Exception in queryFn', err);
         // Even if exception, return defaults to avoid UI crash
         return {
            hasPos: false, hasCollaborators: false, hasEmployees: false,
            hasRecipes: false, hasReceipts: false, hasInventory: false, hasBank: false
         };
      }
    },
    enabled: !!selectedRestaurant?.restaurant_id,
    staleTime: 10000, // Reduced to 10s to ensure fresh data when switching restaurants
    refetchOnMount: true, // Always refetch when component mounts
    refetchOnWindowFocus: true, // Refetch when window regains focus
  });

  // Explicitly refetch when restaurant changes to ensure fresh data
  useEffect(() => {
    if (selectedRestaurant?.restaurant_id) {
      console.log('useOnboardingStatus: Restaurant changed, refetching...', { restaurantId: selectedRestaurant.restaurant_id });
      refetch();
    }
  }, [selectedRestaurant?.restaurant_id, refetch]);

  const steps: OnboardingStep[] = [
    {
      id: 'pos',
      label: 'Connect a POS',
      description: 'See real sales, tips, and labor accuracy.',
      path: '/integrations',
      category: 'operations',
      ctaText: 'Connect POS',
      isCompleted: status?.hasPos ?? false
    },
    {
      id: 'collaborators',
      label: 'Invite Collaborators',
      description: 'Add partners or managers to the platform.',
      path: '/team',
      category: 'operations',
      ctaText: 'Invite Team',
      isCompleted: status?.hasCollaborators ?? false
    },
    {
      id: 'employees',
      label: 'Add Employees',
      description: 'Set up your staff for scheduling and performance.',
      path: '/employees',
      category: 'operations',
      ctaText: 'Add Staff',
      isCompleted: status?.hasEmployees ?? false
    },
    {
      id: 'recipe',
      label: 'Add a Recipe',
      description: 'Track costs and menu profitability.',
      path: '/recipes',
      category: 'inventory',
      ctaText: 'Create Recipe',
      isCompleted: status?.hasRecipes ?? false
    },
    {
      id: 'receipt',
      label: 'Upload a Receipt',
      description: 'Digitize expenses and update prices.',
      path: '/receipt-import',
      category: 'inventory',
      ctaText: 'Upload Receipt',
      isCompleted: status?.hasReceipts ?? false
    },
    {
      id: 'inventory',
      label: 'Scan Inventory',
      description: 'Start tracking stock levels.',
      path: '/inventory',
      category: 'inventory',
      ctaText: 'Start Count',
      isCompleted: status?.hasInventory ?? false
    },
    {
      id: 'bank',
      label: 'Connect Bank',
      description: 'Automate P&L and expense tracking.',
      path: '/banking',
      category: 'finance',
      ctaText: 'Connect Bank',
      isCompleted: status?.hasBank ?? false
    }
  ];

  const completedCount = steps.filter(s => s.isCompleted).length;
  const totalCount = steps.length;
  const percentage = Math.round((completedCount / totalCount) * 100);

  return {
    steps,
    completedCount,
    totalCount,
    percentage,
    isLoading,
    error: error ?? null,
    refetch
  };
};
