/**
 * E2E test helpers for Supabase operations
 * These functions run in Node.js context and can be exposed to browser via page.exposeFunction()
 */

import type { Page } from '@playwright/test';

/**
 * Expose Supabase helper functions to browser context
 * This avoids dynamic imports from /src/ which Vite doesn't serve
 */
export async function exposeSupabaseHelpers(page: Page) {
  // Inject helpers into the browser so they share the same Supabase client/session as the app
  const injectHelpers = async () => {
    if ((window as any).__supabaseHelpersReady) return;

    const { supabase } = await import('/src/integrations/supabase/client');

    const waitForUser = async (): Promise<{ id: string } | null> => {
      for (let i = 0; i < 10; i++) {
        const { data: { user } } = await supabase.auth.getUser();
        if (user) return user;
        await new Promise(res => setTimeout(res, 200));
      }
      return null;
    };

    (window as any).__getAuthUser = waitForUser;

    (window as any).__getRestaurantId = async (userId?: string): Promise<string | null> => {
      const user = userId ? { id: userId } : await waitForUser();
      if (!user?.id) return null;

      const { data, error } = await supabase
        .from('user_restaurants')
        .select('restaurant_id')
        .eq('user_id', user.id)
        .limit(1)
        .single();

      if (error) {
        console.error('Failed to load restaurant for user', error);
        return null;
      }

      return data?.restaurant_id || null;
    };

    (window as any).__insertEmployees = async (employees: any[], restaurantId: string) => {
      const { data, error } = await supabase
        .from('employees')
        .insert(employees.map(emp => ({
          ...emp,
          restaurant_id: restaurantId,
        })))
        .select();

      if (error) {
        throw new Error(error.message);
      }
      return data;
    };

    (window as any).__checkApprovedSplits = async (restaurantId: string): Promise<boolean> => {
      const { count, error } = await supabase
        .from('tip_splits')
        .select('id', { count: 'exact', head: true })
        .eq('restaurant_id', restaurantId)
        .eq('status', 'approved');

      if (error) {
        console.error('Error checking approved splits', error);
        return false;
      }

      return (count || 0) > 0;
    };

    (window as any).__insertDispute = async (dispute: any) => {
      const { error } = await supabase.from('tip_disputes').insert(dispute);
      if (error) {
        throw new Error(error.message);
      }
    };

    (window as any).__checkResolvedDisputes = async (restaurantId: string): Promise<boolean> => {
      const { count, error } = await supabase
        .from('tip_disputes')
        .select('id', { count: 'exact', head: true })
        .eq('restaurant_id', restaurantId)
        .eq('status', 'resolved');

      if (error) {
        console.error('Error checking disputes', error);
        return false;
      }

      return (count || 0) > 0;
    };

    (window as any).__supabaseHelpersReady = true;
  };

  // Ensure helpers exist now and on future navigations
  await page.addInitScript(injectHelpers);
  await page.evaluate(injectHelpers);
}
