
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
  // Use head: false with limit(0) to force a GET request instead of HEAD
  // This avoids potential 404/network issues with HEAD requests on some clients
  let query = supabase.from(table as any)
    .select('*', { count: 'exact', head: false })
    .eq('restaurant_id', restaurantId)
    .limit(0);

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
    queryKey: ['onboarding-status', selectedRestaurant?.id],
    queryFn: async () => {
      console.log('useOnboardingStatus: Starting query', { selectedRestaurantId: selectedRestaurant?.id });

      if (!selectedRestaurant?.id) {
        console.log('useOnboardingStatus: No restaurant ID');
        return null;
      }

      const restaurantId = selectedRestaurant.id;

      try {
        // Run all checks in parallel
        const [
          posResult,
          collaboratorResult,
          employeeResult,
          recipeResult,
          receiptResult,
          inventoryResult,
          bankResult,
          squareResult,
          toastResult,
          cloverResult,
          shift4Result,
          invitationResult,
          productResult
        ] = await Promise.all([
          // 1. POS Connected (Generic)
          checkTableCount(restaurantId, 'integrations', { status: 'connected' }),
          
          // 2. Collaborators (more than just the owner)
          checkTableCount(restaurantId, 'user_restaurants'),

          // 3. Employees
          checkTableCount(restaurantId, 'employees'),

          // 4. Recipes
          checkTableCount(restaurantId, 'recipes'),

          // 5. Receipts
          checkTableCount(restaurantId, 'receipts'),

          // 6. Inventory Scans
          checkTableCount(restaurantId, 'inventory_counts'),
          
          // 7. Bank Account
          checkTableCount(restaurantId, 'bank_connections'),
            
          // 8. Specific POS Connections (Legacy/Direct)
          checkTableCount(restaurantId, 'square_connections'),
          checkTableCount(restaurantId, 'toast_connections'),
          checkTableCount(restaurantId, 'clover_connections'),
          checkTableCount(restaurantId, 'shift4_connections'),

          // 9. Invitations (Pending Collaborators)
          checkTableCount(restaurantId, 'invitations', { status: 'pending' }),

          // 10. Products (Inventory Items)
          checkTableCount(restaurantId, 'products')
        ]);

        // Check for errors
        const results = [
          { name: 'pos', ...posResult },
          { name: 'collaborators', ...collaboratorResult },
          { name: 'employees', ...employeeResult },
          { name: 'recipes', ...recipeResult },
          { name: 'receipts', ...receiptResult },
          { name: 'inventory', ...inventoryResult },
          { name: 'bank', ...bankResult },
          { name: 'square', ...squareResult },
          { name: 'toast', ...toastResult },
          { name: 'clover', ...cloverResult },
          { name: 'shift4', ...shift4Result },
          { name: 'invitations', ...invitationResult },
          { name: 'products', ...productResult }
        ];

        const errors = results.filter(r => r?.error);
        if (errors.length > 0) {
          // Log errors but treat them as 0 counts to prevent blocking the UI
          console.warn('useOnboardingStatus: Some checks failed (defaulting to 0)', errors);
          // We DO NOT throw here anymore.
        }

        // Helper to safely get count
        const getCount = (res: any) => res?.error ? 0 : (res?.count || 0);

        const squareCount = getCount(squareResult);
        const toastCount = getCount(toastResult);
        const cloverCount = getCount(cloverResult);
        const shift4Count = getCount(shift4Result);

        const hasDirectPos = squareCount > 0 || 
                            toastCount > 0 || 
                            cloverCount > 0 || 
                            shift4Count > 0;

        const finalStatus = {
          hasPos: getCount(posResult) > 0 || hasDirectPos,
          hasCollaborators: (getCount(collaboratorResult) > 1) || (getCount(invitationResult) > 0),
          hasEmployees: getCount(employeeResult) > 0,
          hasRecipes: getCount(recipeResult) > 0,
          hasReceipts: getCount(receiptResult) > 0,
          hasInventory: getCount(inventoryResult) > 0 || getCount(productResult) > 0,
          hasBank: getCount(bankResult) > 0
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
    enabled: !!selectedRestaurant?.id,
    staleTime: 10000, // Reduced to 10s to ensure fresh data when switching restaurants
    refetchOnMount: true, // Always refetch when component mounts
    refetchOnWindowFocus: true, // Refetch when window regains focus
  });

  // Explicitly refetch when restaurant changes to ensure fresh data
  useEffect(() => {
    if (selectedRestaurant?.id) {
      console.log('useOnboardingStatus: Restaurant changed, refetching...', { restaurantId: selectedRestaurant.id });
      refetch();
    }
  }, [selectedRestaurant?.id, refetch]);

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
      path: '/receipts',
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
