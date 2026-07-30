import { test, expect } from '@playwright/test';
import { signUpAndCreateRestaurant, generateTestUser, exposeSupabaseHelpers } from '../helpers/e2e-supabase';

interface WindowHelpers {
  __supabase: {
    from: (table: string) => {
      insert: (rows: unknown[]) => Promise<{ error: { message: string } | null }>;
    };
  };
  __getRestaurantId: (userId?: string) => Promise<string | null>;
}

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
      const win = window as unknown as WindowHelpers;
      const supabase = win.__supabase;
      const restaurantId = await win.__getRestaurantId();

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
      const win = window as unknown as WindowHelpers;
      const supabase = win.__supabase;
      const restaurantId = await win.__getRestaurantId();

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

/**
 * Poll until `locator`'s centre point is genuinely hit-testable, rather than assuming that a
 * closed overlay means the rest of the page can receive pointer input again. Radix's nested-
 * layer teardown (releasing focus traps / pointer-events locks) happens asynchronously after
 * a layer's `open` state flips, so `toBeVisible()` going false on the listbox does NOT by
 * itself prove the page is interactive again -- see the [2026-07-22] lesson (documented for a
 * *single* Dialog's async close teardown) and design doc §"Test strategy"/"Risks": this specific
 * nested-Popover-in-Dialog case has no prior-incident coverage, so it must be asserted via
 * `document.elementFromPoint`, never inferred from visibility or a sleep.
 */
async function waitUntilHitTestable(locator: import('@playwright/test').Locator) {
  await expect(async () => {
    const reachable = await locator.evaluate((el) => {
      const rect = el.getBoundingClientRect();
      const x = rect.x + rect.width / 2;
      const y = rect.y + rect.height / 2;
      const target = document.elementFromPoint(x, y);
      return !!target && (el === target || el.contains(target) || target.contains(el));
    });
    if (!reachable) {
      throw new Error('element is not hit-testable yet (stranded pointer-events/focus lock?)');
    }
  }).toPass({ timeout: 5000 });
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

  /**
   * Bug 2's fix (Task 4) makes the Popover's `modal` prop context-driven: `true` inside a
   * Dialog, `false` free-standing. Design §4 states four acceptance criteria for what that
   * nested modal-Popover-in-modal-Dialog combination must do, tracing each to Radix's layer
   * source. This is the only place those criteria are provable -- they depend on Radix's real
   * runtime layer stack (`DismissableLayer`'s shared `branches` set, `FocusScope`'s trap/auto-
   * focus, the browser's real `document.elementFromPoint` hit-testing), none of which jsdom
   * reproduces.
   */
  test('nested overlay: Escape closes only the popover, an outside click does not dismiss the Recipe dialog, focus returns to the trigger, and the body stays interactive', async ({
    page,
  }) => {
    const user = generateTestUser('pos-item-nested');
    await signUpAndCreateRestaurant(page, user);
    await exposeSupabaseHelpers(page);

    await seedPosItems(page, 5);

    await page.goto('/recipes');
    await page.getByRole('button', { name: 'Create new recipe' }).click();

    const dialog = page.getByRole('dialog', { name: /create new recipe/i });
    await expect(dialog).toBeVisible({ timeout: 10000 });

    const posItemCombobox = dialog.getByRole('combobox').filter({ hasText: 'Search POS items or leave blank' });
    await expect(posItemCombobox).toBeVisible({ timeout: 15000 });
    await posItemCombobox.click();

    const listbox = page.getByRole('listbox');
    await expect(listbox).toBeVisible({ timeout: 5000 });

    // While the modal Popover is open, Radix's `hideOthers` (called from
    // `PopoverContentModal`'s own mount effect, independent of the `DismissableLayer`
    // mechanics §4 cites) marks the Dialog's portal root `aria-hidden="true"` -- confirmed by
    // instrumenting the DOM directly during this task. That is correct, standard nested-modal
    // stacking (only the topmost active modal should be exposed to assistive tech at a time,
    // matching how Select-in-Dialog already behaves), not the Dialog being dismissed: it stays
    // mounted with `data-state="open"` and visually on screen the whole time. `getByRole`
    // deliberately excludes `aria-hidden` subtrees (that's what makes it accessibility-tree
    // aware), so asserting `dialog` (a role locator) while the Popover is still open would
    // read a correct accessibility side effect as a false "dismissed" failure. Use a plain
    // text locator instead here -- it matches on rendered text/CSS visibility, not the pruned
    // accessibility tree -- to prove the Dialog is still literally on screen.
    const dialogTitleText = page.getByText('Create New Recipe', { exact: true });

    // --- Criterion: outside click does not dismiss the Dialog ---
    // `PopoverContent` portals to `document.body` (design "Root cause 2"), so it is a
    // *sibling* of the Recipe dialog in the DOM, not a descendant. A click anywhere inside it
    // therefore lands outside `DialogContent`'s own subtree, and would look like an "outside
    // click" to the Dialog's own dismiss detection -- unless Radix's shared `branches` set
    // correctly excludes it (design §4: "the same mechanism that already makes
    // Select-in-Dialog work today"). Click the popover's own search input: it is inside the
    // Popover (so this should not close the Popover either) but is a real click on a sibling
    // DOM node of the Dialog.
    const searchInput = page.getByPlaceholder('Search POS items...');
    await searchInput.click();
    await expect(listbox).toBeVisible();
    await expect(dialogTitleText).toBeVisible();

    // --- Criterion: Escape dismisses only the Popover, not the Dialog ---
    // Radix's `DismissableLayer` picks the highest layer by index, and the Popover mounts
    // after the Dialog, so only the Popover should respond to this Escape.
    await page.keyboard.press('Escape');
    await expect(listbox).not.toBeVisible({ timeout: 5000 });
    // The Dialog is exposed to the accessibility tree again now that the nested modal Popover
    // has unmounted and released its `hideOthers` lock -- a *dismissed* Dialog could never
    // satisfy a role-based query again without re-opening it, so this is the proof (not just
    // the plain-text one above) that the Dialog was never actually closed by any of this.
    await expect(dialog).toBeVisible({ timeout: 5000 });

    // --- Criterion: focus returns to the Popover trigger on close ---
    // `PopoverContentModal.onCloseAutoFocus` composes with the Dialog's `FocusScope` because
    // the trigger is inside the Dialog's trapped subtree.
    await expect(posItemCombobox).toBeFocused({ timeout: 5000 });

    // --- Criterion: `pointer-events: none` is not stranded on <body> ---
    // The Popover's layer count is a shared set whose original `pointer-events` value is
    // captured only on the 0->1 transition, so a Popover mounting under an already-open Dialog
    // should not stomp it when the Popover unmounts. Prove the rest of the Dialog can still be
    // clicked and typed into -- gated on `document.elementFromPoint`, per the [2026-07-22]
    // lesson, rather than inferred from the listbox's visibility already having gone false
    // above (that only proves the Popover's own state flipped, not that the DOM-level lock
    // finished tearing down).
    const nameInput = dialog.getByPlaceholder('e.g., Margarita');
    await waitUntilHitTestable(nameInput);
    await nameInput.fill('Nested Overlay Regression Check');
    await expect(nameInput).toHaveValue('Nested Overlay Regression Check');
  });

  /**
   * Mobile-viewport re-run of the wheel-scroll assertion above, per design §"Test
   * strategy" / design-review finding F5: removing the two dead CSS rules
   * (`overscroll-contain`, `WebkitOverflowScrolling` — Task 3b) needed "a real
   * mobile-viewport check in the E2E rather than an assumption".
   *
   * `-webkit-overflow-scrolling` only ever affected WebKit/iOS Safari's own rendering,
   * and this repo's `e2e` Playwright project runs Chromium (`devices['Desktop
   * Chrome']`), so this cannot exercise that CSS property's browser-specific behaviour
   * directly. What it *can* and does prove: at a real narrow viewport — below the 768px
   * breakpoint this codebase already switches layout on elsewhere (e.g.
   * `Transactions.tsx`'s `TransactionCard` list, Task 5d) — the dropdown still scrolls
   * with a wheel input after that CSS was removed, and the context-driven `modal` fix
   * (Task 4) still resolves correctly once the Recipe dialog's own responsive layout
   * kicks in.
   *
   * The viewport is resized *after* `signUpAndCreateRestaurant`, not via `test.use()`
   * up front (same ordering as the free-standing regression guard's `setViewportSize`
   * call, Task 5d): `OnboardingDrawer` (`src/components/dashboard/OnboardingDrawer.tsx`)
   * renders a fixed, non-modal 400px-wide `Sheet` docked to the right the moment a new
   * user lands post-signup, before any restaurant exists. Below ~400px of viewport width
   * that panel has nowhere to go and physically covers the "Add Restaurant" button the
   * signup helper needs to click, hanging the whole test on an unrelated pre-existing
   * flow issue that has nothing to do with bug 2. Running signup at the default desktop
   * viewport sidesteps it — the helper's own drawer-dismiss step
   * (`tests/helpers/e2e-supabase.ts:731-743`) then closes the drawer and persists
   * `onboarding_drawer_dismissed` in `localStorage` before the viewport ever narrows.
   */
  test.describe('mobile viewport', () => {
    test('scrolls with a wheel input inside the Recipe dialog at a mobile viewport', async ({ page }) => {
      const user = generateTestUser('pos-item-mobile');
      await signUpAndCreateRestaurant(page, user);
      await exposeSupabaseHelpers(page);

      // Same overflow trigger as the desktop wheel-scroll test above.
      await seedPosItems(page, 40);

      // Narrow to a real mobile-sized viewport now that signup/onboarding-drawer
      // dismissal (both viewport-sensitive, see comment above) are already done.
      await page.setViewportSize({ width: 390, height: 844 });

      await page.goto('/recipes');
      await page.getByRole('button', { name: 'Create new recipe' }).click();

      const dialog = page.getByRole('dialog', { name: /create new recipe/i });
      await expect(dialog).toBeVisible({ timeout: 10000 });

      const posItemCombobox = dialog.getByRole('combobox').filter({ hasText: 'Search POS items or leave blank' });
      await expect(posItemCombobox).toBeVisible({ timeout: 15000 });
      await posItemCombobox.click();

      // Still portals to document.body at a mobile viewport — same root cause 2 as the
      // desktop test, so query the page directly rather than scoping to `dialog`.
      const listbox = page.getByRole('listbox');
      await expect(listbox).toBeVisible({ timeout: 5000 });

      const isScrollable = await listbox.evaluate((el) => el.scrollHeight > el.clientHeight);
      expect(isScrollable).toBe(true);

      const scrollTopBefore = await listbox.evaluate((el) => el.scrollTop);
      expect(scrollTopBefore).toBe(0);

      // Same trusted, real wheel input as the desktop assertion — the only tool that
      // exercises the actual bug (see the comment on the desktop test above).
      await listbox.hover();
      await page.mouse.wheel(0, 400);

      await expect
        .poll(async () => listbox.evaluate((el) => el.scrollTop), {
          message: 'CommandList scrollTop should advance after a wheel event at a mobile viewport',
          timeout: 5000,
        })
        .toBeGreaterThan(0);
    });
  });
});
