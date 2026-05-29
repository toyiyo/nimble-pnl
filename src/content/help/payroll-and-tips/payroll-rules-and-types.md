---
title: "How Payroll Is Calculated by Compensation Type"
category: "payroll-and-tips"
summary: "Learn the exact rules EasyShiftHQ uses to calculate pay for hourly, salaried, regular contractor, per-job contractor, and per-day-worked employees, including overtime and proration."
audience: ["owner", "manager", "accountant"]
order: 20
keywords: ["payroll calculation", "hourly", "salaried", "contractor", "per-job", "per day worked", "daily rate", "overtime", "double-time", "proration", "compensation"]
related: ["run-payroll", "adjust-overtime-add-manual-payment"]
---

# How Payroll Is Calculated by Compensation Type

This article explains the exact formulas EasyShiftHQ uses to calculate gross pay for each compensation type — Hourly, Salaried, Contractor, Per-Job Contractor, and Per Day Worked — including how overtime and proration work. It is intended for owners, managers, and accountants who review payroll totals.

## Before you begin

You must have an Owner, Manager, or Accountant role to view the Payroll page and the in-app help page at **/help/payroll-calculations**.

---

## Hourly employees

### How pay is calculated

EasyShiftHQ groups an hourly employee's time punches by calendar week and applies the following formula:

**Pay = (Regular Hours × Hourly Rate) + (Overtime Hours × Hourly Rate × 1.5)**

Overtime kicks in for any hours worked beyond **40 in a single calendar week**. The default overtime multiplier is **1.5×**.

**Example — a server working 45 hours at $15/hour:**

- Regular pay: 40 hrs × $15 = $600.00
- Overtime pay: 5 hrs × $22.50 (1.5×) = $112.50
- **Total: $712.50**

### What counts as worked time

Only completed clock-in / clock-out pairs are counted. The system excludes:

- Any time recorded as a break (break start to break end)
- Punch pairs where the gap between clock-in and clock-out is longer than 18 hours (the system treats these as missing punches and excludes them from hours)

The system also flags — but still counts — shifts where the recorded length is between 16 and 18 hours, because these are unusually long but within the plausible overnight-shift range.

If the system detects any of these conditions, it flags the punch for manager review. Review and correct flagged punches on the **Payroll** page before finalizing.

### Overtime is calculated per calendar week

Even if your pay period spans multiple weeks (bi-weekly, semi-monthly, or monthly), overtime is always assessed on a week-by-week basis. Hours do not carry over from one week to the next.

### Daily overtime and double-time (optional)

By default, overtime applies only to the weekly 40-hour threshold. Your account can also be configured to apply daily overtime (for hours beyond a daily threshold, such as 8 hours in a day) and double-time (for hours beyond a second daily threshold). These options are off by default and require configuration in your labor/financial settings. When both weekly and daily overtime apply, the system calculates them separately and combines them.

---

## Salaried employees (Exempt)

### How pay is calculated

Salaried employees in EasyShiftHQ are treated as **exempt** — they receive a fixed salary with no overtime, regardless of how many hours they work in a week.

Pay for a given payroll period is prorated by the number of days in that period:

**Daily Rate = Salary Amount ÷ Average Days in Pay Period**

The average days used for each pay period type:

| Pay period | Average days used |
|---|---|
| Weekly | 7 |
| Bi-Weekly | 14 |
| Semi-Monthly | 15.22 |
| Monthly | 30.44 |

**Example — a manager with a weekly salary of $1,000:**

- Daily rate: $1,000 ÷ 7 = $142.86/day
- The dashboard shows $142.86 every day of the pay period
- The payroll report shows the full $1,000 on payday

If an employee is hired mid-period or has a termination date on file, the system automatically counts only the days from their hire date (or through their termination date) when calculating their pay.

### No overtime for salaried employees

EasyShiftHQ currently classifies all salaried employees as exempt. If you have a salaried employee who is legally entitled to overtime (sometimes called "non-exempt salaried"), the system will not calculate overtime for them automatically. See the Troubleshooting section below for the recommended workaround.

---

## Regular contractors (Weekly, Bi-Weekly, or Monthly)

### How pay is calculated

Contractors set up with a weekly, bi-weekly, or monthly payment interval are paid a fixed amount that is prorated across the period — similar to salaried employees, but with no employment relationship implied.

**Daily Allocation = Payment Amount ÷ Average Days in Interval**

**Example — a contractor paid $700/week:**

- Daily allocation: $700 ÷ 7 = $100/day
- The dashboard shows $100/day
- The payroll report shows the full $700 on the payment date

Regular contractors are never subject to overtime calculations.

---

## Per-Job contractors

### How pay is calculated

Per-Job contractors show **$0** in the payroll report by default. Their pay does not accrue daily and cannot be estimated automatically because each job has a different amount.

To record a payment:

1. Go to **Payroll** (/payroll).
2. Find the per-job contractor in the employee list.
3. Select **Add Payment** next to their name.
4. Enter the date, amount, and an optional description.
5. Select **Add Payment** to confirm.

The amount you enter will appear in the payroll report for that pay period.

---

## Per Day Worked employees

### How pay is calculated

The **Per Day Worked** compensation type (shown in the system as "Per Day Worked") is designed for employees who are paid a fixed amount for each day they show up, regardless of how many hours they work that day.

**Pay = Daily Rate × Number of Days Worked**

A day counts as worked when the employee has at least one time punch (clock-in) recorded within the pay period.

**Example — a kitchen helper with a $120/day rate who works 4 days:**

- Pay: 4 days × $120 = $480.00

Per Day Worked employees are never subject to overtime calculations.

---

## The Payroll Calculation Notes info card

On the **Payroll** page (/payroll), look for the **Payroll Calculation Notes** info card. It summarizes the key rules the system applies, including:

- Overtime is **1.5×** for hours worked over **40 per calendar week**
- Only **completed time punches** (clock-in / clock-out pairs) are included in worked hours
- **Break time is excluded** from worked hours
- Salaried employees and regular contractors have pay prorated for the period
- Per-job contractors require manual payment entry

Use this card as a quick reference when reviewing a payroll run.

---

## In-app reference page: /help/payroll-calculations

EasyShiftHQ includes a built-in reference page at **/help/payroll-calculations**. It contains four tabs:

- **Compensation Types** — formulas and examples for each type
- **Pay Periods** — how proration works for weekly, bi-weekly, semi-monthly, and monthly schedules
- **Where to See It** — how labor costs appear on the dashboard, in the schedule, and in payroll reports
- **Common Questions** — answers to frequently asked payroll questions

---

## Tips

- **Verify time punches before running payroll.** Punch pairs with gaps longer than 18 hours are flagged and excluded from hours; shifts longer than 16 hours are flagged but still counted. Review and correct flagged punches on the Payroll page before finalizing.
- **Check the pay period type for each employee.** Proration is calculated using the average days for that pay period type. Changing a pay period type mid-year affects future calculations only.
- **For per-job contractors, add payments as jobs are completed.** Payments added after the payroll period closes will not appear in that period's report.

---

## Troubleshooting

**My salaried employee worked 50 hours but there is no overtime shown.**

All salaried employees are currently classified as exempt, so the system does not calculate overtime for them. If this employee should legally receive overtime pay (non-exempt), enter them as an **Hourly** employee instead and set a 40-hour-per-week expectation manually.

**An hourly employee's hours look lower than expected.**

Check for flagged punches. Clock-in records where the gap to the next clock-out is more than 18 hours are treated as missing punches and excluded from hours. Shifts longer than 16 hours are also flagged (though they are still counted pending your review). Review and correct flagged punches on the Payroll page, then recalculate.

**A per-job contractor shows $0 for the pay period.**

Per-job contractor pay is always $0 until you record it manually. Use **Add Payment** on the Payroll page to enter the amount for each completed job.

**The payroll total for a semi-monthly period does not match my expected salary amount.**

This is expected behavior. EasyShiftHQ uses a fixed average of **15.22 days** for both semi-monthly periods (1st–15th and 16th–end of month). Because the second period varies between 13 and 16 days depending on the month, individual periods can be off by up to **±8%**. The annual total will be correct.

---

## Frequently asked questions

**Why does a salaried manager cost the same amount every day, even on slow days?**

Salaried employees are paid for their availability, not for hours worked. The daily allocation spreads the salary evenly across the pay period so your P&L reflects a consistent labor cost. The total for the period is always the same.

**Why does the dashboard show a different labor cost than the payroll report?**

Several factors can cause this difference: (1) The dashboard updates in real time as hourly employees clock in and out, while the payroll report uses completed punches only. (2) If a salaried or contractor employee has daily allocation turned off, the dashboard shows $0 for them daily and records the full amount on payday. (3) The dashboard is per-day and the payroll report covers the full period. Compare the same date ranges to reconcile.

**Does overtime reset each week even in a bi-weekly or monthly pay period?**

Yes. Overtime is always calculated on a week-by-week basis. An employee who works 38 hours one week and 42 hours the next receives overtime pay only for the 2 hours beyond 40 in the second week — the hours do not combine across weeks.

**Can I adjust overtime hours that the system calculated incorrectly?**

Yes. See [Adjust Overtime or Add a Manual Contractor Payment](/help/adjust-overtime-add-manual-payment) for step-by-step instructions.

**Is semi-monthly payroll always off by some amount?**

Individual semi-monthly periods can vary from the expected salary by up to ±8% because the system uses a 15.22-day average instead of the actual calendar days in each period. The annual total across all 24 periods is correct.

---

## Related articles

- [Run Payroll: View Wages, Hours, and Tips](/help/run-payroll)
- [Adjust Overtime or Add a Manual Contractor Payment](/help/adjust-overtime-add-manual-payment)
- [Enter and Approve Daily Tip Splits](/help/tips-daily-entry)
- [Track and Manage Employee Time Punches](/help/time-punches-manager)
- [Manage Your Team: Invite, Change Roles, Remove, and Add Collaborators](/help/manage-team-members)
