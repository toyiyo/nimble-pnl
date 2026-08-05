import { test, expect } from '@playwright/test';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * E2E: the guest star control commits only on an explicit action.
 *
 * The ARIA radio pattern moves selection with focus. Here selection writes a
 * row and branches the page, so arrow keys must PREVIEW and nothing else.
 * This spec is the regression guard for that: if someone later swaps the
 * hand-rolled radiogroup for Radix's, the first assertion fails.
 *
 * The edge function is not served in the e2e stack, so `review-public` is
 * stubbed. Its routing and token logic are unit-tested separately; what this
 * proves is the wiring — which keystrokes reach the network and which don't.
 */

const FN_GLOB = '**/functions/v1/review-public';

test.describe('public review page star control', () => {
  test('arrow keys preview, Enter commits exactly one rating', async ({ page }) => {
    const rateBodies: any[] = [];

    await page.route(FN_GLOB, async (route) => {
      const body = route.request().postDataJSON();
      if (body.action === 'page') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            restaurant_name: 'Test Diner',
            headline: 'How was everything?',
            subheadline: null,
            logo_url: null,
            threshold: 4,
          }),
        });
      }
      if (body.action === 'rate') {
        rateBodies.push(body);
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            token: 'stub-token',
            routed_to: 'destination',
            destination_url: 'https://example.com/google-review',
          }),
        });
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
    });

    await page.goto('/r/table-tents');

    const group = page.getByRole('radiogroup', { name: /rate your visit/i });
    await expect(group).toBeVisible({ timeout: 10000 });

    await page.getByRole('radio', { name: '1 out of 5 stars' }).focus();
    for (let i = 0; i < 4; i++) {
      await page.keyboard.press('ArrowRight');
    }

    // Focus has walked to star 5 and the preview says so...
    await expect(page.getByRole('radio', { name: '5 out of 5 stars' })).toBeFocused();
    // ...and not one byte has gone to the server.
    expect(rateBodies).toHaveLength(0);

    await page.keyboard.press('Enter');

    await expect(page.getByRole('heading', { name: /thank you/i })).toBeVisible();
    expect(rateBodies).toHaveLength(1);
    expect(rateBodies[0]).toMatchObject({ action: 'rate', rating: 5, slug: 'table-tents' });
  });

  test('a promoter sees a Google button that is never followed automatically', async ({ page }) => {
    await page.route(FN_GLOB, async (route) => {
      const body = route.request().postDataJSON();
      if (body.action === 'page') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            restaurant_name: 'Test Diner',
            headline: 'How was everything?',
            subheadline: null,
            logo_url: null,
            threshold: 4,
          }),
        });
      }
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          token: 'stub-token',
          routed_to: 'destination',
          destination_url: 'https://example.com/google-review',
        }),
      });
    });

    await page.goto('/r/table-tents');
    await page.getByRole('radio', { name: '5 out of 5 stars' }).click();

    const link = page.getByRole('link', { name: /leave a google review/i });
    await expect(link).toHaveAttribute('href', 'https://example.com/google-review');
    await expect(link).toHaveAttribute('rel', /noopener/);
    // Still on our page: the guest chooses to leave, we never send them.
    expect(page.url()).toContain('/r/table-tents');
    await expect(page.getByRole('button', { name: /no thanks/i })).toBeVisible();
  });
});
