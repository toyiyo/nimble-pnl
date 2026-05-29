---
title: "Create and Manage Purchase Orders"
category: "inventory-and-recipes"
summary: "Create, edit, and manage purchase orders — including smart quantity suggestions based on par levels and usage — and export orders as PDF, CSV, or text."
audience: ["owner", "manager"]
order: 60
keywords: ["purchase order", "PO", "supplier", "order", "budget", "par level", "export", "PDF", "CSV"]
related: ["manage-inventory-products", "receipt-import", "prep-recipes"]
---

# Create and Manage Purchase Orders

This article walks owners and managers through creating purchase orders, using smart suggestions to fill in recommended quantities, editing line items, and exporting a finished order to share with a supplier.

## Before you begin

You must have the **Owner** or **Manager** role to create and manage purchase orders. If you do not see the Purchase Orders section in the menu, ask your account owner to check your role. See [Roles and What Each One Can Access](/help/roles-and-permissions) for details.

To get the most out of smart suggestions, make sure your inventory products have par levels configured. See [Manage Your Inventory: Add, Edit, and Track Products](/help/manage-inventory-products).

## Open Purchase Orders

1. In the main navigation, click **Purchase Orders**.
2. The list shows all purchase orders for your selected restaurant, with columns for PO Number, Supplier, Status, Order Total, and Created date.
3. Use the search bar to filter by PO number, supplier name, or status.
4. Click any row to open that order.

## Create a new purchase order

1. Go to **Purchase Orders** (route: `/purchase-orders`).
2. Click **New Purchase Order** in the top-right area of the page.
3. The editor opens a blank order form.

### Set the supplier and budget (both optional)

- **Primary Supplier (optional):** Use the dropdown to select a supplier from your list. You can leave this blank if the order spans multiple suppliers — each line item tracks its own supplier.
- **Target Budget (optional):** Type a dollar amount in the **Target Budget** field. Once set, a **Budget Usage** progress bar appears below the order summary. As you add items, the bar fills and shows the percentage used. If the order total exceeds the budget, the bar turns red and an **Over Budget** amount appears.

The **Order Summary** panel on the right always shows the live **Order Total**, and — when a budget is set — the **Remaining** or **Over Budget** amount.

## Add items to the order

The **Add Items** panel on the right side of the editor has two tabs.

### Search Inventory tab

1. Click the **Search Inventory** tab (it is selected by default).
2. Type part of a product name, SKU, or category in the **Search items…** field to filter the list.
3. Optionally use the category dropdown below the search field to filter by a specific category.
4. Each product card shows the supplier, category, unit, current cost, and current on-hand quantity.
5. Click **Add** on a product card to add it to the order. The button changes to **Added** once the item is in the order — the same item cannot be added twice.

### Smart Suggestions tab

1. Click the **Smart Suggestions** tab.
2. The tab shows **High-usage items** — products ranked by total usage over the past 14 days. Each card displays usage totals and a suggested quantity.
3. Click **Add** on any suggestion card to add it directly to the order at the suggested quantity.

## Auto-fill quantities with Suggest Order

**Suggest Order** analyzes your current inventory levels and par targets to recommend quantities for items already in the order.

1. With one or more items in the order, click **Suggest Order** (the button with the sparkle icon, in the header card).
2. For each item in the order that has par levels set, the system calculates how much stock is needed to reach the par target and updates the **Quantity** field automatically.
3. A confirmation toast appears: *"Applied suggestions to N item(s)."* The toast includes an **Undo** button — click it immediately if you want to revert all the suggested changes at once.
4. A summary banner also appears in the header showing how many items were updated and the projected order total, including whether you are over or under budget. Click **Dismiss** to close the banner.

### Including high-usage items in Suggest Order

1. Toggle **Include high-usage items** (the switch in the header card) to the on position.
2. Click **Suggest Order**. In addition to updating quantities for existing items, the system adds up to 5 of the most-used products that are not already in the order, using their suggested quantities from the past 14 days of usage data.
3. The same **Undo** option in the toast lets you reverse all changes, including any items that were automatically added.

> If no automatic par recommendations are available and **Include high-usage items** is off, **Suggest Order** shows a message: *"Add items with par levels or enable high-usage suggestions to see recommendations."*

## Edit line items

The **Order Items** table in the center of the editor shows every item you have added. For each line you can see:

- **On Hand** — current stock level
- **Par / Min** — the par max and par min set on the product
- **Recommended** — the quantity calculated from the par targets
- **Unit** — the purchase unit (for example, Case, Bag, Unit)
- **Unit Cost** — editable dollar field; pre-filled from the product's cost if one is on file
- **Quantity** — editable number field
- **Line Total** — calculated automatically as Quantity × Unit Cost

To make changes:

1. Click into the **Unit Cost** or **Quantity** field for a line and type the new value. The **Line Total** and **Order Total** update automatically.
2. To remove a line, click the trash icon at the end of the row.

## Add notes

Scroll below the **Order Items** table to the **Notes** section. Type any notes about the order (delivery instructions, special requests, etc.) in the text area. Notes are included when you export to PDF or text.

## Save the order

Two save options appear in the top-right area of the editor:

- **Save Draft** — saves the order with a status of **Draft**. You can continue editing later.
- **Mark as Ready to Send** — saves the order with a status of **Ready to Send**. At least one item must be in the order to use this option.

## Export a saved order

The **Export** button appears in the top-right area when you are viewing a saved (non-new) order. It is grayed out until the order has at least one item.

1. Click **Export** to open the format dropdown.
2. Choose one of the three formats:
   - **Export as PDF** — downloads a formatted PDF with your restaurant name, PO details, a line-item table, order total, and any notes.
   - **Export as CSV** — downloads a spreadsheet-compatible CSV file with all line-item data.
   - **Export as Text** — downloads a plain-text file formatted for easy copying or printing.
3. The file downloads automatically. A confirmation toast confirms the export was successful.

> You must save the order first before exporting. The Export button does not appear at all on a brand-new unsaved order — save as Draft or mark it as Ready to Send to make the button available.

## Purchase order statuses

| Status | Meaning |
|---|---|
| **Draft** | Created but not yet finalized. Still editable. |
| **Ready to Send** | Reviewed and ready to share with the supplier. |
| **Sent** | The order has been sent to the supplier. |
| **Partially Received** | Some items have been received, but not all. |
| **Received** | All items have been received. |
| **Closed** | The order is complete and archived. |

## Delete a purchase order

On the **Purchase Orders** list, click the trash icon in the **Actions** column for the order you want to remove. A confirmation dialog appears. Click **Delete** to permanently remove the order. This action cannot be undone.

## Tips

- Set par levels on your inventory products to get the most useful **Suggest Order** results. Products without par levels or a reorder point will not receive automatic quantity recommendations.
- Use the **Target Budget** field early in the ordering process — the real-time progress bar helps you stay within budget as you add items.
- The **Smart Suggestions** tab updates based on the last 14 days of recorded inventory usage. If you have not logged usage recently, the list may be empty or limited.
- You can mix items from different suppliers in the same purchase order. Each line item tracks its own supplier independently of the order-level primary supplier.
- After clicking **Suggest Order**, check the **Undo** option in the toast before navigating away — it disappears once dismissed.

## Troubleshooting

**The Export button is not visible.**
The Export button only appears after an order has been saved. Click **Save Draft** or **Mark as Ready to Send**, then the Export button will appear.

**Suggest Order says "No suggestions available."**
This means none of the items currently in the order have par levels, and **Include high-usage items** is off. Either add items that have par levels configured in inventory, or toggle **Include high-usage items** on before clicking **Suggest Order**.

**An item shows "—" in the Recommended column.**
This item does not have a par level or reorder point set in inventory. You can still edit the quantity manually. To enable recommendations, update the product's par settings in [Manage Your Inventory](/help/manage-inventory-products).

**Mark as Ready to Send is disabled.**
You must have at least one item in the order before you can change the status to Ready to Send. Add at least one item and then click the button.

**The Smart Suggestions tab is empty.**
Usage suggestions require recorded inventory usage transactions from the past 14 days. If your team has not been logging usage, no data is available to rank products. Begin recording usage in inventory to populate this list over time.

**I see "Multiple Suppliers" in the list instead of a supplier name.**
This appears when no primary supplier was selected at the order level. Individual line items may still have their own suppliers assigned based on the product settings.

## Frequently asked questions

**Can I add the same item more than once?**
No. Each product can only appear once per order. If a product is already in the order, its **Add** button shows **Added** and cannot be clicked again. To change the quantity, edit the existing line directly.

**Does clicking Suggest Order overwrite quantities I already entered?**
Suggest Order only raises a quantity if the recommended amount is higher than what you currently have. It will not reduce a quantity you have already set manually.

**What happens if I save as Draft and come back later?**
The order is saved exactly as you left it. You can return to it anytime from the Purchase Orders list, continue editing, and save again.

**Can I export a Draft order?**
Yes. Any saved order — including a Draft — can be exported as long as it has at least one item.

**Do exported files update automatically if I change the order later?**
No. Each export is a snapshot of the order at the moment you click Export. If you make changes after exporting, you will need to export again.

## Related articles

- [Manage Your Inventory: Add, Edit, and Track Products](/help/manage-inventory-products)
- [Import Supplier Receipts to Update Inventory](/help/receipt-import)
- [Create and Manage Prep Recipes](/help/prep-recipes)
- [Roles and What Each One Can Access](/help/roles-and-permissions)
