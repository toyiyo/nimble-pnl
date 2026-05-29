---
title: "Track Expenses, Upload Invoices, and Print Checks"
category: "financials-and-accounting"
summary: "Record pending vendor bills before they clear your bank, upload invoices for AI extraction, and generate printable check PDFs for vendor payments."
audience: ["owner", "manager", "accountant"]
order: 40
keywords: ["expenses", "invoice", "check printing", "vendor", "payment", "ACH", "MICR", "pending", "outflow"]
related: ["banking-connect-and-transactions", "invoices-and-customers", "financial-statements", "assets-and-depreciation"]
---

# Track Expenses, Upload Invoices, and Print Checks

This guide covers everything on the Expenses and Print Checks pages — recording vendor bills before they hit your bank account, using AI to extract invoice details automatically, and generating ready-to-print check PDFs. It is written for owners, managers, and accountants.

## Before you begin

- You need a connected bank account to see a live **Bank Balance** on the Expenses page. See [Connect Your Bank and Manage Transactions](/help/banking-connect-and-transactions) for setup steps.
- To print checks with MICR encoding (the magnetic line at the bottom of a check), you will need your bank's 9-digit ABA routing number and your checking account number. These are found at the bottom of any printed check from your bank.

## View your balance and uncommitted expenses

Go to **Expenses** in the main navigation.

At the top of the page you will see three summary cards:

- **Bank Balance** — the current balance pulled from your connected bank account.
- **Uncommitted Expenses** — the total of all pending bills and checks that have been entered but not yet cleared the bank.
- **Book Balance** — your Bank Balance minus Uncommitted Expenses, showing what you can actually spend once those bills are paid.

Below the cards, the **Uncommitted Expenses** list shows every vendor bill or check that has been recorded but not yet matched to a bank transaction.

## Add an expense by uploading an invoice

1. Click **Add expense** in the Uncommitted Expenses section. A panel slides in from the right.
2. You have three ways to provide the invoice:
   - **Drag and drop** a PDF or image file directly onto the dashed upload area.
   - Click **Choose file** to browse and select a file from your device (PDF, JPG, PNG, or WebP; maximum 10 MB).
   - Click **Take photo** to use your device's camera and photograph a paper invoice.
3. After the file is received, EasyShiftHQ automatically extracts the details. While extraction runs you will see "We're extracting details...". When it finishes you will see "Invoice scanned - details can be edited."
4. Review the extracted fields. Fields the AI was uncertain about are underlined with a dotted line and show a warning icon — hover over the icon to see the note "We weren't fully sure - please confirm."
5. Correct any fields as needed (see the field descriptions below), then click **Save expense**.

If extraction fails, a notice appears: "We couldn't extract details - you can enter them manually." You can still fill in the form and save.

## Add an expense manually (no file)

1. Click **Add expense**.
2. Click **Enter manually** (the ghost button at the bottom of the upload area).
3. Fill in the form fields and click **Save expense**.

## Expense form fields

| Field | Required | Notes |
|---|---|---|
| **Vendor** | Yes | Search your existing vendor list or type a new name to create one. |
| **Date** | Yes | The invoice date. |
| **Total** | Yes | The dollar amount of the bill. |
| **Category** | No | Maps the expense to a chart-of-accounts category (expense, COGS, or asset). |
| **Due date** | No | When the bill is due. |
| **Invoice #** | No | The vendor's invoice number for reference. |
| **Payment method** | No | Choose **Check**, **ACH**, or **Other**. Defaults to Other. |

## Edit or delete an existing expense

Click any row in the Uncommitted Expenses list to open the **Edit expense** panel.

- Update any of the same fields available when adding an expense. The edit panel also has a **Notes** field for free-form comments and a **Reference #** field for an invoice or check number.
- You can attach additional files (images or PDFs) to a saved expense using the attachment area at the top of the edit panel.
- To delete the expense, click the trash icon in the upper-right corner of the panel. A confirmation dialog will appear before anything is removed.
- Click **Save changes** when done, or **Cancel** to close without saving.

## Set up Check Settings before printing

Go to **Print Checks** (or click the **Print Checks** button from the Expenses page).

If this is your first time, you will see a "Configure Check Settings" screen. Click **Configure Settings** to open the Check Settings dialog.

### Business Information

Fill in your **Business Name**, **Address Line 1**, **Address Line 2** (optional), **City**, **State**, and **ZIP**. These fields print at the top-left of every check. EasyShiftHQ pre-fills them from your restaurant profile if available.

### Bank Accounts

Under **Bank Accounts**, click **Add Account** to add your first checking account. You will need:

| Field | Description |
|---|---|
| **Account Name** | A label for this account, such as "Operating Account". |
| **Bank Name** | Your bank's name (optional but recommended). |
| **Next Check Number** | The next sequential check number to use. Defaults to 1001. |
| **Default account** | Toggle on if this is your primary account for printing. |

**Bank info for printing** is an optional toggle. Turn it on only if you are printing on blank (pre-cut) check stock that does not already have bank information and the MICR line printed on it. If your check stock is pre-printed by your bank, leave this toggle off.

When the toggle is on, two additional fields appear:

- **Routing Number** — your bank's 9-digit ABA routing number. EasyShiftHQ validates the checksum in real time.
- **Account Number** — your checking account number (4–17 digits). After saving, only the last 4 digits are shown; the full number is stored encrypted.

Click **Add** to save the account, then click **Save Settings** to close the dialog.

## Write and print checks

1. Go to **Print Checks** and make sure you are on the **Write Checks** tab.
2. If you have more than one bank account, select the account to draw from using the **Bank Account** dropdown.
3. In the **Checks to Print** table, fill in each row:
   - **Pay To** — the payee name. As you type, your supplier list appears as suggestions.
   - **Amount** — the dollar amount. The app shows the amount written out in words below the field as a visual confirmation.
   - **Date** — the check date (defaults to today).
   - **Memo** — an optional note that prints on the check's memo line.
   - **Category** — an optional chart-of-accounts category.
4. To add more checks to the same batch, click **Add Row**.
5. To exclude a row from the current print job without deleting it, uncheck the checkbox at the left of that row.
6. Click **Print N Check(s)** (the button label shows the number of selected checks). The total dollar amount of the selected checks is shown next to the button. EasyShiftHQ generates a PDF and downloads it to your device.

Each printed check uses the next available check number for the selected account, which increments automatically. The PDF includes the check itself plus two stubs (a PAYEE RECORD and a COMPANY RECORD) perforated for easy separation.

Every printed check is automatically recorded as a pending outflow in your Uncommitted Expenses list.

## View check history and reprint

Switch to the **History** tab on the Print Checks page to see the full audit log.

The table shows:

| Column | What it means |
|---|---|
| **Check #** | The sequential check number assigned at print time. |
| **Payee** | The name on the check. |
| **Amount** | The check amount. |
| **Date** | The issue date on the check. |
| **Action** | "printed", "reprinted", or "voided". |
| **Printed** | The date and time the action was performed. |

To download a copy of a previously printed check, click **Reprint** on any row with an action of "printed" or "reprinted". This re-downloads the same PDF and logs a "reprinted" entry in the audit trail.

## Tips

- **Batch multiple vendor payments in one print run.** Add a row for each vendor, verify the totals in the badge at the top of the table, and print them all at once. EasyShiftHQ numbers the checks sequentially and downloads a multi-page PDF.
- **Use the camera option for receipts in the field.** If a vendor hands you a paper invoice, tap **Take photo** on a phone or tablet to capture it without scanning hardware.
- **Low-confidence fields are flagged.** After AI extraction, any field the system is uncertain about has a dotted underline and an alert icon. Always review those fields before saving.
- **Your bank balance updates from your connected bank.** Expenses you enter here are not automatically sent to your bank — they are a way to track what you owe before transactions clear, giving you an accurate Book Balance.
- **Check numbers increment automatically.** The Next Check Number shown in Check Settings (and in the page subtitle) updates each time you print, so you never need to track numbers manually.

## Troubleshooting

**The invoice upload fails or AI extraction finds nothing.**
Only PDF, JPG, PNG, and WebP files up to 10 MB are accepted. If the file is larger, compress or split it before uploading. If the file type is correct but extraction still fails, you will see "We couldn't extract details - you can enter them manually." Use the manual form in that case.

**"Please select a bank account" error when printing.**
You must have at least one bank account configured in Check Settings. Click **Settings** in the upper-right corner of the Print Checks page and add an account.

**"Bank info incomplete" error when printing.**
If you turned on **Bank info for printing** for an account, the Routing Number and Account Number must both be saved. Open **Settings**, edit the account, and re-enter the missing details.

**The routing number shows "Routing number checksum is invalid."**
Double-check the 9-digit number on the bottom of one of your printed bank checks. The leftmost 9-digit sequence is the ABA routing number. Transposed digits are the most common cause.

**Printed checks appear in Uncommitted Expenses with a "Check" payment method.**
This is expected. The Print Checks feature records every printed check as a pending outflow so your Book Balance stays accurate until the check clears the bank.

**I cannot delete a bank account.**
The last remaining account cannot be deleted. To remove it, first add a replacement account, then delete the original.

## Frequently asked questions

**Do I need to connect my bank to use Expenses?**
No. You can record expenses manually without a connected bank account. The Bank Balance and Book Balance cards will show $0.00, but the Uncommitted Expenses list and all invoice-upload features work independently.

**Will the check PDF work with my check stock?**
If your check stock already has the bank name and MICR line pre-printed by your bank, leave **Bank info for printing** turned off. The PDF will include your business name, address, payee, amount, date, memo, and signature lines. If you use blank check stock, turn on the toggle and enter your routing and account numbers so EasyShiftHQ can generate the MICR line.

**How do I update the starting check number if I skipped some checks?**
Open Check Settings, click the edit (pencil) icon on the bank account, and update **Next Check Number** to the correct value. EasyShiftHQ will use that number for the next print job.

**Can I add notes to an expense after saving it?**
Yes. Click the expense row in the Uncommitted Expenses list to open the Edit expense panel. There is a **Notes** field where you can add or update free-form text, as well as attach additional files.

**What happens if I accidentally print a check?**
Go to the **History** tab and find the check. The audit log records every print event permanently. If you need to void the check, contact your bank directly — EasyShiftHQ does not send void instructions to your bank. You can delete the associated pending outflow from the Expenses page to remove it from your Book Balance.

## Related articles

- [Connect Your Bank and Manage Transactions](/help/banking-connect-and-transactions)
- [View and Export Financial Statements](/help/financial-statements)
- [Create and Send Invoices to Customers](/help/invoices-and-customers)
- [Track Fixed Assets and Depreciation](/help/assets-and-depreciation)
- [Set Up the Chart of Accounts and View Financial Intelligence](/help/chart-of-accounts-and-intelligence)
