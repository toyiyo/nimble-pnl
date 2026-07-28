import { test, expect } from '@playwright/test';
import { signUpAndCreateRestaurant, generateTestUser, exposeSupabaseHelpers } from '../helpers/e2e-supabase';

/**
 * E2E: POS item dropdown (Recipe dialog)
 *
 * Design: docs/superpowers/specs/2026-07-28-pos-items-truncation-and-scroll-design.md
 *
 * Bug 2 — the dropdown could not be scrolled with a mouse wheel or trackpad
 * because the Popover portals outside the Dialog's react-remove-scroll
 * shard, which cancels every wheel tick over the portalled content (see
 * design doc "Root cause 2"). jsdom implements neither real layout nor a
 * real non-passive native wheel listener, so this is the only place the
 * fix is provable — a Vitest unit test can only assert the resolved
 * `modal` prop, not that the browser actually lets the list scroll.
 */

const SALE_DATE = '2026-07-01';

/** Seed enough distinct POS items that the dropdown's CommandList overflows
 * its `max-h-72` (288px) box and becomes genuinely scrollable. */
async function seedPosItems(page: import('@playwright/test').Page, count: number) {
  await page.evaluate(
    async ({ count, saleDate }) => {
      const supabase = (window as any).__supabase;
      const restaurantId = await (window as any).__getRestaurantId();

      const rows = Array.from({ length: count }, (_, i) => ({
        restaurant_id: restaurantId,
        pos_system: 'test',
        external_order_id: `wheel-scroll-order-${i}`,
        item_name: `Wheel Scroll Item ${String(i).padStart(3, '0')}`,
        quantity: 1,
        total_price: 10,
        sale_date: saleDate,
      }));

      const { error } = await supabase.from('unified_sales').insert(rows);
      if (error) throw new Error(error.message);
    },
    { count, saleDate: SALE_DATE },
  );
}

/**
 * Bug 1 — `usePOSItems` issued two unbounded selects (no `.limit()`, no
 * `.order()`) and aggregated the results in the browser. PostgREST caps an
 * unbounded response at 1000 rows and still returns HTTP 200, so the old
 * code silently aggregated over an arbitrary 1000-row window instead of the
 * tenant's whole catalogue (see design doc "Root cause 1"). This seeds 1000
 * decoy sale rows first, then a handful more for a distinct item -- so that
 * item's contributing rows land strictly outside the first 1000 rows of the
 * table -- and asserts `search_pos_items` still surfaces it (with its true
 * sales count) when its name is typed into the dropdown.
 */
async function seedItemBeyondRow1000(page: import('@playwright/test').Page) {
  await page.evaluate(
    async ({ saleDate }) => {
      const supabase = (window as any).__supabase;
      const restaurantId = await (window as any).__getRestaurantId();

      // 1000 decoy rows for a single common item, inserted (and therefore
      // occupying table rows) before the target item's rows.
      const decoyRows = Array.from({ length: 1000 }, (_, i) => ({
        restaurant_id: restaurantId,
        pos_system: 'test',
        external_order_id: `row-1000-decoy-${i}`,
        item_name: 'Common Decoy Item',
        quantity: 1,
        total_price: 10,
        sale_date: saleDate,
      }));

      // Insert in batches -- a single 1000-row request risks hitting a
      // request-size/timeout ceiling that has nothing to do with what this
      // test is proving.
      const BATCH = 250;
      for (let i = 0; i < decoyRows.length; i += BATCH) {
        const { error } = await supabase.from('unified_sales').insert(decoyRows.slice(i, i + BATCH));
        if (error) throw new Error(error.message);
      }

      // The target item's 5 sale rows are inserted last, i.e. strictly
      // outside the first-1000-row window the pre-fix client code read.
      const targetRows = Array.from({ length: 5 }, (_, i) => ({
        restaurant_id: restaurantId,
        pos_system: 'test',
        external_order_id: `row-1000-target-${i}`,
        item_name: 'Rare Item Past Row 1000',
        quantity: 1,
        total_price: 10,
        sale_date: saleDate,
      }));

      const { error: targetError } = await supabase.from('unified_sales').insert(targetRows);
      if (targetError) throw new Error(targetError.message);
    },
    { saleDate: SALE_DATE },
  );
}

test.describe('POS Item Dropdown', () => {
  test('surfaces an item outside the first 1000 sale rows when its name is typed', async ({ page }) => {
    const user = generateTestUser('pos-item-1000');
    await signUpAndCreateRestaurant(page, user);
    await exposeSupabaseHelpers(page);

    await seedItemBeyondRow1000(page);

    await page.goto('/recipes');
    await page.getByRole('button', { name: 'Create new recipe' }).click();

    const dialog = page.getByRole('dialog', { name: /create new recipe/i });
    await expect(dialog).toBeVisible({ timeout: 10000 });

    const posItemCombobox = dialog.getByRole('combobox').filter({ hasText: 'Search POS items or leave blank' });
    await expect(posItemCombobox).toBeVisible({ timeout: 15000 });
    await posItemCombobox.click();

    const listbox = page.getByRole('listbox');
    await expect(listbox).toBeVisible({ timeout: 5000 });

    // Type the target item's name. RecipeDialog owns a 250ms debounce
    // before this reaches search_pos_items (Task 3c), so the assertion
    // below needs to tolerate that plus a real network round-trip.
    const searchInput = page.getByPlaceholder('Search POS items...');
    await searchInput.fill('Rare Item Past Row 1000');

    const targetOption = page.getByRole('option', { name: /Rare Item Past Row 1000/i });
    await expect(targetOption).toBeVisible({ timeout: 10000 });
    // Proves the RPC aggregated all 5 of the target's rows, not a
    // truncated subset -- the specific failure mode of the old 1000-row
    // cap bug (a partially-visible window would under-report this count,
    // or the item could be missing from the result entirely).
    await expect(targetOption).toContainText('5 sales');
  });

  test('scrolls with a mouse wheel inside the Recipe dialog', async ({ page }) => {
    const user = generateTestUser('pos-item-scroll');
    await signUpAndCreateRestaurant(page, user);
    await exposeSupabaseHelpers(page);

    // 40 distinct items comfortably overflows the 288px CommandList box.
    await seedPosItems(page, 40);

    await page.goto('/recipes');
    await page.getByRole('button', { name: 'Create new recipe' }).click();

    const dialog = page.getByRole('dialog', { name: /create new recipe/i });
    await expect(dialog).toBeVisible({ timeout: 10000 });

    // Open the POS item combobox. `FormControl`'s Slot never lands its id
    // on this custom component's Button (SearchablePOSItemSelector doesn't
    // forward it), so there is no label association to key an accessible
    // name off of — match on rendered text content instead, same pattern
    // as the other Searchable*Selector combobox locators in this suite
    // (e.g. tests/e2e/prep-production.spec.ts). The button reads "Loading
    // POS items..." until the seeded rows come back from
    // search_pos_items, so wait for the settled label before clicking.
    const posItemCombobox = dialog.getByRole('combobox').filter({ hasText: 'Search POS items or leave blank' });
    await expect(posItemCombobox).toBeVisible({ timeout: 15000 });
    await posItemCombobox.click();

    // The Popover's content is exactly what root cause 2 is about: it
    // portals to `document.body`, so it is a *sibling* of the Recipe
    // dialog in the accessibility tree, not a descendant — `dialog.getByRole`
    // would never find it. Query the page directly; the listbox is unique
    // while the dropdown is open.
    const listbox = page.getByRole('listbox');
    await expect(listbox).toBeVisible({ timeout: 5000 });

    // Sanity check: the list must actually overflow, or a scrollTop
    // assertion below would pass vacuously (nothing to scroll).
    const isScrollable = await listbox.evaluate((el) => el.scrollHeight > el.clientHeight);
    expect(isScrollable).toBe(true);

    const scrollTopBefore = await listbox.evaluate((el) => el.scrollTop);
    expect(scrollTopBefore).toBe(0);

    // A real, trusted wheel input — not element.dispatchEvent(new
    // WheelEvent(...)), which browsers do not translate into native
    // scrolling for untrusted events. This is the only tool that exercises
    // the actual bug: a bubble-phase, non-passive `wheel` listener on
    // `document` (react-remove-scroll's shard check) that swallows the
    // event before the browser's default scroll action runs.
    await listbox.hover();
    await page.mouse.wheel(0, 400);

    await expect
      .poll(async () => listbox.evaluate((el) => el.scrollTop), {
        message: 'CommandList scrollTop should advance after a wheel event',
        timeout: 5000,
      })
      .toBeGreaterThan(0);
  });
});
