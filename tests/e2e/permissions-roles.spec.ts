import { test, expect } from '@playwright/test';
import { generateTestUser, signUpAndCreateRestaurant, exposeSupabaseHelpers } from '../helpers/e2e-supabase';

const collaboratorRoles = [
  {
    role: 'collaborator_accountant',
    landing: '/transactions',
    allowed: [
      '/transactions', '/banking', '/expenses', '/invoices', '/customers', '/chart-of-accounts', '/financial-statements', '/financial-intelligence', '/payroll', '/employees', '/settings'
    ],
    forbidden: ['/inventory', '/recipes', '/team']
  },
  {
    role: 'collaborator_inventory',
    landing: '/inventory',
    allowed: [
      '/inventory', '/inventory-audit', '/purchase-orders', '/receipt-import', '/settings'
    ],
    forbidden: ['/transactions', '/payroll', '/team']
  },
  {
    role: 'collaborator_chef',
    landing: '/recipes',
    allowed: [
      '/recipes', '/prep-recipes', '/batches', '/inventory', '/settings'
    ],
    forbidden: ['/transactions', '/payroll', '/team']
  }
];

test.describe('Collaborator Role Routing and Access', () => {
  for (const { role, landing, allowed, forbidden } of collaboratorRoles) {
    test(`should redirect ${role} to landing and restrict access`, async ({ page }) => {
      const user = generateTestUser();
      await signUpAndCreateRestaurant(page, user);

      // Update user role to collaborator using database
      await exposeSupabaseHelpers(page);
      await page.evaluate(async ({ role }) => {
        const user = await (window as any).__getAuthUser();
        if (!user?.id) throw new Error('No user session');

        const restaurantId = await (window as any).__getRestaurantId(user.id);
        if (!restaurantId) throw new Error('No restaurant');

        // Update the user's role in user_restaurants
        const { error } = await (window as any).__supabase
          .from('user_restaurants')
          .update({ role })
          .eq('user_id', user.id)
          .eq('restaurant_id', restaurantId);

        if (error) {
          throw new Error(`Failed to update role: ${error.message}`);
        }
      }, { role });

      // Reload page to apply role change
      await page.reload();

      // Should redirect to landing page
      await expect(page).toHaveURL(landing);

      // Allowed paths should be accessible
      for (const path of allowed) {
        await page.goto(path);
        await expect(page).not.toHaveURL('/auth');
      }

      // Forbidden paths should redirect to landing
      for (const path of forbidden) {
        await page.goto(path);
        await expect(page).toHaveURL(landing);
      }
    });
  }
});
