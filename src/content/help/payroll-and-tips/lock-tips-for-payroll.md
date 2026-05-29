---
title: "Lock Tips for Payroll, Record Cash Payouts, and Review Tip History"
category: "payroll-and-tips"
summary: "Lock an approved tip period so amounts appear in payroll, record which employees received cash, and review employee tip disputes."
audience: ["owner", "manager"]
order: 60
keywords: ["lock tips", "payroll", "cash payout", "tip history", "dispute", "archived", "weekly overview"]
related: ["tips-daily-entry", "configure-tip-pool-settings", "run-payroll", "employee-tips-view"]
---

# Lock Tips for Payroll, Record Cash Payouts, and Review Tip History

This article covers everything that happens after daily tip splits are approved: how to read the weekly overview, lock a period so tip amounts flow into payroll, record cash that employees have already received, and handle tip review requests from staff. It is written for owners and managers.

## Before you begin

- You must have the **owner** or **manager** role to lock periods, record payouts, and resolve disputes.
- All daily tip splits for the week must be in **approved** status and have employee allocations before you can lock the period. Splits still in **draft** status block the lock.
- If you have not yet entered or approved tips for the week, see [Enter and Approve Daily Tip Splits](/help/tips-daily-entry).

## Navigate the weekly Overview tab

The **Overview** tab on the Tips page shows you a full week at a glance.

1. Go to **Tips** in the main navigation. The page opens on the **Overview** tab by default.
2. The week displayed is always Monday through Sunday. Use the **← Previous** and **Next →** buttons to move between weeks. The **Next →** button is disabled when you are already viewing the current week.
3. The page shows a **Period Summary** card with the week's total tips, number of employees, and how many days have entries.
4. Below that is the **Period Timeline** — a seven-column grid, one cell per day. Each cell shows:
   - The abbreviated day name and date number.
   - The tip total for that day (if any entry exists).
   - A status indicator: **No entry** (dashed border), **Draft** (yellow), **Approved** (green), or **Locked** (muted/grey).
   - A **Paid** badge (emerald) if cash has been recorded for all allocations, or a **Partial** badge (amber) if only some employees have been paid.
5. Click any day cell to jump directly to **Daily Entry** for that date.

## Lock the period for payroll

Locking a period converts all approved splits into a permanent payroll snapshot. Once locked, tip amounts for those days cannot be changed and will appear on the Payroll page as **Tips Owed**.

**When "Lock for payroll" is available:** The button is only active when every split in the week is **approved** (no drafts remain) and every approved split has at least one employee allocation. The **Ready for payroll?** card beneath the timeline shows you the count of approved splits and drafts so you can see what still needs attention.

1. On the **Overview** tab, scroll to the **Ready for payroll?** card at the bottom.
2. The card shows a line such as "3 approved, 0 drafts." If there are remaining drafts, approve them first from the **Daily Entry** tab (see [Enter and Approve Daily Tip Splits](/help/tips-daily-entry)).
3. Once all splits are approved with employee allocations, click **Lock for payroll**.
4. A confirmation dialog appears: "Lock tips for Week of [date]?" with a note that locking ensures payroll numbers won't change and a payroll snapshot will be created.
5. Click **Lock Period** to confirm, or **Cancel** to go back.
6. A success notification appears: "Period locked for payroll — [N] day(s) locked. Tips are now included in payroll." The locked days in the timeline now show a lock icon with a muted (grey) style.

After locking, the approved tips appear on the Payroll page. See [Run Payroll: View Wages, Hours, and Tips](/help/run-payroll) for next steps.

## Record cash tip payouts

If you hand employees their tips in cash (rather than through a paycheck), you can record those payments directly from the timeline so both you and your staff have an accurate record.

1. On the **Overview** tab, find any day in the **Period Timeline** that shows an **Approved** or **Locked** status and has not yet been fully paid out (it will show no **Paid** badge, or a **Partial** badge if partially paid).
2. Below the tip amount on that day's cell, click the small **Pay out** button (it shows a banknote icon).
3. The tip payout side panel opens on the right (titled **Record Tip Payouts** for new entries, or **Edit Tip Payouts** when editing existing ones). The header shows the date and the day's total tip amount.
4. The panel lists every employee who has a tip allocation for that day. Each row shows the employee's name and their **Allocated** amount.
5. Toggle the switch next to each employee you are paying right now. When a switch is toggled on, a **Cash Paid** field appears below the employee's name pre-filled with their allocated amount.
6. If you paid a different amount than what was allocated (for example, you rounded to the nearest dollar), edit the **Cash Paid** field. A warning appears if the amount you enter exceeds the allocation.
7. You can use **Select All** or **Deselect All** at the top of the list to toggle every employee at once.
8. The **Total Payout** shown at the bottom of the panel updates as you make changes.
9. Click **Confirm** to save. A "Payouts recorded" notification appears and the day's cell in the timeline updates to show the **Paid** badge.

To correct a recorded payout, click **Pay out** on the same day again. The panel re-opens showing the existing entries, and you can delete an individual payout using the trash icon next to that employee's row.

## View tip history

The **History** tab shows locked (archived) tip entries for the currently selected date.

1. On the Tips page, click the **History** tab.
2. Each locked entry for the selected date appears as a row with the date and the total tip amount. If no periods have been locked yet, the tab shows "No locked periods yet."
3. History entries are read-only — they are a permanent record for payroll reference.

## Review tip disputes from employees

When an employee flags an issue with their tips from the employee-facing **My Tips** page (at `/employee/tips`), a **Tip Review Requests** alert card appears at the top of the Tips page for managers.

1. The alert card displays the number of open disputes, for example "2 employees have flagged issues." If there are no open disputes, the card is hidden.
2. Each dispute card shows the employee's name, the type of issue (**Missing hours**, **Wrong role**, or **Other**), the tip date, and any message the employee included.
3. Click a dispute card to open the **Tip review requested** dialog. The dialog shows:
   - **Issue type** — the category the employee selected.
   - **Date** — the tip split date the issue relates to.
   - **Employee notes** — the message the employee wrote, if any.
   - A **Resolution notes** text field where you can add your own notes (optional).
4. Click **Mark resolved** to close the dispute as resolved, or **Dismiss** to dismiss it without further action. Either choice closes the dialog and removes the card from the list.

## Tips

- Only approved splits with employee allocations count toward the lock. Days with no tips entered are simply skipped — you do not need to enter $0 for every day.
- You can record cash payouts before or after locking a period. Payout recording is independent of the lock.
- If a day already has a full **Paid** badge, the **Pay out** button will not appear. To correct the payout, you must re-open the side panel by temporarily editing an existing payout — open the panel again from the **Partial** badge state if available, or delete and re-enter from the same **Pay out** button.
- Locking is permanent for the included splits. If you need to change an amount after locking, contact support or re-enter the corrected data as a new split for that date.

## Troubleshooting

**The "Lock for payroll" button is greyed out.**
The button is disabled if any splits in the current week are still in **Draft** status, or if any approved splits have no employee allocations. The **Ready for payroll?** card tells you how many drafts remain. Go to **Daily Entry**, open each draft, review the allocations, and click **Approve**. Once all splits are approved with at least one allocation each, the button becomes active.

**I see "some approved tips have no employee allocations" next to the Ready for payroll? card.**
This means a split was approved without any employee shares (for example, it was approved before employees were added to the tip pool). Go to **Daily Entry** for that date and re-enter the tip with employee allocations, then approve again.

**The Period Timeline shows days with the lock icon but the Payroll page does not yet show the tips.**
Try refreshing the Payroll page. If the amounts still do not appear after a minute or two, check that the correct week is selected on the Payroll page.

**I recorded the wrong cash payout amount.**
Open the tip payout panel again for the same day (click **Pay out** if the day is partial, or delete the existing payout using the trash icon and re-enter). The panel re-initialises with the existing payout amounts so you can correct them.

**The "Tip Review Requests" card is not showing even though an employee says they filed a dispute.**
The card only appears when there are disputes with **open** status. If the dispute was already resolved or dismissed (possibly by another manager), it will not appear. Ask the employee to file a new review request if the issue was not actually resolved.

## Frequently asked questions

**Can I lock a period that only has some days approved, not all seven?**
Yes. Days with no tip entry are simply ignored. Only approved splits with employee allocations are included in the lock. Days that are empty do not block the lock button.

**What happens to tips after I lock the period?**
The approved splits move to a **Locked** state (shown with a lock icon and muted styling in the timeline and stored as archived in the system). They appear on the Payroll page as tips owed to each employee and can no longer be edited. The History tab on the Tips page shows locked entries for the selected date as a permanent record.

**If I record a cash payout, does that reduce what shows on the Payroll page?**
Cash payout records are informational — they let you and your employees see that cash was already handed out. They appear as a **Paid [amount] cash** badge on the employee's My Tips page. Check your Payroll page to understand how cash payouts interact with your specific payroll workflow.

**Can an employee see whether their tip was paid in cash?**
Yes. On the employee-facing My Tips page (`/employee/tips`), each approved tip entry shows a green **Paid [amount] cash** badge when a cash payout has been recorded for that date.

**What dispute types can an employee file?**
Employees can flag a tip as **Missing hours**, **Wrong role**, or **Other**. The employee's message and the tip date are visible to managers in the **Tip review requested** dialog.

## Related articles

- [Enter and Approve Daily Tip Splits](/help/tips-daily-entry)
- [Configure Tip Pool Settings](/help/configure-tip-pool-settings)
- [Run Payroll: View Wages, Hours, and Tips](/help/run-payroll)
- [Roles and What Each One Can Access](/help/roles-and-permissions)
