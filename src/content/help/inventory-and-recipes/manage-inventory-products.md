---
title: "Manage Your Inventory: Add, Edit, and Track Products"
category: "inventory-and-recipes"
summary: "Add products, update stock levels, set par levels and reorder points, record waste, transfer items between locations, and export your product list."
audience: ["owner", "manager", "chef"]
order: 10
keywords: ["inventory", "product", "stock", "par level", "reorder", "waste", "transfer", "SKU", "low stock"]
related: ["barcode-scanning-inventory", "inventory-reconciliation", "purchase-orders", "receipt-import"]
---

# Manage Your Inventory: Add, Edit, and Track Products

This article walks owners, managers, and chefs through every core inventory task in EasyShiftHQ — from adding your first product and setting reorder thresholds to recording waste and moving items between locations.

## Before you begin

You must be signed in and have a restaurant selected. Only **owners** and **managers** can delete products; chefs can add, edit, record waste, and transfer items.

Navigate to **Inventory Management** from your dashboard. The page opens on the **Products** tab by default.

---

## Add a new product

1. In the top-right corner of the Inventory Management page, click **Add Product**.
2. The product form opens. Fill in the fields:
   - **SKU** (required) — your internal code for the item, e.g. `BEEF-001`
   - **Product Name** (required) — the full name as you want it to appear
   - **Description** — optional notes about the product
   - **Brand** — the manufacturer or supplier brand
   - **Category** — type or select a category (Beverages, Meat & Poultry, Seafood, Produce, Dairy, Dry Goods, Spices & Seasonings, Cleaning Supplies, Paper Products, Other)
   - **Product Image** — click the image box to upload a photo
3. In the **Size & Packaging** section, fill in package size, quantity, and units.
4. In the **Cost & Supplier** section, enter the **Unit Cost** and optionally click **Add Supplier** to link a supplier and their price.
5. In the **Inventory Levels** section, set:
   - **Reorder Point** — when stock falls to this number, the product appears in the Low Stock tab
   - **Minimum Par Level** — the least amount you want on hand at any time
   - **Maximum Par Level** — the most you want to store (useful for managing shelf space)
   - **Shelf Life (days)** — how many days the item stays fresh after opening
6. In the **Inventory Update** section at the top of the form, choose **Add Quantity** and enter your starting stock count, or leave it at zero and update stock later.
7. Click **Update Product** to save. The new product appears in your product grid immediately.

> **Tip:** You can also add products by scanning a barcode on the **Scanner** tab. See [Scan Barcodes to Add and Update Inventory](/help/barcode-scanning-inventory).

---

## Search, filter, and sort your products

The **Filters & Sorting** card on the Products tab lets you narrow down exactly what you see.

1. **Search** — type a product name, SKU, or brand name in the search box to filter the list in real time.
2. **Category** — choose a category from the dropdown to show only products in that group.
3. **Stock Status** — filter by:
   - **All Products** — no filter
   - **In Stock** — stock is above the reorder point
   - **Low Stock** — stock is at or below the reorder point but greater than zero
   - **Out of Stock** — stock is zero
   - **Overstock** — stock exceeds the maximum par level
4. **Sort By** — choose the column to sort on: Name, Stock Level, Unit Cost, Inventory Cost, Inventory Value, Category, or Last Updated.
5. **Ascending / Descending** — click the direction button to flip the sort order.

A count at the bottom of the filter card shows how many products match your current filters. To remove all filters at once, click **Clear [n] filters** (appears when at least one filter is active).

---

## Edit a product or adjust stock

1. On the Products tab, click anywhere on a product card to open the edit dialog.
2. To **adjust stock**, choose a method at the top of the form:
   - **Add Quantity** — enter the amount to add to the current stock total (for receiving new deliveries)
   - **Set Exact Count** — enter your physical count to override the current number (for count corrections)
   A preview line shows the before-and-after stock level as you type.
3. Update any other fields — name, SKU, brand, category, cost, par levels, or supplier — as needed.
4. Click **Update Product** to save. Stock changes are recorded in the audit trail automatically.

> **Supplier history:** The Cost & Supplier section shows all linked suppliers with their last price, average price, number of purchases, and last order date. Click the star icon to set a preferred supplier. Click the dollar-sign icon to update a supplier's price.

---

## Record waste

Use this when an item is expired, damaged, spoiled, spilled, or contaminated.

1. On a product card, click the **Waste** icon (trash can).
2. In the **Report Waste** dialog:
   - **Quantity** — enter how much was wasted (cannot exceed current stock)
   - **Waste Type** — select: Expired, Damaged, Spoiled, Spilled, Contaminated, or Other
   - **Reason** — write a brief description of what happened
   - **Additional Notes** — optional details
   - **Include in daily P&L** — leave this checked to automatically add the waste cost to today's food costs in your Profit & Loss report; uncheck it to record the waste without affecting the P&L
3. Review the **Impact** summary, which shows how much stock will be removed and the dollar cost of the waste.
4. Click **Report Waste** to confirm. Stock is reduced immediately and an audit entry is created.

---

## Transfer items between locations

Use this to move inventory between storage areas (for example, walk-in cooler to prep area) without changing the total stock count.

1. On a product card, click the **Transfer** icon (two arrows).
2. In the **Transfer** dialog:
   - **Quantity to Transfer** — enter how much to move
   - **From Location** — select the source location
   - **To Location** — select the destination (must be different from the source)
   - **Reason for Transfer** — briefly describe why the item is being moved (e.g., Restocking, Daily prep)
   - **Additional Notes** — optional
3. A Transfer Summary preview appears once both locations are selected. It notes that two audit entries (OUT and IN) will be created but total stock will not change.
4. Click **Complete Transfer** to save.

---

## View inventory cost and value summaries

At the top of the Products tab, two summary cards show totals for your current filtered product list:

- **Total Inventory Cost** — the total value of all stock on hand, calculated at cost price.
- **Total Inventory Value** — the potential revenue from all stock on hand. This card also shows how many products have recipe-based values versus estimated values.

These numbers update whenever stock levels or costs change.

---

## Export your product list

1. On the Products tab, apply any search or filters you want reflected in the export.
2. In the **Filters & Sorting** card, click **Export**.
3. Choose a format:
   - **Export as CSV** — downloads a spreadsheet file with columns: Name, SKU, Brand, Category, Current Stock, Unit Cost, Inventory Cost, Inventory Value, and Status.
   - **Export as PDF** — downloads a formatted report with columns: Name, SKU, Category, Stock, Unit Cost, Inventory Cost, and Status.

The export always reflects the currently filtered and sorted product list.

---

## Work with the Low Stock tab

The **Low Stock** tab shows every product whose current stock is at or below its reorder point.

- A badge on the tab label shows the count of low-stock items.
- Each card shows the product's current stock, reorder point, unit cost, inventory cost, and inventory value.
- Click **Reorder Now** on any card to open a new Purchase Order pre-filled with that product.
- Click **Export List** (top right of the tab) to download the low-stock list as a CSV file.
- Click a low-stock card to open the edit dialog and update the product's details or add stock.

---

## Tips

- Set a realistic **Reorder Point** for each product — it drives the Low Stock tab and helps you catch shortfalls before service.
- Use **Set Exact Count** after a physical inventory count to quickly correct multiple products without doing the math yourself.
- Link at least one supplier to each product so you can use **Reorder Now** to generate purchase orders with a single click.
- The **Total Inventory Cost** and **Total Inventory Value** cards respond to your active filters, so you can see cost totals for a single category or stock status.
- Waste entries with **Include in daily P&L** checked flow directly into your food cost figures — keep this checked for accurate financial reporting.

---

## Troubleshooting

**I can't delete a product.**
Only owners and managers can delete products. If you are an owner or manager and deletion fails, the product may be linked to recipes, receipt line items, inventory transaction history, or supplier relationships. Remove those links first (for example, remove the ingredient from recipes), then try again.

**My filters show zero results.**
Check whether multiple filters are active at once — for example, a category filter combined with a stock status filter may exclude everything. Click **Clear [n] filters** to reset.

**The stock count doesn't match what I see on the shelf.**
Run a formal count using **Set Exact Count** in the edit dialog, or use the **Reconcile** tab for a guided inventory count session. See [Run an Inventory Count (Reconciliation)](/help/inventory-reconciliation).

**The Reorder Now button opens a blank purchase order.**
Make sure the product has a supplier linked in its **Cost & Supplier** section. See [Create and Manage Purchase Orders](/help/purchase-orders).

**I recorded waste but the P&L didn't update.**
Check that you had **Include in daily P&L** checked when you submitted the waste entry. Past waste entries cannot be edited — record a new adjustment if needed.

---

## Frequently asked questions

**What is the difference between Reorder Point and Minimum Par Level?**
The Reorder Point is the stock level that triggers a Low Stock alert and enables the Reorder Now button — it is your signal to place an order. The Minimum Par Level is the floor you want to maintain during normal operations. In most setups, the Minimum Par Level is higher than the Reorder Point.

**Can I set the stock count to zero?**
Yes. Open the product, choose **Set Exact Count**, enter `0`, and click **Update Product**. The product will appear as Out of Stock.

**Does a transfer change my total inventory numbers?**
No. A transfer creates two audit entries (OUT from the source, IN to the destination) but the total stock count stays the same. Use waste recording when inventory is actually lost.

**Can I export just the low-stock items?**
Yes. Go to the **Low Stock** tab and click **Export List** to download only the low-stock items as a CSV file. Alternatively, on the Products tab, set the Stock Status filter to **Low Stock** and then use **Export**.

**Who can see the inventory pages?**
Owners, managers, and chefs all have access to Inventory Management. Only owners and managers can permanently delete a product. See [Roles and What Each One Can Access](/help/roles-and-permissions).

---

## Related articles

- [Scan Barcodes to Add and Update Inventory](/help/barcode-scanning-inventory)
- [Run an Inventory Count (Reconciliation)](/help/inventory-reconciliation)
- [Create and Manage Purchase Orders](/help/purchase-orders)
- [Import Supplier Receipts to Update Inventory](/help/receipt-import)
- [Build and Manage Menu Item Recipes](/help/menu-item-recipes)
- [Roles and What Each One Can Access](/help/roles-and-permissions)
