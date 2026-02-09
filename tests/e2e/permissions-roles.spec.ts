import { test, expect, Page } from '@playwright/test';
import { generateTestUser, signUpAndCreateRestaurant, exposeSupabaseHelpers } from '../helpers/e2e-supabase';

// Helper to update a user's role via the database and reload
async function setUserRole(page: Page, role: string): Promise<void> {
  await exposeSupabaseHelpers(page);
  await page.evaluate(
    async ({ role }) => {
      const user = await (window as any).__getAuthUser();
      if (!user?.id) throw new Error('No user session');

      const restaurantId = await (window as any).__getRestaurantId(user.id);
      if (!restaurantId) throw new Error('No restaurant');

      const { error } = await (window as any).__supabase
        .from('user_restaurants')
        .update({ role })
        .eq('user_id', user.id)
        .eq('restaurant_id', restaurantId);

      if (error) throw new Error(`Failed to update role: ${error.message}`);
    },
    { role }
  );
  await page.reload();
  await page.waitForLoadState('networkidle');
}

// ============================================================
// COLLABORATOR ROLE ROUTING AND ACCESS TESTS
// ============================================================

const collaboratorRoles = [
  {
    role: 'collaborator_accountant',
    landing: '/transactions',
    allowed: [
      '/transactions',
      '/banking',
      '/expenses',
      '/invoices',
      '/customers',
      '/chart-of-accounts',
      '/financial-statements',
      '/financial-intelligence',
      '/payroll',
      '/employees',
      '/settings',
    ],
    forbidden: ['/inventory', '/recipes', '/team', '/', '/scheduling'],
  },
  {
    role: 'collaborator_inventory',
    landing: '/inventory',
    allowed: ['/inventory', '/inventory-audit', '/purchase-orders', '/receipt-import', '/settings'],
    forbidden: ['/transactions', '/payroll', '/team', '/', '/recipes', '/banking'],
  },
  {
    role: 'collaborator_chef',
    landing: '/recipes',
    allowed: ['/recipes', '/prep-recipes', '/batches', '/inventory', '/settings'],
    forbidden: ['/transactions', '/payroll', '/team', '/', '/banking', '/purchase-orders'],
  },
];

test.describe('Collaborator Role Routing and Access', () => {
  test.describe.configure({ mode: 'serial' });

  for (const { role, landing, allowed, forbidden } of collaboratorRoles) {
    test(`should redirect ${role} to landing (${landing}) and restrict access`, async ({ page }) => {
      const user = generateTestUser();
      await signUpAndCreateRestaurant(page, user);

      await setUserRole(page, role);

      // Should redirect to landing page from dashboard
      await expect(page).toHaveURL(landing, { timeout: 10000 });

      // Allowed paths should be accessible
      for (const path of allowed) {
        await page.goto(path, { waitUntil: 'networkidle' });
        // Should stay on the allowed path, not redirect to auth or elsewhere
        await expect(page).toHaveURL(path, { timeout: 5000 });
      }

      // Forbidden paths should redirect to landing
      for (const path of forbidden) {
        await page.goto(path, { waitUntil: 'networkidle' });
        // Should redirect to the collaborator's landing page
        await expect(page).toHaveURL(landing, { timeout: 5000 });
      }
    });
  }
});

// ============================================================
// EXISTING ROLE REGRESSION TESTS
// These tests ensure existing users still have proper access
// ============================================================

test.describe('Existing Role Routing - Regression Prevention', () => {
  test.describe.configure({ mode: 'serial' });

  test('owner should have access to dashboard and all routes', async ({ page }) => {
    const user = generateTestUser('owner');
    await signUpAndCreateRestaurant(page, user);

    // Owner is default role after creating restaurant
    // Should stay on dashboard
    await expect(page).toHaveURL('/');

    // Owner should access key routes
    const ownerRoutes = [
      '/',
      '/team',
      '/employees',
      '/transactions',
      '/banking',
      '/inventory',
      '/recipes',
      '/scheduling',
      '/payroll',
      '/settings',
    ];

    for (const route of ownerRoutes) {
      await page.goto(route, { waitUntil: 'networkidle' });
      await expect(page).not.toHaveURL('/auth');
      // Owner should stay on the requested route (has full access)
      await expect(page).toHaveURL(route);
    }
  });

  test('manager should have access to dashboard and operational routes', async ({ page }) => {
    const user = generateTestUser('manager');
    await signUpAndCreateRestaurant(page, user);

    await setUserRole(page, 'manager');

    // Manager should stay on dashboard
    await expect(page).toHaveURL('/');

    // Manager should access operational routes
    const managerRoutes = ['/', '/team', '/employees', '/transactions', '/inventory', '/recipes', '/scheduling'];

    for (const route of managerRoutes) {
      await page.goto(route, { waitUntil: 'networkidle' });
      await expect(page).not.toHaveURL('/auth');
    }
  });

  test('chef (internal) should have access to dashboard and recipe/inventory routes', async ({ page }) => {
    const user = generateTestUser('chef');
    await signUpAndCreateRestaurant(page, user);

    await setUserRole(page, 'chef');

    // Chef (internal) should stay on dashboard
    await expect(page).toHaveURL('/');

    // Chef should access recipe and inventory routes
    const chefRoutes = ['/', '/recipes', '/prep-recipes', '/batches', '/inventory'];

    for (const route of chefRoutes) {
      await page.goto(route, { waitUntil: 'networkidle' });
      await expect(page).not.toHaveURL('/auth');
    }
  });

  test('staff should be redirected to employee clock', async ({ page }) => {
    const user = generateTestUser('staff');
    await signUpAndCreateRestaurant(page, user);

    await setUserRole(page, 'staff');

    // Staff should be redirected to employee clock
    await expect(page).toHaveURL('/employee/clock', { timeout: 10000 });

    // Staff should access employee routes
    const staffAllowed = [
      '/employee/clock',
      '/employee/portal',
      '/employee/timecard',
      '/employee/pay',
      '/employee/schedule',
      '/settings',
    ];

    for (const route of staffAllowed) {
      await page.goto(route, { waitUntil: 'networkidle' });
      await expect(page).not.toHaveURL('/auth');
    }

    // Staff should NOT access admin routes
    const staffForbidden = ['/', '/team', '/payroll', '/banking', '/transactions'];

    for (const route of staffForbidden) {
      await page.goto(route, { waitUntil: 'networkidle' });
      // Should redirect to employee clock
      await expect(page).toHaveURL('/employee/clock', { timeout: 5000 });
    }
  });

  test('kiosk should only access kiosk route', async ({ page }) => {
    const user = generateTestUser('kiosk');
    await signUpAndCreateRestaurant(page, user);

    await setUserRole(page, 'kiosk');

    // Kiosk should be redirected to kiosk route
    await expect(page).toHaveURL('/kiosk', { timeout: 10000 });

    // Kiosk should NOT access any other routes
    const kioskForbidden = ['/', '/team', '/employee/clock', '/settings'];

    for (const route of kioskForbidden) {
      await page.goto(route, { waitUntil: 'networkidle' });
      // Should always redirect back to kiosk
      await expect(page).toHaveURL('/kiosk', { timeout: 5000 });
    }
  });
});

// ============================================================
// SIDEBAR VISIBILITY TESTS
// ============================================================

test.describe('Sidebar Navigation Visibility', () => {
  test.describe.configure({ mode: 'serial' });

  test('collaborator_accountant sees only financial navigation', async ({ page }) => {
    const user = generateTestUser('collab-acct');
    await signUpAndCreateRestaurant(page, user);

    await setUserRole(page, 'collaborator_accountant');
    await expect(page).toHaveURL('/transactions', { timeout: 10000 });

    // Check sidebar contains financial items
    const sidebar = page.locator('aside[role="navigation"], [data-sidebar]').first();
    await expect(sidebar).toBeVisible();

    // Should see financial items
    await expect(sidebar.getByText('Transactions')).toBeVisible();
    await expect(sidebar.getByText('Banks')).toBeVisible();

    // Should NOT see inventory or recipe items
    await expect(sidebar.getByText('Recipes')).not.toBeVisible();
    await expect(sidebar.getByText('Scheduling')).not.toBeVisible();
    await expect(sidebar.getByText('Team')).not.toBeVisible();
  });

  test('collaborator_inventory sees only inventory navigation', async ({ page }) => {
    const user = generateTestUser('collab-inv');
    await signUpAndCreateRestaurant(page, user);

    await setUserRole(page, 'collaborator_inventory');
    await expect(page).toHaveURL('/inventory', { timeout: 10000 });

    const sidebar = page.locator('aside[role="navigation"], [data-sidebar]').first();
    await expect(sidebar).toBeVisible();

    // Should see inventory items (use role selector to get only the nav button)
    await expect(sidebar.getByRole('button', { name: 'Inventory', exact: true })).toBeVisible();

    // Should NOT see financial items
    await expect(sidebar.getByRole('button', { name: 'Transactions' })).not.toBeVisible();
    await expect(sidebar.getByRole('button', { name: 'Payroll' })).not.toBeVisible();
    await expect(sidebar.getByRole('button', { name: 'Team' })).not.toBeVisible();
  });

  test('collaborator_chef sees only recipe navigation', async ({ page }) => {
    const user = generateTestUser('collab-chef');
    await signUpAndCreateRestaurant(page, user);

    await setUserRole(page, 'collaborator_chef');
    await expect(page).toHaveURL('/recipes', { timeout: 10000 });

    const sidebar = page.locator('aside[role="navigation"], [data-sidebar]').first();
    await expect(sidebar).toBeVisible();

    // Should see recipe items (use role selector to get only the nav button)
    await expect(sidebar.getByRole('button', { name: 'Recipes', exact: true })).toBeVisible();

    // Should NOT see financial or scheduling items
    await expect(sidebar.getByRole('button', { name: 'Transactions' })).not.toBeVisible();
    await expect(sidebar.getByRole('button', { name: 'Payroll' })).not.toBeVisible();
    await expect(sidebar.getByRole('button', { name: 'Scheduling' })).not.toBeVisible();
  });
});

// ============================================================
// TEAM PAGE ACCESS TESTS (Collaborators should NOT see team)
// ============================================================

test.describe('Team Page Access Control', () => {
  test.describe.configure({ mode: 'serial' });

  test('owner can access Team page', async ({ page }) => {
    const user = generateTestUser('owner-team');
    await signUpAndCreateRestaurant(page, user);

    await page.goto('/team', { waitUntil: 'networkidle' });
    await expect(page).toHaveURL('/team');

    // Wait for page to load and verify we're on Team page (URL check is sufficient)
    await expect(page).toHaveURL('/team');
  });

  test('collaborator_accountant cannot access Team page', async ({ page }) => {
    const user = generateTestUser('collab-team');
    await signUpAndCreateRestaurant(page, user);

    await setUserRole(page, 'collaborator_accountant');

    // Try to access team page
    await page.goto('/team', { waitUntil: 'networkidle' });

    // Should be redirected to collaborator landing page, not team
    await expect(page).toHaveURL('/transactions', { timeout: 5000 });
  });
});

// ============================================================
// DASHBOARD REDIRECT TESTS
// ============================================================

test.describe('Dashboard Access Control', () => {
  test.describe.configure({ mode: 'serial' });

  test('owner lands on dashboard', async ({ page }) => {
    const user = generateTestUser('owner-dash');
    await signUpAndCreateRestaurant(page, user);

    await page.goto('/', { waitUntil: 'networkidle' });
    await expect(page).toHaveURL('/');
  });

  test('collaborators are redirected away from dashboard', async ({ page }) => {
    const user = generateTestUser('collab-dash');
    await signUpAndCreateRestaurant(page, user);

    await setUserRole(page, 'collaborator_accountant');

    // Try to access dashboard
    await page.goto('/', { waitUntil: 'networkidle' });

    // Should be redirected to collaborator landing page
    await expect(page).toHaveURL('/transactions', { timeout: 5000 });
  });
});
