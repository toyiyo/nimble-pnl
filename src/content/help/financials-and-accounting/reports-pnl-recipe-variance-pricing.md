---
title: "Use the Reports Page: P&L, Recipes, Variance, and Pricing"
category: "financials-and-accounting"
summary: "The Reports page gives you seven analytical tabs — P&L Trends, P&L Detail, Recipes, Trends, Alerts, Variance, and Pricing — all scoped to a date range you choose, with CSV and PDF export available on key reports."
audience: ["owner", "manager", "accountant", "chef"]
order: 120
keywords: ["reports", "P&L", "recipe profitability", "variance", "supplier pricing", "food cost", "export", "CSV"]
related: ["financial-statements", "menu-item-recipes", "inventory-reconciliation", "weekly-brief-performance-digest"]
---

# Use the Reports Page: P&L, Recipes, Variance, and Pricing

The **Reports & Analytics** page brings together seven deep-dive reports in one place, from daily profit-and-loss trends to ingredient-level cost savings. All reports update instantly when you change the date range, so you can zero in on any period without leaving the page.

## Before you begin

- You must have at least one restaurant selected. If no restaurant is active, the page will show a restaurant selector instead of the reports.
- The **Recipes** tab requires the recipe profitability feature to be enabled on your plan.
- The **Alerts** tab requires the AI alerts feature to be enabled on your plan.
- Data must exist for the selected period; each report shows an empty state if there is nothing to display yet.

## Open Reports & Analytics and set a date range

1. In the main navigation, click **Reports & Analytics**.
2. At the top of the page, find the **Period Selector**. Click it to open the date range picker.
3. Choose a preset period or set a custom start and end date.
4. The period you select applies to all seven tabs simultaneously. Always set your date range before switching tabs to make sure the data reflects the right time window.

## Use the P&L Trends tab

The **P&L Trends** tab opens the **P&L Intelligence Dashboard**, which shows predictive insights and performance analytics for the selected period.

1. From the Reports & Analytics page, click the **P&L Trends** tab.
2. At the top of the dashboard you will see four summary cards: **Revenue**, **Prime Cost**, **Efficiency Score**, and **Labor ROI** (revenue per labor dollar). Each card shows the current-period value and compares it to the previous period where applicable.
3. Below the summary cards, a second row of tabs lets you drill deeper:
   - **Trends** — a combined chart of daily Revenue bars alongside Food Cost %, Labor Cost %, and Prime Cost % lines; below that, a stacked area chart of cost percentages with industry reference lines.
   - **Revenue Mix** — gross revenue, discounts and refunds, and net revenue broken down by sales category, with a pie chart and a category detail list. When no categorized POS sales exist, this sub-tab shows an empty state prompting you to start categorizing sales.
   - **Comparison** — side-by-side metrics for the current period vs. the previous period (Revenue, Food Cost, Labor Cost, Prime Cost), plus a Cost Distribution pie chart.
   - **Patterns** — a day-of-week analysis showing average revenue, food cost %, and labor cost % for each day of the week.
   - **Forecast** — a 7-day revenue forecast based on historical patterns, with a confidence level indicator.
   - **Benchmarks** — your Food Cost %, Labor Cost %, and Prime Cost % compared to industry averages, plus a radar chart of your overall performance.
4. Any insight cards that appear above the summary cards (color-coded critical, warning, or success) include a **Recommendation** explaining what action to take.
5. To export, click the **Export** button in the P&L Intelligence Dashboard header. Choose **Export CSV** or **Export PDF**. The export includes daily rows for Date, Revenue, Food Cost, Labor Cost, Prime Cost, and the corresponding percentage columns.

## Use the P&L Detail tab

The **P&L Detail** tab opens the **Detailed P&L Breakdown**, which shows a structured income-statement view for the selected period with inline benchmarks and status indicators.

1. Click the **P&L Detail** tab.
2. The breakdown has the following main rows: **Net Sales** (or "Net Sales (after discounts)" when categorized revenue is available), **Cost of Goods Sold (COGS)**, **Labor Costs**, **Prime Cost (COGS + Labor)**, and **Gross Profit (Revenue - Prime Cost)**.
3. Rows with an expand arrow can be clicked to reveal sub-items. For example, Net Sales expands to show Gross Revenue and Less: Discounts & Refunds; Labor Costs expands to show Pending Payroll (Scheduled) and Actual Payroll (Paid).
4. Each row shows the dollar Amount, the percentage of sales, a vs. previous-period change indicator, an industry Target percentage badge, a 7-day mini trend sparkline, and a status icon: a green checkmark means on target, an amber circle means needs attention, and a red circle means critical action required.
5. On desktop, hovering over any row's status icon or Target badge shows detailed insight text and the exact industry benchmark being used.
6. If labor has not been recorded for the period, a banner at the top alerts you that prime cost and margin metrics are incomplete.
7. To export, click the **Export** button at the top right of the card. A CSV file downloads containing all rows with amounts, percentages, benchmarks, and insight text.

## Use the Recipes tab

The **Recipes** tab requires the recipe profitability feature. When enabled, it opens the **Recipe Intelligence Report**.

1. Click the **Recipes** tab.
2. If the feature is not enabled on your plan, you will see a feature gate message instead of the report.
3. When data is available, AI-generated insight cards appear at the top. Each card has a title, description, a list of affected recipes (which link directly to the recipe detail page), a Recommendation, and an estimated monthly dollar impact.
4. Below the insight cards, four summary cards display: **Active Recipes** (count out of total recipes), **Avg Margin** (with a 65% target shown below), **Efficiency Score** (out of 100), and **Top Performers** (count of high-performing recipes, plus how many need attention).
5. A second row of tabs lets you explore further:
   - **Performance** — a bar and line chart of Revenue, Efficiency Score, and Margin % for up to ten recipes, followed by individual recipe cards showing Efficiency Score, Margin, Revenue for the period, Velocity (units/day), and Food Cost %.
   - **Profitability** — a Revenue Contribution pie chart, a Profit per Recipe horizontal bar chart, and a Margin Analysis section with a bar for each recipe color-coded green (60%+), yellow (50–59%), or red (below 50%).
   - **Efficiency** — an Efficiency Score Distribution chart for up to ten recipes, plus three ranked lists: Top Efficiency Leaders, Fastest Moving (by velocity in units/day), and Revenue Champions.
   - **Trends** — a Cost & Margin Trends line chart showing Cost, Price, and Margin % over time, plus a Recipe Velocity Prediction section with a next-week revenue forecast and predicted top sellers.
   - **Benchmarks** — a radar chart comparing your restaurant's metrics to the industry standard, with individual benchmark cards showing Your Value, Industry Standard, and the gap in points.
   - **Ingredients** — a Top Cost Impact Ingredients horizontal bar chart showing Total Cost and Savings Potential for each ingredient, followed by detail cards for each ingredient showing Total Cost, Used in Recipes count, Usage Frequency, and Savings Potential.
6. Recipe names throughout the report are clickable links to the corresponding recipe on the Recipes page.
7. To export, click the **Export** button in the Recipe Intelligence Report header and choose **Export CSV** or **Export PDF**.

## Use the Trends tab

The **Trends** tab opens the Consumption Intelligence Report, which shows ingredient usage trends over the selected period. No additional feature gate applies. The report requires purchase and usage data to display results.

## Use the Alerts tab

The **Alerts** tab opens the Alerts Intelligence Report for AI-generated inventory alerts. This tab requires the AI alerts feature to be enabled on your plan. When enabled and data is present, the report surfaces proactive alerts about stock levels and usage patterns.

## Use the Variance tab

The **Variance** tab opens the **Variance Intelligence Report**, which shows how well your actual inventory counts match expected levels.

1. Click the **Variance** tab.
2. The report requires at least one completed inventory reconciliation. If none exist, you will see a prompt to run a count first.
3. Four summary cards show: **Total Counts** (number of reconciliations analyzed, labeled "reconciliations analyzed"), **Total Shrinkage** (dollar value of inventory loss, with the average per count shown below it), **Problem Category** (the single category with the most variance, labeled "needs attention"), and **Improvement Rate** (the percentage reduction in variance over time, green when positive and red when negative).
4. Any insight cards at the top are color-coded and include an **Action** label with a recommendation, the number of items affected, and an estimated dollar impact.
5. A second set of tabs inside the report provides more detail:
   - **Trends** — two charts: Variance Rate Over Time (percentage of items with variance per count) and Shrinkage Value Trend (dollar cost impact per reconciliation).
   - **Categories** — a pie chart and bar chart of variance by category, followed by detail cards for each category showing its total dollar variance and top offenders.
   - **Products** — cards for the top variance products, each with an **Improving**, **Stable**, or **Worsening** badge, an average variance in units, and a mini line chart comparing Expected vs. Actual counts over time.
   - **Timeline** — a chronological list of every reconciliation, showing date, items counted, items with variance, variance rate %, and dollar impact.
6. To export, click the **Export Report** button in the report header. A CSV downloads containing the summary metrics and a row for every top-variance product with its product name, category, average variance, trend, and total impact.

## Use the Pricing tab

The **Pricing** tab opens the **Supplier Price Analysis** report, which tracks how your ingredient costs are changing across suppliers.

1. Click the **Pricing** tab.
2. The report requires purchase history data. If none exists, you will see a "No Pricing Data Available" message.
3. Four overview cards show: **Avg Price Change (30d)** (average percentage price movement across all tracked products), **Potential Savings** (total dollars available by switching to the cheapest supplier for each item, with the note "By switching to cheaper suppliers"), **High Volatility Items** (count of products with price swings greater than 15%), and **Active Suppliers** (number of suppliers tracked in the selected period).
4. Two side-by-side panels list the **Biggest Price Increases (30d)** and **Biggest Price Decreases (30d)** — the top five products by price movement in each direction, with the current price per unit and a percentage badge.
5. A **Cost Savings Opportunities** table lists products where you have more than one supplier on record. For each product it shows Current Price, Cheapest Supplier (labeled "Cheapest"), Most Expensive Supplier, and Potential Savings. Products are ranked by savings opportunity size.
6. A **Price Volatility by Category** bar chart shows the average volatility percentage for each ingredient category.
7. A **Supplier Performance** table lists all active suppliers with their Products count, Avg Price Change (30d), Total Purchases count, and a Reliability Score out of 100. The table is sorted from highest to lowest reliability.
8. If your average costs have increased by more than 5% in 30 days, a **Price Increase Alert** banner appears at the bottom with a recommendation to review supplier contracts.
9. The Pricing tab does not have a built-in export button.

## Tips

- Set your date range in the Period Selector before switching between the seven tabs. The period applies to all tabs simultaneously.
- On the P&L Trends tab, the Forecast sub-tab shows a confidence level that improves with more historical data in the selected range.
- On the Recipes tab, clicking any recipe name in the report opens that recipe's detail page directly, so you can review or edit its ingredient list without searching.
- On the Variance tab, focus on products showing a Worsening badge first — these have growing average variances across consecutive counts.
- On the Pricing tab, the Cost Savings Opportunities table only shows products where you have recorded purchases from at least two different suppliers, so every comparison is grounded in your own purchase history.
- The Efficiency Score on both the P&L Trends and Recipes tabs is out of 100. Higher scores reflect better cost control relative to the period's performance.

## Troubleshooting

**The Recipes tab shows a feature gate message instead of the report.**
The recipe profitability feature is not enabled on your current plan. Contact your account owner or EasyShiftHQ support to enable it.

**The Alerts tab shows a feature gate message.**
The AI alerts feature is not enabled on your plan. Contact support to upgrade or enable it.

**The Variance tab says to complete at least one inventory reconciliation.**
You need to run an inventory count and submit it through the Inventory Reconciliation workflow before any variance data appears here.

**The Pricing tab says "No Pricing Data Available."**
Pricing data is built from your recorded purchase orders and invoices. Once you have recorded purchases that include supplier and price information, the report will populate.

**The P&L Detail tab shows a warning that labor data is not recorded.**
Prime Cost and Gross Profit figures will be incomplete until labor costs are added. Enter labor costs through the Data Input section.

**The charts look flat or show only a single point.**
The selected period may be too short to show meaningful trends. Try expanding the date range in the Period Selector at the top of the page.

## Frequently asked questions

**What is Prime Cost and why does it matter?**
Prime Cost is the sum of your food cost (COGS) and your labor cost. It represents your two largest controllable expenses and is the single most important restaurant profitability metric. The industry target is generally below 60% of revenue.

**How is the Efficiency Score calculated?**
On the P&L Trends tab, the Efficiency Score is a 0–100 rating based on how well your cost percentages compare to industry benchmarks over the period. On the Recipes tab, each recipe's efficiency score combines its margin, daily sales velocity, and overall profit contribution.

**Why do recipe names in the Recipes tab link to another page?**
Clicking a recipe name jumps directly to that recipe's detail view so you can inspect its ingredient list and cost structure without navigating away from the report manually.

**Can I export all seven report tabs at once?**
No — each report has its own export where available. P&L Trends supports CSV and PDF. Recipes supports CSV and PDF. P&L Detail (via the Export button on the card) supports CSV. The Variance tab supports CSV via the Export Report button. The Trends, Alerts, and Pricing tabs do not currently offer a built-in export.

**Why does the Revenue Mix sub-tab show incomplete totals?**
Revenue Mix only includes sales that have been categorized in your chart of accounts. A banner on that sub-tab will tell you the current categorization rate. Uncategorized POS sales are excluded from the category breakdown but are still counted in the main Revenue figure across the rest of the report.

## Related articles

- [Financial Statements](/help/financial-statements)
- [Inventory Reconciliation](/help/inventory-reconciliation)
- [Weekly Brief & Performance Digest](/help/weekly-brief-performance-digest)
