import { test, expect, type Page } from '@playwright/test';

/**
 * E2E: the public review page tells the truth about why it didn't load.
 *
 * A missing edge-function secret once made `review-public` 500 on every call,
 * and the page rendered "This link isn't active" — so the owner spent the
 * outage toggling `is_active` on a page that was already live. These specs
 * pin the two answers apart.
 *
 * `review-public` is not served in the e2e stack, so the route is stubbed,
 * following the pattern in `review-stars.spec.ts`.
 */

const FN_GLOB = '**/functions/v1/review-public';
const PAGE_URL = '/r/table-tents';

const GOOD_PAGE = {
  restaurant_name: 'Test Diner',
  headline: 'How was everything?',
  subheadline: null,
  logo_url: null,
  threshold: 4,
};

/** Stubs `review-public` with a body the caller controls per request. */
async function stubPage(page: Page, respond: (call: number) => { status: number; body: unknown }) {
  let calls = 0;
  await page.route(FN_GLOB, async (route) => {
    const request = route.request().postDataJSON();
    if (request.action !== 'page') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
    }
    const { status, body } = respond(++calls);
    return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  });
}

test.describe('public review page load states', () => {
  test('a 500 shows the error screen, not the paused screen, and retry recovers', async ({
    page,
  }) => {
    await stubPage(page, (call) =>
      call === 1
        ? { status: 500, body: { error: 'Server error' } }
        : { status: 200, body: GOOD_PAGE }
    );

    await page.goto(PAGE_URL);

    await expect(page.getByRole('heading', { name: /something went wrong/i })).toBeVisible({
      timeout: 10000,
    });
    // The lie this whole change exists to prevent.
    await expect(page.getByText(/isn't active/i)).toHaveCount(0);
    await expect(page.getByText(/that's on us, not you/i)).toBeVisible();

    await page.getByRole('button', { name: /try again/i }).click();

    await expect(page.getByRole('radiogroup', { name: /rate your visit/i })).toBeVisible();
    await expect(page.getByRole('heading', { name: /how was everything/i })).toBeVisible();
  });

  test('a second failure escalates the copy', async ({ page }) => {
    await stubPage(page, () => ({ status: 500, body: { error: 'Server error' } }));

    await page.goto(PAGE_URL);
    await expect(page.getByText(/that's on us, not you/i)).toBeVisible({ timeout: 10000 });

    await page.getByRole('button', { name: /try again/i }).click();

    await expect(page.getByText(/still not working/i)).toBeVisible();
    await expect(page.getByText(/that's on us, not you/i)).toHaveCount(0);
  });

  test('a genuinely paused page still shows the paused screen', async ({ page }) => {
    await stubPage(page, () => ({ status: 200, body: { inactive: true } }));

    await page.goto(PAGE_URL);

    await expect(page.getByRole('heading', { name: /isn't active/i })).toBeVisible({
      timeout: 10000,
    });
    await expect(page.getByText(/ask the restaurant for a current one/i)).toBeVisible();
    // No retry here: retrying a paused page would just pause again.
    await expect(page.getByRole('button', { name: /try again/i })).toHaveCount(0);
  });

  test('a 200 the page cannot render is an error, not a half-drawn card', async ({ page }) => {
    await stubPage(page, () => ({
      status: 200,
      body: { restaurant_name: 'Test Diner', threshold: 'four' },
    }));

    await page.goto(PAGE_URL);

    await expect(page.getByRole('heading', { name: /something went wrong/i })).toBeVisible({
      timeout: 10000,
    });
    await expect(page.getByRole('radiogroup')).toHaveCount(0);
  });
});
