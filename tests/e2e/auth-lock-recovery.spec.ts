import { test, expect, type BrowserContext, type Page } from '@playwright/test';

import { generateTestUser } from '../helpers/e2e-supabase';

// The test Supabase URL. Playwright loads .env.local through Vite, so use the same default.
const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'http://127.0.0.1:54321';

// Same rule as supabase-js: lock:sb-<first hostname label>-auth-token.
const LOCK_NAME = `lock:sb-${new URL(SUPABASE_URL).hostname.split('.')[0]}-auth-token`;

const HOLDER_PATH = '/__auth-lock-holder.html';

/**
 * Hold the auth lock from a blank page on the app origin.
 * Do not load the app in this page. The app would steal the lock.
 */
async function holdAuthLock(context: BrowserContext, baseURL: string): Promise<Page> {
  await context.route(`**${HOLDER_PATH}`, (route) =>
    route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>holder</title>' }),
  );
  const holder = await context.newPage();
  await holder.goto(new URL(HOLDER_PATH, baseURL).toString());
  // The promise never settles. Do not await it.
  await holder.evaluate((name) => {
    void navigator.locks.request(name, () => new Promise<void>(() => {}));
  }, LOCK_NAME);
  // Check that the holder owns the lock.
  await expect
    .poll(() =>
      holder.evaluate(
        async (name) => (await navigator.locks.query()).held?.some((l) => l.name === name) ?? false,
        LOCK_NAME,
      ),
    )
    .toBe(true);
  return holder;
}

function collectWarnings(page: Page): string[] {
  const warnings: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'warning') warnings.push(msg.text());
  });
  return warnings;
}

test.describe('auth lock recovery', () => {
  test('a page with no session recovers from a stuck auth lock', async ({ context, baseURL }) => {
    await holdAuthLock(context, baseURL as string);

    const page = await context.newPage();
    const warnings = collectWarnings(page);
    await page.goto('/');

    await expect(page.getByText('Initializing...')).toBeVisible();
    await expect(page.getByText('Initializing...')).toBeHidden({ timeout: 20_000 });
    await expect(page).toHaveURL(/\/auth/);
    expect(warnings.some((w) => w.includes('[authLock]') && w.includes('Stealing the lock'))).toBe(
      true,
    );
  });

  test('a page with a session stays logged in after a stuck auth lock', async ({
    context,
    baseURL,
  }) => {
    // Create a session in storage. The context shares localStorage for the origin.
    const setup = await context.newPage();
    const user = generateTestUser('lockrec');
    await setup.goto('/auth');
    await setup.getByRole('tab', { name: /sign up/i }).click();
    await setup.getByLabel(/email/i).first().fill(user.email);
    await setup.getByLabel(/full name/i).fill(user.fullName);
    await setup.getByLabel(/password/i).first().fill(user.password);
    await setup.getByRole('button', { name: /sign up|create account/i }).click();
    await setup.waitForURL('/', { timeout: 15_000 });
    await setup.close();

    await holdAuthLock(context, baseURL as string);

    const page = await context.newPage();
    const warnings = collectWarnings(page);
    await page.goto('/');

    await expect(page.getByText('Initializing...')).toBeVisible();
    await expect(page.getByText('Initializing...')).toBeHidden({ timeout: 20_000 });
    await expect(page).not.toHaveURL(/\/auth/);
    expect(warnings.some((w) => w.includes('[authLock]') && w.includes('Stealing the lock'))).toBe(
      true,
    );
  });
});
