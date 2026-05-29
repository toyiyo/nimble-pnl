---
title: "Connect Your Bank and Manage Transactions"
category: "financials-and-accounting"
summary: "Connect a bank account or upload a statement, then review, categorize, reconcile, and export your transactions."
audience: ["owner", "manager", "accountant"]
order: 10
keywords: ["banking", "transactions", "bank connect", "reconcile", "categorize", "AI", "rules", "export", "Stripe"]
related: ["financial-statements", "chart-of-accounts-and-intelligence", "expenses-and-print-checks", "financial-intelligence"]
---

# Connect Your Bank and Manage Transactions

This article walks owners, managers, and accountants through every banking feature in EasyShiftHQ: connecting bank accounts, importing statement files, categorizing and reviewing transactions, setting up automation rules, reconciling with your bank statement, and exporting records.

## Before you begin

- You must be signed in as an **owner**, **manager**, or **collaborator (accountant)** to access Banking. Staff and kiosk roles do not have access to this section.
- To connect a live bank account, you will need online banking credentials for that institution. The connection is handled securely through Stripe Financial Connections — EasyShiftHQ never stores your banking credentials.

## Connect a bank account

Linking a live account lets EasyShiftHQ pull in transactions automatically.

1. Go to **Banking** in the main navigation.
2. In the **Connected Banks** section, click **Connect Bank**.
3. A secure Stripe Financial Connections window opens. Follow the prompts to search for your bank and sign in with your banking username and password.
4. Select the account (or accounts) you want to share, then confirm.
5. Once the connection is verified, your bank appears in the **Connected Banks** list with a status badge showing **Active**.

The bank card shows your institution name, the number of linked accounts, and your current combined balance. Click the **N accounts** link at the bottom of the card to expand individual account details.

## Sync transactions, refresh the balance, or disconnect

Each connected bank card has a menu (the three-dot button on the right) with three options:

- **Sync transactions** — pulls in new transactions from your bank since the last sync. Use this any time you want the latest data.
- **Refresh balance** — updates the displayed balance without importing transactions.
- **Disconnect** — removes the bank connection. You will be asked to confirm; you can choose whether to keep or delete existing transaction data.

The same three options are also available on individual account rows if you expand the card.

## Upload a bank statement (PDF, CSV, or Excel)

If you prefer not to connect a live account, or you need to import historical records, you can upload a statement file instead.

1. Go to **Banking** and click the **Upload Statement** tab.
2. Under **Select Bank Statement**, choose a PDF, CSV, or Excel file from your computer. PDF files up to 5 MB are supported; for larger PDFs, split the statement into smaller files before uploading.
3. For **PDF files**: EasyShiftHQ uses AI to read the statement automatically. A progress bar tracks the upload and processing steps; this can take up to 90 seconds for larger files. When processing is complete, you move to a review screen where you can inspect the extracted transactions before importing them.
4. For **CSV and Excel files**: After you select the file, a column-mapping screen appears. Match your file's columns (date, description, amount, etc.) to the fields EasyShiftHQ expects, then confirm to stage the transactions.
5. Once you confirm the import, transactions appear in the **For Review** tab and are ready to categorize.

## Review and categorize transactions

Newly imported transactions land in the **For Review** tab. The number of pending transactions appears as a badge on the tab.

1. Go to **Banking** and make sure you are on the **For Review** tab.
2. Each row shows the date, description, payee, bank account, and amount. For uncategorized transactions, a **Category** column appears where you can assign a Chart of Accounts category.
3. Click the category field on any row and select the appropriate account from the list to categorize that transaction. It moves to the **Categorized** tab automatically.

Once a transaction is categorized it appears on the **Categorized** tab. You can switch between **For Review**, **Categorized**, and **Excluded** tabs at any time.

## Auto-categorize all uncategorized transactions with AI

When you have uncategorized transactions in **For Review**, an **Auto-Categorize All** button appears at the top of the page.

1. Click **Auto-Categorize All**.
2. EasyShiftHQ's AI reviews every uncategorized transaction and assigns a Chart of Accounts category based on the description and merchant name.
3. The categorized transactions move to the **Categorized** tab. Review them there to confirm the AI's choices were correct; you can always change a category manually.

## Select and bulk-edit multiple transactions

To act on several transactions at once:

1. On the **For Review**, **Categorized**, or **Excluded** tab, click **Select** (top right of the transaction list).
2. Click the checkbox next to each transaction you want to include. A bulk action bar appears at the bottom of the screen showing how many items are selected.
3. From the bulk action bar, choose one of:
   - **Categorize** — assign a single Chart of Accounts category to all selected transactions at once.
   - **Mark as Transfer** — flag the selected transactions as internal transfers so they are excluded from your profit and loss.
   - **Delete** — permanently remove the selected transactions. A confirmation dialog appears before anything is deleted.
4. Click **Done** (or the close button on the action bar) to exit selection mode.

## Search, filter, and sort transactions

A search bar and filter controls appear above the transaction tabs and apply across whichever tab is active.

- **Search box** — type any word to filter by description or payee in real time.
- **Filter button** — opens a filter panel where you can narrow transactions by date range, category, bank account, or amount range. A red badge on the button shows how many filters are active. Click **Clear All** to remove all filters at once.
- **Sort menu** — choose to sort by **Date**, **Payee**, **Amount**, or **Category**. Click the sort-direction button (the up/down arrow icon) next to the sort menu to toggle between ascending and descending order.

## Create automatic categorization rules

Rules tell EasyShiftHQ how to categorize future transactions automatically, saving you from doing it manually each time.

1. Click **Rules** at the top of the Banking page to open the **Categorization Rules** dialog.
2. The dialog has two tabs: **Bank Transactions** (for bank transactions) and **POS Sales** (for point-of-sale data). Make sure **Bank Transactions** is selected.
3. Click **Add New Rule** to open the rule form.
4. Fill in at least one matching condition:
   - **Description Pattern** — text that appears in the transaction description (choose whether the description *contains*, *starts with*, *ends with*, or is an *exact* match).
   - **Supplier** — optionally link the rule to a specific supplier.
   - **Transaction Type** — limit the rule to expenses (debits), income (credits), or either.
   - **Min Amount / Max Amount** — match only transactions within a dollar range.
5. Choose the **Target Category** from your Chart of Accounts.
6. Optionally set a **Priority** (higher numbers run first when multiple rules could match) and toggle **Auto-apply to new records** to have the rule apply automatically as new transactions arrive.
7. Click **Create Rule**.

To edit or delete an existing rule, click the pencil icon on its row. Toggle the **Active** switch to enable or disable a rule without deleting it. Toggle the **Auto** switch to control whether the rule runs automatically on new transactions.

You can also click **AI Suggest** inside the Categorization Rules dialog to have EasyShiftHQ analyze your transaction history and propose rules for you. Review each suggestion and click **Use** to save it or **Skip** to dismiss it.

To apply all active rules to your existing uncategorized transactions immediately, click **Apply to existing** inside the dialog.

## Reconcile transactions with your bank statement

Reconciliation lets you confirm that EasyShiftHQ's records match your official bank statement.

1. Click **Reconcile** at the top of the Banking page to open the **Bank Reconciliation** dialog.
2. In the setup step:
   - Select the **Bank Account** you are reconciling from the dropdown.
   - Enter the **Statement Ending Date** (the date printed on your bank statement).
   - Enter the **Statement Ending Balance** (the closing balance on your statement).
   - Optionally enter **Interest Earned** and **Service Charges** if they appear on your statement.
3. Click **Start Reconciling**.
4. The matching step shows a list of categorized, unreconciled transactions for the selected account up to the ending date. Check the box next to each transaction that appears on your statement.
5. A running summary at the top shows the **Statement Balance**, the **EasyShift Balance**, and the **Difference**. Keep checking off transactions until the Difference reaches **$0.00**.
6. Once the difference is zero, click **Finish Reconciliation**. The selected transactions are marked as reconciled.

After finishing, click **View Report** to close the dialog, then click the **Reconciliation** tab on the Banking page to see a summary showing your opening balance, reconciled total, unreconciled total, and projected balance.

## View the Reconciliation, Excluded, and Deleted tabs

Beyond **For Review** and **Categorized**, three additional tabs provide visibility into other transaction states:

- **Reconciliation** — a report view showing your opening balance, reconciled and unreconciled transaction totals, and your projected balance.
- **Excluded** — transactions that have been marked as duplicates, personal items, or otherwise excluded from your financials. The count appears as a badge on the tab.
- **Deleted** — transactions that were deleted. The count appears as a badge on the tab.

## Export transactions to CSV

You can download the currently visible transactions as a spreadsheet for use in external accounting tools or record-keeping.

1. Go to **Banking** or navigate to **Transactions** in the main menu.
2. Apply any search terms, filters, or sorting you want to capture in the export.
3. Click **Export** (shown as a download icon on some screen sizes).
4. A CSV file is downloaded to your computer containing the date, description, merchant, bank, amount, status, and category for each transaction that matched your current view.

## Tips

- Categorize transactions regularly — even once a week — so your **For Review** count stays manageable and your financial reports stay accurate.
- Rules with **Auto-apply to new records** turned on are the most efficient way to stay caught up: set them once and incoming transactions are categorized automatically.
- You only need to reconcile categorized transactions. If **For Review** has a large backlog, categorize those transactions first, then run reconciliation.
- For PDF bank statements larger than 5 MB, split the file into smaller date ranges before uploading.
- The **Transactions** page (accessible from the main navigation separately from Banking) gives you a combined all-accounts view with the same search, filter, sort, and export capabilities, plus a quick summary of total debits and credits for the current filtered view.

## Troubleshooting

**My bank is not listed or the connection fails.**
EasyShiftHQ uses Stripe Financial Connections, which supports thousands of institutions. If your bank is not found, use the **Upload Statement** tab to import a PDF, CSV, or Excel statement instead.

**My bank card shows "Requires Reauth."**
This means your banking credentials have changed or the connection has expired. Open the bank card's menu and disconnect, then click **Connect Bank** again to re-authenticate with your bank.

**Transactions are not showing after I click "Sync transactions."**
Open the bank card's menu and click **Sync transactions** again. Some banks take a few minutes to make recent transactions available. If the problem persists, check whether the account status shows **Error** — in that case, disconnecting and reconnecting the bank often resolves it.

**The reconciliation difference is not reaching $0.00.**
Double-check that you have entered the statement ending balance exactly as it appears on your statement (including cents). Also confirm that any interest earned or service charges on the statement are entered in the corresponding fields. Only categorized transactions appear in the matching list — categorize any remaining **For Review** items first.

**A CSV or Excel upload does not map my columns correctly.**
On the column-mapping screen, manually select the correct field for each column from the dropdown. If your file uses a non-standard date format, try reformatting the date column as YYYY-MM-DD before uploading.

## Frequently asked questions

**Does EasyShiftHQ store my bank username and password?**
No. Bank connections are handled entirely by Stripe Financial Connections. EasyShiftHQ only receives read-only transaction data — your credentials are never stored in EasyShiftHQ.

**What is the difference between the Banking page and the Transactions page?**
Both pages show your bank transactions. The **Banking** page includes connected bank management, the statement upload tool, the reconciliation workflow, and tabs to separate transactions by status (For Review, Categorized, Excluded, Reconciliation, Deleted). The **Transactions** page is a simpler combined view across all accounts with the same search, filter, sort, categorize, and export tools — useful when you just want a quick overview or export.

**Can I connect more than one bank account?**
Yes. Click **Connect Bank** as many times as you need. Each institution appears as a separate card, and the total balance across all connected accounts is shown at the top of the Banking page.

**What happens to transactions if I disconnect a bank?**
When you disconnect, EasyShiftHQ asks whether you want to keep or delete the existing transaction data. If you choose to keep the data, the transactions remain in your records but will no longer be updated automatically.

**Why do some transactions appear in the Excluded tab?**
Transactions are moved to **Excluded** when they are flagged as transfers between your own accounts or otherwise excluded from your profit and loss. You can review excluded transactions there at any time.

## Related articles

- [View and Export Financial Statements](/help/financial-statements)
- [Set Up the Chart of Accounts and View Financial Intelligence](/help/chart-of-accounts-and-intelligence)
- [Track Expenses, Upload Invoices, and Print Checks](/help/expenses-and-print-checks)
- [Roles and What Each One Can Access](/help/roles-and-permissions)
