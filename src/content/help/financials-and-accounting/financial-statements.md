---
title: "View and Export Financial Statements"
category: "financials-and-accounting"
summary: "Read your Income Statement, Balance Sheet, Cash Flow Statement, and Trial Balance, adjust the date range, and export reports as PDF or CSV."
audience: ["owner", "accountant"]
order: 20
keywords: ["income statement", "balance sheet", "cash flow", "trial balance", "financial statements", "export", "P&L", "COGS"]
related: ["banking-connect-and-transactions", "chart-of-accounts-and-intelligence", "budget-break-even"]
---

# View and Export Financial Statements

This article explains how to open and read the four core financial reports in EasyShiftHQ — Income Statement, Balance Sheet, Cash Flow Statement, and Trial Balance — set the reporting period, and download any report as a PDF or CSV file. It is written for owners and accountants.

## Before you begin

You must have a restaurant selected before any financial data will load. If you manage more than one location, the page will ask you to pick one before showing any reports.

## Navigate to Financial Statements and select a restaurant

1. In the main navigation, go to **Financial Statements** (route: `/financial-statements`).
2. If no restaurant is selected yet, choose your location from the list that appears on screen.
3. Once a restaurant is selected, the full reporting page loads with four tabs and a **Report Period** toolbar.

## Set the report period

The date range you choose applies to all four statements simultaneously.

1. In the **Report Period** row at the top of the page, click the date picker to enter a custom start and end date.
2. To jump to common periods quickly, click **Last Month** or **This Month** — the date range updates immediately.
3. All four statement tabs will reflect the period you selected. Note that the Balance Sheet and Trial Balance show balances *as of* the end date you choose, while the Income Statement and Cash Flow Statement cover the full date range.

## Read the Income Statement

1. Click the **Income Statement** tab.
2. The statement opens with a **REVENUE** section. If your point-of-sale sales are categorized, you will see individual revenue lines (each with an account code) along with subtotals for **Gross Revenue**, deductions such as discounts or refunds listed under **Less: Deductions**, and a **Net Sales Revenue** line. Sales tax and tips collected on behalf of customers appear in a separate **OTHER COLLECTIONS (Pass-Through)** section labeled as liabilities — they are not counted as your revenue.
3. Below revenue is **COST OF GOODS SOLD**, showing individual COGS accounts and a **Total COGS** subtotal.
4. A highlighted **Gross Profit** row shows revenue minus COGS.
5. The **LABOR COSTS** section lists payroll and labor accounts with a **Total Labor** subtotal, followed by a **Prime Cost (COGS + Labor)** highlight row — a key restaurant benchmark.
6. **CONTROLLABLE EXPENSES** covers day-to-day variable costs. Any bank transactions that have not yet been assigned to an account appear in amber as **Uncategorized Expenses** and are included in the totals. If you see this, click **Review Transactions** to categorize them.
7. **NON-CONTROLLABLE / FIXED** covers rent, insurance, depreciation, and similar fixed costs.
8. The statement closes with **Total Operating Expenses**, **Operating Income**, and **Net Income**, each shown as a dollar amount and as a percentage of revenue.
9. Each line item displays its account code on the left and the percentage of revenue on the right, making it easy to spot outliers.
10. If the period you selected extends into the future, a note next to the date will show the payroll cutoff date actually used (payroll is calculated only through today by default). Use the **Projected payroll** toggle to project payroll through the full period end date instead.
11. Turn on **GL-only** to see only transactions that have been formally posted to the general ledger, hiding payroll and inventory estimates that have not yet been journaled.

## Read the Balance Sheet

1. Click the **Balance Sheet** tab.
2. The statement shows balances **as of** the end date in your Report Period.
3. Three sections appear: **ASSETS**, **LIABILITIES**, and **EQUITY**. Each account line shows its account code and balance. Totals appear at the bottom of each section.
4. The final highlighted row, **Total Liabilities & Equity**, should equal **Total Assets**. If there is a discrepancy, a warning banner appears. Use **Rebuild Balances** (described below) to recalculate.
5. Turn on **GL-only (no unposted accruals)** to exclude payroll and inventory adjustments that have not yet been posted as journal entries.

## Read the Cash Flow Statement

1. Click the **Cash Flow** tab.
2. The statement covers the full date range in your Report Period.
3. Three activity sections appear:
   - **Cash Flow from Operating Activities** — day-to-day business cash, summarized as **Net Operating Cash Flow**.
   - **Cash Flow from Investing Activities** — summarized as **Net Investing Cash Flow**.
   - **Cash Flow from Financing Activities** — summarized as **Net Financing Cash Flow**.
4. The large highlighted row at the bottom shows **Net Change in Cash** for the period. Green means cash increased; red means cash decreased.

## Read the Trial Balance

1. Click the **Trial Balance** tab.
2. The trial balance shows every active account as of the end date, with its balance split into **Debit** and **Credit** columns. An account will show a value in only one column; the other will show a dash.
3. The bottom row (**TOTALS**) sums all debits and all credits. In a balanced set of books these two totals are equal. If they differ by more than a penny, a warning banner appears.

## Export a statement as PDF or CSV

You can export any of the four statements independently.

1. While viewing any statement tab, click the **Export** button on the right side of the statement header.
2. A small menu appears with two options:
   - **Export as CSV** — downloads a spreadsheet file you can open in Excel or Google Sheets.
   - **Export as PDF** — downloads a formatted PDF with the restaurant name and date range in the header.
3. The file downloads automatically. A confirmation message will appear when the export is complete.

## Recalculate the opening balance

Use this when you have just connected your bank account for the first time and want EasyShiftHQ to set your starting cash balance automatically.

1. Click **Calculate Opening Balance** in the Report Period toolbar.
2. EasyShiftHQ reads your current bank balance, subtracts the net total of all categorized transactions on file, and creates the opening balance journal entry.
3. A success message confirms the opening balance amount that was set.

> **Note:** The opening balance can only be created once. If one already exists, clicking this button will show an error message telling you to use **Rebuild Balances** instead.

## Rebuild all account balances

Use this after correcting or importing transactions in bulk to ensure every account reflects the latest data.

1. Click **Rebuild Balances** in the Report Period toolbar.
2. EasyShiftHQ recalculates every account balance from the underlying journal entries.
3. A success message confirms how many accounts were updated.

## Fix a reconciliation issue

If historical bank transactions were imported after your opening balance was set, EasyShiftHQ detects the gap and shows a **Reconciliation Issue Detected** banner below the date controls. The banner explains the date of the earliest out-of-order transaction, the resulting discrepancy amount, and what the opening balance will be changed to.

1. Review the details in the banner to confirm the adjustment looks correct.
2. Click **Fix Reconciliation** to automatically correct the opening balance.
3. A confirmation message will show the old and new opening balance values as well as the updated boundary date.

---

## Tips

- Use **Last Month** before sharing financials with your accountant — it guarantees a complete, closed period.
- The percentage-of-revenue column on the Income Statement is the fastest way to see if any cost category is running high relative to your sales.
- If you see uncategorized amounts highlighted in amber on the Income Statement, categorize those bank transactions first for the most accurate numbers. Click **Review Transactions** inside the banner to go there directly.
- Export a PDF for your records and a CSV if you want to do additional calculations in a spreadsheet.
- Run **Rebuild Balances** any time you make a large batch of corrections to keep all four statements in sync.

---

## Troubleshooting

**The page says "Please select a restaurant to view financial statements."**
No restaurant is selected. Choose your location from the selector that appears and the reports will load.

**Numbers look wrong or totals don't add up.**
Click **Rebuild Balances** to force a recalculation of all account balances from the underlying journal entries. If the problem persists after rebuilding, check whether a **Reconciliation Issue Detected** banner is visible and use **Fix Reconciliation** to correct it.

**"Opening balance already set" error when clicking Calculate Opening Balance.**
The opening balance can only be set once. To recalculate all balances going forward, use **Rebuild Balances** instead.

**The Balance Sheet or Trial Balance shows a warning that it doesn't balance.**
This usually means unposted transactions are included. Try enabling **GL-only** to see only formally journaled data. If the imbalance persists in GL-only mode, use **Rebuild Balances** and then check for any **Reconciliation Issue Detected** banner.

**The Export button is grayed out or stuck on "Exporting..."**
The report data may still be loading. Wait for the statement to finish rendering, then try again.

---

## Frequently asked questions

**Which date range do the Balance Sheet and Trial Balance use?**
Both the Balance Sheet and Trial Balance show balances *as of* the **end date** of your Report Period, not the full range. The Income Statement and Cash Flow Statement cover the entire date range from start to end.

**What are the items shown in amber on the Income Statement?**
Amber rows represent transactions that have not yet been categorized and assigned to a chart of accounts account. They are included in the totals so your net income figure is complete, but they are flagged so you know to review them. Click **Review Transactions** to categorize them.

**What does "GL-only" do?**
Toggling GL-only on hides payroll and inventory amounts that EasyShiftHQ has estimated but not yet formally posted as journal entries. It shows only amounts that appear in your actual general ledger. Use it when you want to share numbers that reflect only posted entries.

**When should I use Calculate Opening Balance vs. Rebuild Balances?**
Use **Calculate Opening Balance** once, the first time you connect your bank account. It creates the initial starting point for your books. Use **Rebuild Balances** any time after that to refresh all account totals from your existing journal entries without changing the opening balance.

**Can I export all four statements at once?**
No. Each statement has its own **Export** button. You need to export them one at a time from the respective tab.

---

## Related articles

- [Connect Your Bank and Manage Transactions](/help/banking-connect-and-transactions)
- [Set Up the Chart of Accounts and View Financial Intelligence](/help/chart-of-accounts-and-intelligence)
- [Understand Your Break-Even and Set Operating Costs](/help/budget-break-even)
- [Roles and What Each One Can Access](/help/roles-and-permissions)
