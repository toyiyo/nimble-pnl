---
title: "View, Search, and Filter Your POS Sales"
category: "pos-and-sales"
summary: "Browse all sales from connected POS systems and manual entries on the Sales page, using date ranges, search, and status or recipe filters."
audience: ["owner", "manager", "accountant"]
order: 30
keywords: ["sales", "POS", "filter", "search", "view", "date range", "revenue", "metrics"]
related: ["record-edit-manual-sales", "import-sales-csv", "categorize-pos-sales", "connect-pos-system"]
---

# View, Search, and Filter Your POS Sales

This article explains how to find and review sales records on the Sales page — including how to read the summary metrics, narrow results with search and date filters, and switch between individual and grouped views. It is intended for owners, managers, and accountants.

## Before you begin

You need to be signed in with an **owner**, **manager**, or **accountant (collaborator)** role for the restaurant you want to review. At least one POS system must be connected, or you must have recorded sales manually. If no POS system is connected, the page will prompt you to connect one or record sales manually.

## Go to the Sales page and select a restaurant

1. In the left navigation, click **Sales**.
2. If you manage more than one restaurant, a restaurant selector appears. Click the restaurant you want to review.
3. Once a restaurant is selected, the page loads your sales data automatically. If a POS system is connected, a background sync runs to pull in the latest records.

## Read the summary metrics

At the top of the page, a row of metrics summarises the sales for your current date range and filters:

- **Collected** — the total amount collected at the POS (after discounts and pass-through items are accounted for).
- **Revenue** — gross revenue from sales.
- **Discounts** — total discounts applied.
- **Voids** — total value of voided transactions (only shown when voids exist in the selected period).
- **Pass-Through** — pass-through items such as tax collected on behalf of a third party.
- **Items** — the number of unique menu items sold.

If a POS sync has run, a **Synced** timestamp appears on the right side of the metrics row showing the date and time of the last successful sync.

When you change any filter, the metrics update automatically to reflect the filtered subset of data. A **Filtered** indicator appears when the numbers shown are not the full unfiltered totals.

## Search for a specific item

1. Click the **Search items...** box at the top of the filter bar.
2. Type part or all of the item name.
3. The list and the summary metrics update as you type to show only matching records.

To clear the search, delete the text in the box or click **Clear** (described below).

## Set a date range

The page defaults to the **last 30 days**. To change the range:

1. Click the first date field (the start date) and choose a date.
2. Click the second date field (the end date) and choose a date.

The list and all metrics update immediately to cover only sales that fall within the chosen range. Both fields accept any date you type or pick from the date picker built into your browser.

## Filter by categorization status

The **Status** segmented control lets you focus on sales that need attention:

| Option | What it shows |
|---|---|
| **All** | Every sale regardless of categorization state |
| **Uncategorized** | Sales with no category assigned and no AI suggestion pending |
| **Pending Review** | Sales where the AI has suggested a category but you have not accepted it yet |
| **Categorized** | Sales that have a confirmed category assigned |

Click a label to apply it. A count badge next to **Uncategorized** and **Pending Review** shows how many records match (based on your current date range).

## Filter by recipe mapping

The **Recipe** segmented control shows whether each item has a linked recipe:

| Option | What it shows |
|---|---|
| **All** | Every sale |
| **Mapped** | Sales for items that are linked to a recipe in your recipe library |
| **Unmapped** | Sales for items that have no matching recipe |

Use **Unmapped** to find items you have not yet linked to a recipe, which also means their ingredient costs are not being tracked.

## Switch between Individual and Grouped views

The **View** segmented control changes how results are displayed:

- **Individual** — shows a scrollable list of every sale record. Each row displays the item name, date and time, source (POS system name), quantity, and total price. This is the default view.
- **Grouped** — shows a card grid where sales are combined by item name. Each card shows the item's total revenue, total quantity sold, and total number of individual sale records in the selected period. This view is useful for spotting your best-selling items at a glance.

## Sort the list

A sort control sits at the right end of the filter bar:

1. Click the sort dropdown (it shows the current sort field, for example **Date**) and choose one of:
   - **Date** — sorted by sale date and time (default).
   - **Item Name** — sorted alphabetically by item name.
   - **Quantity** — sorted by quantity sold per record.
   - **Amount** — sorted by the total price of each record.
2. Click the arrow button immediately to the right of the dropdown to toggle between ascending and descending order.

## Load more records

By default, the page loads a batch of records at a time. If more records exist beyond the current batch, a **Load more** button appears at the bottom of the list (and in the results header bar above the list). Click it to fetch the next batch.

## Clear all filters at once

When any filter is active — including a search term, date range, or a Status or Recipe selection other than **All** — a **Clear** button appears in the filter bar. Click it to reset:

- The search box to empty.
- The start and end dates to empty (showing all dates).
- Status back to **All**.
- Recipe back to **All**.
- Sort back to **Date**, descending.

## Tips

- The summary metrics always reflect your current filters, so you can use the date range and search together to check revenue for a specific item over a specific period.
- In **Grouped** view, each card shows a horizontal bar comparing that item's revenue to the top-performing item in the filtered set — a quick visual way to compare relative performance.
- If an item shows **No recipe** next to its name in the list, click that label to link it to a recipe. Linking recipes enables ingredient cost tracking and profit margin calculations.
- Use the **Pending Review** status filter after running AI categorization to quickly review and accept or adjust the suggestions the AI made.
- The **Synced** time shown in the metrics row reflects when the most recent POS sync completed, not when data was last loaded in your browser. Click **Sync** in the page header to pull in fresh data at any time.

## Troubleshooting

**The page shows "No POS systems connected."**
You have not yet linked a Square, Toast, or other supported POS system. See [Connect and Sync a POS System](/help/connect-pos-system) to get started, or use **Add Sale** to enter sales manually.

**Metrics show $0.00 even though sales exist.**
Check the date range. If both date fields are blank or set to a period with no data, the metrics will be zero. Try clearing the filters to see all dates.

**The list says "No sales found" after I searched.**
Your search term or filter combination returned no matches. Click **Clear** to reset everything, then narrow down again one filter at a time.

**The Synced time is several hours old.**
If your POS system is connected, click **Sync** in the page header to trigger a manual sync. If the sync still does not update, check your POS connection status in the POS settings page.

**I can see sales but the metrics seem lower than expected.**
The metrics show totals for the current filter set. If **Status** is set to **Uncategorized** or **Recipe** is set to **Mapped**, only a subset of sales is counted. Click **Clear** to see full unfiltered totals.

## Frequently asked questions

**Can I export the sales data I see?**
Yes. An export button is available in the page header. You can export what is currently shown — either Individual or Grouped view — to a CSV or PDF file.

**Does changing the date range affect what the AI categorizes?**
No. The AI categorization runs against all uncategorized sales for the restaurant, regardless of the date range you have selected on screen.

**Why do some sale cards have an amber background?**
An amber-highlighted card means the AI has suggested a category for that sale but you have not confirmed it yet. Click **Accept** to apply the suggestion, or click **Change** to pick a different category.

**Can I filter by more than one status at a time, for example both Uncategorized and Pending Review?**
No. The Status filter is a single-select control. To work through both groups, select one, take action, then select the other.

**What is the difference between Collected and Revenue?**
**Revenue** is the gross sale amount. **Collected** is the net amount actually received at the POS after discounts and pass-through items (such as third-party taxes) are subtracted. For most restaurants these numbers will be close but not identical.

## Related articles

- [Connect and Sync a POS System](/help/connect-pos-system)
- [Record and Edit Sales Manually](/help/record-edit-manual-sales)
- [Import Sales from a CSV File](/help/import-sales-csv)
- [Categorize Sales and Create Automation Rules](/help/categorize-pos-sales)
- [Build and Manage Menu Item Recipes](/help/menu-item-recipes)
