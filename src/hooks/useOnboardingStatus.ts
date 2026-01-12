
import { useQuery } from '@tanstack/react-query';
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
  let query = supabase.from(table as any)
    .select('*', { count: 'exact', head: true })
    .eq('restaurant_id', restaurantId);

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
      if (!selectedRestaurant?.id) return null;

      const restaurantId = selectedRestaurant.id;

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
        const aggregatedError = new Error('Onboarding status query failed');
        (aggregatedError as Error & { details?: unknown[] }).details = errors;
        throw aggregatedError;
      }

      const squareCount = squareResult.count;
      const toastCount = toastResult.count;
      const cloverCount = cloverResult.count;
      const shift4Count = shift4Result.count;

      const hasDirectPos = (squareCount || 0) > 0 || 
                          (toastCount || 0) > 0 || 
                          (cloverCount || 0) > 0 || 
                          (shift4Count || 0) > 0;

      return {
        hasPos: (posResult.count || 0) > 0 || hasDirectPos,
        hasCollaborators: ((collaboratorResult.count || 0) > 1) || ((invitationResult.count || 0) > 0),
        hasEmployees: (employeeResult.count || 0) > 0,
        hasRecipes: (recipeResult.count || 0) > 0,
        hasReceipts: (receiptResult.count || 0) > 0,
        hasInventory: (inventoryResult.count || 0) > 0 || (productResult.count || 0) > 0,
        hasBank: (bankResult.count || 0) > 0
      };
    },
    enabled: !!selectedRestaurant?.id,
    staleTime: 30000, // 30 seconds
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
