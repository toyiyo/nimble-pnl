---
title: "Track and Manage Employee Time Punches"
category: "scheduling-and-time"
summary: "View, manually enter, edit, delete, and export time punch data; manage kiosk mode for PIN-based clock-in; and handle open sessions that need a forced clock-out."
audience: ["owner", "manager"]
order: 50
keywords: ["time punch", "clock in", "kiosk", "PIN", "force out", "export", "timeline", "manager", "verification"]
related: ["employee-time-clock", "run-payroll", "build-publish-weekly-schedule", "payroll-rules-and-types"]
---

# Track and Manage Employee Time Punches

This article walks owners and managers through every task available on the Time Clock page — from reviewing daily hours and correcting individual punches to configuring kiosk mode and exporting data for payroll.

## Before you begin

You must have the **owner** or **manager** role to access the Time Clock page, manage kiosk settings, force clock-outs, or edit and delete punches. Staff can clock in and out but cannot manage time records. If you cannot see the Time Clock page, ask your owner to review your role.

See [Roles and What Each One Can Access](/help/roles-and-permissions) for a full breakdown.

## Read the status summary

When you open the Time Clock page at `/time-punches`, a summary bar at the top of the page gives you an at-a-glance view of the current state:

- **Kiosk Mode: On / Off** — whether this device is locked to PIN-only clock-in.
- **Today: X hours** — total worked hours for the period currently displayed.
- **PINs: X / Y** — how many of your employees have a kiosk PIN set.
- **Open sessions badge** — appears when one or more employees are clocked in without a clock-out.
- **Anomalies badge** — appears when the system detects unusual punch patterns (for example, overlapping sessions or very long shifts).

## Navigate dates and filter by employee

1. Use the **Day**, **Week**, or **Month** selector (the dropdown showing the current period) to choose how much time to display.
2. Click the left arrow (**Previous**) or right arrow (**Next**) to move backward or forward by the selected period.
3. Click **Today** to jump back to the current date.
4. To narrow results to one person, choose their name from the employee dropdown. You can also type in the **Search by employee name** box to filter the list.

## Choose a view

A tab bar lets you switch how punches are displayed. Choose the view that works best for your current task:

- **Manual** — an interactive timeline where you can drag to create or adjust time blocks. This is the default view and only works in Day view. On a mobile device, it shows a simplified slider-based form called **Mobile Time Entry**.
- **Cards** — one card per employee showing their shift start/end, total hours, break time, and any anomalies.
- **Stripes** — a visual bar chart of sessions for a quick look at shift coverage.
- **Stream** — a chronological list of all individual punch events.
- **Receipt** — a detailed per-employee summary. You must select a specific employee from the dropdown before this view displays anything.

## Manually enter or adjust time on the desktop timeline

The **Manual** tab in Day view shows one row per employee with a 24-hour timeline.

**To create a new time block by dragging:**

1. Click and drag across an employee's timeline row. A colored block appears as you drag, and a floating label shows the snapped time.
2. Release when the block covers the correct shift window. The entry saves automatically.

**To adjust an existing block:**

1. Drag the left edge of a block to change the clock-in time.
2. Drag the right edge to change the clock-out time.
3. Release to save.

**To add a shift using the form:**

1. Click the employee's name in the timeline to expand the inline form.
2. Fill in **Start Time**, **End Time**, **Break (mins)**, and an optional **Notes** field.
3. Click **Add Time Block**. The entry appears in the timeline and saves automatically.
4. To remove a block, expand the employee row and click **Delete** next to the block.

**Warning:** If an employee's total for the day exceeds 12 hours, an "Over 12 hours" warning badge appears next to their name.

## Enter time on a mobile device

On a narrow screen, the Manual tab shows the **Mobile Time Entry** form instead of the drag timeline.

1. Tap an employee's card to expand it.
2. Tap **Add time block**. A new block is added with a default of 9:00 AM to 5:00 PM.
3. Drag the **Start time** slider to set when the shift began.
4. Drag the **End time** slider to set when it ended.
5. Release the slider to save the entry automatically.
6. To remove a block, tap the trash icon on the block.

## View and edit individual punch records

The **Punch List** section (below the visualization tabs) shows every raw punch record for the current period. Click the **Punch List** header to expand or collapse the list.

**To view verification details for a punch:**

The eye icon only appears on punches that have a verification photo or location data attached. If a punch has neither, the icon is not shown.

1. Find the punch in the list and click the **eye icon** (visible when the punch has a photo or location). The Verification Details panel opens and shows:
   - Employee name, punch type, date, and exact time.
   - A verification photo (if one was captured at clock-in).
   - GPS coordinates with a "View on map" link, or a note that location was unavailable.
   - Device information if it was recorded.

**To edit a punch:**

1. Click the **pencil icon** on the punch row. The Edit Time Punch dialog opens.
2. Adjust the **Punch Time** field to correct the date and time.
3. Optionally add or update the **Notes** field.
4. Click **Save**.

**To delete a punch:**

1. Click the **trash icon** on the punch row.
2. In the confirmation dialog, click **Delete** to confirm. This action cannot be undone.

## Handle open sessions (force clock-out)

When an employee forgets to clock out, their session appears in the **Open Sessions** section with an amber border. The section shows how long the session has been open.

1. Click **Force Out** next to the employee's name.
2. In the Force Clock Out dialog, set the correct **Clock-out time**.
3. Click **Force Clock Out** to apply. The system creates a clock-out punch on the employee's behalf.

If the time you enter is earlier than the clock-in time, the button stays disabled and an error message appears.

## Export punches to CSV

1. Apply any date range and employee filters you need.
2. Click the **download icon** (in the filters row on desktop). A file downloads with columns for Employee, Position, Punch Type, Date, Time, Notes, and Location.

If there are no punches in the current view, a message appears and no file is downloaded.

## Import punches from a CSV file

1. Click **Upload Punches** (the button above the date navigation row).
2. In the panel that opens, drag a file onto the drop zone or click **Choose file** to select a CSV or TXT file. Formats from Toast, Square, Clover, Focus, Shift4, and other systems are supported.
3. The system analyzes the file and suggests column mappings automatically. Review the mappings shown in the table and adjust any that are incorrect using the dropdowns above each column.
4. If any employee names in the file do not match your team, an **Unmatched employees** section appears. Use the dropdown to map them to an existing employee, or click **Create** to add them as a new employee.
5. Review the **Preview Summary** which shows the total punches detected, incomplete shifts, overlapping shifts, and any invalid times.
6. Click **Import & Review** to complete the import. The view switches to the Manual tab so you can review the imported data immediately.

## Configure Time Clock Settings

The **Time Clock Settings** section (only visible to owners and managers) appears at the bottom of the page. Click the label to expand it. It contains two cards side by side.

### Set up Kiosk Mode

The **Kiosk Mode** card controls the shared tablet clock-in experience.

1. Click **Launch** to lock this device to PIN-only clock-in mode. The device navigates to the kiosk screen.
2. If kiosk mode is already active, click **Exit** to unlock the device and restore normal navigation.

Under **Advanced** you can configure:
- **Minimum PIN digits** — choose 4, 5, or 6 digits.
- **Force update on first use** — toggle on to mark newly created PINs as temporary so the employee must change them on first use.
- **Dedicated kiosk login** — create or rotate a separate service-account email and password for signing in to a shared tablet. Click **Create login** (or **Rotate credentials** if one exists), then use the **Copy** button to copy the credentials before dismissing them.

### Manage Employee PINs

The **Employee PINs** card lists every employee and their PIN status.

1. Click **Set** next to an employee who does not yet have a PIN, or **Reset** to replace an existing one. A dialog opens showing a randomly generated PIN.
2. In the dialog, you can type a different PIN in the **PIN** field, or click **Regenerate** to get a new random one.
3. Toggle **Force update on first use** if you want the employee to create their own PIN after the first clock-in.
4. Click **Save PIN** to confirm.

To create PINs for all employees who are missing one at once:

1. Click **Generate X missing** (the count reflects how many employees have no PIN yet).
2. A dialog appears showing all the generated PINs. Note them down — the app does not email PINs to employees automatically.

## Tips

- The Punch List collapses by default. Expand it when you need to audit individual records or find a specific punch to edit.
- The timeline auto-saves as soon as you finish dragging. You do not need to click a save button.
- Imported punches are marked with an "Imported" badge in the expanded timeline view so you can tell them apart from punches made at the time clock.
- Employees with an anomaly badge (Issues) in Cards view may have overlapping sessions or unusual hours — review those first after importing a file.
- After rotating kiosk credentials, copy them immediately. The password is not stored in readable form after you dismiss the dialog.

## Troubleshooting

**The Receipt tab shows "Select a specific employee."**
The Receipt view requires a single employee to be selected. Use the employee dropdown in the filters row to pick one person, then switch to the Receipt tab.

**The Manual timeline does not appear.**
Manual time entry only works when the date selector is set to **Day**. If you have Week or Month selected, the tab shows a message asking you to switch to Day view.

**A punch I edited did not change the displayed time.**
Check that you clicked **Save** in the Edit Time Punch dialog — closing the dialog with the X discards changes.

**The Force Clock Out button is disabled.**
The clock-out time you entered is earlier than the employee's clock-in time. Adjust the time to be after the clock-in shown in the description, then try again.

**An employee name in my CSV file was not matched.**
The system matches by name — if the name in the file is slightly different (different capitalization, a nickname, or a missing last name), use the **Map to employee** dropdown in the Unmatched employees section to link the row to the correct person manually.

**PIN set does not appear after clicking Save PIN.**
The PIN must meet the minimum length configured in Time Clock Settings (default is 4 digits). If the warning "Must be at least X digits" appears, add more digits and try again.

## Frequently asked questions

**Can I undo a deleted punch?**
No. Once you confirm the deletion, it cannot be restored. If you need to recover data, you will need to re-enter the punch manually using the Manual tab or the Edit dialog.

**Does force clock-out notify the employee?**
The employee's time record is updated with the clock-out time you entered, but no automatic notification is sent. The notes on the punch will show "Force clock out by manager" so you can see who made the change later.

**What happens if two managers both try to edit the same punch at the same time?**
The last save wins. If you are coordinating with another manager, communicate before editing the same record to avoid overwriting each other's changes.

**How do I give employees access to clock in from their own phone instead of the shared kiosk?**
Employees clock in from the Employee Time Clock page on their own device. The kiosk is a separate shared-tablet mode. Both methods create punch records you can view and edit here.

**Does the system detect if someone clocks in from outside the restaurant?**
Yes. If location data was captured at clock-in, the Punch List shows an amber map-pin icon and the distance from the restaurant when the employee was outside the expected area. Click the eye icon to see exact coordinates and a link to view the location on a map.

## Related articles

- [Clock In, Start a Break, and Clock Out](/help/employee-time-clock)
- [Using the Shared Kiosk Tablet to Clock In and Out](/help/kiosk-mode-clock-in-out)
- [Setting and Changing Your Kiosk PIN](/help/employee-kiosk-pin)
- [Run Payroll: View Wages, Hours, and Tips](/help/run-payroll)
- [How Payroll Is Calculated by Compensation Type](/help/payroll-rules-and-types)
- [Build, Edit, and Publish the Weekly Schedule](/help/build-publish-weekly-schedule)
