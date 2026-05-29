---
title: "Enter and Approve Daily Tip Splits"
category: "payroll-and-tips"
summary: "Enter total tips collected for a day, review the calculated split across eligible employees, then approve or save as a draft to include amounts in payroll."
audience: ["owner", "manager"]
order: 40
keywords: ["tips", "tip split", "daily entry", "approve", "draft", "pool", "POS tips", "server tips"]
related: ["configure-tip-pool-settings", "lock-tips-for-payroll", "run-payroll", "employee-view-tips-and-dispute"]
---

# Enter and Approve Daily Tip Splits

This article walks owners and managers through entering the day's tip total, reviewing how the app splits that amount across eligible employees, and approving or saving the result as a draft for payroll.

## Before you begin

- You must be signed in as an **owner** or **manager** to enter or approve tip splits.
- Your tip pool settings (pooling model, share method, and which employees participate) should already be configured. If you have not done that yet, see [Configure Tip Pool Settings](/help/configure-tip-pool-settings).
- If you use a POS system and want tips synced automatically, make sure the POS connection is active. See [Connect and Sync a POS System](/help/connect-pos-system).

## Go to the Daily Entry tab

1. From the main navigation, click **Tips**.
2. On the Tips page, click the **Daily Entry** tab.
3. Use the date selector at the top of the tab to pick the date you are entering tips for. It defaults to today.

## Enter the tip total — Full Pool with Manual Entry

If your pooling model is **Full Pool** and your tip source is **Manual Entry**, follow these steps:

1. On the Daily Entry tab, find the **Enter tips** card.
2. Click **Enter today's tips**. A dialog opens.
3. Type the total dollar amount of tips collected for the day (for example, `450.00`).
4. Click **Continue**. The app moves you to the Review Tip Split screen.

## Import tips from your POS — Full Pool with POS Import

If your tip source is set to **POS Import** and tips have already synced from your POS:

1. On the Daily Entry tab, the **Today's tips** card shows the imported total and the number of transactions pulled from the POS.
2. Click **Use this amount** to accept the synced total and proceed to the Review Tip Split screen.
3. If the synced amount looks wrong, click **Edit** to switch to manual entry and type the correct total instead.

If the POS import card does not appear, no tips have synced yet for that day. An info message will say "No POS tips found for today." You can wait for the next sync or enter the amount manually.

## Enter individual server tips — Percentage Contribution model

If your pooling model is **Percentage Contribution**, you enter tips per server rather than a single pool total:

1. On the Daily Entry tab, find the **Enter server tips** card.
2. Click **Enter server tips**. A side panel opens showing each tip-eligible server.
3. Type each server's total tips for the day in the field next to their name. A running **Total** updates at the bottom of the panel as you type.
4. When all amounts are entered, click **Calculate Split**. The app calculates pool contributions and distributions automatically, then takes you to the Review Tip Split screen.

## Use employee-declared tips to pre-fill the total

If employees declared their tips when clocking out, the **Employee-Declared Tips** card appears on the Daily Entry tab with a breakdown by employee.

1. Review the listed amounts to make sure they look correct.
2. Click **Use Employee-Declared Tips ([amount])** to send that combined total directly to the Review Tip Split screen.
3. You can still change the total on the Review screen if needed.

## Review and adjust the tip split

After entering the tip total (by any method), the **Review Tip Split** screen shows each eligible employee's calculated share.

### Read the allocation table

- **Full Pool model:** The table lists each employee, the basis for their share (hours worked, role, or an even split depending on your settings), and their tip amount.
- **Percentage Contribution model:** The screen shows three sections — **Server Earnings** (each server's earned amount, deductions, refunds, and final amount), **Pool Breakdown** (how each pool distributed its funds), and **All Allocations** (the final amount for every employee).

### Edit an individual amount

Click any dollar amount in the **All Allocations** table to make it editable. Type a new value and the remaining employees' amounts automatically rebalance so the total stays correct.

### Recalculate hours from time punches

If your share method is **By hours worked** and you want to refresh the hours used in the calculation:

1. On the Review Tip Split screen, scroll up to the **Hours worked** card.
2. Click **Recalculate from punches**. The app pulls each employee's clock-in and clock-out records for the selected day and updates the hours fields.
3. You can still type a different value into any employee's hours field to override the calculated number.

### Check the balance before approving

At the bottom of the review card, the **Total remaining** indicator shows how much of the tip pool is unallocated. It turns green when the value is **$0.00**, meaning every dollar has been assigned. The **Approve tips** button is disabled until the total remaining is $0.00.

## Approve or save as a draft

Once you are satisfied with the allocations:

- Click **Approve tips** to finalize the split. The amounts are recorded and will be included in payroll reports.
- Click **Save as draft** to save the split without finalizing it. You can come back to it later.

After approving, a confirmation message confirms how much was distributed and to how many employees.

## Resume a saved draft

1. On the **Daily Entry** tab, scroll down to the **Saved Drafts** card. Each draft shows the date, total amount, and share method.
2. Click **Resume** next to the draft you want to continue.
3. The Review Tip Split screen reopens with the saved amounts. Make any changes, then click **Approve tips** or **Save as draft** again.

To delete a draft you no longer need, click the trash icon next to it and confirm the deletion in the dialog that appears.

## Tips

- The app auto-calculates hours from time punch records whenever your share method is set to **By hours worked**. A small clock icon next to an employee's name means their hours were pulled from the time clock. You can always type a different number to override it.
- You can adjust the total tip amount at the top of the Review Tip Split screen at any time before approving — useful if you realize you entered the wrong number.
- Approved tip splits flow to the **Overview** tab, where you can track approved days across the week and eventually lock the period for payroll. See [Lock Tips for Payroll, Record Cash Payouts, and Review Tip History](/help/lock-tips-for-payroll).

## Troubleshooting

**The "Approve tips" button stays grayed out.**
The button is disabled until "Total remaining" shows $0.00. Click any employee's amount to adjust it, or click "Recalculate from punches" to redistribute the total evenly based on hours.

**No POS tips appear even though I have a POS connected.**
Tips may not have synced yet for the selected day. Wait a few minutes and refresh the page, or switch to manual entry by clicking **Edit** on the POS import card.

**An employee I expect to see is missing from the allocation table.**
Only tip-eligible employees who are included in your tip pool settings appear. Go to the Settings icon on the Tips page to check which employees are enabled. See [Configure Tip Pool Settings](/help/configure-tip-pool-settings).

**"Enter Server Tips" shows "No tip-eligible servers found for this day."**
This appears when no participants are enabled for the Percentage Contribution model. Check your tip pool settings to confirm the right employees are marked as participants.

**I saved a draft but cannot find it.**
Drafts are listed in the **Saved Drafts** card on the Daily Entry tab. If the card shows "No saved drafts," the draft may have already been approved or deleted.

## Frequently asked questions

**Can I change an approved tip split?**
Approved splits are finalized. To make changes, contact your administrator. In some configurations a split can be re-opened to draft status, which removes the approval and allows editing before re-approving.

**What happens if I save a draft and someone else approves it?**
Whoever approves the split finalizes it. The last saved state of the allocations is what gets recorded.

**Does approving tips immediately update payroll?**
Approved tips appear in payroll reports right away. However, the period must also be locked before tips are included in a final payroll run. See [Lock Tips for Payroll, Record Cash Payouts, and Review Tip History](/help/lock-tips-for-payroll).

**Can employees see their own tip allocations?**
Employees can view tips declared at clock-out from the employee-facing pages, but the manager-approved split is a management-level record shown in payroll and the Tips page.

**What is the difference between "Full Pool" and "Percentage Contribution"?**
Full Pool collects all tips into one pot and distributes them using hours, role weights, or an even split. Percentage Contribution has each server contribute a set percentage of their own tips into shared pools that are then distributed to supporting staff. See [Configure Tip Pool Settings](/help/configure-tip-pool-settings) for setup details.

## Related articles

- [Configure Tip Pool Settings](/help/configure-tip-pool-settings)
- [Lock Tips for Payroll, Record Cash Payouts, and Review Tip History](/help/lock-tips-for-payroll)
- [Run Payroll: View Wages, Hours, and Tips](/help/run-payroll)
- [Track and Manage Employee Time Punches](/help/time-punches-manager)
- [Connect and Sync a POS System](/help/connect-pos-system)
