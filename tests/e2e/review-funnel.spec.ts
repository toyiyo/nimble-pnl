import { test, expect } from '@playwright/test';
import { signUpAndCreateRestaurant, generateTestUser } from '../helpers/e2e-supabase';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * E2E: an owner builds a review page, a guest leaves private feedback on it,
 * and the owner works the note in the inbox.
 *
 * The page is created for real through the builder — `review_pages` is
 * writable by a manager under RLS. `review_responses` is not: only the
 * service role inserts there, which is exactly the isolation Task 2 buys.
 * The inbox half therefore serves its row from an intercepted PostgREST read
 * and asserts the status write on the wire, where the tenant filter is
 * visible. The guest half stubs `review-public`, which the e2e stack does not
 * serve.
 */

const FN_GLOB = '**/functions/v1/review-public';

test('owner creates a page, a guest comments, the owner resolves it', async ({ page, browser }) => {
  const user = generateTestUser('reviews');
  await signUpAndCreateRestaurant(page, user);

  // `__getRestaurantId` is a test-only hook the app exposes on `window`, not
  // part of any typed global — hence the `any` cast.
  const restaurantId = await page.evaluate(() => (window as any).__getRestaurantId());
  expect(restaurantId).toBeTruthy();

  await page.goto('/reviews');
  await expect(page.getByRole('heading', { name: 'Reviews' })).toBeVisible({ timeout: 10000 });

  await page.getByRole('button', { name: /new page/i }).first().click();

  const pageName = `Table tents ${Date.now()}`;
  await page.getByLabel(/^name$/i).fill(pageName);

  const slug = await page.getByLabel(/public link/i).inputValue();
  expect(slug).toMatch(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/);

  await page.getByLabel(/google review link/i).fill('https://example.com/google-review');
  await page.getByRole('button', { name: /create page/i }).click();

  // The card now exists, live, with the slug the guest will scan. Scoped to
  // the list card specifically: the builder stays open in the other pane
  // after creation (this is a split view, not a modal) and its own "Live"
  // switch label would otherwise make `getByText('Live')` ambiguous.
  const card = page.getByRole('button', { name: pageName });
  await expect(card).toBeVisible({ timeout: 10000 });
  await expect(card.getByText(`/r/${slug}`)).toBeVisible();
  await expect(card.getByText('Live', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: /qr code/i }).click();
  await expect(page.getByRole('button', { name: /download qr code as svg/i })).toBeEnabled({
    timeout: 10000,
  });
  await page.keyboard.press('Escape');

  // A guest, in their own browser context — no session, no app chrome.
  const guestContext = await browser.newContext();
  const guest = await guestContext.newPage();

  const commentBodies: any[] = [];
  await guest.route(FN_GLOB, async (route) => {
    const body = route.request().postDataJSON();
    if (body.action === 'page') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          restaurant_name: user.restaurantName,
          headline: 'How was everything?',
          subheadline: null,
          logo_url: null,
          threshold: 4,
        }),
      });
    }
    if (body.action === 'rate') {
      // Two stars is below the threshold: the server routes to feedback and
      // withholds the destination URL entirely.
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ token: 'stub-token', routed_to: 'feedback' }),
      });
    }
    commentBodies.push(body);
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
  });

  await guest.goto(`/r/${slug}`);
  await guest.getByRole('radio', { name: '2 out of 5 stars' }).click();

  await expect(guest.getByRole('heading', { name: /what happened/i })).toBeVisible();
  // Anchored: an sr-only live-region paragraph elsewhere on the page also
  // contains "straight to the owner", which would otherwise make this
  // ambiguous. This targets the visible micro-copy specifically.
  await expect(guest.getByText(/^this goes straight to the owner/i)).toBeVisible();
  // No Google link on this branch, at all.
  await expect(guest.getByRole('link', { name: /google/i })).toHaveCount(0);

  await guest.getByLabel(/your feedback/i).fill('The wait was long and nobody said anything.');
  await guest.getByRole('button', { name: /send to the owner/i }).click();

  await expect(guest.getByRole('heading', { name: /thanks for telling us/i })).toBeVisible();
  expect(commentBodies).toHaveLength(1);
  expect(commentBodies[0]).toMatchObject({
    action: 'comment',
    token: 'stub-token',
    consent: false,
  });
  expect(commentBodies[0].comment).toContain('The wait was long');
  // Consent was never given, so no contact details left the browser.
  expect(commentBodies[0].name).toBeUndefined();
  expect(commentBodies[0].email).toBeUndefined();

  await guestContext.close();

  const responseId = '11111111-1111-4111-8111-111111111111';
  let statusPatchUrl: string | null = null;

  await page.route('**/rest/v1/review_responses*', async (route) => {
    if (route.request().method() === 'PATCH') {
      statusPatchUrl = route.request().url();
      return route.fulfill({ status: 204, body: '' });
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        {
          id: responseId,
          restaurant_id: restaurantId,
          review_page_id: null,
          rating: 2,
          routed_to: 'feedback',
          comment: 'The wait was long and nobody said anything.',
          contact_consent: false,
          status: 'new',
          submitted_at: new Date().toISOString(),
          commented_at: new Date().toISOString(),
        },
      ]),
    });
  });

  await page.reload();
  // Scoped to #root: a third-party survey widget injects its own
  // "Feedback" tab outside the app root, which would otherwise make this
  // ambiguous.
  await page.locator('#root').getByRole('button', { name: 'Feedback' }).click();

  // Exactly one row: silent ratings never reach this list.
  const rows = page.getByRole('button').filter({ hasText: 'The wait was long' });
  await expect(rows).toHaveCount(1);
  await rows.first().click();

  await expect(page.getByText('The wait was long and nobody said anything.').last()).toBeVisible();

  await page.getByRole('combobox', { name: /feedback status/i }).click();
  await page.getByRole('option', { name: 'Resolved' }).click();

  await expect.poll(() => statusPatchUrl, { timeout: 10000 }).not.toBeNull();
  // The tenant filter is on the wire, not merely trusted to RLS.
  expect(statusPatchUrl!).toContain(`id=eq.${responseId}`);
  expect(statusPatchUrl!).toContain(`restaurant_id=eq.${restaurantId}`);
});
