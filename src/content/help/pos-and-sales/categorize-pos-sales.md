---
title: "Categorize Sales and Create Automation Rules"
category: "pos-and-sales"
summary: "Assign sales to chart-of-accounts categories manually, accept AI suggestions, bulk-categorize, split a sale across categories, and save rules to auto-categorize future sales."
audience: ["owner", "manager", "accountant"]
order: 60
keywords: ["categorize", "AI", "split", "bulk", "rules", "chart of accounts", "automation", "revenue"]
related: ["view-filter-pos-sales", "banking-connect-and-transactions", "chart-of-accounts-and-intelligence"]
---

# Categorize Sales and Create Automation Rules

This article explains how to assign your POS sales to chart-of-accounts categories on the Sales page — using AI suggestions, manual selection, bulk actions, or split allocations — and how to save category rules so future sales are categorized automatically. It is intended for owners, managers, and accountants.

## Before you begin

You need to be signed in with an **owner**, **manager**, or **accountant (collaborator)** role for the restaurant you want to work with. Your chart of accounts must have at least one revenue or liability account set up before you can assign categories. If the AI categorization button is grayed out or shows an error directing you to Accounting, set up your chart of accounts first. See [Set Up the Chart of Accounts and View Financial Intelligence](/help/chart-of-accounts-and-intelligence).

## Understand the AI Categorization card

At the top of the Sales page, below the summary metrics, there is an **AI Categorization** card with two pieces of information:

- **Uncategorized** badge — the number of sales in the selected date range that have no category and no pending AI suggestion.
- **Pending review** badge — the number of sales where the AI has already suggested a category but you have not accepted it yet. This badge only appears when there are pending suggestions.

These counts are based on the full date range you have set, not the current search or Status filter.

## Have the AI suggest categories for uncategorized sales

1. Go to **Sales** in the left navigation and select your restaurant if prompted.
2. In the **AI Categorization** card, click **AI Categorize Sales**.
3. The button changes to **Categorizing...** while the AI processes the uncategorized sales. Wait for it to finish.
4. When complete, the **Uncategorized** count decreases and a **Pending review** count appears (or increases) showing how many suggestions are waiting for your review.

If the AI cannot run — for example because no chart-of-accounts categories are configured — an error message appears below the button with a **Go to Accounting** link and a **Dismiss** button.

## Review and accept AI suggestions

After the AI runs, each sale that received a suggestion is highlighted with an amber background. To review them efficiently, use the **Status** filter:

1. In the filter bar, under **Status**, click **Pending Review**. The list narrows to only sales with AI suggestions.
2. Each card shows an amber panel with:
   - A sparkle icon and the suggested account name.
   - A confidence badge: **high**, **medium**, or **low**.
3. To confirm the suggestion, click **Accept** on the card. The sale is immediately categorized and the amber highlight disappears.
4. To choose a different category instead, click **Change**. An account selector opens inline on the card. Search or scroll to the account you want and click it to apply your choice.

## Manually categorize a sale without an AI suggestion

For sales that the AI did not suggest a category for:

1. Hover over the sale card. A row of action links appears at the bottom of the card.
2. Click **Categorize**. An inline account selector opens on the card.
3. Search or scroll to find the right revenue or liability account and click it. The category is applied immediately.

If the sale was already categorized and you want to change it, hover the card and click **Edit** next to the category badge, then pick a new account from the selector.

## Bulk-categorize multiple sales at once

When you need to assign the same category to many sales at once:

1. In the results header bar (above the sales list), click **Select**. The button turns active and a checkbox appears on each sale card.
2. Click the checkboxes on the sales you want to include. To select a range of cards at once, click the first card you want, then click the last card while holding **Shift**.
3. A floating **Bulk Actions** bar appears at the bottom of the screen showing how many items are selected (for example, **3 selected**).
4. In the Bulk Actions bar, click **Categorize**.
5. A side panel slides in titled **Categorize [N] sales**. Use the **Chart of Accounts Category** selector to pick an account.
6. Optionally, turn on the **Override existing categories** toggle if you want to overwrite categories on sales that are already categorized.
7. Click **Apply to [N] sales**. The panel closes and the categories are saved.
8. To exit selection mode without applying, click **Done** in the results header bar or the X button on the Bulk Actions bar.

## Split a sale across multiple categories

Use a split when a single sale amount needs to be divided between two or more accounting categories — for example, splitting a combo sale between food revenue and beverage revenue.

1. Hover over a sale card and click **Split**. The **Split Sale** dialog opens.
2. The dialog shows the item name, **Total Amount**, **Allocated** (the sum of your split lines), and **Remaining** (how much is still unallocated).
3. The dialog starts with two split lines labeled **Split 1** and **Split 2**. For each line:
   - Click the **Category** selector and choose a revenue or liability account.
   - Enter an **Amount** for that portion of the sale.
   - Optionally enter a **Description** (for example, "Sales Tax" or "Tip").
4. To add more lines, click **Add Split Line**.
5. To remove a line you added (when there are more than two), click the trash icon on that line.
6. The **Split Sale** button at the bottom is enabled only when **Remaining** reaches $0.00 (the amounts balance exactly). If it is still disabled, adjust your amounts until the **Remaining** field shows green with $0.00.
7. Click **Split Sale** to save. The dialog closes and the sale card updates to show its split breakdown.

### Edit or revert an existing split

- To edit split amounts or categories: find the split sale card in the list (it shows a **Split Sale** badge and an expandable breakdown). Click **Edit Split** on the card. The **Edit Split Sale** dialog opens, pre-filled with the existing split lines. Adjust the values and click **Update Split**.
- To undo a split entirely: open the **Edit Split Sale** dialog and click **Revert**. A confirmation dialog titled **Revert Split Transaction** appears asking if you are sure. Click **Revert Split** to restore the sale to its original single-line state. The sale can then be categorized again normally.

## Create a rule to auto-categorize future sales

After you categorize a sale, you can save a rule so that future sales with the same item name are categorized automatically.

1. Hover over a categorized sale card. In the action row at the bottom of the card, click **Create rule**.
2. The **Category Rules** dialog opens, pre-filled with:
   - A rule name based on the item name (for example, "Auto-categorize Burger Combo").
   - The item name set as the pattern to match.
   - The category already applied to that sale.
3. Review the pre-filled details, adjust the rule name or match pattern if needed, and save the rule.

To open the rules dialog directly without starting from a specific sale, click **Rules** in the top-right area of the Sales page header. From there you can view, edit, and manage all existing POS categorization rules.

## Use the Status filter to work through sales systematically

The **Status** filter under the filter bar helps you work through uncategorized sales in stages:

| Option | What it shows |
|---|---|
| **All** | Every sale regardless of categorization state |
| **Uncategorized** | Sales with no category and no pending AI suggestion |
| **Pending Review** | Sales where the AI has suggested a category awaiting your approval |
| **Categorized** | Sales that have a confirmed category |

A recommended workflow:

1. Click **AI Categorize Sales** to generate suggestions.
2. Switch **Status** to **Pending Review** and accept or adjust each suggestion.
3. Switch **Status** to **Uncategorized** and manually categorize any remaining sales.
4. Switch **Status** to **Categorized** to confirm everything looks correct.

## Tips

- Run AI categorization before working through sales manually — it handles the majority of common items and saves significant time.
- The AI categorization runs across all uncategorized sales for the restaurant regardless of which date range is shown on screen. The date range you set only affects the counts shown in the **AI Categorization** card and the sales visible in the list.
- After accepting or applying categories to a batch of sales, click **Create rule** on one of them to prevent the same items from needing manual categorization in the future.
- You can use **Bulk categorize** together with the **Status: Uncategorized** filter to quickly assign the same category to a large group of similar, uncategorized sales.
- The category selector in all dialogs and inline panels only shows revenue and liability accounts — the account types relevant to sales categorization.

## Troubleshooting

**The "AI Categorize Sales" button is grayed out.**
The button is disabled when there are zero uncategorized sales in the selected date range or when totals are still loading. Try selecting a wider date range. If the count shows zero and you believe there are uncategorized sales, click **Clear** in the filter bar to remove any active filters.

**The AI returns an error message with a "Go to Accounting" link.**
This means the AI cannot find enough chart-of-accounts categories to make suggestions. Click **Go to Accounting** and ensure you have revenue accounts set up. Once accounts exist, return to the Sales page and try again.

**"Split Sale" button stays disabled even though I've entered amounts.**
The button is enabled only when the **Remaining** amount is exactly $0.00. Check that the sum of all your split line amounts equals the **Total Amount** shown at the top of the dialog. Even a one-cent difference will keep the button disabled.

**I can't find the "Categorize" or "Split" action links on a card.**
These links appear on hover on desktop screens. If you are on a small screen or touch device they should be visible without hovering. Make sure you are not in selection mode (the **Select** button is active) — in selection mode, clicking a card toggles its checkbox rather than showing action links.

**I reverted a split but the sale still shows the old categories.**
The page should refresh automatically after a successful revert. If the old split is still visible, reload the page or click **Sync** in the header if a POS system is connected.

## Frequently asked questions

**Does accepting an AI suggestion create a category rule automatically?**
No. Accepting a suggestion only categorizes that individual sale. To prevent the same item from needing categorization again, hover the categorized card and click **Create rule** to save a rule manually.

**Can I categorize a sale that came from a connected POS system (not just manual sales)?**
Yes. Categorization works on all sales regardless of source — Square, Toast, Clover, manual entries, or CSV imports. The source only affects whether you can edit or delete the record itself.

**What account types can I assign to a sale?**
Only **revenue** and **liability** accounts appear in the category selector. This matches the account types appropriate for sales (for example, sales revenue, sales tax payable).

**If I bulk-categorize and some of the selected sales are already categorized, what happens?**
By default, the bulk action skips sales that already have a category. Turn on the **Override existing categories** toggle in the side panel if you want to overwrite them.

**Can I split a sale that is already categorized?**
Yes. You can split any sale that has not already been split. If the sale is already split, use the **Edit Split Sale** flow instead. Categorization of the parent sale is replaced by the individual categories you assign to each split line.

## Related articles

- [View, Search, and Filter Your POS Sales](/help/view-filter-pos-sales)
- [Set Up the Chart of Accounts and View Financial Intelligence](/help/chart-of-accounts-and-intelligence)
- [Connect Your Bank and Manage Transactions](/help/banking-connect-and-transactions)
- [Connect and Sync a POS System](/help/connect-pos-system)
- [Record and Edit Sales Manually](/help/record-edit-manual-sales)
