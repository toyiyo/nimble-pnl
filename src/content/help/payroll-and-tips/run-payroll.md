---
title: "Run Payroll: View Wages, Hours, and Tips"
category: "payroll-and-tips"
summary: "Calculate gross wages, overtime, and tips owed for any pay period, spot incomplete punches, and export payroll data for your payroll processor."
audience: ["owner", "manager", "accountant"]
order: 10
keywords: ["payroll", "wages", "overtime", "tips", "export", "CSV", "gross wages", "ADP", "Gusto"]
related: ["payroll-rules-and-types", "adjust-overtime-add-manual-payment", "tips-daily-entry", "lock-tips-for-payroll"]
---

# Run Payroll: View Wages, Hours, and Tips

This article walks owners, managers, and accountants through the Payroll page — how to choose a pay period, read the wage and tip totals, catch time-punch problems before they affect paychecks, and export a file for your payroll processor.

## Before you begin

You must be signed in with an **Owner**, **Manager**, or **Accountant (collaborator)** role. Staff and Kiosk accounts cannot access the Payroll page. If you see a subscription gate instead of payroll data, contact your account owner to confirm your plan includes payroll features.

## Choose a pay period

1. In the left navigation, go to **Payroll** (the `/payroll` route opens automatically).
2. Locate the **Pay Period** dropdown near the top of the page.
3. Select one of the four options:
   - **Current Week** — the week in progress right now.
   - **Last Week** — the most recently completed week.
   - **Last 2 Weeks** — the two most recently completed weeks combined.
   - **Custom Range** — enter any start and end date using the date fields that appear.
4. The date badge between the navigation buttons updates to show the exact range you are viewing (for example, "May 19 - May 25, 2026").

## Navigate between periods

Use the **← Previous** and **Next →** buttons beside the date badge to step backward or forward. When you are on a preset like "Current Week," "Last Week," or "Last 2 Weeks," clicking either button always moves exactly one week at a time and automatically switches the selector to **Custom Range**. When you are already on **Custom Range**, the buttons shift the period by the same number of days as your current range.

## Read the summary cards

Four summary cards appear once data loads:

| Card | What it shows |
|---|---|
| **Employees** | Total number of employees included in this period |
| **Total Hours** | Combined regular and overtime hours worked; if any overtime exists, a note below the number shows the OT portion (for example, "2.50 OT") |
| **Gross Wages** | Total gross wages owed across all employees for the period |
| **Tips Owed** | Net tips still to be paid out; if cash payouts were already recorded, a note shows tips earned and the amount already paid |

## Review employee details in the table

Scroll down to the **Employee Payroll Details** table. Each row represents one employee with these columns:

- **Employee** — the employee's name, plus any badges or icons (see below)
- **Position** — their job title on file
- **Rate** — hourly rate for hourly employees; a per-period amount for salaried or contractor employees; "Per-Job" for per-job contractors with no fixed rate
- **Regular Hrs** — regular hours worked (blank for non-hourly employees)
- **OT Hrs** — overtime hours, highlighted with a badge when greater than zero (blank for non-hourly employees)
- **Regular Pay** — regular wages earned; for salaried or contractor employees this reflects their prorated period pay
- **OT Pay** — overtime wages earned (blank when there is none)
- **Tips Earned** — total tips allocated to this employee for the period
- **Tips Paid** — tips already paid out in cash
- **Tips Owed** — remaining tips still to be paid (Tips Earned minus Tips Paid)
- **Total Pay** — gross wages plus tips owed

A **TOTAL** row at the bottom summarizes every column across all employees.

### Compensation type badges

Salaried employees show a **Salary** badge next to their name. Contractors show a **Contractor** badge (purple); per-job contractors show a **Per-Job** badge instead.

### Manual payments for per-job contractors

When a per-job contractor has had a manual payment recorded for the period, a green badge showing the payment total (for example, **+$150.00**) appears next to their name. Hover over the badge to see a breakdown of each individual payment, including the date, amount, and any description.

## Spot and fix incomplete time punches

If any employee has a time-punch problem — a missing clock-out, a missing clock-in, or an unusually long shift — the page shows an amber **Incomplete Time Punches Detected** alert above the table. The alert lists each affected employee by name and describes each issue (for example, "Missing clock-out for shift started at May 20, 6:00 PM").

In the table, rows for affected employees are lightly highlighted in amber and a warning icon appears next to their name. Hover over the icon to see the full list of issues for that employee without leaving the page.

Resolve punch problems before exporting payroll, because incomplete punches are excluded from hour totals, which may result in underpayment.

To fix time punches, go to [Track and Manage Employee Time Punches](/help/time-punches-manager).

## Export payroll data for your payroll processor

1. Once you have reviewed the data and resolved any punch warnings, click **Export CSV** in the top-right corner of the **Employee Payroll Details** section.
2. Your browser downloads a file named `payroll_YYYY-MM-DD_to_YYYY-MM-DD.csv` where the dates match the period you are viewing.
3. Import the file into your payroll processor — the format is compatible with ADP, Gusto, and other CSV-based systems.

The CSV includes one row per employee with all columns shown in the on-screen table, plus additional detail columns such as Double-Time Hours, Daily OT Hours, and Weekly OT Hours.

## Refresh payroll data

Click the **Refresh** button in the page header to reload all payroll calculations. This is useful after correcting time punches or approving tips, because the page caches data for up to 30 seconds.

## Tips

- Approve or lock daily tip splits before running payroll so that tip totals are final. See [Enter and Approve Daily Tip Splits](/help/tips-daily-entry) and [Lock Tips for Payroll, Record Cash Payouts, and Review Tip History](/help/lock-tips-for-payroll).
- Only approved and locked tip splits are included in payroll calculations. Pending splits do not appear.
- Break time is automatically excluded from worked hours — only time between clock-in and clock-out (minus recorded breaks) counts.
- Overtime is calculated per calendar week at 1.5× the regular rate for hours over 40. If your location uses daily overtime rules, those are configured separately under payroll settings. See [How Payroll Is Calculated by Compensation Type](/help/payroll-rules-and-types).
- Salaried employees and regular contractors show a prorated pay amount based on the number of days in the selected period. Per-job contractors show only the manual payments you have entered.
- Former employees who were active during the selected period still appear in payroll results through the end of the week containing their deactivation date.

## Troubleshooting

**The Payroll page shows "No Payroll Data."**
The selected period has no time punches and no salary or contractor employees. Confirm that employees clocked in during that range, or switch to a different period using the **Pay Period** dropdown.

**An employee's hours look wrong.**
Check for the amber warning icon next to their name — incomplete punches are excluded from hour calculations. Open [Track and Manage Employee Time Punches](/help/time-punches-manager) to correct the punches, then click **Refresh**.

**Tips Owed is lower than expected.**
Tips Owed equals tips earned minus any cash already paid out. If cash payouts were recorded, the amount is subtracted automatically. Review payout history in [Lock Tips for Payroll, Record Cash Payouts, and Review Tip History](/help/lock-tips-for-payroll).

**The OT Hrs column shows a dash for an employee.**
Only hourly employees display regular and overtime hours. Salaried, contractor, and per-job contractor rows show a dash in those columns because their pay is calculated differently.

**I do not see the Export CSV button.**
The button is disabled when there are no employees in the current period. Select a period that contains payroll data.

## Frequently asked questions

**Can I run payroll for a custom date range that spans more than two weeks?**
Yes. Select **Custom Range** from the **Pay Period** dropdown and enter any start and end date you need.

**Does the payroll page automatically update when I fix a time punch?**
Not instantly — click **Refresh** after making any corrections so the page recalculates with the updated punch data.

**What is the difference between Tips Earned, Tips Paid, and Tips Owed?**
Tips Earned is the total allocated to the employee from approved tip splits. Tips Paid is the cash already handed to them (recorded via the lock-tips workflow). Tips Owed is what remains to be paid — it appears in the exported CSV and in the Tips Owed summary card so you know exactly what to include in each paycheck.

**Do overtime adjustments I make on this page affect the time punch records?**
No. Using **Adjust OT** (available for hourly employees) reclassifies hours between regular and overtime for payroll purposes without changing the underlying clock-in/clock-out records.

**Will an employee who was terminated this week still appear in payroll?**
Yes. Former employees remain in payroll results through the end of the calendar week containing their deactivation date, so their final week of work is included.

## Related articles

- [How Payroll Is Calculated by Compensation Type](/help/payroll-rules-and-types)
- [Adjust Overtime or Add a Manual Contractor Payment](/help/adjust-overtime-add-manual-payment)
- [Enter and Approve Daily Tip Splits](/help/tips-daily-entry)
- [Lock Tips for Payroll, Record Cash Payouts, and Review Tip History](/help/lock-tips-for-payroll)
- [Track and Manage Employee Time Punches](/help/time-punches-manager)
- [Roles and What Each One Can Access](/help/roles-and-permissions)
