---
title: "Import Supplier Receipts to Update Inventory"
category: "inventory-and-recipes"
summary: "Upload a supplier receipt image or PDF so AI extracts line items which you review and confirm to add purchases to your inventory."
audience: ["owner", "manager"]
order: 70
keywords: ["receipt", "import", "supplier", "AI", "OCR", "invoice", "inventory", "photo"]
related: ["manage-inventory-products", "purchase-orders", "expenses-and-print-checks"]
---

# Import Supplier Receipts to Update Inventory

This guide explains how to upload a supplier receipt so EasyShiftHQ can read it automatically and add the purchased items directly to your inventory. It is intended for owners and managers.

## Before you begin

You must be signed in as an **owner** or **manager**. This feature requires an active subscription plan that includes inventory automation. If the Receipt Import page is not available to you, check your subscription or contact your account owner.

## Open the Receipt Import page

Navigate to the Receipt Import page at `/receipt-import`. A **Back to Inventory** button on the page lets you return to the main Inventory view at any time.

The page opens to the **Upload Receipt** tab. A **Receipt History** tab is also available to review past uploads.

## Upload a receipt file

Use this method when you have a receipt saved as an image or PDF on your device.

1. On the **Upload Receipt** tab, click **Upload File**.
2. Click **Select Receipt Image** and choose your file. Supported formats are JPG, PNG, and WEBP images, and PDF files. The maximum file size is 10 MB.
3. The system immediately begins processing:
   - A progress bar appears showing **Uploading receipt...** while the file transfers.
   - The bar then shows **Processing with AI...** while the AI reads and extracts the line items. A note below the bar says this may take up to 30 seconds.
4. When processing is complete, the screen shows **Receipt processed successfully!** and opens the review screen automatically.

## Take a photo of a receipt with your camera

Use this method when you have a physical receipt in hand and want to capture it directly.

1. On the **Upload Receipt** tab, click **Take Photo**.
2. Use the camera capture area that appears to photograph the receipt.
3. Once captured, the same upload and AI processing steps run as described above.

## Handle a duplicate file warning

If you upload a file that has already been uploaded before, a **Possible duplicate receipt** dialog appears. It shows the vendor name, amount, and the date the file was previously uploaded, along with a **View previous receipt** link.

- Click **Cancel** to stop and not upload the file again.
- Click **Upload anyway** to proceed and create a new import from the same file.

## Review and confirm the extracted line items

After processing completes, the receipt moves to **Ready to Review** status. The review screen opens automatically, or you can return to it later from Receipt History by clicking **Review Items**.

The review screen shows a panel with the receipt image (or PDF) on the left and the extracted line items on the right.

### Check the vendor and purchase date

At the top of the review panel, confirm the **Vendor** and **Purchase Date** fields extracted from the receipt. You can:

- Select a different supplier from the **Vendor** dropdown, or type a new supplier name to create one.
- Click the **Purchase Date** field to pick the correct date from a calendar if the AI extracted it incorrectly.

### Review item sections

Line items are grouped into three sections based on how confident the AI was in its reading:

- **Needs Attention** — items the AI was least certain about; review these first.
- **Quick Review** — items with moderate confidence; verify and adjust as needed.
- **Ready to Import** — items the AI matched with high confidence; click **Show** to expand and inspect them if you wish.

For each line item you can adjust the name, quantity, price, package type, and size. You can also map the item to an existing inventory product using the dropdown, mark it as a new item to be created, or skip it entirely.

If the same receipt was already imported under a different file (same vendor, date, and total), a **Similar receipt already uploaded** warning banner appears. Review it and click the **View** link to compare, or dismiss the banner and continue.

### Confirm the import

When you are satisfied with the line items, confirm the import using the import button in the status bar at the top of the review panel. EasyShiftHQ adds the quantities to your existing inventory products (or creates new products for items marked as new), and the receipt status changes to **Imported**.

## View receipt history

1. On the Receipt Import page, click the **Receipt History** tab.
2. The list shows all previously uploaded receipts with vendor name, upload date and time, and amount. Each row displays a status badge:
   - **Uploaded** — the file was received but not yet processed.
   - **Ready to Review** — AI processing is done and the receipt is waiting for your review.
   - **Imported** — the receipt has been confirmed and inventory was updated.
3. Click any row, or click **Review Items** (for ready-to-review receipts) or **View Details** (for already-imported receipts), to open that receipt's review screen.

## Tips

- Receipts from the same supplier are matched automatically to your existing products. The more receipts you import, the better the automatic matching becomes over time.
- If you map an item to an existing product once, future receipts from the same supplier will recognize that item automatically.
- You can correct the purchase date after a receipt is already imported. Updating it on an imported receipt also updates the corresponding inventory transaction dates.
- Skipping an item in the review screen excludes it from the import without affecting other items.

## Troubleshooting

**The Upload File or Take Photo buttons are grayed out.**
Processing is already in progress. Wait for the current upload to finish before selecting a new file.

**Processing with AI... takes longer than expected.**
AI processing typically completes within 30 seconds but can take up to a minute for large files. If it times out, an error notification appears. Try uploading again. Very large PDFs or low-contrast photos may take longer or produce fewer extracted items.

**The vendor name or purchase date extracted by AI is wrong.**
You can correct both fields on the review screen before confirming the import. Changes take effect immediately.

**A "Similar receipt already uploaded" banner appears on the review screen.**
This means a previously imported receipt has the same vendor name, purchase date, and total amount. Use the **View** link in the banner to compare the two receipts, then decide whether to continue importing or dismiss and cancel.

**Items are missing from the extracted list.**
The AI reads the receipt as an image. Blurry photos, poor lighting, or heavily formatted PDFs may result in some lines being missed. You cannot manually add lines on the review screen, but you can record missed items using a [purchase order](/help/purchase-orders) or by adjusting stock directly on the [Inventory](/help/manage-inventory-products) page.

**The import button does not appear.**
If you are viewing a receipt that is already in **Imported** status, the import action is no longer available. You can still view the details and adjust the purchase date.

## Frequently asked questions

**What file types and sizes are supported?**
You can upload JPG, PNG, and WEBP image files, as well as PDF files. The maximum file size is 10 MB per receipt.

**Will importing a receipt create duplicate inventory products?**
If an item on the receipt matches an existing product in your inventory, EasyShiftHQ adds the quantity to that product rather than creating a new one. Items you mark as "new item" during review are created as new products. You can always merge or clean up products afterward on the Inventory page.

**Can I re-import a receipt I already imported?**
The system warns you if you upload the same file again (the "Possible duplicate receipt" dialog). You can choose to upload anyway, which creates a separate import. Be careful not to double-count quantities in your inventory.

**What happens to the receipt image after upload?**
The original file is stored securely and remains accessible from the Receipt History tab so you can refer back to it at any time.

**Can staff members use Receipt Import?**
No. Only owners and managers have access to the Receipt Import page. Staff and other roles do not see this feature.

## Related articles

- [Manage Your Inventory: Add, Edit, and Track Products](/help/manage-inventory-products)
- [Create and Manage Purchase Orders](/help/purchase-orders)
- [Track Expenses, Upload Invoices, and Print Checks](/help/expenses-and-print-checks)
- [Roles and What Each One Can Access](/help/roles-and-permissions)
