---
title: "Build, Edit, and Publish the Weekly Schedule"
category: "scheduling-and-time"
summary: "Create shifts on the weekly grid, use filters and grouping, copy or import shifts, publish the schedule for staff to see, and undo a publish when corrections are needed."
audience: ["owner", "manager"]
order: 10
keywords: ["schedule", "shift", "publish", "weekly", "copy week", "import", "bulk edit", "print", "drag"]
related: ["recurring-shifts", "shift-planner-templates-auto-generate", "time-off-availability", "copy-week-import-broadcast"]
---

# Build, Edit, and Publish the Weekly Schedule

This article walks owners and managers through every step of building the weekly shift grid in EasyShiftHQ — from adding your first shift to publishing the final schedule so your team can see it.

## Before you begin

- You must be signed in with the **Owner** or **Manager** role. Staff and Kiosk accounts cannot create or publish shifts.
- At least one active employee must exist before you can create a shift. If your team list is empty, add employees first (see [Manage Your Team](/help/manage-team-members)).

---

## Navigate to the schedule and move between weeks

1. In the left sidebar, click **Scheduling** (route `/scheduling`). The page opens on the **Schedule** tab showing the current week.
2. Use the navigation bar at the top of the schedule grid:
   - Click the left arrow (**‹**) to go to the previous week.
   - Click **Today** to jump back to the current week.
   - Click the right arrow (**›**) to go to the next week.
3. The week range (for example, **May 26 – Jun 1, 2026**) and the total number of shifts scheduled are displayed next to the navigation controls.

---

## Create a new shift

You can open the shift form from two places:

**Option A — Top-right button**

1. Click the **Shift** button in the top-right toolbar (it shows a plus icon).
2. The **Create New Shift** dialog opens.

**Option B — Add button inside a day cell**

1. Hover over any employee row. A dashed **Add** button appears in each day cell.
2. Click **Add** on the specific day you want. The dialog opens with the employee and date already filled in.

**Fill in the shift details:**

| Field | What to enter |
|-------|---------------|
| **Employee** | Select the team member from the dropdown (active employees only). |
| **Position** | Choose a position: Server, Cook, Bartender, Host, Manager, Dishwasher, Chef, Busser, or Other. |
| **Start Date** | The date the shift begins. |
| **Start Time** | The time the shift starts. |
| **End Date** | The date the shift ends (usually the same day). |
| **End Time** | The time the shift ends. |
| **Break Duration (minutes)** | Paid-break deduction in minutes (default is 30). |
| **Status** | Scheduled, Confirmed, Completed, or Cancelled. |
| **Notes** | Optional notes visible to managers. |
| **Repeat** | Choose a recurrence pattern for new shifts (does not appear when editing). |

If the employee has a time-off request or availability conflict for the chosen times, a warning appears in the dialog before you save.

3. Click **Create Shift** to save. The shift card appears on the grid.

---

## Edit or delete a single shift

**To edit:**
- Click the **pencil icon** that appears when you hover over a shift card, **or** click anywhere on the shift card itself. The **Edit Shift** dialog opens with the current values pre-filled. Make your changes and click **Update Shift**.

**To delete:**
- Click the **trash icon** that appears when you hover over a shift card. Confirm the deletion in the alert that appears.

> **Note:** If a shift belongs to a published schedule, it is locked. The dialog shows a "Shift is Locked" warning and the save button is disabled. You must unpublish the schedule first (see [Unpublish the schedule](#unpublish-the-schedule-to-make-corrections) below).

---

## Filter and group the schedule grid

### Filter by position or area

Use the dropdowns in the toolbar above the grid:

- **All Positions** (or a specific position name) — shows only employees in that role.
- **All Areas** (or a specific area name) — shows only employees assigned to that area. This dropdown appears only when your team has more than one area configured.

Filters affect both what you see on the grid and what is included when you print.

### Change grouping

Click the **Group by** dropdown (the icon looks like stacked layers) and pick one option:

- **No Grouping** — employees appear in a flat list.
- **Group by Area** — rows are separated into collapsible sections by area.
- **Group by Position** — rows are separated into collapsible sections by position.

Click a group header to collapse or expand that section. Your grouping choice is remembered between sessions.

---

## Select multiple shifts and use bulk actions

1. Click **Select** in the toolbar. The grid enters selection mode and each shift card shows a circular checkbox.
2. Select individual shifts by clicking their cards. To select all shifts for a whole employee row, click that employee's name. To select all shifts for a whole day column, click the day header.
3. When at least one shift is selected, a floating **Bulk Action Bar** appears at the bottom of the screen showing the number of selected shifts.
4. From the Bulk Action Bar, choose:
   - **Edit** — opens the **Edit Shifts** dialog where you can apply a new Start Time, End Time, or Position to all selected shifts at once. Only fields you change will be updated; leave a field blank to keep each shift's existing value.
   - **Delete** — permanently removes all selected shifts after confirmation.
5. Click **Done** in the toolbar (or press **Escape**) to exit selection mode.

---

## Move a shift by dragging

To copy a shift to a different day or employee slot, click and hold a shift card, then drag it to the target day cell in the grid. The destination cell highlights as you drag. Release to create a copy of the shift in the new location. The original shift stays in place.

---

## Copy all shifts to another week

Use **Copy Week** to duplicate the entire current week's schedule to a future week.

1. Click **Copy Week** in the toolbar (the button is disabled if there are no shifts this week).
2. The **Copy Schedule** dialog opens showing the current week's date range.
3. On the **Copy from Week** tab, pick any date in the target week using the calendar. The dialog shows the target week range and how many shifts will be copied.

   > **Warning:** If the target week already has unlocked shifts, they will be permanently deleted and replaced. A red warning appears in the dialog if this applies.

4. Click **Copy N Shifts** to confirm. The app navigates you to the target week automatically.

The dialog also has a **Templates** tab where you can save the current week as a named template (up to five templates) and apply saved templates to any future week. See [Use the Shift Planner: Templates and AI Schedule Generation](/help/shift-planner-templates-auto-generate) for more on templates.

---

## Import shifts from a CSV file

Use **Import** to bulk-add shifts from a spreadsheet export.

1. Click **Import** in the toolbar. The **Import Shifts** panel slides open from the right.
2. **Upload step:** Drop a CSV or TXT file onto the upload area, or click **Choose file** to browse. The app supports standard CSV schedules and Sling exports.
3. **Map Columns step** (skipped for Sling files): Each column from your CSV appears at the top of a preview table. Use the dropdown above each column to tell the app what that column contains — for example, **Employee Name**, **Start Time**, **End Time**, **Position / Role**, **Break Duration (min)**, or **Notes**. At minimum you must map Employee Name (or ID), Start Time, and End Time. Click **Next** when the mapping is valid.
4. **Employees step:** The app matches CSV names to your existing team members. For each name it finds, you can link it to an existing employee, create a new employee, or skip those shifts. Click **Next** when you are satisfied with the matches.
5. **Preview step:** Review how many shifts are ready to import, any duplicates detected, or any issues. Click **Import N Shifts** to finish.

---

## Publish the schedule

Publishing makes the schedule visible to all employees and sends push notifications to staff.

1. Click **Publish** in the toolbar. The button is disabled if there are no shifts on the current week.
2. The **Publish Schedule** dialog shows a summary: the number of shifts, employees scheduled, and total hours for the week.
3. If any open shift slots still need staff, a warning appears in the dialog.
4. Optionally add notes in the **Notes** field (for example, "Holiday weekend — extra coverage needed").
5. Click **Publish Schedule** to confirm.

Once published:
- All shifts are locked and cannot be edited without unpublishing.
- The schedule is visible to your entire team.
- Staff receive a push notification.
- A status badge appears next to the week range showing the schedule is published.

---

## Unpublish the schedule to make corrections

If you need to edit shifts after publishing:

1. Click **Unpublish** in the toolbar (visible only when the current week is published).
2. Confirm the action in the alert dialog.

All shifts for that week are unlocked. Make your corrections, then publish again when ready.

---

## Review the change log

After publishing, every shift creation, edit, and deletion is recorded.

1. Click **Changes** in the toolbar (visible when the week is published).
2. The **Schedule Change History** dialog lists each change with the type (Created, Updated, Deleted, or Unpublished), the employee affected, the timestamp, and before/after shift details for updates.

---

## Print or download the schedule

1. Click **Print** in the toolbar (the button is disabled if there are no shifts).
2. The **Print Schedule** dialog opens with a preview of how the schedule will look on paper.
3. Choose which employees to include using the checkboxes. Use **Select All** or **Deselect All** to adjust quickly.
4. Toggle optional settings:
   - **Include position labels** — adds each employee's position under their name.
   - **Include hours summary per employee** — adds a total-hours column.
5. Click **Download PDF** to generate and download a print-ready PDF.

---

## Tips

- **Drafting across weeks:** Shifts you add to a future week are saved immediately but stay unpublished until you explicitly click Publish for that week.
- **Conflict indicators:** A yellow triangle on a shift card means there is a scheduling conflict (overlapping time-off or another shift). Hover over the card to read the conflict details.
- **Inactive employees:** Employees marked as inactive are hidden from the grid unless they have at least one non-cancelled shift that week.
- **Labor cost:** The **Labor Cost** card at the top of the page updates in real time as you add or remove shifts, helping you stay within budget before you publish.

---

## Troubleshooting

**The Publish button is grayed out.**
There are no shifts on the current week. Add at least one shift before publishing.

**A shift card shows "Shift is Locked" when I try to edit it.**
The schedule for that week has already been published. Click **Unpublish** in the toolbar, make your edits, then publish again.

**Copy Week is grayed out.**
The current week has no shifts to copy. Build the schedule first, then use Copy Week.

**The Import step shows "No shifts parsed."**
Your column mappings may not include a required field. Go back to the **Map Columns** step and make sure Employee Name, Start Time, and End Time are all mapped to columns in your CSV.

**An employee does not appear in the grid.**
Check whether the employee is set to inactive and has no shifts this week. Active employees always appear; inactive employees are shown only when they have at least one non-cancelled shift.

**I can't find the area filter dropdown.**
The area filter only appears when your team has more than one area configured. If everyone is in a single area (or no area is set), the dropdown is hidden.

---

## Frequently asked questions

**Can staff see the schedule before I publish it?**
No. Shifts are only visible to employees after you click Publish. Unpublished shifts are visible to owners and managers only.

**What happens to existing shifts when I use Copy Week?**
Existing unlocked shifts in the target week are permanently replaced. Published (locked) shifts in the target week are not affected. The dialog shows a warning and the count of shifts that will be deleted before you confirm.

**Can I undo a bulk delete?**
No. Bulk deletion is permanent. If you accidentally delete shifts, you will need to recreate them manually or use Copy Week or Import to restore them.

**Why do some shift cards have a yellow warning triangle?**
The triangle indicates a scheduling conflict — for example, the employee has an approved time-off request that overlaps the shift, or two shifts for the same employee overlap. Hover over the card to see the specific conflict message. You can still save and publish the shift, but you should review the conflict first.

**Can I set a shift to repeat every week automatically?**
Yes. When creating a new shift, use the **Repeat** dropdown to choose a recurrence pattern (daily, weekly, every two weeks, and so on, or Custom). Editing or deleting a recurring shift asks whether the change applies to just this shift, this and all following shifts, or the entire series. See [Set Up Recurring Shifts and Edit a Shift Series](/help/recurring-shifts) for details.

---

## Related articles

- [Set Up Recurring Shifts and Edit a Shift Series](/help/recurring-shifts)
- [Use the Shift Planner: Templates and AI Schedule Generation](/help/shift-planner-templates-auto-generate)
- [Manage Time-Off Requests and Employee Availability](/help/time-off-availability)
- [Manage Your Team: Invite, Change Roles, Remove, and Add Collaborators](/help/manage-team-members)
- [Roles and What Each One Can Access](/help/roles-and-permissions)
