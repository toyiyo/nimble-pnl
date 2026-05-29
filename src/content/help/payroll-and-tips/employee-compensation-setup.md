---
title: "Set Compensation Type and Pay Rate for an Employee"
category: "payroll-and-tips"
summary: "How to choose between hourly, salary, per-day, and contractor pay types and enter the matching rate or amount when adding or editing an employee."
audience: ["owner", "manager"]
order: 110
keywords: ["compensation", "hourly rate", "salary", "contractor", "overtime exempt", "FLSA", "pay period", "daily rate"]
related: ["add-edit-employees", "payroll-rules-and-types", "run-payroll", "adjust-overtime-add-manual-payment"]
---

# Set Compensation Type and Pay Rate for an Employee

Every employee in EasyShiftHQ needs a compensation type so the system can calculate labor costs, P&L allocations, and payroll correctly. This article walks you through choosing the right pay type and filling in the matching fields when you add a new employee or edit an existing one.

## Before you begin

You must have the **Owner** or **Manager** role to add or edit employees. Staff-level accounts do not have access to compensation settings.

## Open the employee form

1. Go to **Employees** in the main navigation.
2. To add someone new, click **Add New Employee** (top-right area of the page). The **Add New Employee** dialog opens.
3. To edit an existing person, find their name in the list and click the edit action. The **Edit Employee** dialog opens with their current information pre-filled.

The **Compensation Type** dropdown appears near the top of the form, below the Employment Type toggle.

---

## Set up an Hourly employee

1. In the **Compensation Type** dropdown, select **Hourly**.
2. Enter the employee's regular pay in the **Hourly Rate ($)** field (for example, `15.00`).
   - Overtime is automatically calculated at 1.5x this rate for any hours worked over 40 in a week.
3. If this employee should **not** be eligible for overtime pay, turn on the **Exempt from Overtime** toggle.
   - When the toggle is on and the rate you entered would produce an annualized pay below **$35,568/year** (the current FLSA threshold), an amber warning appears showing the calculated annualized amount and advising you to consult labor law before classifying the employee as exempt.
   - The toggle is only available for Hourly employees; switching to another compensation type turns it off automatically.

### Unusually high rate warning

If you enter an hourly rate above **$50.00/hr**, the app pauses and shows an **Unusually High Rate** dialog. This is a safeguard against accidentally entering a biweekly or annual salary in the hourly-rate field.

- The dialog shows your entered rate and suggests likely corrections (for example, the equivalent biweekly or annual amount). Click any suggestion to replace the rate with the corrected value.
- If the rate is intentional, click **Keep $X/hr** to proceed.
- Click **Edit Manually** to go back and change the value yourself.

---

## Set up a Salaried employee

1. In the **Compensation Type** dropdown, select **Salary**.
2. Enter the amount paid each pay period in the **Salary Amount ($)** field.
   - **Important:** This is the amount per pay period, not per year. For example, if you pay $2,000 every two weeks, enter `2000.00` — not the annual total.
3. Choose how often this employee is paid using the **Pay Period** dropdown:
   - **Weekly** — 52 paychecks per year
   - **Bi-weekly** — 26 paychecks per year
   - **Semi-monthly** — 24 paychecks per year (typically the 1st and 15th)
   - **Monthly** — 12 paychecks per year
4. Decide how this cost should appear in your P&L by checking or unchecking **Allocate to Daily P&L**:
   - **Checked (on, the default):** The salary cost is spread evenly across each calendar day, so your daily P&L shows a smooth, consistent labor expense.
   - **Unchecked (off):** The full salary amount appears only on the actual payday, which gives a cash-basis view.

---

## Set up a Per Day Worked employee

This option is for employees who are paid a set amount for each day they show up, regardless of how many hours they work that day.

1. In the **Compensation Type** dropdown, select **Per Day Worked**.
2. Enter the **Weekly Reference Amount ($)** — this is the total you'd expect to pay if the employee works their standard number of days in a week (for example, `1000.00` for an employee you think of as earning $1,000 a week).
3. Choose how many days per week this employee normally works using the **Standard Work Days** dropdown:
   - **5 days (2 days off)**
   - **6 days (1 day off)**
   - **7 days (no days off)**
4. As soon as you fill in both fields, a **Daily Rate** preview appears showing the calculated amount per day worked and example totals for 3 days, the chosen standard number of days, and 7 days.
   - If the standard days setting is less than 7, a note reminds you that the employee would earn more than the weekly reference amount in any week they work all 7 days.

Actual payroll is based on the days the employee is recorded as having worked; the weekly reference amount is used only to derive the daily rate.

---

## Set up a Contractor

1. In the **Compensation Type** dropdown, select **Contractor**.
2. Enter the amount you pay this contractor in the **Payment Amount ($)** field.
3. Choose how often that amount is paid using the **Payment Interval** dropdown:
   - **Weekly**
   - **Bi-weekly**
   - **Monthly**
   - **Per Job**

No overtime or benefits are included for contractor pay types.

---

## Save the form

- For a **new** employee, click **Add Employee** at the bottom of the dialog. The employee is saved and, if you entered an email address, an invitation is sent to that address automatically.
- For an **existing** employee with no compensation change, click **Update Employee** and the record is saved immediately.

### When you change pay for an existing employee

If you edit any compensation field for an employee who already has a pay rate on file, the app does not save immediately. Instead, a second dialog — **Apply New Compensation Rate** — opens automatically.

1. Check or adjust the **Effective Date** field. It defaults to today's date.
   - This date determines which shifts use the new rate. Shifts worked before this date retain the old rate in your historical records.
2. Click **Save New Rate** to confirm. The employee's profile is updated and the change is recorded in their compensation history.
3. Click **Cancel** if you change your mind; no changes are saved.

---

## Tips

- Use **Bi-weekly** as the Pay Period for salaried employees unless your payroll processor runs on a different schedule — it is the most common US pay cycle and the default.
- Turn on **Allocate to Daily P&L** for salaried employees if you review your P&L daily; it smooths out the spikes you would otherwise see on payday.
- For **Per Day Worked** employees, choose the standard days setting that matches the employee's typical schedule, not the maximum possible. The daily rate calculation and preview update instantly as you change either field.
- The **Unusually High Rate** warning exists purely as a data-entry safety net. If someone genuinely earns more than $50/hr, use the **Keep $X/hr** button to confirm.

---

## Troubleshooting

**The Compensation Type dropdown is not visible.**
Scroll down in the employee form — the compensation section appears after the Employment Type toggle and before the Email and Phone fields.

**I see an FLSA warning even though I intended to mark the employee exempt.**
The warning is informational, not a block. You can still save the employee as exempt. The warning is there to prompt you to verify the classification is correct under applicable labor law.

**The "Apply New Compensation Rate" dialog appeared when I did not intend to change pay.**
The dialog appears when a compensation field differs from the saved value for Hourly, Salary, or Contractor employees (type, rate, pay period, or payment interval). Note: the dialog does not appear for Per Day Worked employees even if you change their weekly reference amount or standard days — those changes save immediately. If you accidentally changed a field, click Cancel, reopen the edit dialog, and restore the original value before saving.

**I cannot find the employee I just added.**
The employee list defaults to showing active employees. If the new employee's status was set to Inactive or Terminated during setup, switch the status filter to see them.

---

## Frequently asked questions

**Is the Salary Amount per year or per pay period?**
Per pay period. If you pay $52,000 a year on a bi-weekly schedule, enter `2,000.00` (the amount paid every two weeks), not `52000.00`.

**Can I change the compensation type later?**
Yes. Open the employee's edit dialog, select a different type from the Compensation Type dropdown, fill in the new fields, and save. The app will prompt you for an effective date so historical records stay intact.

**What happens if I enter the wrong hourly rate and save it?**
Open the edit dialog, correct the rate, and save. The Apply New Compensation Rate dialog will appear — set the effective date to the employee's original hire date (or the date the correct rate should have started) to backfill the record accurately.

**Does Exempt from Overtime affect salary or contractor employees?**
No. The Exempt from Overtime toggle only appears when Compensation Type is set to Hourly. Salary, Per Day Worked, and Contractor types handle overtime eligibility differently and the toggle is hidden for those types.

**Will the employee be notified when I update their pay rate?**
No. Pay rate changes are internal records only. The employee does not receive an automatic notification when their compensation is updated.

---

## Related articles

- [Add and Edit Employees](/help/add-edit-employees)
- [Payroll Rules and Types](/help/payroll-rules-and-types)
- [Run Payroll](/help/run-payroll)
- [Adjust Overtime or Add a Manual Payment](/help/adjust-overtime-add-manual-payment)
