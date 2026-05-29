---
title: "Use the Shift Planner: Templates and AI Schedule Generation"
category: "scheduling-and-time"
summary: "Define reusable shift templates in the Planner tab, assign employees to templates, and use AI to auto-generate a full week's schedule."
audience: ["owner", "manager"]
order: 30
keywords: ["shift planner", "template", "AI schedule", "auto-generate", "coverage", "capacity", "planner tab"]
related: ["build-publish-weekly-schedule", "recurring-shifts", "time-off-availability"]
---

# Use the Shift Planner: Templates and AI Schedule Generation

This article explains how to create reusable shift templates in the Planner tab, assign employees to those templates, and let AI fill in a full week's schedule automatically. It is intended for owners and managers.

## Before you begin

- You must have at least one active employee on your team. The Planner tab will display a "No employees found" message and will not load if no employees exist.
- You need the **owner** or **manager** role. Staff-level accounts do not have access to create or edit templates or generate schedules.

## Go to the Planner tab

1. From the main navigation, go to **Scheduling** (route: `/scheduling`).
2. On the Staff Schedule page, click the **Planner** tab.

The Planner shows a weekly grid with your templates as rows and the seven days of the week as columns. An **Employees** panel sits on the right side of the grid on desktop.

Use the arrow buttons in the header to move between weeks, or click **Today** to jump back to the current week. The header also shows the total hours scheduled for the displayed week.

## Create a shift template

Templates define a recurring shift pattern — a position, a time window, the days it runs, and how many staff are needed. You create them once and reuse them every week.

1. Click **+ Add Shift Template** at the bottom of the template grid, or click **Add Shift Template** if the grid is empty and no templates exist yet.
2. The **Add Shift Template** dialog opens. Fill in the following fields:
   - **Template Name** — a recognizable label, for example "Morning Weekdays".
   - **Start Time** and **End Time** — the shift hours.
   - **Position** — the job role for this shift, for example "Server". Existing positions from your team are suggested as you type.
   - **Area** — an optional grouping label (for example "Bar" or "Kitchen"). If you use areas, templates can be filtered and collapsed by area on the grid.
   - **Days** — toggle the day buttons (S M T W T F S) to select which days of the week this template is active. At least one day is required.
   - **Break Duration (minutes)** — the paid-break time subtracted from each shift's working hours. Enter 0 for no break.
   - **Staff Needed** — how many employees are required for this shift each active day. Defaults to 1. When a template needs more than one person, the grid shows a "Need N" indicator on the template row.
3. Click **Add Template** to save, or **Cancel** to discard.

## Edit or delete a template

1. Hover over a template row header in the grid. A three-dot menu button appears on the right side of the row header.
2. Click the three-dot menu to open a small menu with two options:
   - **Edit** — opens the **Edit Shift Template** dialog with all fields pre-filled. Make your changes and click **Save Changes**.
   - **Delete** — removes the template from the planner immediately.

## Filter templates by area

If you have assigned areas to your templates, filter pills appear above the grid. The pills include **All** (to show everything) plus one pill per area. Click an area pill to show only templates belonging to that area. Click **All** to clear the filter. This is useful in larger operations where front-of-house and kitchen templates would otherwise crowd the same grid.

## Read the coverage strip

Directly below the day headers, a row labeled **Cover** displays a heat-map bar for each day. Each bar is divided into hourly segments. Darker segments mean more staff are scheduled during that hour; lighter or empty segments mean fewer or none. Hover over a segment to see the exact hour and how many employees are on shift at that time.

This gives you a quick visual check of gaps and peaks before you finalize the week.

## Assign employees to templates by dragging

The **Employees** panel on the right lists all active employees with their position and, if already scheduled, the number of shifts and hours they have that week.

1. Find the employee you want to assign. Use the **Search** field to filter by name. Dropdown filters for area, role, and employment type (Full-Time / Part-Time) appear when your team has employees in more than one area or more than one role.
2. Drag an employee card from the panel and drop it onto the cell where the template row and the target day intersect. Active days for the template are shown; inactive days are visually dimmed.
3. A small dialog appears asking how to assign:
   - **This day only** — creates a single shift for the day you dropped onto.
   - **All N days this week** — creates shifts on every day the template is active during the current week. This option appears only when the template is active on more than one day.
4. If the employee has a scheduling conflict or a time-off request that overlaps, a confirmation dialog explains the issue and lets you proceed anyway or cancel.

Assigned shifts appear as chips inside the grid cell. Each chip shows the employee's name. To remove an assignment, click the remove control on the chip.

## Assign employees on a mobile device

On a phone or small screen the employee panel is hidden by default.

1. Tap the **Team** floating button (people icon) in the bottom-right corner to slide out the employee list.
2. Tap an employee's name to select them. A banner at the bottom of the screen confirms the selection and shows "Tap a cell to assign [Name]".
3. Tap a template/day cell to complete the assignment. The same "This day only" / "All N days" dialog appears.
4. To cancel the selection, tap the X in the banner.

## Generate a full week's schedule with AI

The **Generate with AI** button in the planner header tells the AI to read your templates, employee positions, and availability records, then fill in shift assignments automatically for the displayed week.

1. Click **Generate with AI** in the top-right area of the planner header.
2. The **Generate Schedule** dialog opens, showing the week date range.

   **Preferences (optional)** — type plain-language notes about how you want the schedule built, for example: "Keep Maya off Mondays. Sam prefers weekends." The field accepts up to 2,000 characters.

   **Employees** section — all active employees are listed with checkboxes. All are checked (included) by default. Uncheck any employee you want to exclude from this generated schedule.

   **Existing Shifts** section — if any shifts are already on the grid for this week, they appear here. Check the box next to a shift to lock it; locked shifts will not be replaced or removed by the AI. This section only appears when there are existing unlocked shifts.

   **Scheduling Readiness** section — if the system detects issues such as employees with no availability set, limited availability, or no matching templates for their position, warnings are listed here before you generate. Resolving these issues first leads to better results.

3. Click **Generate** to start. The dialog shows "Generating schedule..." while the AI works.
4. When generation succeeds and shifts are created, the dialog closes automatically. A notification at the top of the screen confirms how many shifts were created and how many required slots were filled. If estimated labor cost exceeds your budget, the notification also notes the percentage over budget. The new shifts appear immediately in the weekly grid, ready for you to review and publish.

   If generation completes but could not schedule any shifts, the dialog stays open and shows details about what was filtered out, including any dropped suggestions and the reason each was skipped. Click **Close** to dismiss.

   If generation fails with an error, the dialog stays open and shows the error message. Click **Try Again** to go back to the configuration screen, or close the dialog to assign employees manually.

## Tips

- Build your templates to match your standard operating hours before trying AI generation. The AI uses your templates as the blueprint for what positions and times to fill.
- Set employee availability before generating. Employees without availability on file may be skipped or generate warnings. Use the **Manage Time-Off Requests and Employee Availability** article to set availability in advance.
- Use **Staff Needed** (capacity) accurately. If a template normally needs two servers, set it to 2 so the AI knows to assign two employees and the coverage strip reflects the real requirement.
- Lock shifts for key employees before generating. If a manager is always scheduled Tuesday morning, lock that shift so AI generation doesn't reassign or remove it.
- After generation, review the grid and make any manual adjustments before publishing. Generated shifts are saved but not published — use the weekly schedule view to publish when ready.

## Troubleshooting

**The "Generate with AI" button is greyed out or shows "Generating..."**
A generation is already in progress. Wait for it to finish before starting another.

**Generation completed but zero shifts were created**
The most common causes are: no employee availability is set (AI cannot place anyone), employee positions do not match any template positions, or all available employees were excluded. Click **Try Again** to return to the configuration screen and review the **Scheduling Readiness** warnings before generating again. Ensure at least some employees have availability on file and that position names on templates match position names on employee profiles.

**I dragged an employee to a cell but nothing happened**
The day may be inactive for that template (templates only accept drops on their active days). Check the active days selected on the template. Also confirm the employee exists in the filtered list — if a filter is active in the Employees panel, the employee you dragged may have been removed from the draggable list.

**After dropping an employee, the conflict dialog appeared**
This means the employee has a recorded time-off request or an existing shift that overlaps the new assignment's hours. Review the details in the dialog and choose whether to assign anyway or cancel.

**I can't see the three-dot menu on a template row**
The menu appears only on hover on desktop. On mobile, the template menu is not accessible — use a desktop or tablet in landscape mode to edit or delete templates.

## Frequently asked questions

**Do generated shifts get published automatically?**
No. AI-generated shifts are created in "scheduled" (unpublished) status. You must review them in the schedule view and publish manually when you are satisfied. See [Build, Edit, and Publish the Weekly Schedule](/scheduling) for how to publish.

**Can I use Generate with AI every week, or is it a one-time tool?**
You can generate a schedule for any week. Each time you open the Generate Schedule dialog for a new week, it starts fresh. Your templates carry over automatically from week to week.

**What does "Staff Needed" on a template actually control?**
It sets the target headcount for that shift. The coverage strip and the AI both use this number to determine whether the shift is fully staffed. For example, if Staff Needed is 3 and only 2 employees are assigned, the template shows that one slot is still open.

**Can I have templates that only run on certain days, like a weekend brunch shift?**
Yes. When creating or editing a template, select only the days you want (for example, just Saturday and Sunday). The template row will only accept drops and generate assignments on those days; the other day cells are inactive.

**What happens if I delete a template that already has shifts assigned to it?**
Existing shifts that were assigned through that template remain on the schedule and are not deleted. The template will no longer appear in the planner grid, but the individual shifts can still be viewed and managed in the weekly schedule view.

## Related articles

- [Build, Edit, and Publish the Weekly Schedule](/help/build-publish-weekly-schedule)
- [Set Up Recurring Shifts and Edit a Shift Series](/help/recurring-shifts)
- [Manage Time-Off Requests and Employee Availability](/help/time-off-availability)
- [Roles and What Each One Can Access](/help/roles-and-permissions)
- [Manage Your Team: Invite, Change Roles, Remove, and Add Collaborators](/help/manage-team-members)
