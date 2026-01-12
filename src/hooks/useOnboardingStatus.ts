
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
}

export const useOnboardingStatus = (): OnboardingStatus => {
  const { selectedRestaurant } = useRestaurantContext();

  const { data: status, isLoading } = useQuery({
    queryKey: ['onboarding-status', selectedRestaurant?.id],
    queryFn: async () => {
      if (!selectedRestaurant?.id) return null;

      const restaurantId = selectedRestaurant.id;

      // Run all checks in parallel
      const [
        { count: posCount },
        { count: collaboratorCount },
        { count: employeeCount },
        { count: recipeCount },
        { count: receiptCount },
        { count: inventoryCount },
        { count: bankCount }
      ] = await Promise.all([
        // 1. POS Connected
        supabase.from('integrations')
          .select('*', { count: 'exact', head: true })
          .eq('restaurant_id', restaurantId)
          .eq('status', 'connected'),
        
        // 2. Collaborators (more than just the owner)
        // We check if there's more than 1 user_restaurant record
        supabase.from('user_restaurants')
          .select('*', { count: 'exact', head: true })
          .eq('restaurant_id', restaurantId),

        // 3. Employees
        supabase.from('employees')
          .select('*', { count: 'exact', head: true })
          .eq('restaurant_id', restaurantId)
          .eq('status', 'active'),

        // 4. Recipes
        supabase.from('recipes')
          .select('*', { count: 'exact', head: true })
          .eq('restaurant_id', restaurantId),

        // 5. Receipts (checking receipts table)
        supabase.from('receipts')
          .select('*', { count: 'exact', head: true })
          .eq('restaurant_id', restaurantId),

        // 6. Inventory Scans (checking inventory_counts)
        supabase.from('inventory_counts')
          .select('*', { count: 'exact', head: true })
          .eq('restaurant_id', restaurantId),
        
        // 7. Bank Account
        supabase.from('bank_connections')
          .select('*', { count: 'exact', head: true })
          .eq('restaurant_id', restaurantId)
          .eq('status', 'active')
      ]);

      return {
        hasPos: (posCount || 0) > 0,
        hasCollaborators: (collaboratorCount || 0) > 1,
        hasEmployees: (employeeCount || 0) > 0,
        hasRecipes: (recipeCount || 0) > 0,
        hasReceipts: (receiptCount || 0) > 0,
        hasInventory: (inventoryCount || 0) > 0,
        hasBank: (bankCount || 0) > 0
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
    isLoading
  };
};
