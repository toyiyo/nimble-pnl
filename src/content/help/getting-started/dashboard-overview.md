---
title: "Read and Use Your Dashboard"
category: "getting-started"
summary: "A guide to every section on the main Dashboard — what the numbers mean, how to change the date range, and what to do when an alert appears."
audience: ["owner", "manager"]
order: 5
keywords: ["dashboard", "snapshot", "prime cost", "runway", "break-even", "alerts", "cashflow", "revenue mix"]
related: ["budget-break-even", "banking-connect-and-transactions", "ops-inbox-triage-alerts", "financial-statements"]
---

# Read and Use Your Dashboard

The Dashboard is your restaurant's command center. Every time you open it you get an up-to-the-minute view of today's finances, a 14-day break-even trend, and a deep-dive into any time period you choose — all in one place.

## Before you begin

You must be signed in as an **Owner** or **Manager**. Staff members and collaborators with restricted roles are directed to different pages after sign-in and do not see the Dashboard.

## Open the Dashboard

1. Sign in to EasyShiftHQ.
2. In the main navigation, click your restaurant name.
3. The page heading shows your restaurant's name and today's full date, confirming you are in the right place.

If you manage more than one restaurant, use the restaurant selector that appears at the top of the page to switch locations.

## Read Today's Snapshot

Directly below the page heading is the **Today's Snapshot** card. It always reflects today — it does not change when you adjust the Performance Period (see below).

The card shows five tiles:

| Tile | What it shows | Healthy target |
|---|---|---|
| **Revenue** | Net sales for today (after discounts and refunds) | — |
| **Margin** | Net profit as a percentage of today's revenue | 15% or higher |
| **Cash** | Total current balance across all connected bank accounts | — |
| **Runway** | How many days of cash you have at your current spending rate | 60 days or more |
| **Prime Cost** | Food costs plus labor costs combined, as a percentage of today's sales | 60–65% |

Hover over the small information icon next to **Margin**, **Runway**, or **Prime Cost** to see a brief explanation without leaving the page.

## Read the break-even status line

Immediately below the five tiles, inside the same **Today's Snapshot** card, is a single line of break-even information:

- **Break-even: $X/day** — the daily revenue you need to cover all your fixed and variable costs.
- A colored badge showing whether today's sales are **Above** (green), **At break-even** (orange), or **Below** (red) that target, plus the dollar difference.
- **Last 14d: X above · X below** — a quick count of how many of the past 14 days cleared break-even versus fell short.

If no daily costs have been configured yet, the line prompts you to **Configure** and links to the Budget page.

## Read the Monthly Break-Even strip

Just below Today's Snapshot is the **Monthly Break-Even** strip. It summarizes your month-to-date progress toward your monthly break-even in one compact bar:

1. The **progress bar** fills from left to right as month-to-date revenue grows toward your monthly break-even target. The fill color is green (Ahead), yellow (On pace), or red (Behind).
2. A **dashed vertical line** marks where the bar should be filled by today's date if you are exactly on pace.
3. The status badge on the right reads **Ahead**, **On pace**, or **Behind**.
4. Below the bar, you can see how much revenue you have collected so far this month, the monthly break-even target, the percentage reached, and (when behind) the daily amount still needed to hit the target.

Click **Budget** on the right side of the strip to open the full Budget page.

## Read the Sales vs Break-Even chart

Below the Monthly Break-Even strip is the **Sales vs Break-Even** bar chart. It plots each of the last 14 days as a bar colored green (above break-even) or red (below break-even). A dashed horizontal line marks your daily break-even dollar amount.

Below the chart, four summary tiles show:

- **Days above** and **Days below** break-even over the 14-day window.
- **Avg surplus** — the average amount you cleared break-even on good days.
- **Avg shortfall** — the average amount you fell short on bad days.

When your budget is configured, two additional tiles appear: **Target COGS %** (your budgeted cost-of-goods percentage) and **Actual COGS %** (what you actually spent). Red text means actual exceeded target.

You can click any bar to jump directly to the P&L report for that day.

## Act on Critical Alerts

If any of the following conditions exist, a colored alert banner appears at the very top of the Dashboard content area, above Today's Snapshot:

- **Red (critical):** fewer than 14 days of cash runway, prime cost above 70%, more than 20 items needing reorder, or more than 50 unmapped POS items.
- **Orange (warning):** cash runway between 14 and 30 days, prime cost between 65% and 70%, 11–20 items needing reorder, or 21–50 unmapped POS items.

Each banner shows a short title, a description, and a link button. Click the link button — for example **View Banking**, **View Reports**, **View Inventory**, or **Map Items** — to go directly to the page where you can fix the issue.

When no alerts exist the banner area is hidden automatically.

## Read Smart Alerts

Below the Sales vs Break-Even chart is the **Smart Alerts** panel. It generates food cost and inventory insights by comparing today's data against recent history:

- If today's food cost percentage is more than 5 points above the previous period, it flags **Food Cost Above Average** and shows the gap.
- If food cost is meaningfully below the previous period, it shows **Excellent Food Cost Control**.
- If prime cost exceeds 65%, it shows **Prime Cost Above Target**.
- If a small number of items (5 or fewer) are below par level, it shows an informational note.
- When everything looks fine, it shows **Restaurant looks healthy**.

No action is required from this panel — it is for awareness only.

## Change the Performance Period

Below Smart Alerts is the **Performance Period** selector. Clicking any tab updates all **Performance Overview** cards, the **Cashflow** diagram, the **Revenue Mix** section, the **Expenses** cards, and the month count shown in the header.

Available periods:

- **Today**
- **This Week** (Monday through today)
- **This Month** (first of the month through today)
- **This Quarter** (first day of the current quarter through today)
- **Last 30 Days**
- **Last 90 Days**
- **Custom** — click the calendar icon, then pick a start and end date in the date picker that appears.

The currently active period is underlined. A small day-count appears on the right side of the selector row.

## Read Performance Overview cards

Directly below the Performance Period selector is the **Performance Overview** section. It contains five metric cards for the selected period:

1. **Your Sales (after discounts/refunds)** — net revenue for the period. An up or down trend arrow compares it to the previous period of equal length.
2. **Inventory Purchases** — total dollars spent on inventory orders during the period, plus the percentage of revenue those purchases represent and the number of purchases.
3. **COGS** — cost of goods sold (food costs recognized during the period). The subtitle shows the percentage of revenue and a target range of 28–32%.
4. **Labor Cost (Wages + Payroll)** — total labor for the period, as a dollar amount and a percentage of revenue. The subtitle also breaks this into **Pending Payroll** (labor recognized but not yet paid through payroll) and **Actual Payroll** (payroll runs already processed).
5. **Gross Profit** — revenue minus food cost and labor cost. The subtitle shows the gross profit margin percentage.

Below the five cards, a summary bar repeats the gross profit dollar amount and margin percentage, and then shows two side-by-side boxes for **Pending Payroll** and **Actual Payroll** with their respective percentages of revenue.

## View the Cashflow section

The **Cashflow** section shows a Sankey diagram — a flow chart — of money coming in and going out during the selected period. The width of each flow band represents the relative size of that income or expense stream. This makes it easy to see at a glance which cost categories consume the most revenue.

## View Monthly Performance

The **Monthly Performance** section shows a month-by-month table covering the last 12 months up to the end of the selected period. Use it to spot seasonal patterns or month-over-month trends in revenue, costs, and profit.

## View Revenue Mix

The **Revenue Mix** section appears only when your POS sales data has been categorized. It shows:

- **Gross Revenue**, **Discounts & Refunds**, and **Net Revenue** for the period.
- A breakdown by sales category (for example, Food, Beverages, or Merchandise) with each category's dollar amount and share of gross revenue.
- A **Collected but Owed** subsection that separates out **Sales Tax Collected** and **Tips Collected** — money that passed through your POS but belongs to the government or your staff, not to your business.

A small badge shows the percentage of POS items that have been categorized so far.

## View Banking

The **Banking** section displays current balances from all connected bank accounts. If no bank is connected, you will see a prompt to **Connect Bank Account**, which takes you to the Banking page.

## View Expenses

The **Expenses** section ("Where your money went") shows two cards for the selected period:

- **Spending by category** — how much went to each expense type (such as food purchases, utilities, or rent) pulled from your categorized bank transactions.
- **Top vendors** — the suppliers and payees that received the most payments.

## View Operations Health

The **Operations Health** section contains the **Restaurant Health** card. It checks four items and marks each as good (green checkmark) or needs attention (orange triangle):

1. **Prime Cost** within target or above target — click **View Details** to open Reports.
2. **POS items mapped** — if any items are unmapped, click **Map Items** to go to POS Sales.
3. **Uncategorized transactions** — if any transactions have not been categorized, click **Categorize** to go to Banking.
4. **Inventory levels** — if any items are low, click **Review** to go to Inventory.

When any item needs attention, a footer note reminds you to fix it to keep your costs and reports accurate.

## Use Quick Actions

At the bottom of the Dashboard is the **Quick Actions** section — eight buttons for the most common tasks:

| Button | Where it goes |
|---|---|
| **Add Inventory** | Inventory page |
| **Upload Receipt** | Receipt import |
| **Manage Recipes** | Recipes page |
| **View Reports** | Reports page |
| **POS Sales** | POS Sales page |
| **Bank Accounts** | Banking page |
| **Integrations** | Integrations page |
| **Settings** | Restaurant settings |

## Collapse or expand any section

Every major section on the Dashboard — **Performance Overview**, **Cashflow**, **Monthly Performance**, **Revenue Mix**, **Banking**, **Expenses**, **Operations Health**, and **Quick Actions** — has a small chevron button on the right side of its heading. Click that button to collapse the section and hide its content. Click it again to expand it. Your choices are not saved between sessions.

---

## Tips

- **Check Today's Snapshot first thing every morning.** The five tiles give you a 30-second health check before the day gets busy.
- **Use the break-even status line as your daily goal.** If today is already above the break-even target before the dinner rush, that is a strong signal.
- **Aim for Prime Cost between 60% and 65%.** If it is creeping above that, review your labor schedule and supplier costs together rather than one at a time.
- **Connect your bank accounts.** Cash, Runway, and the Cashflow section are only as accurate as the bank data behind them. The Banking page walks you through the connection in a few minutes.
- **Keep POS items mapped.** Unmapped items show up as warnings in Operations Health and make your Revenue Mix and COGS numbers incomplete.

---

## Troubleshooting

**Today's Snapshot shows $0 revenue even though we took sales.**
Your POS connection or manual sales entry may not be synced yet. Go to **POS Sales** to trigger a sync or add sales manually, then return to the Dashboard.

**Cash and Runway show $0.**
No bank accounts are connected, or your bank connection needs to be refreshed. Go to **Banking** and reconnect.

**The Revenue Mix section is not visible.**
This section only appears when at least some of your POS sales have been categorized. Go to **POS Sales** and map your menu items to sales categories.

**The Monthly Break-Even strip says "Set fixed and percentage costs."**
Your budget has not been configured. Click the **Set up costs** link in the strip (or go to **Budget** in the navigation) to enter your fixed and variable costs.

**The break-even chart shows no data.**
The chart requires both a configured budget and at least one day of sales history. Set up your budget first, and the chart will populate as sales data comes in.

---

## Frequently asked questions

**What is the difference between Revenue in Today's Snapshot and Your Sales in Performance Overview?**
Both are net revenue — sales after discounts and refunds. Today's Snapshot always shows today's figure. Your Sales in Performance Overview reflects whichever period you have selected in the Performance Period tabs.

**Why is my Runway number very high (or shows "365+")?**
If spending from your connected bank accounts is very low or zero, the calculation produces an unusually large number. This usually means your bank connection is new and does not yet have 30 days of transaction history, or most of your transactions are not yet categorized.

**What counts as Prime Cost?**
Prime Cost is food costs (ingredients and supplies used) plus all labor costs (hourly wages and payroll) expressed as a percentage of sales. The healthy target in EasyShiftHQ is 60–65%. Above 70% triggers a critical alert.

**Can I see data for a specific custom date range?**
Yes. In the Performance Period row, click **Custom**, then pick a start date and an end date from the calendar. All Performance Overview and Expenses data will update to match that range.

**Do changes I make on other pages update the Dashboard automatically?**
Yes. Data refreshes in the background. If you add inventory, run a payroll, or import sales, the relevant Dashboard numbers will update within about 30–60 seconds of returning to the Dashboard page.

---

## Related articles

- [Set Up Your Budget and Break-Even Target](/help/budget-break-even)
- [Connect and Review Bank Transactions](/help/banking-connect-and-transactions)
- [Triage Ops Inbox Alerts](/help/ops-inbox-triage-alerts)
- [Read Your Financial Statements](/help/financial-statements)
