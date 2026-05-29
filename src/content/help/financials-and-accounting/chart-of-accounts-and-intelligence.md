---
title: "Set Up the Chart of Accounts and View Financial Intelligence"
category: "financials-and-accounting"
summary: "Generate restaurant-specific accounts, add custom accounts or sub-accounts, and use the Financial Intelligence dashboard for cash flow, spending, and AI-powered predictions."
audience: ["owner", "accountant"]
order: 70
keywords: ["chart of accounts", "accounts", "sub-account", "financial intelligence", "cash flow", "spending", "predictions", "liquidity", "runway"]
related: ["banking-connect-and-transactions", "financial-statements", "budget-break-even", "categorize-pos-sales"]
---

# Set Up the Chart of Accounts and View Financial Intelligence

This article explains how to build and manage your Chart of Accounts and how to use the Financial Intelligence dashboard to monitor cash flow, analyze spending, and view AI-powered financial forecasts. It is written for restaurant owners and accountants.

## Before you begin

- Only users with the **Owner** role or the **Accountant** collaborator role can create default accounts or add new accounts. Managers can view the Chart of Accounts but cannot add or edit accounts.
- The **Financial Intelligence** dashboard requires at least one connected bank account and a qualifying subscription plan. If your plan does not include this feature, the page will display an upgrade prompt.

## Set up your Chart of Accounts

### Generate the default account list

If you have never set up a Chart of Accounts, EasyShiftHQ can create a standard set of restaurant-specific accounts for you in one click.

1. In the main navigation, go to **Chart of Accounts** (`/chart-of-accounts`).
2. If no accounts have been created yet, you will see a card titled **Set Up Your Chart of Accounts**.
3. Click **Create Default Accounts**.
4. EasyShiftHQ will generate a full account tree with categories designed for restaurant operations. The page will reload and display all accounts grouped by type.

### Understand the account groups

Accounts are organized into six types, each shown in its own section:

| Type | What it tracks |
|---|---|
| **Asset** | What your restaurant owns (cash, inventory, equipment) |
| **Liability** | What your restaurant owes (payables, loans) |
| **Equity** | Owner's stake and retained earnings |
| **Revenue** | Income from food, beverages, catering, and other sources |
| **Expense** | Operating costs such as labor, rent, and utilities |
| **Cost of Goods Sold** | Direct costs of items sold (food cost, beverage cost) |

Each account displays its **account code** and **account name**. Accounts marked with a **System** badge are built-in accounts that cannot be deleted.

### Add a new top-level account

1. On the **Chart of Accounts** page, click **Add Account** in the upper-right corner.
2. In the dialog, fill in:
   - **Account Name** (required) — a descriptive name, for example "Office Supplies."
   - **Account Code** (required) — a numeric code, for example "7800." Use the format shown in the hint below the field.
   - **Account Type** (required) — choose from Asset, Liability, Equity, Revenue, Expense, or Cost of Goods Sold.
   - **Account Subtype** (optional) — a more specific category within the account type.
   - **Normal Balance** (required) — Debit or Credit.
   - **Description** (optional) — internal notes about the account.
3. Click **Create Account**.

The new account appears immediately in the matching account-type section.

### Add a sub-account under an existing account

Sub-accounts let you break a parent account into more detailed categories. For example, you might add sub-accounts under "Food Cost" for "Produce" and "Proteins."

1. On the **Chart of Accounts** page, find the parent account you want to expand.
2. Hover over the account row. The **Add Sub** button appears on the right side of the row.
3. Click **Add Sub**.
4. The dialog opens titled **Add Sub-Account to [Parent Account Name]**. The account type and normal balance are automatically inherited from the parent and cannot be changed.
5. Fill in the **Account Name** and **Account Code** (the code will be pre-filled with the parent's code followed by a dash, for example "6000-"). Add an optional **Description**.
6. Click **Create Account**.

The sub-account appears indented beneath its parent account.

### A note on labor costs in reports

The Chart of Accounts page includes an informational notice about how labor costs appear in performance reports. Your reports show two separate figures:

- **Pending Payroll (Scheduled):** Labor costs from employee time punches — what you owe but have not yet paid.
- **Actual Payroll (Paid):** Bank transactions and checks showing what has already been paid out.

Both figures appear separately until they are matched. Labor expenses are automatically excluded from the "Other Expenses" category in your reports.

## Use the Financial Intelligence dashboard

### Open Financial Intelligence

You can reach the **Financial Intelligence** page in two ways:

- Navigate directly to `/financial-intelligence` in the app.
- On the **Banking** page, find the **Financial Intelligence** section and click **View Insights**.

### Choose a time period and bank account

At the top of the Financial Intelligence page:

1. Use the **period selector** to choose the analysis window (for example, This Month, Last Month, or a custom date range).
2. If you have more than one connected bank, use the **bank account filter** to focus the analysis on a specific account or view all accounts together.

All tabs below update automatically when you change either filter.

### Cash Flow tab

The **Cash Flow** tab shows how money has moved in and out of your accounts during the selected period.

- **Net Inflows** — total incoming cash.
- **Net Outflows** — total outgoing cash.
- **Net Cash Flow** — your overall net position (inflows minus outflows).
- A **Daily Cash Flow Trend** chart shows day-by-day movement over up to the last 14 days of the period.
- An **Inflows vs. Outflows** chart breaks down the two sides visually.
- A **Cash Flow Volatility** score (0–100) indicates how stable and predictable your cash flow is. Higher scores mean less volatility.

### Revenue tab

The **Revenue** tab provides an analysis of your revenue health for the selected period, drawing from your banking data.

### Spending tab

The **Spending** tab analyzes where your money is going.

- **Total Outflows** — total expenses for the period.
- **Avg Weekly Spend** — your average weekly outflow.
- **Vendor Concentration** — the percentage of spending concentrated among your top three vendors, with a risk indicator (Low Risk, Medium Risk, or High Risk).
- **Top 5 Vendors by Spend** — a ranked list of your highest-spend vendors with bar charts and percentage breakdowns. If a vendor's spending has changed by more than 15% compared to the previous period, a badge appears showing the change.
- **Spend by Category** — a pie chart showing how spending is distributed across categories.
- **Recurring Expenses Detected** — a list of expenses the system has automatically identified as recurring, showing the vendor, frequency, last amount, and average amount.
- **Efficiency & Data Quality Metrics** — four additional indicators:
  - **Processing Fees** — the percentage and dollar amount of payment processing costs.
  - **Weekend Spending** — what proportion of spending happens on weekends.
  - **AI Categorization** — the percentage of transactions categorized with high confidence by the AI.
  - **Uncategorized** — the percentage and dollar amount of transactions that have not been categorized yet.

### Liquidity tab

The **Liquidity** tab (labeled **Runway** on smaller screens) shows your cash runway — how long your current cash will last at your current burn rate.

- A status alert at the top shows one of three states: **Healthy Cash Position**, **Cash Runway Caution**, or **Critical Cash Runway Alert**, along with a projected number of days of cash remaining and an estimated date when cash would reach zero.
- **Current Balance** — total cash across all connected accounts.
- **Avg Weekly Outflow** — average outflow per week based on recent activity.
- **Cash Burn Rate** — your net weekly cash change (positive means net outflow; negative means you are net positive).
- A **Weekly Burn Rate Trend** chart shows how your burn rate has changed over recent weeks.
- A **Daily Cash Analysis** section shows your average daily outflow, days until zero, and current status.
- An **Action Items** section provides specific recommendations based on your runway status.

### Predictions tab

The **Predictions** tab uses AI to forecast upcoming cash movements based on patterns in your transaction history.

- **Next Expected Deposit** — a predicted date and amount for your next POS revenue deposit, along with a confidence percentage.
- **Next Expected Payroll** — a predicted date and amount for your next payroll outflow, based on detected payment patterns.
- **Supplier Cost Drift Alerts** — a list of suppliers whose average spending has changed significantly compared to the previous period, shown as percentage increases or decreases.
- **Expense Seasonality** — indicates whether a seasonal spending pattern has been detected in your data, along with a recommendation if applicable.
- **Rent & Fixed Costs Detected** — recurring monthly expenses above a certain threshold are automatically identified and listed with their average amount and next expected date.

Predictions improve over time as more transaction history accumulates.

## Tips

- Run **Create Default Accounts** only once. If accounts already exist, this button does not appear.
- System accounts (marked **System**) cannot be deleted. You can still add sub-accounts beneath them to create more granular categories.
- Sub-accounts always inherit their parent's account type and normal balance. You only need to supply a name, code, and optional description.
- For the most useful Financial Intelligence analysis, keep your bank transactions well-categorized. A high **Uncategorized** percentage on the Spending tab means the other charts may not fully reflect your actual spending patterns. See [Categorize Sales and Create Automation Rules](/help/categorize-pos-sales) for tips on improving categorization.
- Change the period selector on Financial Intelligence to compare different months or quarters side by side by switching the period between visits.

## Troubleshooting

**"Create Default Accounts" is not visible.**
This button only appears when no accounts exist. If you already have accounts, the normal account list is displayed instead. If the page shows accounts that do not belong to your restaurant, verify you have the correct restaurant selected in the restaurant switcher.

**I clicked "Add Sub" but the button is not visible.**
On desktop, the "Add Sub" button is hidden until you hover over the parent account row. On mobile the icon is always visible (the text label is hidden on small screens, but the button itself is there). If the button does not respond, ensure your role is Owner or Accountant collaborator — Managers, Staff, and Chef roles cannot add or edit accounts.

**Financial Intelligence shows an upgrade prompt instead of data.**
The Financial Intelligence feature requires a qualifying subscription plan. Go to **Settings > Subscription** to review your current plan and upgrade options.

**Financial Intelligence shows nothing even though I have a bank connected.**
Ensure at least one bank account is actively connected and has synced recent transactions. Go to the [Banking](/help/banking-connect-and-transactions) page to verify your connection status and trigger a manual sync if needed.

**Predictions show "Not enough deposit history to predict" or "No payroll pattern detected."**
The AI needs a sufficient number of past transactions to detect patterns. Continue using EasyShiftHQ with your bank connected, and predictions will populate as your history grows.

**A sub-account I created does not appear under the right parent.**
Sub-accounts are grouped under their parent in the display. Scroll to the parent account section for the account type you selected (for example, Expense) and look for the indented sub-account beneath the parent row.

## Frequently asked questions

**Can I delete a custom account I created by mistake?**
The current Chart of Accounts page does not display a delete button. System accounts are intentionally protected. For custom accounts you want to remove, contact your account owner or use your accounting export and exclude that account from reports. Only accounts with no transactions attached can safely be removed.

**What is the difference between Account Type and Account Subtype?**
Account Type is the broad accounting category (Asset, Liability, Equity, Revenue, Expense, or Cost of Goods Sold). Account Subtype is a more specific classification within that type — for example, "Labor" within Expense, or "Food Sales" within Revenue. Subtype is optional but helps with more detailed financial reporting.

**Can I add sub-accounts to sub-accounts (multiple levels deep)?**
The current implementation supports one level of sub-accounts beneath a parent account. You can add multiple sub-accounts to the same parent, but you cannot nest sub-accounts inside other sub-accounts.

**Does the Financial Intelligence period selector change what data is stored?**
No. The period selector only filters which data is displayed in the dashboard. Your underlying transaction data is not affected.

**Why does the Vendor Concentration score matter?**
A high vendor concentration means a large portion of your spending depends on just a few suppliers. If one of those suppliers raises prices, has a shortage, or closes, it could significantly impact your costs. A lower concentration score generally indicates a more resilient supply chain.

## Related articles

- [Connect Your Bank and Manage Transactions](/help/banking-connect-and-transactions)
- [View and Export Financial Statements](/help/financial-statements)
- [Understand Your Break-Even and Set Operating Costs](/help/budget-break-even)
- [Categorize Sales and Create Automation Rules](/help/categorize-pos-sales)
- [Choose or Change Your Subscription Plan](/help/subscription-plans)
