
import { useQuery } from '@tanstack/react-query';
import { supabase } from "@/integrations/supabase/client";
import type { Database } from '@/integrations/supabase/types';
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

type TableName = keyof Database['public']['Tables'];

const onboardingTables = {
  collaborators: 'user_restaurants',
  employees: 'employees',
  recipes: 'recipes',
  receiptImports: 'receipt_imports',
  inventoryReconciliations: 'inventory_reconciliations',
  inventoryTransactions: 'inventory_transactions',
  connectedBanks: 'connected_banks',
  bankTransactions: 'bank_transactions',
  squareConnections: 'square_connections',
  toastConnections: 'toast_connections',
  cloverConnections: 'clover_connections',
  shift4Connections: 'shift4_connections',
  invitations: 'invitations',
  products: 'products'
} as const;

const checkTableCount = (
  restaurantId: string, 
  table: TableName, 
  filters?: Record<string, string>
) => {
  // Select only 'id' for minimal data transfer, with count: 'exact' to get the count
  // Use head: false to force a GET request instead of HEAD (avoids 404/network issues)
  // limit(1) is sufficient since we only need the count, not the data
  let query = supabase.from(table)
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
  const restaurantId = selectedRestaurant?.restaurant_id
    ?? selectedRestaurant?.restaurant?.id
    ?? selectedRestaurant?.id
    ?? null;
  const isDev = import.meta.env.DEV;

  const { data: status, isLoading, error, refetch } = useQuery({
    queryKey: ['onboarding-status', restaurantId],
    queryFn: async () => {
      if (!restaurantId) {
        if (isDev) {
          console.warn('useOnboardingStatus: Missing restaurant ID', { selectedRestaurant });
        }
        return null;
      }

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
          checkTableCount(restaurantId, onboardingTables.collaborators),

          // 2. Employees
          checkTableCount(restaurantId, onboardingTables.employees),

          // 3. Recipes
          checkTableCount(restaurantId, onboardingTables.recipes),

          // 4. Receipt Imports (uploaded receipts)
          checkTableCount(restaurantId, onboardingTables.receiptImports),

          // 5. Inventory Reconciliations
          checkTableCount(restaurantId, onboardingTables.inventoryReconciliations),
          
          // 5b. Alternative: Inventory Transactions
          checkTableCount(restaurantId, onboardingTables.inventoryTransactions),
          
          // 6. Bank Account (connected banks via Stripe)
          checkTableCount(restaurantId, onboardingTables.connectedBanks),
          
          // 6b. Alternative: Bank Transactions (if statements were uploaded)
          checkTableCount(restaurantId, onboardingTables.bankTransactions),
            
          // 7. Specific POS Connections
          checkTableCount(restaurantId, onboardingTables.squareConnections),
          checkTableCount(restaurantId, onboardingTables.toastConnections),
          checkTableCount(restaurantId, onboardingTables.cloverConnections),
          checkTableCount(restaurantId, onboardingTables.shift4Connections),

          // 8. Invitations (Pending Collaborators)
          checkTableCount(restaurantId, onboardingTables.invitations, { status: 'pending' }),

          // 9. Products (Inventory Items)
          checkTableCount(restaurantId, onboardingTables.products)
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

        const errors = results.filter(r => r?.error);
        if (errors.length > 0) {
          // Errors are treated as 0 counts to prevent blocking the UI
          if (isDev) {
            console.warn('useOnboardingStatus: Some checks failed (defaulting to 0)', errors.map(e => ({
              name: e.name,
              error: e.error?.message || e.error
            })));
          }
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

        const finalStatus = {
          hasPos: hasDirectPos,
          hasCollaborators: (getCount(collaboratorResult) > 1) || (getCount(invitationResult) > 0),
          hasEmployees: getCount(employeeResult) > 0,
          hasRecipes: getCount(recipeResult) > 0,
          hasReceipts: getCount(receiptResult) > 0,
          hasInventory: hasInventoryData(),
          hasBank: hasBankData()
        };

        return finalStatus;
      } catch (err) {
         if (isDev) {
           console.error('useOnboardingStatus: Exception in queryFn', err);
         }
         // Even if exception, return defaults to avoid UI crash
         return {
            hasPos: false, hasCollaborators: false, hasEmployees: false,
            hasRecipes: false, hasReceipts: false, hasInventory: false, hasBank: false
         };
      }
    },
    enabled: !!restaurantId,
    staleTime: 30000, // 30s per guidelines for critical data
    refetchOnMount: true, // Always refetch when component mounts
    refetchOnWindowFocus: true, // Refetch when window regains focus
  });

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
