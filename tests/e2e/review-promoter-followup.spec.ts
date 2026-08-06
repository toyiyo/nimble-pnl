import { test, expect } from '@playwright/test';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * E2E: a promoter can leave a comment, an email, or both.
 *
 * Slice 1 sent a four-star or five-star guest straight to the Google
 * hand-off, with no way back. This spec is the regression guard for the
 * three paths that hand-off must not close.
 *
 * The edge function is not served in the e2e stack, so `review-public` is
 * stubbed. Its token and routing logic are covered elsewhere; what this
 * proves is the wiring — which controls appear, and what the client sends.
 */

const FN_GLOB = '**/functions/v1/review-public';
const PAGE_BODY = {
  restaurant_name: 'Test Diner',
  headline: 'How was everything?',
  subheadline: null,
  logo_url: null,
  threshold: 4,
};
const RATE_BODY = {
  token: 'stub-token',
  routed_to: 'destination',
  destination_url: 'https://example.com/google-review',
};

/** Stubs the three actions and collects every `comment` body the page sends. */
async function stubReviewPublic(page: any, commentBodies: any[]) {
  await page.route(FN_GLOB, async (route: any) => {
    const body = route.request().postDataJSON();
    if (body.action === 'page') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(PAGE_BODY),
      });
    }
    if (body.action === 'rate') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(RATE_BODY),
      });
    }
    commentBodies.push(body);
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
  });
}

test.describe('public review page promoter follow-up', () => {
  test('a promoter reaches the form and returns with the text kept', async ({ page }) => {
    await stubReviewPublic(page, []);
    await page.goto('/r/table-tents');

    await page.getByRole('radio', { name: '5 out of 5 stars' }).click();
    await expect(page.getByRole('heading', { name: /thank you/i })).toBeVisible();

    await page.getByRole('button', { name: /tell us something directly/i }).click();

    // The heading follows the branch: `What happened?` reads as an
    // accusation in front of a five-star guest.
    await expect(page.getByRole('heading', { name: /tell us more/i })).toBeVisible();
    const field = page.getByLabel(/your feedback \(optional\)/i);
    await field.fill('The bread was excellent');

    await page.getByRole('button', { name: /^back$/i }).click();
    await expect(page.getByRole('link', { name: /leave a google review/i })).toBeVisible();

    await page.getByRole('button', { name: /tell us something directly/i }).click();
    await expect(page.getByLabel(/your feedback \(optional\)/i)).toHaveValue(
      'The bread was excellent'
    );
  });

  test('a promoter sends a comment and still sees the Google button', async ({ page }) => {
    const commentBodies: any[] = [];
    await stubReviewPublic(page, commentBodies);
    await page.goto('/r/table-tents');

    await page.getByRole('radio', { name: '5 out of 5 stars' }).click();
    await page.getByRole('button', { name: /tell us something directly/i }).click();
    await page.getByLabel(/your feedback \(optional\)/i).fill('The bread was excellent');
    await page.getByRole('button', { name: /send to the owner/i }).click();

    await expect(page.getByRole('heading', { name: /thanks for telling us/i })).toBeVisible();
    expect(commentBodies).toHaveLength(1);
    expect(commentBodies[0]).toMatchObject({
      action: 'comment',
      token: 'stub-token',
      comment: 'The bread was excellent',
    });

    // A comment must not cost the restaurant a Google review.
    const link = page.getByRole('link', { name: /leave a google review/i });
    await expect(link).toHaveAttribute('href', 'https://example.com/google-review');
  });

  test('a promoter sends an email with no comment', async ({ page }) => {
    const commentBodies: any[] = [];
    await stubReviewPublic(page, commentBodies);
    await page.goto('/r/table-tents');

    await page.getByRole('radio', { name: '5 out of 5 stars' }).click();
    await page.getByRole('button', { name: /tell us something directly/i }).click();

    const send = page.getByRole('button', { name: /send to the owner/i });
    // An empty form writes nothing, so the control stays disabled.
    await expect(send).toBeDisabled();

    await page.getByLabel(/it's ok to contact me about this/i).check();
    await page.getByLabel(/^email$/i).fill('ada@example.com');
    await expect(send).toBeEnabled();
    await send.click();

    await expect(page.getByRole('heading', { name: /thanks for telling us/i })).toBeVisible();
    expect(commentBodies).toHaveLength(1);
    // No empty string. An empty comment would store as a blank inbox row.
    expect(commentBodies[0].comment).toBeUndefined();
    expect(commentBodies[0]).toMatchObject({ consent: true, email: 'ada@example.com' });
  });
});
