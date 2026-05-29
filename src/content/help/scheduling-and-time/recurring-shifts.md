---
title: "Set Up Recurring Shifts and Edit a Shift Series"
category: "scheduling-and-time"
summary: "Create a shift that repeats on a schedule, then edit or delete one occurrence, all future occurrences, or the entire series when plans change."
audience: ["owner", "manager"]
order: 20
keywords: ["recurring shift", "repeat", "series", "weekly", "daily", "biweekly", "monthly", "schedule"]
related: ["build-publish-weekly-schedule", "shift-planner-templates-auto-generate", "time-off-availability"]
---

# Set Up Recurring Shifts and Edit a Shift Series

This article explains how to create a shift that repeats on a regular schedule and how to update or remove recurring shifts — one at a time or across an entire series. It is intended for owners and managers who build and maintain the weekly schedule.

## Before you begin

You must have an owner or manager role to create, edit, or delete shifts. If you cannot access the Schedule page, ask your owner to check your role. See [Roles and What Each One Can Access](/help/roles-and-permissions) for details.

## Create a recurring shift

1. Go to **Scheduling** in the main navigation. The page opens on the **Schedule** tab showing the current week.
2. To open the **Create New Shift** dialog, either click the **+ Shift** button in the schedule header, or hover over a day cell in an employee's row and click the **+ Add** button that appears.
3. Fill in the shift details:
   - **Employee** — select the team member from the dropdown.
   - **Position** — choose the role for this shift (Server, Cook, Bartender, Host, Manager, Dishwasher, Chef, Busser, or Other).
   - **Start Date** and **Start Time** — the date and time the shift begins.
   - **End Date** and **End Time** — the date and time the shift ends.
   - **Break Duration (minutes)** — the unpaid break length; defaults to 30 minutes.
   - **Status** — leave as Scheduled for new shifts, or set to Confirmed if already agreed upon.
   - **Notes** — any additional information for this shift (optional).
4. Open the **Repeat** dropdown. Choose one of the following options:
   - **Does not repeat** — a one-time shift (default).
   - **Daily** — repeats every day.
   - **Weekly on [day]** — repeats once a week on the same day as the start date you entered (for example, "Weekly on Tuesday").
   - **Monthly on the [first/second/third/fourth/last] [day]** — repeats once a month on the same weekday position as the start date (for example, "Monthly on the second Monday").
   - **Annually on [Month Day]** — repeats once a year on the same date.
   - **Every weekday (Monday to Friday)** — repeats on all five weekdays.
   - **Custom...** — opens the Custom recurrence dialog (see the next section).
5. Click **Create Shift** to save. EasyShiftHQ creates the full series of shifts automatically.

## Set a custom recurrence

When you choose **Custom...** from the Repeat dropdown, the **Custom recurrence** dialog opens.

1. Under **Repeat every**, enter a number and choose a unit: **day**, **week**, **month**, or **year**. For example, enter 2 and choose "weeks" for a shift that repeats every two weeks.
2. If you chose **week**, a **Repeat on** section appears showing all seven days of the week. Check the boxes for each day you want the shift to occur. You must keep at least one day selected.
3. Under **Ends**, choose when the series should stop:
   - **Never** — the series continues indefinitely.
   - **On** — enter a specific end date; the series stops on or before that date.
   - **After** — enter a number of occurrences; the series stops after that many shifts.
4. Click **Done** to return to the Create New Shift dialog. The Repeat field updates to show a summary of your custom schedule.
5. Click **Create Shift** to save.

## Edit a recurring shift

When plans change, you can update one shift, a group of future shifts, or the entire series.

1. In the Schedule grid, click the shift card you want to edit. If the shift is part of a recurring series, the **Edit Recurring Shift** dialog appears.
2. The dialog shows the date and time of the shift you clicked and the total number of shifts in the series. Choose the scope of your edit:
   - **This shift only** — changes apply only to the shift on that date.
   - **This and following shifts** — changes apply to the clicked shift and all future shifts in the series.
   - **All shifts in series** — changes apply to every shift in the series, past and future.
3. Click **Continue**. The **Edit Shift** dialog opens with the shift details pre-filled.
4. Make your changes to any of the fields, then click **Update Shift**.

> If one or more shifts in the series are part of a published schedule, a notice will appear in the dialog explaining that those shifts will not be modified. To edit a published shift, you must first unpublish the schedule from the Schedule header.

## Delete a recurring shift

1. In the Schedule grid, hover over the shift card and click the trash icon (Delete shift) that appears in the top-right corner of the card.
2. If the shift is part of a recurring series, the **Delete Recurring Shift** dialog appears. Choose the scope:
   - **This shift only** — removes only the shift on that date.
   - **This and following shifts** — removes the clicked shift and all future shifts in the series.
   - **All shifts in series** — removes every shift in the series.
3. Click **Delete** to confirm. The selected shifts are removed from the schedule.

> If any shifts in the scope are part of a published schedule, the dialog will warn you that employees may have already seen those shifts. They will still be deleted when you confirm.

## Tips

- The **Repeat** dropdown is only shown when creating a new shift, not when editing an existing one. If you need to change the repeat pattern for an entire series, delete the series and recreate it with the new pattern.
- When you select a start date, the **Repeat** dropdown automatically offers options that match that date — for example, "Weekly on Wednesday" if you picked a Wednesday.
- Shifts that are part of a recurring series can be identified by the scope dialog that appears when you click to edit or delete them — a one-time shift goes straight to the edit or delete confirmation without a scope prompt.
- A conflict warning appears in the Create New Shift dialog in real time if the employee has an approved time-off request or an availability restriction that overlaps with the shift times. You can still save the shift, but review the conflict first.

## Troubleshooting

**The Repeat dropdown does not appear.**
The Repeat option is only available when creating a brand-new shift. It does not appear when you open an existing shift to edit it.

**I clicked a shift and saw a scope dialog, but I only wanted to edit that one occurrence.**
Select **This shift only** in the scope dialog, then make your changes in the Edit Shift form that follows. Only that single occurrence will be updated.

**Clicking Delete on a one-time shift shows a confirmation dialog, but for a recurring shift it shows a scope dialog instead.**
This is expected behavior. For regular one-time shifts, a simple "Are you sure?" prompt appears. For recurring shifts, the scope dialog lets you choose how many shifts to delete.

**Some shifts in the series were not updated.**
When editing a series, shifts that are locked because they belong to a published schedule are skipped automatically. The remaining unlocked shifts will still be updated. Unpublish the schedule first if you need to change the locked shifts, then retry the edit.

**The shift I created is not appearing in future weeks.**
Navigate forward using the arrow buttons in the Schedule header to check future weeks. Recurring shifts are created across all future occurrences and will appear week by week as you navigate.

## Frequently asked questions

**Can I change the repeat pattern of an existing series?**
Not directly. The Repeat setting can only be configured when a shift is first created. To change the pattern, delete the existing series (choose "All shifts in series") and create a new shift with the updated repeat setting.

**What happens to past shifts when I choose "This and following shifts"?**
Past shifts in the series are left unchanged. Only the shift you clicked and all future occurrences are affected.

**Does deleting a recurring shift affect published schedules?**
Yes. If shifts in the series have already been published, the dialog warns you before you confirm. Published shifts that fall within your selected scope will still be deleted. To avoid confusion for your team, consider unpublishing the schedule first and notifying staff of the change.

**Can I set a recurring shift to end after a certain number of occurrences?**
Yes. When creating a shift with a Custom recurrence, choose **After** under the Ends section and enter the number of occurrences you want. The series will stop automatically after that count.

**Can I assign a recurring shift to multiple employees at once?**
Each shift is assigned to one employee. To schedule the same recurring shift for multiple employees, create a separate recurring shift for each person.

## Related articles

- [Build, Edit, and Publish the Weekly Schedule](/help/build-publish-weekly-schedule)
- [Use the Shift Planner: Templates and AI Schedule Generation](/help/shift-planner-templates-auto-generate)
- [Manage Time-Off Requests and Employee Availability](/help/time-off-availability)
- [Roles and What Each One Can Access](/help/roles-and-permissions)
