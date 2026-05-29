---
title: "Adjust Overtime or Add a Manual Contractor Payment"
category: "payroll-and-tips"
summary: "From the Payroll table, reclassify hours between regular and overtime for hourly employees, or record a one-off cash payment for a per-job contractor."
audience: ["owner", "manager"]
order: 30
keywords: ["overtime", "adjust", "contractor", "manual payment", "per-job", "reclassify", "payroll"]
related: ["run-payroll", "payroll-rules-and-types", "tips-daily-entry"]
---

# Adjust Overtime or Add a Manual Contractor Payment

This article covers two actions available directly in the Payroll table: reclassifying hours between regular and overtime pay for hourly employees, and recording a one-off payment for a per-job contractor. Both are intended for owners and managers who need to correct or supplement payroll data before running payroll.

## Before you begin

- You must be logged in as an **Owner** or **Manager**. Staff and Kiosk roles do not have access to the Payroll page.
- Navigate to **Payroll** in the main menu. The actions described here appear in the **Actions** column on the right side of the employee payroll table.
- The payroll table must have data for the selected pay period. If the table is empty, make sure the correct period is selected and that time punches exist.

## Adjust overtime for an hourly employee

Use this when an hourly employee's hours are classified incorrectly — for example, hours that should count as overtime were recorded as regular time, or vice versa.

The **Adjust OT** button is only visible for hourly employees who have hours on record for the current pay period. It does not appear for salaried employees, standard contractors, or per-job contractors.

1. Go to **Payroll** and select the pay period you want to correct using the **Pay Period** dropdown (Current Week, Last Week, Last 2 Weeks, or Custom Range).
2. Find the employee's row in the **Employee Payroll Details** table.
3. In the **Actions** column, click **Adjust OT**.
4. The **Adjust Overtime** dialog opens, showing the employee's name.
5. Under **Adjustment Type**, choose one of:
   - **Regular → Overtime** — moves hours from regular pay to overtime pay (paid at your overtime rate).
   - **Overtime → Regular** — moves hours from overtime pay back to regular pay.
6. In the **Hours** field, enter the number of hours to reclassify. The dialog shows the maximum hours available for the direction you selected — you cannot exceed that number.
7. In the **Date** field, choose a date within the pay period. The date must fall between the period's start and end dates.
8. Optionally, type a note in the **Reason** field (for example, "Manager-approved schedule change").
9. Click **Apply Adjustment**.

The dialog closes and the payroll table recalculates immediately, updating the employee's **Regular Hrs**, **OT Hrs**, **Regular Pay**, and **OT Pay** columns to reflect the change.

> If you submit the same employee, date, and adjustment direction again, the new entry replaces the previous one for that combination.

## Pay a per-job contractor

Use this to record a one-time cash or manual payment for a contractor who is set up as per-job. Unlike hourly or salaried employees, per-job contractors do not have hours tracked — each payment must be entered manually.

The **Add Payment** button is only visible in the Actions column for employees whose compensation type is **Per-Job** contractor. It does not appear for hourly or salaried employees, or for standard contractors.

1. Go to **Payroll** and select the pay period that covers the work performed.
2. Find the contractor's row in the **Employee Payroll Details** table.
3. In the **Actions** column, click **Add Payment**.
4. The **Add Payment** dialog opens, confirming the contractor's name.
5. In the **Payment Amount** field, enter the dollar amount (for example, `250.00`).
6. In the **Payment Date** field, select the date the work was performed or the payment was agreed upon.
7. Optionally, enter a note in the **Description** field (for example, "Catering event" or "Special project").
8. Click **Add Payment**.

The dialog closes and the contractor's row updates immediately. A green badge appears next to their name showing the total of all manual payments recorded for the period (for example, **+$250.00**). Hovering over the badge shows a breakdown of each payment with its date and description.

You can record multiple payments for the same contractor within the same period — each one is saved separately and all appear in the badge tooltip.

## Tips

- **Check the pay period before adjusting.** Overtime adjustments and manual payments are tied to the period that is currently displayed. Switch the period using the dropdown or the **← Previous** / **Next →** buttons before making changes.
- **Overtime thresholds.** By default, overtime kicks in for hours over 40 in a calendar week. Your restaurant may have different rules configured. The table already applies those rules when calculating OT hours — use **Adjust OT** only when the automatic classification is incorrect.
- **Export after adjusting.** Once your changes look correct, use the **Export CSV** button to download the updated payroll data for your payroll processor (ADP, Gusto, etc.).
- **Incomplete punch warnings.** If a yellow warning triangle appears next to an employee's name, that employee has missing or incomplete time punches that may affect their hours. Fix those under Time Punches before adjusting overtime.

## Troubleshooting

**The Adjust OT button is not visible for an employee.**
This button only appears for hourly employees with at least some hours (regular or overtime) recorded in the selected period. If the employee is salaried, a contractor, or has zero hours clocked for the period, the button will not show.

**The Add Payment button is not visible for a contractor.**
The button only appears for employees whose compensation type is specifically set to per-job contractor. If a contractor's type is set differently in their profile, the button will not appear. Ask your Owner to review the employee's compensation settings.

**"Date must be within the pay period" error.**
The date you entered in the **Adjust Overtime** dialog falls outside the start and end dates of the currently selected pay period. Switch to the correct period first, or choose a date within the displayed range.

**"Cannot exceed X available hours" error.**
You entered more hours than are available in the direction you selected. For example, if the employee has 2.00 regular hours, you cannot move more than 2.00 to overtime. Reduce the hours value or review the time punch records for accuracy.

**The table still shows the old numbers after saving.**
The table should recalculate automatically after a successful save. If it does not update, click the **Refresh** button in the top-right corner of the page header to reload the payroll data.

**The Add Payment button shows "Adding..." but never completes.**
A slow connection may delay the save. Wait a moment before trying again. If the problem persists, refresh the page, check that the payment was not already saved (look for the green badge), and re-enter if needed.

## Frequently asked questions

**Can I undo an overtime adjustment?**
Not directly through a single button. To reverse an adjustment, open **Adjust OT** again for the same employee, select the opposite direction (for example, if you moved hours Regular → Overtime, select Overtime → Regular), enter the same number of hours and the same date, and click **Apply Adjustment**. This replaces the previous entry for that date and direction.

**Can I delete a manual contractor payment?**
Manual payments are visible in the payroll table via the green badge, but there is no delete button in the table view itself. Contact your account owner or administrator to remove an incorrectly entered payment.

**Will adjustments carry over to next week's payroll?**
No. Each overtime adjustment is recorded against a specific date within the selected pay period. When you view a different period, only the adjustments and payments that fall within that period's date range are included.

**Do per-job contractor payments affect the Tips columns?**
No. Manual payments show in the contractor's **Regular Pay** column and are included in their **Total Pay**. They have no effect on the Tips Earned, Tips Paid, or Tips Owed columns.

**Can I add a payment for a contractor in a past pay period?**
Yes. Select the past period using the **← Previous** button or the **Custom Range** option, then click **Add Payment** and enter a Payment Date within that past period. The payment will be recorded and reflected in that period's totals.

## Related articles

- [Run Payroll: View Wages, Hours, and Tips](/help/run-payroll)
- [How Payroll Is Calculated by Compensation Type](/help/payroll-rules-and-types)
- [Enter and Approve Daily Tip Splits](/help/tips-daily-entry)
- [Track and Manage Employee Time Punches](/help/time-punches-manager)
- [Roles and What Each One Can Access](/help/roles-and-permissions)
