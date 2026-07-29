import { test, expect, type Page } from '@playwright/test';
import { signUpAndCreateRestaurant, generateTestUser, exposeSupabaseHelpers } from '../helpers/e2e-supabase';

/**
 * E2E: free-standing regression guard (design doc "Test strategy",
 * plan Task 5 item 3).
 *
 * Design: docs/superpowers/specs/2026-07-28-pos-items-truncation-and-scroll-design.md
 *
 * The bug-2 fix makes every affected combobox's Radix `Popover` resolve
 * `modal={useInsideScrollLock()}` instead of a hardcoded value, so it can be
 * `true` inside a Dialog (the actual fix — bug 2) without also being `true`
 * for the same component's *free-standing* call sites, where `modal={true}`
 * would regress the page: Radix's `react-remove-scroll` shard locks the
 * whole document's scroll, and `hideOthers` marks every sibling
 * `aria-hidden`, whenever a modal Popover is open (design doc "Affected
 * components" / F1, the design-review finding that changed `modal` from a
 * hardcoded value to context-driven).
 *
 * `src/components/banking/SearchableAccountSelector.tsx` is rendered
 * free-standing (no Dialog/Sheet/AlertDialog ancestor) by
 * `TransactionCard.tsx:106` on the mobile-card layout of
 * `src/pages/Transactions.tsx` (design doc's "Affected components" table).
 * This is the free-standing site the design doc names explicitly for this
 * guard, so it — not the desktop `BankTransactionList` table view, whose
 * categorization opens inside a `Sheet` — is what this test exercises.
 */

const TRANSACTION_DATE = '2026-07-01';

/** Enough distinct bank transactions that the (unconstrained-height) page
 * overflows the viewport and genuinely has room to scroll -- otherwise a
 * scrollTop assertion below would pass vacuously with nothing to scroll. */
async function seedBankTransactions(page: Page, count: number) {
  await page.evaluate(
    async ({ count, date }) => {
      const supabase = (window as any).__supabase;
      const restaurantId = await (window as any).__getRestaurantId();

      const timestamp = Date.now();
      const random = crypto.randomUUID().slice(0, 8);

      const { data: bank, error: bankError } = await supabase
        .from('connected_banks')
        .insert({
          restaurant_id: restaurantId,
          institution_name: 'Free-Standing Scroll Test Bank',
          stripe_financial_account_id: `fca_freestanding_scroll_${timestamp}_${random}`,
          status: 'connected',
        })
        .select()
        .single();
      if (bankError) throw new Error(`Failed to create connected bank: ${bankError.message}`);

      const rows = Array.from({ length: count }, (_, i) => ({
        restaurant_id: restaurantId,
        connected_bank_id: bank.id,
        stripe_transaction_id: `txn_freestanding_scroll_${timestamp}_${random}_${i}`,
        transaction_date: date,
        description: `Free-Standing Scroll Test Transaction ${String(i).padStart(2, '0')}`,
        amount: -(10 + i),
      }));

      const { error: txError } = await supabase.from('bank_transactions').insert(rows);
      if (txError) throw new Error(`Failed to create transactions: ${txError.message}`);
    },
    { count, date: TRANSACTION_DATE },
  );
}

test.describe('Free-standing combobox scroll regression guard', () => {
  test('opening the category combobox on the Transactions page does not lock page scroll', async ({ page }) => {
    const user = generateTestUser('txn-scroll');
    await signUpAndCreateRestaurant(page, user);
    await exposeSupabaseHelpers(page);

    // 25 cards comfortably overflows any viewport height used below.
    await seedBankTransactions(page, 25);

    // Under the 768px mobile breakpoint (src/hooks/use-mobile.tsx) so
    // Transactions.tsx renders the mobile TransactionCard list (the
    // free-standing site) rather than the desktop BankTransactionList
    // table. Kept well above phone width so there's comfortable horizontal
    // room to find a point outside the open popover for the wheel event
    // below, without needing pixel-perfect geometry.
    await page.setViewportSize({ width: 700, height: 800 });

    await page.goto('/transactions');
    await expect(
      page.getByRole('heading', { name: 'Bank Transactions', level: 1 }),
    ).toBeVisible({ timeout: 15000 });

    const combobox = page.getByRole('combobox').filter({ hasText: 'Select category...' }).first();
    await expect(combobox).toBeVisible({ timeout: 15000 });
    await combobox.click();

    // Radix portals popper-positioned content (Popover included) into a
    // wrapper carrying this attribute -- confirmed at
    // node_modules/@radix-ui/react-popper/dist/index.js:177. Its bounding
    // box covers the whole open popover (search input + list), which is
    // what the wheel-point calculation below needs to steer clear of.
    const popoverWrapper = page.locator('[data-radix-popper-content-wrapper]');
    await expect(popoverWrapper).toBeVisible({ timeout: 5000 });
    await expect(page.getByPlaceholder('Search accounts...')).toBeVisible();

    const viewport = page.viewportSize();
    if (!viewport) throw new Error('viewport size unavailable');
    const box = await popoverWrapper.boundingBox();
    if (!box) throw new Error('popover bounding box unavailable');

    // Pick a point guaranteed to sit outside the open popover's box so the
    // wheel event actually lands on ordinary page content instead of the
    // list. (The list's own `onWheel` handler stops propagation so
    // scrolling *inside* it doesn't also scroll the page underneath --
    // intentional, unrelated behaviour this test must not trip over by
    // accidentally wheeling over the popover itself.) Computed rather than
    // hardcoded because the popover's on-screen position depends on where
    // Radix's collision detection placed the (first, therefore
    // scrolled-into-view) combobox trigger.
    let point: { x: number; y: number };
    if (box.x + box.width + 40 < viewport.width) {
      point = { x: box.x + box.width + 20, y: clamp(box.y + 20, 5, viewport.height - 5) };
    } else if (box.x - 40 > 0) {
      point = { x: clamp(box.x - 20, 5, viewport.width - 5), y: clamp(box.y + 20, 5, viewport.height - 5) };
    } else if (box.y - 40 > 0) {
      point = { x: 10, y: clamp(box.y - 20, 5, viewport.height - 5) };
    } else {
      point = { x: 10, y: clamp(box.y + box.height + 20, 5, viewport.height - 5) };
    }

    const scrollTop = () =>
      page.evaluate(() => document.scrollingElement?.scrollTop ?? window.scrollY ?? 0);
    const before = await scrollTop();

    // A real, trusted wheel input at a point outside the popover -- same
    // technique as the wheel-scroll assertion in pos-item-dropdown.spec.ts,
    // just aimed at the page instead of the list.
    await page.mouse.move(point.x, point.y);
    await page.mouse.wheel(0, 600);

    await expect
      .poll(scrollTop, {
        message: 'document should still scroll behind a free-standing (non-modal) combobox',
        timeout: 5000,
      })
      .toBeGreaterThan(before);

    // The popover itself is unaffected by the page having scrolled under
    // it -- it's still open and interactive. This rules out the page
    // having scrolled for an unrelated reason (e.g. the popover having
    // silently closed and released some other lock).
    await expect(page.getByPlaceholder('Search accounts...')).toBeVisible();
  });
});

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
