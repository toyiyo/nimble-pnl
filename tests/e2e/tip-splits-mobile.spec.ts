import { test, expect, Page } from '@playwright/test';
import { format } from 'date-fns';
import {
  signUpAndCreateRestaurant,
  generateTestUser,
  exposeSupabaseHelpers,
  type E2EHelperWindow,
} from '../helpers/e2e-supabase';

/**
 * Regression: at 390px, the "Recent Tip Splits" row did not wrap. The
 * "View Details" button sat outside the viewport and a tap could not reach it.
 */

const MOBILE = { width: 390, height: 844 };

async function seedApprovedSplit(page: Page, splitDate: string) {
  await exposeSupabaseHelpers(page);

  await page.evaluate(async (date) => {
    const win = window as unknown as E2EHelperWindow;
    const user = await win.__getAuthUser();
    if (!user?.id) throw new Error('No user session');

    const restaurantId = await win.__getRestaurantId(user.id);
    if (!restaurantId) throw new Error('No restaurant');

    const { error } = await win.__supabase.from('tip_splits').insert({
      restaurant_id: restaurantId,
      split_date: date,
      total_amount: 12345,
      status: 'approved',
      share_method: 'hours',
      tip_source: 'manual',
      created_by: user.id,
      approved_by: user.id,
      approved_at: new Date().toISOString(),
    });
    if (error) throw new Error(error.message);
  }, splitDate);
}

test.describe('Recent Tip Splits on mobile', () => {
  test('approved split buttons stay inside a 390px viewport', async ({ page }) => {
    const user = generateTestUser('tip-mobile');
    await signUpAndCreateRestaurant(page, user);
    await seedApprovedSplit(page, format(new Date(), 'yyyy-MM-dd'));

    await page.setViewportSize(MOBILE);
    await page.goto('/tips');
    await expect(page.getByRole('heading', { name: /^tips$/i }).first()).toBeVisible({ timeout: 25000 });

    const dailyEntry = page.getByRole('button', { name: /daily entry/i });
    if (await dailyEntry.isVisible()) {
      await dailyEntry.click();
    }

    await expect(page.getByText('Recent Tip Splits')).toBeVisible({ timeout: 15000 });

    const reopen = page.getByRole('button', { name: 'Reopen split for editing' });
    const viewDetails = page.getByRole('button', { name: 'View audit trail' });
    await expect(reopen).toBeVisible({ timeout: 15000 });
    await expect(viewDetails).toBeVisible();

    for (const button of [reopen, viewDetails]) {
      const box = await button.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(MOBILE.width);
    }

    const overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
    }));
    expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.innerWidth);

    // A normal pointer click. Playwright fails it if the target is outside the viewport.
    await viewDetails.click();
    await expect(page.getByRole('dialog').getByText('Tip Split Details')).toBeVisible({ timeout: 5000 });
  });
});
