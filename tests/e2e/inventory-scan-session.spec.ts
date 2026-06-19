/* eslint-disable @typescript-eslint/no-explicit-any */
import { test, expect, Page } from '@playwright/test';
import { signUpAndCreateRestaurant, generateTestUser } from '../helpers/e2e-supabase';

/**
 * Escape a string for use in a RegExp so that product names with special
 * characters don't break pattern matching (lesson 2026-06-04).
 */
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Navigate to the Inventory page, open the Scanner tab, and select the
 * Camera Scanner type. Returns after the ScanSessionView is mounted
 * (i.e. the __emitScan bridge is available on window).
 */
async function goToCameraScanner(page: Page) {
  await page.goto('/inventory');
  await page.waitForURL(/\/inventory/);

  // Open the Scanner tab
  const scannerTab = page.getByRole('tab', { name: /scanner/i });
  await expect(scannerTab).toBeVisible({ timeout: 15000 });
  await scannerTab.click();

  // Select Camera Scanner type
  const cameraButton = page.getByRole('button', { name: /camera scanner/i });
  await expect(cameraButton).toBeVisible({ timeout: 10000 });
  await cameraButton.click();

  // Wait for the ScanSessionView to mount and expose the bridge
  await page.waitForFunction(() => typeof (window as any).__emitScan === 'function', {
    timeout: 10000,
  });
}

test.describe('Inventory scan session', () => {
  test('scan new item → fill form → confirm beat → scan next, no duplicate dialogs', async ({
    page,
  }) => {
    // Clear any stale auth state from a previous test run before enabling the bridge
    await page.context().clearCookies();
    await page.goto('/');
    await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });

    // Enable the E2E bridge before any page code runs
    await page.addInitScript(() => {
      (window as any).__E2E__ = true;
    });

    const user = generateTestUser('scan-session');
    await signUpAndCreateRestaurant(page, user);

    await goToCameraScanner(page);

    // ── Step 1: Emit a new-product scan (gtin not in DB) ──────────────────
    const newItemGtin = `0123456789${Date.now().toString().slice(-3)}`;
    await page.evaluate((gtin) => (window as any).__emitScan(gtin), newItemGtin);

    // The full-form dialog/sheet must appear (new product flow)
    const fullForm = page.getByRole('dialog').filter({ hasText: /update product/i });
    await expect(fullForm).toBeVisible({ timeout: 10000 });

    // ── Step 2: A second emit while the form is open must NOT open a duplicate ──
    await page.evaluate((gtin) => (window as any).__emitScan(gtin), newItemGtin);
    // Only one dialog/sheet should be visible
    await expect(page.getByRole('dialog')).toHaveCount(1);

    // ── Step 3: Fill required fields and save ──────────────────────────────
    const rand = Math.random().toString(36).slice(2, 6);
    const productName = `E2E Scan Product ${rand}`;
    const productSku = `SCAN-E2E-${rand}`;

    await fullForm.getByLabel(/sku \*/i).fill(productSku);
    await fullForm.getByLabel(/product name \*/i).fill(productName);

    await fullForm.getByRole('button', { name: /update product/i }).click();

    // ── Step 4: Confirm beat appears after successful save ─────────────────
    // Wait for the "Scan next item" button, which only appears on the confirm-beat overlay.
    const scanNextBtn = page.getByRole('button', { name: /scan next item/i });
    await expect(scanNextBtn).toBeVisible({ timeout: 15000 });
    // The visible badge in the overlay shows "{N} item[s] this session".
    // Use .first() since the sr-only aria-live region also contains this text.
    await expect(page.getByText(/items? this session/i).first()).toBeVisible({ timeout: 5000 });
    // Product name also appears in toast notifications; use .first() to avoid strict-mode violation.
    await expect(page.getByText(new RegExp(esc(productName), 'i')).first()).toBeVisible({
      timeout: 5000,
    });

    // ── Step 5: "Scan next item" returns to scanning state ─────────────────
    await scanNextBtn.click();

    // The confirm beat overlay is gone — "Scan next item" button should no longer be visible
    await expect(scanNextBtn).not.toBeVisible({ timeout: 5000 });

    // The bridge must still be live (the session is back in scanning state)
    await expect(
      page.waitForFunction(() => typeof (window as any).__emitScan === 'function', {
        timeout: 5000,
      }),
    ).resolves.toBeTruthy();
  });

  test('session counter increments on each save and Done cleans up', async ({ page }) => {
    // Clear any stale auth state from a previous test run before enabling the bridge
    await page.context().clearCookies();
    await page.goto('/');
    await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });

    await page.addInitScript(() => {
      (window as any).__E2E__ = true;
    });

    const user = generateTestUser('scan-counter');
    await signUpAndCreateRestaurant(page, user);

    await goToCameraScanner(page);

    // Initially 0 items added badge is visible
    await expect(page.getByText(/0 added/i)).toBeVisible({ timeout: 10000 });

    // ── Scan first new item and save ───────────────────────────────────────
    const gtin1 = `GTIN1${Date.now()}`;
    await page.evaluate((g) => (window as any).__emitScan(g), gtin1);

    const dialog1 = page.getByRole('dialog').filter({ hasText: /update product/i });
    await expect(dialog1).toBeVisible({ timeout: 10000 });

    const rand1 = Math.random().toString(36).slice(2, 6);
    await dialog1.getByLabel(/sku \*/i).fill(`SCAN-A-${rand1}`);
    await dialog1.getByLabel(/product name \*/i).fill(`E2E Item A ${rand1}`);
    await dialog1.getByRole('button', { name: /update product/i }).click();

    // Confirm beat shows 1 item — "Scan next item" button is the unique confirm-beat indicator.
    // The sr-only aria-live region also contains "1 item this session", so use .first() for
    // the badge, and wait for the button separately to avoid strict-mode violations.
    const scanNextBtn1 = page.getByRole('button', { name: /scan next item/i });
    await expect(scanNextBtn1).toBeVisible({ timeout: 15000 });
    await expect(page.getByText(/1 items? this session/i).first()).toBeVisible({ timeout: 5000 });
    await scanNextBtn1.click();

    // Badge updates to 1 added
    await expect(page.getByText(/1 added/i)).toBeVisible({ timeout: 5000 });

    // ── Done button ends the session and resets the badge to 0 ─────────────
    await page.getByRole('button', { name: /done scanning/i }).click();

    // After Done, the session resets the counter so the badge shows 0 again
    // (the tab stays on the scanner, but a fresh session starts with 0)
    await expect(page.getByText(/0 added/i)).toBeVisible({ timeout: 5000 });
  });
});
