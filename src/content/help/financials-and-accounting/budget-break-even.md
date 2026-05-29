---
title: "Understand Your Break-Even and Set Operating Costs"
category: "financials-and-accounting"
summary: "Set up fixed and variable operating costs, see your daily break-even target, track monthly progress, and view a sales-vs-cost chart."
audience: ["owner", "manager"]
order: 30
keywords: ["break-even", "budget", "fixed cost", "variable cost", "operating cost", "run rate", "daily target", "food cost", "labor"]
related: ["financial-statements", "banking-connect-and-transactions", "payroll-labor-financial-settings", "weekly-brief-and-ops-inbox"]
---

# Understand Your Break-Even and Set Operating Costs

This article walks owners and managers through EasyShiftHQ's **Budget & Run Rate** page — where you enter your operating costs, see exactly how much revenue you need to earn each day to cover those costs, and track whether this month's sales are keeping up.

## Before you begin

You must be logged in as an **Owner** or **Manager** to view and edit budget data. Staff and kiosk roles do not have access to this page.

If you have not yet selected a restaurant from the top navigation, you will see a prompt to do so. All cost data is specific to the restaurant you have selected.

## Navigate to Budget & Run Rate

1. From the main navigation, click **Budget & Run Rate**.
2. The page loads at `/budget` and shows four sections stacked top to bottom:
   - **Break-Even Analysis** hero card
   - **Monthly Break-Even Progress** card
   - **What makes up your daily cost** section (Fixed Costs and Variable Costs)
   - **Sales vs Break-Even** chart

## Read the Break-Even Analysis hero card

The **Break-Even Analysis** card appears at the top of the page and gives you an at-a-glance view of your break-even numbers.

- The card header shows a status badge: **Above break-even**, **At break-even**, or **Below break-even**, based on today's sales compared to your daily target. A dollar delta (e.g., +$320 or -$150) shows how far above or below you are today.
- Below the header, a three-column grid shows your break-even target three ways:
  - **Daily** — the minimum daily revenue needed to cover all costs
  - **Monthly** — daily target multiplied across the full month
  - **Yearly** — the annualized figure
  Each column also shows the fixed-cost portion of that period's target.
- A row below the grid shows:
  - **Variable Costs** — the total percentage of sales consumed by variable costs
  - **Contribution Margin** — the percentage of each sales dollar left over after variable costs (used to calculate break-even)
  - **Today's sales** — revenue recorded for today so far

If you have not yet entered any costs, the card prompts you to add fixed and variable costs to enable calculations.

## Read the Monthly Break-Even Progress card

The **Monthly Break-Even Progress** card sits just below the hero card and shows how far into the month's break-even target your actual sales have carried you.

- The card header shows the current month and day (for example, "May · Day 18 of 31") and a status badge: **Ahead of pace**, **On pace**, or **Behind pace**.
- The headline reads, for example, "$42,000 of $58,000 needed" — your month-to-date sales versus your monthly break-even amount.
- A progress bar fills from left to right as sales accumulate. A dashed vertical line marks where you are **expected** to be by today based on a straight-line pace through the month.
- Below the bar, three stats are shown side by side:
  - **Still needed** — remaining sales required to hit this month's break-even
  - **Days left** — calendar days remaining in the month
  - **Per day to hit** — the daily average you need for the rest of the month to reach break-even
- A projection sentence below the stats estimates where you will finish by month-end based on your current pace (for example, "Trending toward $61,000 by month-end — $3,000 above target").

If no costs are configured yet, the card shows a prompt to add costs first.

## View and understand Fixed Costs and Variable Costs

Under the heading **What makes up your daily cost**, you will see two collapsible sections.

**Fixed Costs** (subtitle: "Dollar amounts that don't scale with sales") lists each cost item with:
- Its name
- A monthly dollar amount (e.g., $3,200.00/mo)
- A daily equivalent (e.g., → $107/day)
- The total for the section shown in the header as, for example, $380/day

**Variable Costs** (subtitle: "Percentages that scale with sales") lists each cost item with:
- Its name
- A percentage of sales (e.g., 28.0% of sales)
- A daily dollar equivalent based on your average revenue (e.g., → $280/day)
- The total for the section shown in the header

Click the section header to collapse or expand either block.

## Add a fixed operating cost

Fixed costs are dollar amounts that do not change with your sales volume — rent, insurance, loan payments, and similar items.

1. In the **Fixed Costs** section, click the **+** icon in the section header, or the "Add one" link if the list is empty.
2. The **Add Fixed Cost** dialog opens.
3. In the **Name** field, type a name for the cost (for example, "Rent" or "Equipment Lease").
4. Under **How is this cost calculated?**, confirm **Fixed Amount** is selected.
5. In the **Monthly Amount** field, enter the dollar amount you pay each month.
   - A preview line below the field shows the daily equivalent (e.g., "Daily: $106.67").
6. Click **Add Cost** to save. The item appears in the Fixed Costs list immediately and the break-even numbers update.

## Add a variable operating cost

Variable costs are percentages of sales — food cost, credit card processing fees, and similar items.

1. In the **Variable Costs** section, click the **+** icon in the section header.
2. The **Add Variable Cost** dialog opens.
3. In the **Name** field, type a name (for example, "Food Cost" or "Labor").
4. Under **How is this cost calculated?**, confirm **% of Sales** is selected.
5. In the **Percentage** field, enter the percentage (for example, 28 for 28%).
   - A note below the field confirms that the daily cost will be calculated from average sales.
6. Click **Add Cost** to save. The item appears in the Variable Costs list and the break-even calculation updates.

## Edit or delete an existing cost item

Each cost item shows edit and delete icons when you hover over it.

**To edit:**
1. Hover over the cost item row. A pencil icon appears on the right.
2. Click the pencil icon. The **Edit Cost Item** dialog opens, pre-filled with the item's current values.
3. Change the name, amount, or percentage as needed.
4. Click **Save Changes**.

**To delete:**
1. Hover over the cost item row. A trash icon appears to the right of the pencil icon.
2. Click the trash icon. The item is removed immediately and the break-even numbers update.

There is no confirmation prompt before deletion. If you remove an item by mistake, you can re-add it using the steps above.

## Review and act on AI-suggested expense items

EasyShiftHQ analyzes your connected bank transactions to detect recurring payments that are not yet in your budget. When it finds one, a suggestion banner appears inside the relevant cost section with a lightbulb icon.

Each suggestion reads something like: "We found a recurring $420/mo payment to [Payee Name]. Add as '[Suggested Name]'?"

You have three options for each suggestion:

- **Add to Budget** — Opens the cost item dialog pre-filled with the suggested name and monthly amount. Review the values, then click **Save Changes** to confirm. The suggestion is marked as accepted and will not reappear.
- **Not Now** — Snoozes the suggestion for 30 days. It will reappear after that period if the recurring payment is still detected.
- **Dismiss** — Permanently hides the suggestion. It will not reappear.

If there are more than three suggestions in a section, a "Show N more suggestions" link appears below the visible ones.

## Read the Sales vs Break-Even chart

The **Sales vs Break-Even** chart at the bottom of the page shows the past 14 days of daily sales compared to your break-even threshold.

- Each bar represents one day's sales. Green bars are days you were **above** break-even; red bars are days you were **below**.
- A dashed horizontal reference line marks your **Break-even** threshold and shows the dollar amount.
- Below the chart, four summary stats are displayed side by side:
  - **Days above** — how many of the 14 days your sales exceeded break-even
  - **Days below** — how many days they fell short
  - **Avg surplus** — average daily surplus on above-break-even days
  - **Avg shortfall** — average daily shortfall on below-break-even days
- If you have a food cost item configured, two additional stats appear: **Target COGS %** (the percentage you entered) and **Actual COGS %** (calculated from real inventory and financial data over the same 14-day window).
- A tip at the bottom of the chart reads: "Click any bar to view P&L for that day." Clicking a bar takes you to the daily P&L report for that date.

## Tips

- **Start with your biggest fixed costs.** Rent, loan payments, and insurance have the most impact on your break-even number. Add those first to get a useful baseline quickly.
- **Use the contribution margin as a gut check.** If your contribution margin is very low (for example, under 20%), you will need very high sales volume to cover fixed costs. Reviewing your variable cost percentages may reveal room to reduce food or labor spend.
- **Connect your bank account to unlock AI suggestions.** EasyShiftHQ looks at 90 days of transaction history to surface recurring payments. Connecting your bank at [Banking](/banking) makes this feature work automatically.
- **The chart covers only the last 14 days.** For longer-term trend analysis, use the Financial Statements page.
- **Variable costs that equal or exceed 100% of sales make break-even impossible to calculate.** Keep variable cost percentages well below 100% in total.

## Troubleshooting

**The Break-Even Analysis card shows "Set up your operating costs to see your break-even targets."**
You have no cost items saved yet. EasyShiftHQ automatically seeds a set of default items the first time you load the page. If defaults did not appear, try refreshing the page. You can also add items manually using the Add Fixed Cost and Add Variable Cost buttons.

**The monthly progress card shows "Add your fixed and variable costs above to see how this month is tracking."**
The monthly target is derived from your cost items. Add at least one fixed or variable cost and the progress card will populate.

**Today's sales in the hero card show $0.**
Sales data comes from your connected POS system or manually entered sales. If you have not connected a POS or entered sales for today, the value will be zero. See [Connect and Sync a POS System](/help/connect-pos-system) or [Record and Edit Sales Manually](/help/record-edit-manual-sales).

**The Actual COGS % row does not appear below the chart.**
This row only appears if you have a variable cost item categorized as food cost configured. Add a variable cost representing your food cost percentage to see the actual vs target COGS comparison.

**I deleted a cost item by accident.**
There is no undo. Re-add the item using the Add Fixed Cost or Add Variable Cost button and enter the original values.

**AI suggestions do not appear.**
Suggestions are generated from bank transaction history. If your bank account is not connected, or if fewer than 90 days of transactions are available, no suggestions will appear. Connect your bank at [Connect Your Bank and Manage Transactions](/help/banking-connect-and-transactions).

## Frequently asked questions

**What is the contribution margin and why does it matter?**
The contribution margin is the percentage of each sales dollar that remains after covering variable costs. For example, if variable costs total 65% of sales, the contribution margin is 35%. EasyShiftHQ divides your total fixed costs by this margin to calculate your break-even. A higher contribution margin means you need less revenue to cover your fixed costs.

**Does editing a cost item affect historical data?**
No. Cost changes apply to the current break-even calculation and forward-looking projections. Previously recorded sales and P&L reports are not altered.

**What is the difference between a fixed cost and a variable cost?**
Fixed costs are set dollar amounts you pay regardless of sales volume (rent, insurance, subscriptions). Variable costs are percentages that scale proportionally with your revenue (food cost, credit card fees, royalties). Both types count toward your break-even calculation, but they are handled differently — fixed costs are entered as monthly dollar amounts, and variable costs are entered as percentages.

**Why does the "Per day to hit" number change each day?**
It recalculates daily based on how much of your monthly break-even is still uncovered and how many days remain in the month. If sales have been strong, the per-day requirement drops. If sales have been weak, it rises.

**Can I have multiple restaurants with separate budgets?**
Yes. Each restaurant has its own independent set of operating costs. Switch between restaurants using the restaurant selector at the top of the page.

## Related articles

- [View and Export Financial Statements](/help/financial-statements)
- [Connect Your Bank and Manage Transactions](/help/banking-connect-and-transactions)
- [Connect and Sync a POS System](/help/connect-pos-system)
- [Record and Edit Sales Manually](/help/record-edit-manual-sales)
- [Roles and What Each One Can Access](/help/roles-and-permissions)
