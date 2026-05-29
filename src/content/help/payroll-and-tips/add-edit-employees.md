---
title: "Add and Edit Employees on the Roster"
category: "payroll-and-tips"
summary: "How to add a new employee record, fill in their position, contact details, and hire date, and how to edit any of those details later."
audience: ["owner", "manager"]
order: 100
keywords: ["add employee", "employee roster", "hire date", "position", "employment type", "minor", "invitation"]
related: ["employee-compensation-setup", "deactivate-reactivate-employee", "manage-team-members", "run-payroll"]
---

# Add and Edit Employees on the Roster

The Employees page is where you build and maintain your restaurant's roster. Every person you add here becomes available for scheduling, payroll, and tip distribution.

## Before you begin

You must be signed in as an **owner** or **manager** to add or edit employee records.

## Add a new employee

1. Go to **Employees** in the main navigation (the page is at `/employees`).
2. Click **Add Employee** in the top-right corner of the Employees card. The "Add New Employee" form opens.
3. Enter the employee's **Name**. This field is required.
4. Choose a **Position** from the dropdown. You can type to search existing positions — or type a brand-new position name and select it to create it on the fly.
5. Optionally choose an **Area** (a kitchen zone or dining section). Like Position, you can type to search or create a new area.
6. Under **Employment Type**, click either **Full-Time** or **Part-Time**. This setting is used by the scheduler to plan weekly hours. The form shows a brief note beneath the toggle to remind you of this.
7. Choose a **Compensation Type** from the dropdown. The options are **Hourly**, **Salary**, **Per Day Worked**, and **Contractor**. Required fields for the chosen type appear immediately below the selector.
8. Fill in the contact fields:
   - **Email** — optional, but if you enter one an invitation is automatically sent to this address when you save.
   - **Phone** — optional.
9. Set the **Status** to **Active**, **Inactive**, or **Terminated**. New hires are typically Active.
10. Enter a **Hire Date** using the date picker.
11. Optionally enter a **Date of Birth**. If the date you enter makes the employee under 18, a **Minor** badge appears immediately next to the field showing their age.
12. If you set Status to **Inactive** or **Terminated**, a **Termination Date** field appears. Termination Date is required when the status is Terminated. Payroll allocations stop being generated after this date.
13. Add any free-text **Notes** about the employee (certifications, allergies, special arrangements, etc.).
14. In the **Default availability** section at the bottom of the form, choose one of:
    - **Apply default template** — automatically applies your restaurant's standard availability window (shown in the radio label) when the record is saved. You can click **Edit** to adjust the grid before saving.
    - **Set later** — saves the employee without any availability; you set it manually from the team page afterward.
15. Click **Add Employee** to save. If you provided an email address, an invitation is sent to that address automatically.

## Edit an existing employee

1. Go to **Employees**.
2. Use the **Active**, **Inactive**, or **All** tabs to find the person you want to update. The count badge next to the Active and Inactive tabs shows how many employees are in that group (the All tab shows everyone but does not display a count).
3. Click the **Edit** button on the employee's card.
4. The "Edit Employee" form opens with all fields pre-filled with the current information. Change any fields you need.
5. Click **Update Employee** to save your changes.

> **Changing compensation?** If you change the Compensation Type or rate while editing, EasyShiftHQ will ask you to confirm an **Effective Date** before saving. Historical pay records before that date are preserved automatically.

## Tips

- **Creating a new position on the fly**: In the Position combobox, just type the role name (e.g., "Expo") and select it from the dropdown. EasyShiftHQ saves it as an available option for future employees automatically.
- **Minor badge**: The amber "Minor" badge next to Date of Birth is calculated automatically — you do not need to check a box or enter anything extra. It appears as soon as the entered birthdate results in an age under 18.
- **Employment Type and scheduling**: Full-Time and Part-Time affect how the scheduler plans weekly hours. Make sure this matches the employee's actual schedule to get accurate schedule suggestions.
- **Invitation email**: The invitation is sent the moment you click Add Employee. If you want to hold off on sending it, leave the Email field blank and add the address later via Edit.
- **Tabs on the list**: Active shows only currently active employees; Inactive shows deactivated employees who can be reactivated; All shows everyone regardless of status.

## Troubleshooting

**The Add Employee button does not appear.**
Make sure you are signed in as an owner or manager. Staff and kiosk roles do not have access to add employees.

**The invitation email did not arrive.**
Check that the email address was entered correctly. You can re-open the employee with Edit, verify the address, and resend from the Team page if needed. The app will show a notice if the invitation failed to send.

**I saved the record but the employee does not appear in the Active tab.**
Check whether the Status was accidentally set to Inactive or Terminated. Open the employee via the Inactive or All tab, click Edit, change Status back to Active, and click Update Employee.

**A "Minor" badge appeared unexpectedly.**
EasyShiftHQ automatically marks anyone under 18 as a Minor based on the Date of Birth you entered. Double-check that the correct birth year was entered.

**I entered an hourly rate and saw an "Unusually High Rate" warning.**
This appears when the rate exceeds $50/hr. EasyShiftHQ suggests common corrections in case the number was entered in cents instead of dollars (for example, 1500 instead of 15.00). Select a suggested value or click **Keep $X/hr** (where X is your entered rate) if the high rate is correct.

## Frequently asked questions

**Can I add a position that does not already exist?**
Yes. In the Position field, type the new role name and select it from the dropdown. EasyShiftHQ creates it and makes it available for future employees at your restaurant.

**What happens when I provide an email address?**
An invitation is sent to that email as soon as you click Add Employee. The employee receives a link to set up their login. If the invitation fails, the record is still created and you can resend the invitation from the Team page.

**What is the difference between Inactive and Terminated?**
Both statuses move the employee off the Active tab. Terminated additionally requires a Termination Date, and payroll allocations stop generating after that date. Inactive is a softer status — the employee can be reactivated at any time without that hard cutoff.

**Does adding Date of Birth affect payroll?**
The only effect on this form is the automatic Minor badge. Whether or not you track a minor employee's hours differently is up to your restaurant's policies and local labor law.

**If I change an employee's pay rate, will old payroll records change?**
No. When you edit a compensation field, EasyShiftHQ asks you to set an Effective Date. Only shifts worked on or after that date use the new rate; all earlier records stay intact.

## Related articles

- [Set Up Employee Compensation](/help/employee-compensation-setup)
- [Deactivate or Reactivate an Employee](/help/deactivate-reactivate-employee)
- [Manage Team Members](/help/manage-team-members)
- [Run Payroll](/help/run-payroll)
