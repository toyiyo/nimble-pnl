---
title: "Run an Inventory Count (Reconciliation)"
category: "inventory-and-recipes"
summary: "Start, conduct, and complete a physical inventory count session that compares expected stock to actual counted quantities and applies corrections."
audience: ["owner", "manager", "chef"]
order: 30
keywords: ["reconciliation", "inventory count", "variance", "stock count", "physical count", "audit"]
related: ["manage-inventory-products", "barcode-scanning-inventory", "purchase-orders"]
---

# Run an Inventory Count (Reconciliation)

This article covers how to run a physical inventory count in EasyShiftHQ — from starting a new session to reviewing variances and applying corrections to your stock levels. It is intended for owners, managers, and chefs who are responsible for keeping inventory accurate.

## Before you begin

You must be signed in to an account with owner, manager, or chef access. You must also have at least one product added to Inventory before a count can be started.

## Open the Reconcile tab

1. From the main navigation, go to **Inventory Management**.
2. At the top of the page, click the **Reconcile** tab.
   - If a count is already in progress, the tab shows a blue **Active** badge.
3. The **Inventory Reconciliation History** screen appears, listing all past and in-progress counts.

## Start a new count

1. On the **Inventory Reconciliation History** screen, click **Start New Count**.
2. EasyShiftHQ creates a new session and loads every product in your inventory into the count sheet, with each product's current recorded quantity shown as the **Expected** amount.
3. The view switches to the counting screen, which shows the heading **Counting in Progress** and a progress bar tracking how many items you have counted.

## Enter actual quantities

The counting screen displays a table with columns for **Product**, **Unit**, **Expected**, **Actual Count**, **Variance**, and **Status**.

1. Locate the product you are counting. You can scroll through the list or use the search bar (see below).
2. Click the **Actual Count** field next to the product and type the quantity you physically counted.
3. Press Enter or click away from the field. The **Variance** column updates immediately to show the difference between expected and actual, and the **Status** badge changes:
   - **Not Counted** — no quantity entered yet.
   - Green **OK** — actual matches expected (zero variance).
   - Yellow badge — a small variance (under $50 in value, or under 10 units if no cost is set).
   - Red badge — a large variance.
4. Repeat for each product you are counting. The progress bar advances as you go.

You do not need to count every item before saving or submitting.

## Search for a specific product

1. While on the counting screen, use the **Search products...** bar at the top of the list.
2. Type any part of the product name or SKU to filter the list instantly.

## Sort the product list

1. Next to the search bar, open the sort dropdown (default is **Name**).
2. Choose from:
   - **Name** — alphabetical
   - **Unit** — by purchase unit
   - **Expected** — by expected quantity
   - **Actual** — by the quantity you have entered so far
   - **Variance** — by the size of the difference
   - **Status** — uncounted items first, then counted
3. Click the arrow button next to the dropdown to toggle between ascending and descending order.

## Use scanner mode during a count

If you prefer to scan barcodes to locate items rather than scrolling the list:

1. On the counting screen, click **Scan**.
2. Choose your scanner type:
   - **Camera Scanner** — uses your device's camera for continuous barcode detection.
   - **AI OCR Scanner** — takes a photo and uses AI to detect the barcode (useful for damaged or unclear barcodes).
   - **Keyboard Scanner** — works with a USB laser barcode scanner plugged into your device.
3. Scan the barcode on the product. If the product is in the current count, a dialog opens where you can enter the quantity found at that location.
4. To close the scanner and return to the list, click **Scan** again (the button shows **Close** while the scanner is open).

## Save progress without completing

At any time during a count, click **Save** to save all quantities you have entered so far without finishing the count. Your progress is stored and the session remains open so you can return to it later.

## Review and submit the count

When you are ready to finalize:

1. Click **Review** on the counting screen.
   - The **Review** button is only active after at least one item has been counted.
2. The **Reconciliation Summary** screen appears, showing three summary cards:
   - **Items Counted** — how many products you entered a quantity for, out of the total.
   - **Items with Variance** — how many of those have a difference from expected.
   - **Total Impact** — the net dollar value of all variances (shown in red for shrinkage, green for overage).
3. A **Top Variances** list highlights the products with the largest dollar differences.
4. If any products have no quantity entered, a notice tells you how many uncounted items remain. You can still submit — uncounted items will not be adjusted.
5. To go back and make corrections, click **Back to Counting**.
6. To download the full item-by-item breakdown before submitting, click **Export CSV**.
7. When you are satisfied, click **Confirm & Submit Reconciliation**.
   - All counted products have their stock levels updated to the actual quantities you entered.
   - The session moves to **Completed** status in the history.

## Resume an in-progress count

If a count was saved but not submitted, you can pick up where you left off:

1. Go to the **Reconcile** tab. The tab shows a blue **Active** badge if a session is open.
2. On the **Inventory Reconciliation History** screen, find the session with an **In Progress** badge.
3. Click **Resume** next to that session.
4. The counting screen reopens with all previously entered quantities intact.

## View a completed count's report

1. Go to the **Reconcile** tab.
2. On the **Inventory Reconciliation History** screen, find the session with a green **Completed** badge.
3. Click **View** next to that session to open the full reconciliation report.

## Tips

- Count during a quiet period (before opening or after close) so stock does not change while you are counting.
- Use the **Save** button if you need to pause and count a different area of your restaurant. The session remains open until you submit or cancel it.
- The **Expected** quantity reflects what EasyShiftHQ thinks you have based on purchases, sales, and manual adjustments. Variances help you spot theft, waste, or data entry errors.
- If the **Reconcile** tab shows a blue **Active** badge, a count is already in progress. Resume that session to continue where you left off, or cancel it before starting a fresh one — leaving multiple sessions open can cause confusion about which count is current.
- On mobile, each product appears as a card rather than a table row, but all the same fields are available.

## Troubleshooting

**The "Start New Count" button does not appear.**
Make sure you are on the **Reconcile** tab inside **Inventory Management**. The button is always visible at the top of the history list. If you do not see the list, make sure you are on the **Reconcile** tab (not Products, Scanner, Low Stock, or Settings).

**The "Review" button is grayed out.**
You must enter an actual count for at least one item before the **Review** button becomes active.

**I accidentally cancelled the count.**
Cancelling permanently deletes all progress for that session and does not adjust any stock levels. You will need to start a new count.

**A product does not appear in the count list.**
The count session captures products that exist at the moment you click **Start New Count**. Any product added to inventory after the session started will not appear. Cancel the session and start a new one to include newly added products.

**The scanner does not find my product.**
Scanner mode looks up products by their barcode or SKU. If a product was added manually without a barcode, use the search bar instead to find it in the list.

**I submitted the count but the stock levels look wrong.**
Only items where you entered an actual quantity are updated. Uncounted items keep their existing stock level. If you need to correct a submitted count, you can adjust individual product quantities from the **Products** tab on the Inventory page.

## Frequently asked questions

**Can I count items in stages across multiple shifts?**
Yes. Use **Save** to preserve your work at any point. The session stays open until you click **Confirm & Submit Reconciliation** or cancel it. Multiple team members can count different sections and save their entries to the same session.

**What happens to items I did not count when I submit?**
Uncounted items are not changed. Their stock levels remain at whatever EasyShiftHQ had recorded before the count. The summary screen warns you of how many items were left uncounted.

**Can I undo a submitted reconciliation?**
No. Once you click **Confirm & Submit Reconciliation**, the stock levels are updated and the session is marked Completed. To correct a mistake, adjust the affected product directly from the Inventory Products tab.

**How is the Total Impact dollar figure calculated?**
Each variance (actual minus expected) is multiplied by the product's unit cost. Negative values mean you have less stock than expected (shrinkage); positive values mean you have more (overage). The Total Impact card shows the net of all variances.

**Who can run an inventory count?**
Any team member with an owner, manager, or chef role can start, conduct, and submit a reconciliation. Staff and kiosk roles do not have access to the Reconcile tab.

## Related articles

- [Manage Your Inventory: Add, Edit, and Track Products](/help/manage-inventory-products)
- [Scan Barcodes to Add and Update Inventory](/help/barcode-scanning-inventory)
- [Create and Manage Purchase Orders](/help/purchase-orders)
- [Import Supplier Receipts to Update Inventory](/help/receipt-import)
- [Roles and What Each One Can Access](/help/roles-and-permissions)
