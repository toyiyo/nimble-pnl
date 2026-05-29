---
title: "Create and Manage Prep Recipes"
category: "inventory-and-recipes"
summary: "Build a library of standardized kitchen prep recipes with ingredients, procedure steps, yield, storage instructions, and batch cost tracking — then log a prep batch to update inventory."
audience: ["owner", "manager", "chef"]
order: 50
keywords: ["prep recipe", "batch", "procedure", "yield", "shelf life", "storage", "kitchen", "batch cost"]
related: ["menu-item-recipes", "manage-inventory-products", "purchase-orders"]
---

# Create and Manage Prep Recipes

This article explains how to build and maintain your kitchen's Prep Recipe Library in EasyShiftHQ — covering recipe setup, ingredients, step-by-step procedures, and how to log a completed batch so inventory updates automatically. It is intended for owners, managers, and chefs.

## Before you begin

- You must be signed in with an owner, manager, or chef role to create and edit prep recipes.
- Ingredients are pulled from your inventory product list. Add any missing products in [Manage Your Inventory](/help/manage-inventory-products) before building a recipe.

## Go to the Prep Recipe Library

1. In the main navigation, select **Prep Recipes** (the route is `/prep-recipes`).
2. The **Prep Recipe Library** page loads, showing summary stats at the top: **Total Recipes**, **Ingredients Used**, **Avg. Batch Cost**, and **Need Attention** (recipes with unit-conversion issues).
3. If you manage multiple locations, make sure the correct restaurant is selected before continuing.

## Create a new recipe

1. On the Prep Recipe Library page, click **New Recipe** (top-right).
2. The **Create Prep Recipe** dialog opens. It has three tabs — **Details**, **Ingredients**, and **Procedure** — and a recipe completeness indicator in the top-right corner that tracks how many fields you have filled in.

### Details tab

The Details tab is organized into three sections:

**Recipe Identity**

| Field | What to enter |
|---|---|
| Recipe Name | Required. The name that appears on recipe cards and in inventory (e.g., *Roasted Garlic*, *Caesar Dressing*). |
| Category | Choose one: **Prep**, **Sauces & Dressings**, **Proteins**, **Dough & Bread**, **Desserts**, or **Soups**. |
| Description | A brief note describing the item and when it is used in the kitchen. |

**Yield & Timing**

| Field | What to enter |
|---|---|
| 1X Yield | The quantity produced by one standard batch (e.g., *5*). |
| Yield Unit | The unit of measure for that quantity (e.g., *lb*, *qt*, *unit*). |
| Prep Time | Optional. Total preparation time in minutes. |
| Shelf Life | Optional. Choose from **1 day**, **2 days**, **3 days**, **5 days**, **7 days**, **2 weeks**, or **1 month**. |

A **Batch Scaling** preview below these fields automatically shows the 2X yield so you can quickly sanity-check the numbers.

**Equipment & Storage**

| Field | What to enter |
|---|---|
| Oven Temperature | Optional. Enter a number and choose **°F** or **°C**. |
| Output Item | Optional but recommended. Select the inventory product that this recipe produces. When set, completing a batch automatically adds stock to this product. |
| Storage Method | Click one button: **Refrigerate**, **Freeze**, or **Room Temp**. |
| Equipment Notes | Optional free-text notes about required equipment (e.g., *food processor, dough mixer on speed 2*). |

### Ingredients tab

1. Click the **Ingredients** tab.
2. The **Batch Calculator** bar at the top lets you preview quantities at **1X**, **2X**, or **3X** scale. Selecting a multiplier scales all displayed quantities without changing the saved 1X amounts.
3. A cost summary shows **Total Cost**, **Cost per Unit**, **Yield**, and **Ingredients** count — all updated live as you add or change ingredients.
4. For each ingredient row:
   - Select an **ingredient** from your inventory product list.
   - Enter the **1X Qty** (the amount needed for one standard batch).
   - Choose the **Unit** (e.g., *oz*, *lb*, *cup*, *each*).
   - Optionally, add a **note** (e.g., *rough chop*, *peeled*, *trim 10%*).
   - The scaled quantity and individual cost impact appear automatically.
5. Click **Add Ingredient** (dashed button at the bottom) to add more rows.
6. To remove an ingredient, click the trash icon on that row.

If a unit cannot be converted to the product's stored unit, a yellow warning appears on that row. Resolve it by choosing a compatible unit or updating the product's unit of measure in inventory.

### Procedure tab

1. Click the **Procedure** tab.
2. Each numbered step has:
   - A **text area** for the instruction. Write clear, complete directions for that single action.
   - A **Timer** field (in minutes) — optional, for steps that require a timed hold, cook, or rest.
   - A **critical point toggle** (the alert icon in the step header). Steps marked as critical are highlighted in amber so kitchen staff know to pay extra attention. Hover over the icon to see the tooltip *Mark as critical quality point*.
3. Click **Add Step** to append another step. Steps are automatically renumbered if you remove one.
4. A reminder at the bottom of the tab shows the standard closing step: *Cover, label, date, [storage method], and rotate.*

### Save the recipe

When you are ready, click **Create Recipe** in the dialog footer. The footer also shows a running tally of ingredients, procedure steps, and current batch cost for a quick final check.

To discard without saving, click **Cancel**.

## Edit an existing recipe

1. On the Prep Recipe Library page, hover over any recipe card.
2. Click the **Edit** button that appears (top-right of the card).
3. The **Edit Recipe** dialog opens with all existing values pre-filled. Make your changes across the **Details**, **Ingredients**, and **Procedure** tabs.
4. Click **Save Changes** when done.

## Find recipes: search and filter

Use the toolbar below the stats cards to narrow the list:

- **Search** — Type any part of a recipe name or description in the search box.
- **Category filter** — Open the dropdown to show only a specific category: All Recipes, Prep, Sauces, Proteins, Dough & Bread, Desserts, or Soups.
- **View toggle** — Switch between the full **card view** (grid icon) and a condensed **list view** (lines icon). The list view shows the recipe name, yield, ingredient count, prep time, and batch cost in a compact row.

The result count updates dynamically as you type or change the filter.

## Log a prep batch (Cook Now)

Logging a batch deducts the ingredients from inventory and adds the finished output to stock.

1. On a recipe card, click **Cook Now**.
2. A confirmation dialog titled **Cook Now: [Recipe Name]** opens and shows:
   - **Preparing at 1X yield** — the standard batch size.
   - **Will Deduct** — every ingredient, the amount that will be removed, and current stock levels. A green check icon means stock is sufficient; a yellow warning icon means stock is low.
   - **Will Add** — the output product and the quantity that will be added to inventory, along with the calculated cost.
3. If any ingredient shows a **Low Stock Warning**, you can still proceed — stock will go negative — or click **Cancel** to restock first.
4. Click **Cook Now** to confirm. Inventory updates immediately and the card refreshes to show the new stock level.

If the recipe does not have an Output Item set, EasyShiftHQ automatically creates an inventory product with the same name as the recipe and links it going forward.

## Tips

- Fill in as many fields as possible — the completeness indicator in the dialog header helps you track progress and rewards complete recipes with a higher percentage.
- Set the **Output Item** field before logging your first batch to make sure the finished product is linked to the correct existing inventory item rather than creating a new one automatically.
- Use the **Batch Calculator** (1X / 2X / 3X) on the Ingredients tab to verify ingredient quantities scale correctly before training staff.
- Mark temperature-sensitive or food-safety-critical steps as **Critical Point** so they stand out when kitchen staff follow the printed procedure.
- The **Need Attention** stat card on the library page flags recipes with unit-conversion issues. Open each flagged recipe and resolve the yellow-highlighted ingredient rows so batch costs calculate correctly.
- The **Avg. Batch Cost** stat updates automatically as you add ingredients and cost data to your products.

## Troubleshooting

**The "Cook Now" button is missing.**
The button only appears on recipe cards when you have the necessary permissions. Confirm your role is owner, manager, or chef under [Roles and What Each One Can Access](/help/roles-and-permissions).

**An ingredient shows a yellow conversion warning.**
EasyShiftHQ cannot convert the recipe unit to the unit stored on the inventory product (e.g., recipe uses *cups* but the product is tracked in *lb*). Either change the ingredient's unit to match the product's stored unit, or update the product's unit of measure in [Manage Your Inventory](/help/manage-inventory-products).

**The batch cost shows $0.00.**
The cost is calculated from the **Cost per unit** field on each inventory product. If a product has no cost entered, its cost contribution is zero. Update the product cost in inventory and the recipe will recalculate automatically.

**Stock went negative after a batch.**
The confirmation dialog warned that one or more ingredients were below the required quantity. You can correct the stock level by adjusting the product's current stock in [Manage Your Inventory](/help/manage-inventory-products) or by running an [Inventory Count (Reconciliation)](/help/inventory-reconciliation).

**I cannot find my ingredient in the dropdown.**
The ingredient list is drawn from your inventory products. Add the product first in [Manage Your Inventory](/help/manage-inventory-products), then return to the recipe to add it.

**The Output Item dropdown is empty or missing my product.**
The dropdown lists all inventory products. If the product does not appear, create it in inventory first, then come back to link it as the recipe's Output Item.

## Frequently asked questions

**Can I scale a batch beyond 1X when I log it?**
The Cook Now flow always logs exactly 1X (the standard yield). To produce more, complete multiple batches. The Batch Calculator on the Ingredients tab helps you plan scaled amounts, but those scaled quantities are for reference only — they do not change what is deducted when you confirm a batch.

**What happens if I do not set an Output Item?**
EasyShiftHQ will automatically create a new inventory product named after the recipe and link it to the recipe. That auto-created product will appear in your inventory list going forward. If a product with the same name already exists, it will be linked to that existing product instead.

**Does the recipe cost update automatically when ingredient prices change?**
Yes. Batch cost is calculated live from each ingredient product's current cost per unit. When you update a product's cost in inventory, all recipes using that ingredient reflect the new cost immediately.

**Can I set the storage method per step, or only at the recipe level?**
Storage method is set once at the recipe level (Refrigerate, Freeze, or Room Temp) in the Equipment & Storage section of the Details tab. The standard closing step reminder on the Procedure tab references that setting. Individual steps can include any storage or handling notes in the step's instruction text.

**What does "Need Attention" mean on the library page?**
It counts recipes where at least one ingredient has a unit-conversion issue — meaning EasyShiftHQ cannot calculate the cost or inventory deduction for that ingredient. Edit the recipe, look for yellow-highlighted rows in the Ingredients tab, and choose a compatible unit to resolve the issue.

## Related articles

- [Build and Manage Menu Item Recipes](/help/menu-item-recipes)
- [Manage Your Inventory: Add, Edit, and Track Products](/help/manage-inventory-products)
- [Run an Inventory Count (Reconciliation)](/help/inventory-reconciliation)
- [Create and Manage Purchase Orders](/help/purchase-orders)
- [Import Supplier Receipts to Update Inventory](/help/receipt-import)
- [Roles and What Each One Can Access](/help/roles-and-permissions)
