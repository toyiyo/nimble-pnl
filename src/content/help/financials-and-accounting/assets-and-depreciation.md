---
title: "Track Fixed Assets and Depreciation"
category: "financials-and-accounting"
summary: "Add, edit, and dispose of restaurant equipment and other fixed assets, record depreciation entries, and bulk-import assets from an invoice or CSV."
audience: ["owner", "accountant"]
order: 60
keywords: ["assets", "depreciation", "equipment", "fixed assets", "dispose", "import", "net book value"]
related: ["expenses-and-print-checks", "financial-statements", "chart-of-accounts-and-intelligence"]
---

# Track Fixed Assets and Depreciation

This article explains how to use the Assets & Equipment section of EasyShiftHQ to add, track, and depreciate your restaurant's fixed assets—such as kitchen equipment, furniture, and POS hardware—and how to record when an asset is sold or retired. It is intended for owners and accountants.

## Before you begin

You must be signed in with an Owner or Accountant role to add, edit, or delete assets. If you want depreciation entries to post to your books automatically, set up the relevant accounts in your chart of accounts first and link them to each asset under Accounting Settings (see [Set Up the Chart of Accounts and View Financial Intelligence](/help/chart-of-accounts-and-intelligence)).

## Navigate to Assets & Equipment

1. In the main navigation, select **Assets & Equipment**.
2. At the top of the page you will see four summary cards:
   - **Total Assets** — the total number of asset units across all records, with a note showing how many are active. If a record has a quantity greater than one, each unit is counted individually.
   - **Total Cost** — the original purchase value of all assets.
   - **Net Book Value** — the current book value after accumulated depreciation.
   - **Pending Depreciation** — the number of active assets that still need a depreciation entry posted. When this number is greater than zero, the card is highlighted to draw attention.

## Add an asset

1. Click **Add Asset** in the top-right area of the page.
2. A panel slides in with two tabs: **Details** and **Photos**. Fill in the **Details** tab first.

### Basic Information

| Field | Notes |
|---|---|
| **Asset Name** | Required. For example, "Walk-in Refrigerator." |
| **Category** | Required. Choose from: Kitchen Equipment, Furniture & Fixtures, Electronics, Vehicles, Leasehold Improvements, Office Equipment, Signage, HVAC Systems, Security Systems, POS Hardware, or Other. Selecting a category automatically fills in a suggested useful life. |
| **Serial Number** | Optional. Useful for warranty and insurance tracking. |
| **Location** | Optional. Choose an existing location or type a name to create a new one on the spot. |
| **Description** | Optional free-text field for notes about the asset. |

### Financial Details

| Field | Notes |
|---|---|
| **Purchase Date** | Required. |
| **Quantity** | Number of identical units purchased together (defaults to 1). |
| **Unit Cost** | Cost per unit. The **Total Cost** field calculates automatically based on quantity. |
| **Salvage Value** | Estimated value at the end of the asset's useful life (can be $0). |
| **Useful Life (Months)** | How many months the asset is expected to last. The category default is pre-filled; adjust as needed. A years-and-months breakdown is shown below the field. |

A **Depreciation Preview** panel appears once you enter a cost, showing the depreciable amount and the monthly depreciation under straight-line depreciation.

### Accounting Settings (optional)

Click the **Accounting Settings** toggle to expand additional fields:

- **Asset Account** — the fixed-asset account to debit.
- **Accumulated Depreciation Account** — the contra-asset account to credit when depreciation is posted.
- **Depreciation Expense Account** — the expense account to debit when depreciation is posted.
- **Notes** — any internal notes you want to store with the asset.

These account links are required before you can post a depreciation entry that creates a journal entry. You can add them now or return and edit the asset later.

3. Click **Add Asset** to save.

### Add photos

After saving (or when editing an existing asset), open the **Photos** tab to attach images. Drag and drop image files or click the upload area to browse. Supported formats are JPG, PNG, GIF, and WEBP up to 10 MB each. The first photo uploaded is marked as **Primary**. You can click any photo to view it full-screen, set a different photo as primary, or delete photos you no longer need.

## Filter and search the asset list

Below the summary cards is the full asset table. Use these controls to narrow what you see:

- **Status tabs** — choose **All**, **Active**, **Fully Depreciated**, or **Disposed**.
- **Category filter** — a dropdown that limits the list to a single category.
- **Search box** — searches by asset name, serial number, or category.

The table columns are: Asset (name, location, serial number), Category, Purchase Cost, Net Book Value, Depreciation (a progress bar showing percentage depreciated and months remaining), and Status.

## Edit an asset

1. Find the asset in the list and click the three-dot menu at the end of its row.
2. Select **Edit**.
3. The same panel used to add the asset opens with the current values filled in. Update any field and click **Save Changes**.

## Run depreciation for an asset

Depreciation can only be posted for assets with a status of **Active**.

1. In the asset's three-dot menu, select **Run Depreciation**.
2. A Depreciation panel slides in showing the asset's Purchase Cost, Salvage Value, Depreciable Amount, Accumulated Depreciation, and current Net Book Value.
3. The **Period Start** and **Period End** fields are pre-filled with the suggested next period based on the last depreciation posted. Adjust them if needed.
4. Click **Calculate Preview**. The panel shows:
   - Monthly Rate
   - Months in Period
   - Depreciation Amount
   - New Accumulated (total after posting)
   - New Net Book Value
   - A notice if this entry will fully depreciate the asset.
5. Click **Post Depreciation & Create Journal Entry** to record the entry. This requires the Accumulated Depreciation Account and Depreciation Expense Account to be configured on the asset.

After posting, the entry appears in the **Depreciation History** table at the bottom of the panel, including the period, the amount, the resulting net book value, and the linked journal entry number.

## Dispose of an asset

Use disposal to record that an asset has been sold, scrapped, or otherwise retired. Disposed assets remain in the system for historical reference but can no longer be depreciated.

1. In the asset's three-dot menu, select **Dispose**.
2. The Dispose Asset dialog shows the asset's original cost, accumulated depreciation, and net book value.
3. Fill in:
   - **Disposal Date** — defaults to today; change if needed.
   - **Sale Proceeds (Optional)** — if the asset was sold, enter the amount received. The dialog calculates and displays the gain or loss on disposal.
   - **Notes (Optional)** — reason for disposal, buyer name, or other details.
4. Click **Dispose Asset** to confirm. This action cannot be undone.

## Delete an asset record

Deleting an asset permanently removes it along with all its photos and depreciation history.

1. In the asset's three-dot menu, select **Delete**.
2. A confirmation dialog appears warning that this cannot be undone.
3. Click **Delete** to confirm, or **Cancel** to go back.

Only delete an asset if the record was entered in error. For assets that have been retired, use the Dispose action instead so you retain historical data.

## Import assets in bulk

Use Import to add multiple assets at once from an invoice, receipt, or spreadsheet.

1. Click **Import** near the top of the Assets & Equipment page.
2. The import dialog opens. You can drag a file onto the upload area or click one of two buttons:
   - **Invoice / Receipt** — accepts PDF, JPG, PNG, and WEBP files. AI reads the document and extracts line items automatically.
   - **Spreadsheet** — accepts CSV, XLS, XLSX, and XML files. For these files you can choose whether to let AI extract the data or map columns yourself.
3. If you upload a spreadsheet and choose column mapping, a dialog lets you match each column in your file to the corresponding asset field (name, category, purchase date, unit cost, and so on).
4. Once the file is processed, the **Review Extracted Assets** screen appears. For each line item you can:
   - Edit the **Asset Name**.
   - Change the **Category** from the dropdown.
   - Adjust the **Purchase Date**, **Qty** (quantity), **Unit Cost**, and useful life in months.
   - Remove a row you do not want to import by clicking the trash icon.
   - An AI confidence badge (High, Medium, or Low) indicates how certain the extraction was.
   - Items without a unit cost are marked **Needs price** and will be skipped unless you enter a value.
5. When the list looks correct, click **Import N Assets** to save all ready items.

A CSV template is available if you want a pre-formatted file to fill in. Click **Download Template** at the bottom of the upload screen.

## Tips

- Choosing the correct category when you add an asset automatically fills in a standard useful life (for example, Kitchen Equipment defaults to 84 months / 7 years, POS Hardware to 36 months / 3 years). You can always override the default.
- If you purchase several identical items on the same invoice, set **Quantity** to the number of units and enter the **Unit Cost** per unit. The total cost is calculated for you.
- Run depreciation once a month or once a quarter to keep your net book value and financial statements current.
- The **Pending Depreciation** summary card on the Assets page is a quick way to check whether any active assets are overdue for a depreciation entry.
- Photos stored on an asset are a handy reference for insurance claims and equipment serial number tracking.

## Troubleshooting

**The "Post Depreciation & Create Journal Entry" button is disabled.**
The asset is missing its Accumulated Depreciation Account or Depreciation Expense Account. Edit the asset, expand **Accounting Settings**, select the correct accounts, save, and try again.

**The "Run Depreciation" option does not appear in the menu.**
Run Depreciation is only available for assets with an **Active** status. Assets that are Fully Depreciated or Disposed cannot receive new depreciation entries.

**An imported item shows "Needs price" and will not import.**
The AI or column mapping could not find a unit cost for that row. Enter a value in the Unit Cost field on the review screen before clicking Import.

**I disposed of an asset by mistake.**
Disposal cannot be undone from within the app. Contact your account owner or accountant to correct the record manually.

**Assets are not showing up after I add them.**
Check the status tab and category filter — an active filter may be hiding the asset. Switch to **All** and clear the category filter to see every record.

## Frequently asked questions

**What depreciation method does EasyShiftHQ use?**
The app uses straight-line depreciation. The depreciable amount (purchase cost minus salvage value) is divided evenly over the useful life in months.

**Can I record depreciation without linking chart-of-accounts entries?**
The app requires the Accumulated Depreciation Account and Depreciation Expense Account to be set on an asset before it will post a depreciation entry and create a journal entry. You can still track the asset and its net book value without those accounts linked, but no journal entry will be created.

**What happens to depreciation history when I dispose of an asset?**
All historical depreciation entries are kept. The asset moves to Disposed status and no further depreciation can be posted, but you can still view the full history in the Depreciation panel.

**Can I import assets from my POS invoice?**
Yes. If your POS system or supplier emails you a PDF invoice, upload it using the Invoice / Receipt button. The AI will attempt to extract each line item as a potential asset. Review and correct the results before confirming the import.

**How do I fix an asset that was entered with the wrong purchase cost?**
Open the asset's three-dot menu and select Edit. Update the Unit Cost and save. Note that if depreciation has already been posted, the historical entries will not change automatically — consult your accountant about any adjustments needed.

## Related articles

- [Set Up the Chart of Accounts and View Financial Intelligence](/help/chart-of-accounts-and-intelligence)
- [Track Expenses, Upload Invoices, and Print Checks](/help/expenses-and-print-checks)
- [View and Export Financial Statements](/help/financial-statements)
