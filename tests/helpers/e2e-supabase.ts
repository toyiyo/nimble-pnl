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
  // Get current user from browser's localStorage
  await page.exposeFunction('__getAuthUser', async (): Promise<{ id: string } | null> => {
    const session = await page.evaluate(() => {
      const item = localStorage.getItem('sb-localhost-auth-token');
      if (!item) return null;
      try {
        const parsed = JSON.parse(item);
        return parsed?.user || null;
      } catch {
        return null;
      }
    });
    return session;
  });

  // Get restaurant ID for current user
  await page.exposeFunction('__getRestaurantId', async (): Promise<string | null> => {
    const user = await (page as any).evaluate(() => (window as any).__getAuthUser());
    if (!user?.id) return null;

    const url = process.env.SUPABASE_URL || 'http://localhost:54321';
    const key = process.env.SUPABASE_ANON_KEY || '';
    
    const response = await fetch(`${url}/rest/v1/user_restaurants?user_id=eq.${user.id}&select=restaurant_id&limit=1`, {
      headers: {
        'apikey': key,
        'Authorization': `Bearer ${key}`
      }
    });
    
    const data = await response.json();
    return data?.[0]?.restaurant_id || null;
  });

  // Insert employees
  await page.exposeFunction('__insertEmployees', async (employees: any[], restaurantId: string) => {
    const url = process.env.SUPABASE_URL || 'http://localhost:54321';
    const key = process.env.SUPABASE_ANON_KEY || '';
    
    const response = await fetch(`${url}/rest/v1/employees`, {
      method: 'POST',
      headers: {
        'apikey': key,
        'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation'
      },
      body: JSON.stringify(employees.map(emp => ({
        ...emp,
        restaurant_id: restaurantId
      })))
    });
    
    if (!response.ok) {
      throw new Error(`Failed to insert employees: ${response.statusText}`);
    }
    
    return await response.json();
  });

  // Check if splits exist
  await page.exposeFunction('__checkApprovedSplits', async (restaurantId: string): Promise<boolean> => {
    const url = process.env.SUPABASE_URL || 'http://localhost:54321';
    const key = process.env.SUPABASE_ANON_KEY || '';
    
    const response = await fetch(
      `${url}/rest/v1/tip_splits?restaurant_id=eq.${restaurantId}&status=eq.approved&select=id`,
      {
        headers: {
          'apikey': key,
          'Authorization': `Bearer ${key}`,
          'Prefer': 'count=exact'
        }
      }
    );
    
    const count = response.headers.get('Content-Range')?.split('/')[1];
    return parseInt(count || '0') > 0;
  });

  // Insert dispute
  await page.exposeFunction('__insertDispute', async (dispute: any) => {
    const url = process.env.SUPABASE_URL || 'http://localhost:54321';
    const key = process.env.SUPABASE_ANON_KEY || '';
    
    const response = await fetch(`${url}/rest/v1/tip_disputes`, {
      method: 'POST',
      headers: {
        'apikey': key,
        'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify(dispute)
    });
    
    if (!response.ok) {
      throw new Error(`Failed to insert dispute: ${response.statusText}`);
    }
  });

  // Check if disputes exist
  await page.exposeFunction('__checkResolvedDisputes', async (restaurantId: string): Promise<boolean> => {
    const url = process.env.SUPABASE_URL || 'http://localhost:54321';
    const key = process.env.SUPABASE_ANON_KEY || '';
    
    const response = await fetch(
      `${url}/rest/v1/tip_disputes?restaurant_id=eq.${restaurantId}&status=eq.resolved&select=id`,
      {
        headers: {
          'apikey': key,
          'Authorization': `Bearer ${key}`,
          'Prefer': 'count=exact'
        }
      }
    );
    
    const count = response.headers.get('Content-Range')?.split('/')[1];
    return parseInt(count || '0') > 0;
  });
}
