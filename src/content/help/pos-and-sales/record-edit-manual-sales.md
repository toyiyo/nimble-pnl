---
title: "Record and Edit Sales Manually"
category: "pos-and-sales"
summary: "Add individual sales entries by hand — including adjustments for tax, tip, and discounts — and edit or delete them later."
audience: ["owner", "manager"]
order: 40
keywords: ["manual sale", "add sale", "record sale", "edit sale", "adjustments", "tip", "tax", "discount"]
related: ["view-filter-pos-sales", "import-sales-csv", "categorize-pos-sales"]
---

# Record and Edit Sales Manually

This article explains how owners and managers can add individual sales entries by hand on the Sales page, optionally include adjustments such as tax, tip, and discounts, and then edit or delete those entries later.

## Before you begin

You must have the **Owner** or **Manager** role to record, edit, or delete manual sales. Staff members can view the Sales page but will not see the **Add Sale**, **Edit**, or **Delete** controls.

## Add a manual sale

1. Go to **Sales** (`/pos-sales`).
2. Click the **Add Sale** button in the top-right area of the page header.
3. The **Record Manual Sale** dialog opens.

### Choose the item

4. Click the **Item Name** field. A searchable dropdown appears.
   - Start typing to search your existing items. Results are grouped into two sections:
     - **Items with Recipe** — items linked to a recipe (shown with a green checkmark). When you select one of these, the system notes that inventory will be deducted automatically.
     - **Items without Recipe** — items not yet linked to a recipe (shown with an amber icon). A note below the field will remind you that inventory won't be deducted.
   - If your search finds no match, a **Create: "..."** button appears at the bottom of the list. Click it to use your typed text as a new item name.
   - If a matching item already exists under a different casing (for example you typed "burger" but "Burger" exists), the system will use the existing name automatically.

5. If the item is linked to a recipe and has an average sale price on record, **Total Price** will be pre-filled automatically. You can change it before saving.

### Fill in the sale details

6. Enter the **Quantity** (must be at least 1).
7. Enter the **Unit Price** if you know the per-item price. This field is optional.
8. Enter the **Total Price**. If you leave it blank, the app will calculate it from Unit Price multiplied by Quantity.
9. Set the **Sale Date**. It defaults to today.
10. Set the **Sale Time**. It defaults to the current time.

### Add adjustments (optional)

11. Below the date and time fields, the **Adjustments** section is always visible when adding a new sale. All fields are optional.
   - **Sales Tax** — the tax amount collected.
   - **Tip** — any tip amount.
   - **Service Charge** — a mandatory service charge, if applicable.
   - **Platform Fee** — a delivery platform or third-party fee.
   - **Discount** — any discount applied (subtracts from the total).

12. As you fill in these fields, a **Total Collected at POS** preview appears automatically, showing the running sum: revenue + tax + tip + service charge + platform fee, minus discount. A breakdown line beneath the total shows each component.

### Save the sale

13. Click **Record Sale**. The dialog closes and the new entry appears in your sales list.
    - To cancel without saving, click **Cancel**.

## Edit a manual sale

Only sales that were entered manually can be edited. Sales imported from a connected POS system (Square, Toast, etc.) do not show Edit or Delete controls.

1. On the **Sales** page, find the sale card you want to update. On desktop, hover over the card to reveal the action links.
2. Click **Edit**. The **Edit Manual Sale** dialog opens, pre-filled with the existing values.
3. Update any of the fields: **Item Name**, **Quantity**, **Unit Price**, **Total Price**, **Sale Date**, or **Sale Time**.

   > Note: The Adjustments section (tax, tip, service charge, platform fee, discount) is not shown in the Edit dialog. To change adjustment amounts, delete the entry and record it again with the correct values.

4. Click **Update Sale** to save your changes.
   - Click **Cancel** to close without saving.

## Delete a manual sale

1. On the **Sales** page, hover over the manual sale card to reveal the action links.
2. Click **Delete**.
3. A confirmation prompt appears: "Are you sure you want to delete this manual sale?" Click **OK** to confirm, or **Cancel** to keep the record.

## Tips

- **Item Name search is fuzzy.** You don't need to type the exact name — close matches will appear in the list.
- **Adjustments are separate entries.** When you save a sale with adjustments, each adjustment (tax, tip, etc.) is stored as its own line in the sales list alongside the main revenue entry. This keeps your financial records accurate when categorizing to your chart of accounts.
- **Average price auto-fill.** When you select an item that is linked to a recipe and has an average sale price recorded, the **Total Price** field will pre-fill with that price. You can always overwrite it.
- **Total Collected at POS preview.** The running total only appears once at least one dollar amount is entered. It updates instantly as you type, so you can verify the math before saving.
- **Edit and Delete are only for manual sales.** If you don't see these controls on a sale card, the sale came from a connected POS system and must be corrected at the source.

## Troubleshooting

**I clicked "Add Sale" but nothing happened.**
Make sure you have a restaurant selected at the top of the page. If no restaurant is selected, the Sales page prompts you to choose one first.

**The Item Name I typed shows a "No recipe mapping" warning.**
This means the item isn't linked to a recipe yet. The sale will still be recorded, but inventory won't be deducted automatically. To link a recipe, go to **Recipes** and add a POS item name to the relevant recipe, then come back to record the sale.

**The Adjustments section is missing when I open the Edit dialog.**
The Adjustments section (tax, tip, service charge, platform fee, discount) only appears when recording a new sale, not when editing. To correct an adjustment amount, delete the existing entry and create a new one.

**I see no Edit or Delete buttons on a sale card.**
Edit and Delete only appear for manually entered sales. Sales synced from a connected POS system (Square, Toast, Clover, etc.) cannot be edited here — changes need to be made in the POS system and re-synced.

**The Total Collected at POS preview doesn't appear.**
The preview only shows when the total would be greater than zero. Enter a **Total Price** or an adjustment amount to trigger it.

## Frequently asked questions

**Can I record a sale without a Total Price?**
Yes — leave **Total Price** blank and fill in **Unit Price** and **Quantity** instead. The app calculates the total automatically. You can also leave both blank if you only need to record the item name and quantity.

**What happens to inventory when I record a manual sale?**
If the item you selected is linked to a recipe (shown with a green checkmark), the recipe's ingredients will be marked for deduction. If there is no recipe link (amber icon, "No recipe mapping" note), no inventory is affected.

**Can I add multiple adjustments to the same sale?**
Yes. Fill in as many of the five adjustment fields (Sales Tax, Tip, Service Charge, Platform Fee, Discount) as you need in one go. Each is stored separately so your financial reports stay accurate.

**Does the sale date default to today?**
Yes. Both **Sale Date** and **Sale Time** pre-fill with the current date and time when you open the **Record Manual Sale** dialog. Change them if you're entering a past sale.

**Can staff members record manual sales?**
No. Only owners and managers see the **Add Sale** button and the **Edit** / **Delete** controls. Staff members can view the sales list but cannot add or modify entries.

## Related articles

- [View, Search, and Filter Your POS Sales](/help/view-filter-pos-sales)
- [Import Sales from a CSV File](/help/import-sales-csv)
- [Categorize Sales and Create Automation Rules](/help/categorize-pos-sales)
- [Connect and Sync a POS System](/help/connect-pos-system)
- [Roles and What Each One Can Access](/help/roles-and-permissions)
