---
title: "Build and Manage Menu Item Recipes"
category: "inventory-and-recipes"
summary: "Create, edit, and link menu recipes to POS items so the system can automatically deduct ingredients from inventory when sales occur."
audience: ["owner", "manager", "chef"]
order: 40
keywords: ["recipe", "menu item", "ingredients", "inventory deduction", "POS", "food cost", "margin"]
related: ["prep-recipes", "manage-inventory-products", "view-filter-pos-sales"]
---

# Build and Manage Menu Item Recipes

This article explains how to create and manage menu item recipes in EasyShiftHQ, link them to your POS items, and use the automatic inventory deduction feature to keep stock levels accurate after every sale. It is written for owners, managers, and chefs.

## Before you begin

- You must be signed in with an owner, manager, or chef role. Staff and kiosk roles cannot access Recipe Management. See [Roles and What Each One Can Access](/help/roles-and-permissions) for details.
- Your inventory products must already exist before you can add them as recipe ingredients. If a product is missing, go to [Manage Your Inventory](/help/manage-inventory-products) to add it first.
- To link a recipe to a POS item and enable automatic inventory deduction, you need a connected POS system with synced sales data. See [Connect and Sync a POS System](/help/connect-pos-system).

## Create a new recipe

1. Go to **Recipe Management** at `/recipes`.
2. Click **Create Recipe** in the top-right area of the page.
3. In the **Basic Information** section, fill in:
   - **Recipe Name** (required) — the name of the menu item as you want it to appear in EasyShiftHQ.
   - **Description** (optional) — a brief note about the dish or drink.
   - **Serving Size** (required) — enter a number representing the number of servings this recipe produces (for example, `1` for a single-serving dish).
4. In the **POS Integration** section, use the **POS Item Name** field to link this recipe to a POS item. Start typing to search your synced POS items and select the matching one. The **Estimated Cost** displayed below this field updates automatically as you add ingredients.
5. In the **Ingredients** section, click **Add Ingredient** to add each ingredient. For each ingredient:
   - Select the **product** from your inventory using the dropdown.
   - Enter the **quantity** used per serving.
   - Choose the **unit of measure** from the list (for example, oz, fl oz, cup, g, each).
6. Repeat step 5 for every ingredient in the recipe.
7. Click **Create Recipe** to save. The recipe appears in the list immediately.

> If a product you need does not exist in inventory yet, the ingredient row includes an option to go create it. Your recipe form is saved automatically so you can return and pick up where you left off.

## Edit an existing recipe

1. Go to **Recipe Management** at `/recipes`.
2. Find the recipe in the list. On desktop, click the actions menu (the three-dot icon at the right of the row) and choose **Edit**. On mobile, tap the pencil icon.
3. Update any fields — name, description, serving size, POS item, or ingredients — as needed.
4. Click **Update Recipe** to save your changes.

## Link a recipe to a POS item

Linking a recipe to a POS item is what enables the system to automatically deduct the right ingredients from inventory each time that item is sold.

1. Open the recipe for editing (see above).
2. In the **POS Integration** section, click the **POS Item Name** field and search for the POS item you want to link.
3. Select the correct item from the results.
4. Click **Update Recipe**.

Once linked, the recipe moves to the **Mapped to POS** tab. Recipes without a POS item appear on the **Unmapped** tab.

## Copy an existing recipe as a starting point

Use this when a new recipe shares most of its ingredients or structure with an existing one — for example, a dish that comes in a lunch and dinner portion.

1. Go to **Recipe Management** at `/recipes`.
2. Click the small arrow (chevron) on the right side of the **Create Recipe** button to open the dropdown.
3. Choose **From Existing Recipe**.
4. In the dialog that opens, search for and click the recipe you want to use as the base.
5. On the next screen, choose what to reuse from the base recipe by checking or unchecking:
   - **Copy ingredients and units**
   - **Copy serving size**
   - **Copy description**
   - **Copy POS mapping**
   - **Copy name**
6. Click **Create from base**.
7. The recipe creation form opens pre-filled with the options you selected. Give the new recipe a unique name, adjust any details, and click **Create Recipe**.

You can also start a copy from an existing recipe row: open the actions menu for any recipe and choose **Create variation**.

## Search and filter recipes

- Use the **search bar** at the top of the recipe list to find recipes by name or by the POS item name they are linked to.
- Use the **sort dropdown** to sort all recipes by: Name, Cost, Sale Price, Margin %, or Date Created.
- Click the **sort direction button** (the arrow icon next to the sort dropdown) to toggle between ascending and descending order.
- Click the **Warnings** button to show only recipes that have conversion issues or are missing ingredients entirely. Click it again to return to the full list. When active, the button turns red.

The three tabs — **All Recipes**, **Mapped to POS**, and **Unmapped** — let you quickly focus on the subset you care about. The count in parentheses next to each tab label updates as you search.

## Enable or disable automatic inventory deduction

When automatic deduction is on, every new POS sale that matches a linked recipe automatically reduces the ingredient quantities in your inventory.

1. Go to **Recipe Management** at `/recipes`.
2. Click the **Auto Deduction** button (the settings icon) near the top of the page. A settings panel expands below the header.
3. Under **Enable Auto Deduction**, toggle the switch on or off.
   - When active, the toggle shows an **Active** badge and the system begins deducting inventory for new sales in real time.
4. To close the panel, click **Auto Deduction** again.

The panel also shows a **Process Pending Sales** button under **Manual Actions**, which lets you trigger deduction for any POS sales that were received while auto deduction was off.

## Run a bulk inventory deduction for historical sales

Use this when you have created recipes after sales already occurred and you want to retroactively deduct inventory for those past sales.

1. Go to **Recipe Management** at `/recipes`.
2. Click **Bulk Process Sales** in the top-right area of the page.
3. In the dialog that opens (**Bulk Process Historical Sales**), select a **Start Date** and an **End Date** for the period you want to process.
4. Click **Process Sales**.

The system will process only sales that have not already been deducted. Already-processed sales are skipped automatically.

## Tips

- The **Estimated Cost** shown in the recipe form and in the recipe list is calculated automatically from your inventory product costs and the quantities in the recipe. Keep your product costs up to date to get accurate food cost data.
- The recipe list always shows **Avg Sale Price**, **Profit**, and **Margin %** columns. These columns are populated from your actual sales history once a recipe is linked to a POS item and sales data exists; otherwise they show a dash. The values update each time the page loads.
- The **AI Recipe Suggestions** panel appears automatically when you have POS items that are not yet linked to a recipe. Click **Suggest Recipe** next to any item to let the AI generate a starting recipe from your existing inventory. You can review the suggested ingredients, then click **Create Recipe** to save it, or **Dismiss** to skip.
- Use the **Mapped to POS** tab as a quick health check: every recipe there is actively contributing to inventory accuracy.
- Use the **Unmapped** tab to prioritize which recipes still need a POS item linked.

## Troubleshooting

**The POS Item Name field shows no results.**
The POS item may not have synced yet. Go to [Connect and Sync a POS System](/help/connect-pos-system) and confirm your POS connection is active and synced. After syncing, return to the recipe and try the field again.

**The recipe list shows a "No ingredients" badge on a recipe.**
The recipe was saved without any ingredients. Open the recipe, click **Add Ingredient**, fill in at least one product, quantity, and unit, then save. Recipes without ingredients do not contribute to cost calculations or automatic inventory deduction.

**The Warnings filter is on but shows "No recipes with warnings."**
That is the expected result — it means all your recipes have ingredients and valid unit conversions. Click **Warnings** again to turn the filter off and see all recipes.

**Automatic deduction is enabled, but inventory is not going down after sales.**
First check that the recipe is on the **Mapped to POS** tab (not Unmapped). If it is unmapped, edit it and select the correct **POS Item Name**. Also confirm that new sales are syncing — go to [View, Search, and Filter Your POS Sales](/help/view-filter-pos-sales) to verify recent sales are appearing.

**Bulk Process Sales completed but inventory did not change.**
Sales that were already processed will not be deducted again. If inventory still looks incorrect, check that the recipes were linked to the correct POS items before the bulk run was triggered. You may need to run the bulk process again for the relevant date range after fixing the POS mapping.

**I get a "Permission Error" when trying to create a recipe.**
Your account role may not have permission to create recipes for this location. Ask the restaurant owner to verify your role. See [Roles and What Each One Can Access](/help/roles-and-permissions).

## Frequently asked questions

**Do I need to create a recipe for every POS item?**
No — only create recipes for items whose ingredients you want to track and deduct from inventory. Items without a linked recipe will still appear in your POS sales but will not affect inventory levels.

**What happens if I update a recipe's ingredients after auto deduction is already running?**
Future sales will use the updated ingredients and quantities. Past sales that were already processed are not retroactively changed.

**Can two recipes be linked to the same POS item?**
The system allows it, but linking multiple recipes to the same POS item can produce duplicate inventory deductions for a single sale. It is best practice to maintain a one-to-one relationship between a POS item and a recipe.

**Why does the Margin % column show a dash for some recipes?**
Margin % is calculated from your average sale price, which comes from POS sales history. If the recipe is not yet linked to a POS item, or if there are no sales on record for that item, the column shows a dash. Link the recipe to the correct POS item and the figure will appear once sales data is available.

**Will the "From Existing Recipe" copy also copy the POS mapping?**
Only if you check the **Copy POS mapping** option in the confirmation step. By default it is unchecked, so each copy starts with no POS link and must be mapped separately.

## Related articles

- [Manage Your Inventory: Add, Edit, and Track Products](/help/manage-inventory-products)
- [Create and Manage Prep Recipes](/help/prep-recipes)
- [Connect and Sync a POS System](/help/connect-pos-system)
- [View, Search, and Filter Your POS Sales](/help/view-filter-pos-sales)
- [Roles and What Each One Can Access](/help/roles-and-permissions)
