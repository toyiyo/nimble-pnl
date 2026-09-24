import { test, expect } from '@playwright/test';
import { signUpAndCreateRestaurant, generateTestUser } from '../helpers/e2e-supabase';
import { seedInventoryUsage } from '../helpers/e2e-service-role';

test('Dashboard shows the COGS value for This Month from seeded inventory usage', async ({ page }) => {
  const user = generateTestUser();
  const restaurantId = await signUpAndCreateRestaurant(page, user);

  // Build today's local date string. The RPC buckets by transaction_date,
  // so the seeded rows must fall inside the current month.
  const today = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const todayStr = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;

  // Seed two usage rows. The RPC sums ABS(total_cost) per row:
  // 120.25 + 66.75 = 187.00. The COGS card shows this as "$187".
  await seedInventoryUsage(restaurantId, [
    { totalCost: -120.25, transactionDate: todayStr },
    { totalCost: -66.75, transactionDate: todayStr },
  ]);

  // Reload the dashboard so the queries run after the seed.
  await page.goto('/', { timeout: 10000 });

  // The dashboard default period is Today. Switch to This Month.
  await page.getByRole('button', { name: 'This Month' }).click();

  // DashboardMetricCard exposes each card as a named region.
  const cogsCard = page.getByRole('region', { name: 'COGS' });
  await expect(cogsCard.getByText('$187')).toBeVisible({ timeout: 30000 });
});
