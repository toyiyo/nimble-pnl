import { test, expect, type Page } from '@playwright/test';
import { exposeSupabaseHelpers, generateTestUser, signUpAndCreateRestaurant } from '../helpers/e2e-supabase';

/**
 * End-to-end cover for the /recipes page-load rework: the page still shows the
 * numbers it used to, create/edit/delete still round-trip through the shared
 * React Query cache, a failed load reads as an outage, and — the actual point
 * of the change — the number of round trips no longer scales with the number
 * of recipes.
 */

type SeedRecipe = {
  name: string;
  posItemName?: string;
  estimatedCost?: number;
};

/** Just enough of the helpers exposeSupabaseHelpers puts on window to seed rows. */
type SeedWindow = typeof globalThis & {
  __supabase: {
    from: (table: string) => {
      insert: (rows: unknown) => Promise<{ error: { message: string } | null }>;
    };
  };
  __getAuthUser: () => Promise<{ id: string } | null>;
  __getRestaurantId: (userId: string) => Promise<string | null>;
};

/** Insert recipes (and optional sales for them) as the signed-in owner. */
const seedRecipes = (page: Page, recipes: SeedRecipe[], sales: { itemName: string; quantity: number; totalPrice: number }[] = []) =>
  page.evaluate(
    async ({ recipes, sales }) => {
      const seedWindow = window as SeedWindow;
      const supabase = seedWindow.__supabase;
      const user = await seedWindow.__getAuthUser();
      if (!user?.id) throw new Error('No user session');
      const restaurantId = await seedWindow.__getRestaurantId(user.id);
      if (!restaurantId) throw new Error('No restaurant');

      const { error: recipeError } = await supabase.from('recipes').insert(
        recipes.map((recipe) => ({
          restaurant_id: restaurantId,
          name: recipe.name,
          pos_item_name: recipe.posItemName ?? null,
          serving_size: 1,
          // No ingredients, so the page's cost calculation falls back to the
          // stored value and the background cost heal finds no drift to write.
          estimated_cost: recipe.estimatedCost ?? 0,
          is_active: true,
        }))
      );
      if (recipeError) throw new Error(recipeError.message);

      if (sales.length > 0) {
        const { error: salesError } = await supabase.from('unified_sales').insert(
          sales.map((sale) => ({
            restaurant_id: restaurantId,
            external_order_id: `recipes-perf-${crypto.randomUUID()}`,
            item_name: sale.itemName,
            quantity: sale.quantity,
            total_price: sale.totalPrice,
            unit_price: sale.totalPrice / sale.quantity,
            sale_date: new Date().toISOString().slice(0, 10),
            pos_system: 'manual',
          }))
        );
        if (salesError) throw new Error(salesError.message);
      }

      return restaurantId;
    },
    { recipes, sales }
  );

/** The recipe dialog requires at least one ingredient, so it needs a product. */
const seedProduct = (page: Page, name: string) =>
  page.evaluate(async (name) => {
    const seedWindow = window as SeedWindow;
    const user = await seedWindow.__getAuthUser();
    if (!user?.id) throw new Error('No user session');
    const restaurantId = await seedWindow.__getRestaurantId(user.id);
    const { error } = await seedWindow.__supabase.from('products').insert({
      restaurant_id: restaurantId,
      name,
      sku: `e2e-${crypto.randomUUID()}`,
      cost_per_unit: 1,
      uom_purchase: 'oz',
    });
    if (error) throw new Error(error.message);
  }, name);

test.describe('Recipes page load', () => {
  test('shows costs and margins, and create/edit/delete round-trip through the cache', async ({ page }) => {
    const user = generateTestUser('recipes-perf');
    await signUpAndCreateRestaurant(page, user);
    await page.goto('/recipes');
    await exposeSupabaseHelpers(page);

    // $10.00 average sale price (20.00 over 2 units) against a $4.00 cost:
    // +$6.00 profit, 60.0% margin.
    await seedRecipes(
      page,
      [{ name: 'E2E Carne Guisada', posItemName: 'E2E Carne Guisada', estimatedCost: 4 }],
      [{ itemName: 'E2E Carne Guisada', quantity: 2, totalPrice: 20 }]
    );
    await seedProduct(page, 'E2E Rice');

    await page.reload();
    const row = page.getByRole('row').filter({ hasText: 'E2E Carne Guisada' });
    await expect(row).toBeVisible({ timeout: 15000 });
    await expect(row).toContainText('4.00');
    await expect(row).toContainText('10.00');
    await expect(row).toContainText('60.0%');

    // Create: the new recipe must appear without a reload, i.e. the mutation
    // invalidated the shared query rather than mutating local state.
    await page.getByRole('button', { name: 'Create new recipe' }).click();
    const createDialog = page.getByRole('dialog', { name: 'Create New Recipe' });
    await expect(createDialog).toBeVisible();
    await createDialog.getByLabel('Recipe Name *').fill('E2E Horchata');
    // A recipe needs at least one ingredient to save.
    await createDialog.getByRole('combobox', { name: 'Product' }).click();
    await page.getByRole('option', { name: /E2E Rice/ }).click();
    await createDialog.getByRole('button', { name: 'Create Recipe' }).click();
    await expect(createDialog).not.toBeVisible({ timeout: 15000 });
    await expect(page.getByRole('row').filter({ hasText: 'E2E Horchata' })).toBeVisible({ timeout: 15000 });

    // Edit
    await page.getByRole('button', { name: 'Recipe actions for E2E Horchata' }).click();
    await page.getByRole('menuitem', { name: 'Edit' }).click();
    const editDialog = page.getByRole('dialog', { name: 'Edit Recipe' });
    await expect(editDialog).toBeVisible();
    // The dialog fetches the recipe's ingredients and then resets the whole
    // form, so typing before that lands would be silently overwritten.
    const editName = editDialog.getByLabel('Recipe Name *');
    await expect(editName).toHaveValue('E2E Horchata');
    await expect(editDialog.getByRole('combobox', { name: 'Product' })).toContainText('E2E Rice');
    await editName.fill('E2E Horchata Grande');
    await editDialog.getByRole('button', { name: 'Update Recipe' }).click();
    await expect(editDialog).not.toBeVisible({ timeout: 15000 });
    await expect(page.getByRole('row').filter({ hasText: 'E2E Horchata Grande' })).toBeVisible({ timeout: 15000 });

    // Delete
    await page.getByRole('button', { name: 'Recipe actions for E2E Horchata Grande' }).click();
    await page.getByRole('menuitem', { name: 'Delete' }).click();
    await page.getByRole('button', { name: 'Delete Recipe' }).click();
    await expect(page.getByRole('row').filter({ hasText: 'E2E Horchata Grande' })).toHaveCount(0, { timeout: 15000 });

    // The untouched recipe is still there: the delete invalidated, it did not
    // clear the list.
    await expect(page.getByRole('row').filter({ hasText: 'E2E Carne Guisada' })).toBeVisible();
  });

  test('CRITICAL: round trips do not scale with the number of recipes', async ({ page }) => {
    const user = generateTestUser('recipes-fanout');
    await signUpAndCreateRestaurant(page, user);
    await page.goto('/recipes');
    await exposeSupabaseHelpers(page);

    // Count the queries the recipe list itself owns, per endpoint.
    //
    // Deliberately NOT counting every `/rest/v1/` call: the app shell fetches
    // `user_restaurants`, `pos_sales`, `unified_sales` and `products` on its
    // own schedule, and measurement showed those varying run to run (28 total
    // calls on one load, 22 on the next, in whichever direction). A total-call
    // comparison therefore measures shell noise, not this page's fan-out, and
    // passes or fails by luck. `products` is excluded for the same reason —
    // several components fetch it, so its count cannot be attributed here.
    const RECIPE_OWNED_ENDPOINTS = [
      'recipes',
      'prep_recipes',
      'recipe_ingredients',
      'rpc/get_recipe_sales_stats',
      'rpc/get_unmapped_sale_item_names',
    ] as const;
    let perEndpoint: Record<string, number> = {};
    page.on('request', (request) => {
      const url = request.url();
      if (!url.includes('/rest/v1/')) return;
      const path = url.split('/rest/v1/')[1].split('?')[0];
      if ((RECIPE_OWNED_ENDPOINTS as readonly string[]).includes(path)) {
        perEndpoint[path] = (perEndpoint[path] ?? 0) + 1;
      }
    });

    const countLoad = async (expectedFirstRecipe: string) => {
      perEndpoint = {};
      await page.reload();
      await expect(page.getByRole('row').filter({ hasText: expectedFirstRecipe })).toBeVisible({ timeout: 20000 });
      // Let anything the page fires just after first paint land in the count.
      await page.waitForTimeout(3000);
      return { ...perEndpoint };
    };

    await seedRecipes(
      page,
      Array.from({ length: 5 }, (_, i) => ({ name: `Fanout ${String(i).padStart(3, '0')}` }))
    );
    const withFive = await countLoad('Fanout 000');

    await seedRecipes(
      page,
      Array.from({ length: 55 }, (_, i) => ({ name: `Fanout ${String(i + 5).padStart(3, '0')}` }))
    );
    const withSixty = await countLoad('Fanout 000');

    // Prove the counter is actually counting. Every ceiling below is an upper
    // bound, so a counter that silently matched nothing — a renamed table, a
    // changed RPC path — would sail through all of them at zero.
    for (const endpoint of RECIPE_OWNED_ENDPOINTS) {
      expect(withFive[endpoint] ?? 0, `${endpoint} was never observed`).toBeGreaterThanOrEqual(1);
    }

    // The old page issued a sales query and an ingredients query per recipe,
    // so 60 recipes cost ~12x what 5 did. Now each of these is one bulk query
    // whatever the recipe count: twelve times the data, the same round trips.
    // Two ceilings rather than one, because either alone has a hole —
    // comparing the two loads would accept "equal but both enormous", and an
    // absolute cap alone would accept slow growth under the cap.
    for (const endpoint of RECIPE_OWNED_ENDPOINTS) {
      expect(
        withSixty[endpoint] ?? 0,
        `${endpoint} must not grow with the recipe count`
      ).toBeLessThanOrEqual((withFive[endpoint] ?? 0) + 1);
      expect(
        withSixty[endpoint] ?? 0,
        `${endpoint} must be a bulk query, not one per recipe`
      ).toBeLessThanOrEqual(2);
    }
  });

  test('a failed load reads as an outage, not as an empty recipe book', async ({ page }) => {
    const user = generateTestUser('recipes-error');
    await signUpAndCreateRestaurant(page, user);
    await page.goto('/recipes');
    await exposeSupabaseHelpers(page);
    await seedRecipes(page, [{ name: 'E2E Elote' }]);

    await page.route('**/rest/v1/recipes?*', (route) =>
      route.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"boom"}' })
    );

    await page.reload();

    await expect(page.getByText("Couldn't load recipes").first()).toBeVisible({ timeout: 20000 });
    // The empty state invites creating a first recipe -- exactly the wrong
    // prompt during an outage, since the recipes still exist.
    await expect(page.getByText('Create your first recipe to start tracking')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Try again to load recipes' }).first()).toBeVisible();
  });
});
