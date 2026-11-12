import { test, expect } from '@playwright/test';
import {
  addSecondRestaurant,
  generateTestUser,
  signUpAndCreateRestaurant,
} from '../helpers/e2e-supabase';

/**
 * E2E: a notice link `/banking?select_restaurant=<id>` selects the linked
 * restaurant, removes the query key, and keeps the choice after a reload.
 */
test('banking link selects the linked restaurant', async ({ page }) => {
  const user = generateTestUser('deep-link');
  const firstId = await signUpAndCreateRestaurant(page, user);
  const secondName = `${user.restaurantName} Second`;
  const secondId = await addSecondRestaurant(page, secondName);
  expect(secondId).not.toBe(firstId);

  // Select the second restaurant first, so the link must change the selection.
  await page.goto('/');
  await page.reload();
  const trigger = page.getByRole('combobox').first();
  await expect(trigger).toBeVisible({ timeout: 15000 });
  await trigger.click();
  await page.getByRole('option', { name: new RegExp(secondName) }).click();
  await expect(trigger).toContainText(secondName, { timeout: 15000 });

  await page.goto(`/banking?select_restaurant=${firstId}`);

  await expect(page.getByRole('combobox').first()).toContainText(user.restaurantName, {
    timeout: 15000,
  });
  await expect(page.getByRole('combobox').first()).not.toContainText(secondName);
  await expect.poll(() => new URL(page.url()).searchParams.has('select_restaurant')).toBe(false);

  await page.reload();
  await expect(page.getByRole('combobox').first()).toContainText(user.restaurantName, {
    timeout: 15000,
  });
  const stored = await page.evaluate(() => {
    const key = Object.keys(localStorage).find((k) => k.startsWith('selectedRestaurant_'));
    return key ? localStorage.getItem(key) : null;
  });
  expect(stored).toBe(firstId);
});
