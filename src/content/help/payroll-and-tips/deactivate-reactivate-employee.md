---
title: "Deactivate or Reactivate an Employee"
category: "payroll-and-tips"
summary: "How to deactivate an employee when they leave or go on leave — stopping payroll and scheduling access while keeping historical records — and how to bring them back when they return."
audience: ["owner", "manager"]
order: 120
keywords: ["deactivate", "reactivate", "termination", "seasonal", "inactive", "kiosk PIN", "leave", "rehire"]
related: ["add-edit-employees", "kiosk-mode-clock-in-out", "build-publish-weekly-schedule", "run-payroll"]
---

# Deactivate or Reactivate an Employee

When a team member leaves, takes a break, or goes on leave, you can deactivate them to stop payroll calculations and remove their scheduling access — without losing any of their historical punch or payroll records. When they return, reactivating them takes just a few clicks.

## Before you begin

You must be signed in as an **owner** or **manager** to deactivate or reactivate employees.

## Deactivate an employee

1. Go to the **Employees** page (`/employees`).
2. Click the **Active** tab (or the **All** tab if you are not sure which tab the employee is on).
3. Find the employee you want to deactivate.
4. Click the **Deactivate** button on their card. The "Deactivate Employee" dialog opens.
5. Set the **Termination/Effective Date** (required). This defaults to today.
   - **Important:** Payroll calculations stop after this date. If the employee is working a notice period, set a future date so they continue to be paid through their last day.
6. Optionally select a reason from the list:
   - **Seasonal break**
   - **Left the company**
   - **On leave**
   - **Other**
   Choosing a reason is optional but helps you remember the context when you review the Inactive tab later.
7. Review the **Remove from future shifts** checkbox. It is checked by default, which cancels all of the employee's scheduled shifts after today. Uncheck it if you want to keep their upcoming shifts on the schedule.
8. Read the **What will happen** summary in the dialog:
   - The employee will no longer appear in active lists.
   - They cannot log in or punch in/out at the kiosk.
   - They cannot be assigned to new shifts.
   - If you left "Remove from future shifts" checked, their future scheduled shifts will be cancelled.
   - Historical punches and payroll data are preserved.
9. Click **Deactivate Employee** to confirm.

The employee moves to the **Inactive** tab immediately and no longer affects active payroll runs or scheduling.

## Reactivate an employee

1. Go to the **Employees** page (`/employees`).
2. Click the **Inactive** tab.
3. Find the employee you want to bring back.
4. Click the **Reactivate** button on their card. The "Reactivate Employee" dialog opens.
5. Review the employee summary, which shows their **Position**, **Current Rate** on file, and (if one was saved) the **Deactivation Reason** from when they were deactivated.
6. If the employee's pay has changed, check **Update hourly rate** and enter their new rate in the **New Hourly Rate** field that appears.
7. Review the **Enable kiosk PIN** checkbox. It is checked by default, which lets the employee punch in and out using their existing PIN.
8. Click **Reactivate Employee** to confirm.

The employee moves back to the **Active** tab right away and can immediately log in, punch in/out at the kiosk, and be added to the schedule. A confirmation notice appears at the top of the screen. You can adjust roles, permissions, and other settings in their employee profile after reactivation.

## Tips

- **Notice periods:** Always set the Termination/Effective Date to the employee's actual last working day, not the day you click Deactivate. Payroll stops calculating after that date, so setting it early will short-change the employee.
- **Seasonal staff:** Use the "Seasonal break" reason so it is easy to identify these employees in the Inactive tab and reactivate them quickly next season.
- **Keeping shifts on the schedule:** If a manager will cover the employee's remaining shifts, uncheck "Remove from future shifts" before deactivating so those shift slots stay visible.
- **Kiosk PIN on reactivation:** The existing PIN is preserved during deactivation. When you reactivate, the "Enable kiosk PIN" option indicates that the employee's existing PIN will be ready to use at the kiosk — you do not need to set up a new one.

## Troubleshooting

**The Deactivate button is not visible on an employee card.**
The Deactivate button only appears on cards in the **Active** tab or the **All** tab for currently active employees. If you are on the Inactive tab, you will see Reactivate instead.

**The Reactivate button is not visible.**
Click the **Inactive** tab. The Reactivate button only appears on cards in that tab.

**I deactivated someone by mistake.**
Go to the **Inactive** tab, find the employee, and click **Reactivate**. Their account and all historical data are intact.

**Payroll still shows the employee for dates after their termination date.**
Check the Termination/Effective Date you set when deactivating. Payroll calculations stop after that date, not before. If the date needs to be corrected, reactivate and then deactivate again with the right date, or contact support.

**The employee's future shifts were not cancelled.**
The "Remove from future shifts" checkbox must have been unchecked when you deactivated them. Go to the schedule and remove any remaining shifts manually.

## Frequently asked questions

**Will deactivating an employee delete their time punches and payroll history?**
No. Historical punch records and payroll data are always preserved. The "What will happen" summary in the dialog explicitly confirms this before you confirm.

**Can I reactivate an employee more than once?**
Yes. You can deactivate and reactivate an employee as many times as needed, for example for seasonal staff who return every year.

**Does the employee lose their kiosk PIN when deactivated?**
The PIN is preserved. When you reactivate, the "Enable kiosk PIN" checkbox confirms that the existing PIN will be active at the kiosk — no new PIN setup is required.

**Can I update the employee's pay rate when reactivating?**
Yes. Check "Update hourly rate" in the Reactivate Employee dialog and enter the new rate. You can also update it afterward in the employee profile.

**What happens to shifts already assigned to the employee after I deactivate them?**
If "Remove from future shifts" was checked, all scheduled shifts after today are cancelled. If it was unchecked, those shifts remain on the schedule and need to be reassigned or removed manually.

## Related articles

- [Add or Edit an Employee](/help/add-edit-employees)
- [Kiosk Mode — Clock In and Out](/help/kiosk-mode-clock-in-out)
- [Build and Publish the Weekly Schedule](/help/build-publish-weekly-schedule)
- [Run Payroll](/help/run-payroll)
