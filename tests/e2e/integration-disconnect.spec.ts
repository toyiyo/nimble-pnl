import { test, expect, type Page } from '@playwright/test';
import {
  exposeSupabaseHelpers,
  generateTestUser,
  seedRevelConnection,
  setUserRole,
  signUpAndCreateRestaurant,
  type E2EHelperWindow,
} from '../helpers/e2e-supabase';

/**
 * E2E: disconnect flow for an integration. Uses a seeded Revel connection.
 * The alert function call is intercepted, so no alert goes out.
 */

async function setup(page: Page, prefix: string): Promise<string> {
  await page.route('**/functions/v1/notify-integration-disconnect', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }),
  );
  await signUpAndCreateRestaurant(page, generateTestUser(prefix));
  await exposeSupabaseHelpers(page);
  const restaurantId = await page.evaluate(() => (window as E2EHelperWindow).__getRestaurantId());
  if (!restaurantId) throw new Error('No restaurant');
  await seedRevelConnection(page, restaurantId);
  await page.goto('/integrations');
  return restaurantId;
}

async function runOwnerPath(page: Page, restaurantId: string) {
  const disconnect = page.getByRole('button', { name: 'Disconnect' }).first();
  await expect(disconnect).toBeVisible({ timeout: 20000 });
  await disconnect.click();

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Continue' }).click();

  await dialog.getByRole('radio', { name: 'Other' }).click();
  await dialog.getByLabel('Tell us more').fill('E2E test reason');
  await dialog.getByRole('button', { name: 'Continue' }).click();

  const confirm = dialog.getByRole('button', { name: 'Disconnect anyway' });
  await expect(confirm).toBeVisible();
  await confirm.scrollIntoViewIfNeeded();
  await confirm.click();

  await expect(dialog).toBeHidden({ timeout: 20000 });
  await expect(page.getByRole('button', { name: 'Connect', exact: true }).first()).toBeVisible();

  await exposeSupabaseHelpers(page);
  await expect
    .poll(
      async () =>
        page.evaluate(async (restId) => {
          const w = window as unknown as E2EHelperWindow;
          const { data, error } = await w.__supabase
            .from('integration_events')
            .select('reason, event, integration')
            .eq('restaurant_id', restId)
            .eq('event', 'disconnect');
          if (error) throw new Error(error.message);
          return data?.map((r: { integration: string; reason: string }) => `${r.integration}:${r.reason}`) ?? [];
        }, restaurantId),
      { timeout: 15000 },
    )
    .toEqual(['revel:other']);
}

test('owner disconnects Revel through the three steps', async ({ page }) => {
  const restaurantId = await setup(page, 'disc-owner');
  await runOwnerPath(page, restaurantId);
});

test('owner path works on a 375x667 screen', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 });
  const restaurantId = await setup(page, 'disc-mobile');
  await runOwnerPath(page, restaurantId);
});

test('a chef does not see the Disconnect button', async ({ page }) => {
  await setup(page, 'disc-chef');
  await setUserRole(page, 'chef');
  await page.goto('/integrations');
  await expect(page.getByRole('button', { name: 'Configure' }).first()).toBeVisible({ timeout: 20000 });
  await expect(page.getByRole('button', { name: 'Disconnect' })).toHaveCount(0);
});
