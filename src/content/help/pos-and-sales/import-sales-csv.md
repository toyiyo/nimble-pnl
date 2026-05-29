---
title: "Import Sales from a CSV File"
category: "pos-and-sales"
summary: "Upload a CSV export from any POS system, map columns, review and correct records, and confirm before importing."
audience: ["owner", "manager"]
order: 50
keywords: ["CSV", "import", "upload", "file", "Toast", "Square", "column mapping", "template", "duplicate"]
related: ["view-filter-pos-sales", "record-edit-manual-sales", "categorize-pos-sales", "connect-pos-system"]
---

# Import Sales from a CSV File

This article explains how to upload a CSV file exported from any POS system — such as Toast or Square — map its columns to EasyShiftHQ fields, review and correct records, and confirm the import. It is intended for owners and managers.

## Before you begin

- You must be signed in as an **owner** or **manager**. Staff and other collaborator roles cannot access the import feature.
- Export a CSV file from your POS system before starting. The file must end in `.csv`.
- At minimum, your file needs a column that contains item names. Columns for date, quantity, price, time, and order ID are recommended but not required.

## Open the Import from File tab

1. Go to **Sales** in the left navigation (or navigate directly to `/pos-sales`).
2. In the page header, click the **Import** button, or click the **Import from File** tab near the bottom of the page. Both actions activate the same upload screen.

## Upload your CSV file

1. On the **Upload POS Sales File** card, click **Choose CSV File**.
2. A file picker opens — select your `.csv` file and confirm.
3. The app reads the file. If the file is not a valid CSV, you will see an error message and can try a different file.

## Map columns to fields

After the file loads, a column-mapping dialog opens. This is where you tell EasyShiftHQ which column in your file corresponds to which sales field.

### What the dialog shows

- Each row in the dialog represents one target field (such as **Item Name**, **Date**, **Quantity**, **Price**, **Time**, and **Order ID**).
- Next to each field is a dropdown listing every column header found in your CSV.
- A sample of the first few rows from your file is shown so you can verify you are picking the right column.

### Auto-suggestions and saved templates

- The app automatically suggests the most likely column match for each field based on your column names.
- If you have imported a file with the same column headers before and saved a mapping template, the app applies that template automatically and shows a **"Template applied"** notice with the template name. You can still adjust any mapping before confirming.

### Required and recommended mappings

| Field | Required? |
|---|---|
| Item Name | Yes — rows without an item name are skipped |
| Date | Recommended — rows without a date will need one added during review |
| Quantity | Recommended |
| Price / Amount | Recommended |
| Time | Optional |
| Order ID | Optional but helps prevent duplicate imports |

### Adjustment columns (discounts, taxes, tips)

If your CSV has columns for discounts, taxes, tips, service charges, or fees, you can mark them as **adjustment** columns during mapping. EasyShiftHQ creates separate entries for each adjustment amount, keeping them out of revenue totals.

### Save a mapping template

If you plan to import files from the same POS system regularly, you can save your column mappings as a named template:

1. Before clicking **Confirm**, enter a name in the **Save as template** field.
2. Click **Confirm**. The template is saved and will be applied automatically the next time a file with the same column headers is uploaded.

### Confirm your mappings

Once the columns look correct, click **Confirm**. The app parses all rows using your mappings and moves you to the review screen.

## Review and correct records

The **Review Imported Sales** table shows every record parsed from your file. Before anything is saved to your account, you can inspect and edit the data.

### Status badges

At the top of the table you will see counts for:

- **Valid** — records ready to import.
- **Adjustments** — discount, tax, tip, or fee entries (shown in blue).
- **Summary Rows** — rows that appear to be totals or aggregate lines (shown in amber). These are excluded by default.
- **Errors** — records missing an item name or a required date (shown in red). All errors must be fixed before you can import.
- **Voided/Zero** — items with a zero quantity or that appear to be voided or refunded. These are excluded by default.

### Apply a date when the file has none

If your file contains no date column, an orange banner appears at the top of the review table:

1. Click **Pick a date** in the banner.
2. A calendar picker opens — choose the date that applies to all records in the file.
3. The date is applied to every row and the banner turns green, confirming **"Date applied to all rows."**
4. You can click **Change Date** if you need to correct your selection.

You cannot click **Import** until a date has been applied or all rows already have dates.

### Edit a row inline

1. Click the pencil icon on the row you want to change.
2. The row's fields (Item Name, Category, Quantity, Unit Price, Total, Date, Time, Order ID) become editable inputs.
3. Make your changes, then click the save icon to apply them, or the X icon to discard changes.

### Remove a row

Click the X icon on any row to remove it from the import entirely. This does not affect your original file.

### Include or exclude voided and summary rows

Rows flagged as **Voided/Zero** or **Summary** are excluded by default. Each of those rows has an **Include** button. Click it to add the row to the import, or click **Exclude** to remove it again.

## Import the records

When the table shows no errors and every row looks correct:

1. Click **Import N Sales** (the button shows the exact count of valid, included records — for example, "Import 12 Sales").
2. The app checks for duplicates. If any records match transactions already in your account, they are automatically skipped and you will see a notice explaining how many were skipped and how many new records were imported.
3. If all records are duplicates, the import stops and shows a message explaining the situation.
4. On success, you see a confirmation notice and are returned to the **View Sales** tab, where your newly imported records appear.

## Tips

- **Column names are flexible.** EasyShiftHQ recognizes variations like "Item," "Product," "Name," "Amount," "Sale Amount," and many others, so exact matches are not required.
- **Currency symbols are stripped automatically.** Dollar signs, pound signs, and parentheses for negative values (e.g., `(5.00)`) are handled correctly.
- **Save a template the first time** you import from a new POS export format. Future imports from the same system will be mapped instantly.
- **Summary rows** (rows labelled "Totals:", "Grand Total", and similar) are detected and excluded automatically. Review them before deciding to include any.
- **Adjustment columns** such as discounts show up as separate blue-labelled entries in the review table. They are tracked separately and do not add to revenue.

## Troubleshooting

**The file is rejected immediately.**
Only `.csv` files are accepted. If your POS exports in Excel format, open the file in your spreadsheet app and save it as CSV before uploading.

**Many rows are skipped with "Missing item name."**
Your item name column may not have been mapped correctly. Go back and re-upload the file, then select the correct column for **Item Name** in the mapping dialog.

**The import button is greyed out.**
One or more rows still have errors (shown in red). Fix or remove those rows, and make sure a date has been applied if your file had no date column.

**All records are flagged as duplicates.**
This usually means you have already imported this file. Export a different date range from your POS system or verify whether the data exists under **View Sales**.

**The "Template applied" notice appears but the mappings look wrong.**
A saved template matched your file's column headers but the mappings are outdated. Adjust any incorrect mappings in the dialog and save over the template with a new name, or correct the existing one.

**I imported the wrong file by mistake.**
Find the records under the **View Sales** tab, use the date range filter to locate them, and delete each entry manually. Manual and file-imported sales can be deleted individually from the sales list.

## Frequently asked questions

**Can I import sales from any POS system, or only Toast and Square?**
You can import from any POS system that can export a CSV file. The app works with the column headers in your file regardless of where it came from.

**What happens if my CSV has both gross sales and net sales columns?**
If your file also includes a discount column, EasyShiftHQ uses the gross sales figure and tracks the discount as a separate adjustment entry. If there is no discount column, net sales is used.

**Can I import the same file twice by accident?**
The app checks for duplicate records before saving. Any records that match existing transactions are automatically skipped. If your entire file is already in the system, the import is stopped and you are told it is a duplicate.

**My file has no dates. Can I still import it?**
Yes. A date picker appears on the review screen. Select the date that applies to all records in the file and it is applied to every row before you import.

**How do I know if a row is a "Summary Row" that I should exclude?**
Rows that look like totals — for example, a row labelled "Totals:" or one that contains an unusually large number compared to the other rows — are automatically flagged with a yellow **Summary** badge. Exclude them unless you specifically want them included in your records.

## Related articles

- [View, Search, and Filter Your POS Sales](/help/view-filter-pos-sales)
- [Record and Edit Sales Manually](/help/record-edit-manual-sales)
- [Categorize Sales and Create Automation Rules](/help/categorize-pos-sales)
- [Connect and Sync a POS System](/help/connect-pos-system)
