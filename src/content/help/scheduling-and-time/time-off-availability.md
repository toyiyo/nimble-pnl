---
title: "Manage Time-Off Requests and Employee Availability"
category: "scheduling-and-time"
summary: "Create and approve time-off requests, set each employee's regular weekly availability, add one-time date exceptions, and handle open-shift claims and shift trades."
audience: ["owner", "manager"]
order: 40
keywords: ["time off", "availability", "request", "approve", "reject", "shift trade", "claim", "exception", "availability grid"]
related: ["build-publish-weekly-schedule", "employee-availability-and-time-off", "employee-shift-marketplace"]
---

# Manage Time-Off Requests and Employee Availability

This article covers everything owners and managers need to handle employee time-off requests, weekly availability preferences, one-time date exceptions, open-shift claims, and shift trade approvals — all from the Staff Schedule page.

## Before you begin

You must be signed in as an owner or manager. Navigate to **Staff Schedule** (found in the main navigation). All of the features below live on tabs within that page at `/scheduling`.

## Manage time-off requests

### View pending requests

1. Go to **Staff Schedule**.
2. Click the **Time-Off** tab. A badge on the tab shows the number of requests waiting for a decision.
3. The **Action needed** section at the top lists all pending requests in order.

### Create a new time-off request

1. On the **Time-Off** tab, click **New Request**.
2. In the dialog that opens, select the **Employee** from the dropdown.
3. Click the **Start Date** field and pick a date from the calendar.
4. Click the **End Date** field and pick an end date. The end date cannot be before the start date.
5. Optionally, type a note in the **Reason (Optional)** field.
6. Click **Submit Request**. The request is created with a Pending status and the employee is notified.

### Approve or reject a pending request

Each pending request shows the employee name, date range, and reason (if provided).

1. On the **Time-Off** tab, find the request under **Action needed**.
2. Click **Approve** to approve the request, or **Reject** to decline it.
3. The employee is notified of your decision automatically.

### Edit a request

Hover over any pending request row to reveal the edit icon (pencil). Click it to open the **Edit Time-Off Request** dialog, update any fields, and click **Update Request**.

### Delete a request

Hover over a request row to reveal the delete icon (trash can). Click it, then confirm by clicking **Delete** in the confirmation dialog. Deletion is permanent and cannot be undone.

## Set employee weekly availability

### View the team availability grid

1. Go to **Staff Schedule**.
2. Click the **Availability** tab.
3. The **Team Availability Grid** appears — a table with every active employee in the first column and the seven days of the week (Mon through Sun) across the top. Each cell shows the employee's availability for that day.
   - Green cells indicate the employee is available (recurring schedule or an available exception), with the time range shown.
   - Amber cells indicate a one-time unavailability exception is in effect for that date.
   - Muted/grey cells indicate no availability has been set yet for that day.
   - A reddish cell indicates the employee is marked unavailable on a recurring basis for that day.
   - A lightning-bolt icon on a green cell means a one-time available exception is overriding the regular weekly schedule for that specific date.
4. Use the arrow buttons in the grid header to navigate to different weeks. Click **Today** to return to the current week.

### Set or update recurring weekly availability

1. On the **Availability** tab, click **Set Availability**.
2. Select the **Employee** from the dropdown.
3. Choose the **Day of Week** (Sunday through Saturday).
4. Toggle **Is available on this day** on or off.
5. If the employee is available, set the **Start Time** and **End Time** for that day.
6. Optionally, type a note in the **Notes (Optional)** field.
7. Click **Save**. The availability is saved and appears in the grid.

You can also click directly on any cell in the grid to open the same dialog, pre-filled with that employee and day.

### Add a one-time availability exception

Use exceptions to override an employee's regular weekly schedule for a single specific date — for example, when someone can only work a partial day, or needs an unexpected day off.

1. On the **Availability** tab, click **Add Exception**.
2. Select the **Employee** from the dropdown.
3. Click the **Date** field and pick the specific date from the calendar.
4. Toggle **Available on this date** on or off.
5. If the employee is available on that date, set the **Start Time** and **End Time**.
6. Optionally, type a note in the **Reason (Optional)** field.
7. Click **Save**. The exception appears in the grid: amber if the employee is unavailable, or green with a lightning-bolt icon if the employee is available on that date.

You can also click directly on any date cell in the grid that already has an exception to open the **Edit Availability Exception** dialog and update it.

## Handle shift trades and open-shift claims

### Go to the Shift Trades tab

1. Go to **Staff Schedule**.
2. Click the **Shift Trades** tab. A badge on the tab shows the total number of trades pending your decision.

The tab contains two main sections: **Pending Shift Claims** and **Pending Approval**.

### Approve or reject an open-shift claim

When an employee requests to claim an open shift, it appears in the **Pending Shift Claims** section (shown with a green header).

1. On the **Shift Trades** tab, find the claim card under **Pending Shift Claims**. The card shows the employee's name, the shift template, date, time, and position.
2. Click **Approve** to assign the shift to that employee, or **Reject** to decline the request.
3. A confirmation dialog opens showing a **Claim Summary** with the employee name, shift name, date, time, and position.
4. Optionally type a note in the **Add Note** field. A note is recommended when rejecting so the employee understands why.
5. Click **Approve** or **Reject** to confirm. The employee is notified of your decision.

### Approve or reject a shift trade request

When two employees have agreed to swap a shift, the trade appears in the **Pending Approval** section (shown with an amber header) awaiting your final sign-off.

1. On the **Shift Trades** tab, find the trade card under **Pending Approval**. Each card shows the shift date and time, the employee offering the shift (From), the employee receiving it (To), and any reason the employee provided.
2. Click **Approve** to transfer the shift, or **Reject** to keep the original assignment.
3. A confirmation dialog opens showing a **Trade Summary** with the from/to employees, date, time, and position.
4. Optionally type a note in the **Add Note** field. A note is recommended when rejecting.
5. Click **Approve** or **Reject** to confirm. Both employees are notified via email.

### View shifts open in the marketplace

Below the pending sections, the **Open in Marketplace** section lists any shifts that employees have posted for trade but that no other employee has accepted yet. This section is read-only — no action is required from you until another employee accepts the trade and it moves to Pending Approval.

## Tips

- The badge count on the **Time-Off** tab reflects only requests with a Pending status. Approved and rejected requests still appear in the list below the Action needed section for reference.
- The badge count on the **Shift Trades** tab counts trades that are in the pending approval stage — it does not count open marketplace shifts.
- Clicking a cell directly in the Team Availability Grid is the fastest way to set or edit a single employee's availability for a specific day or date.
- When an exception is active for a date, it overrides the employee's regular weekly schedule for that date only. Their normal recurring schedule resumes after that date. An available exception shows as a green cell with a lightning-bolt icon; an unavailable exception shows as an amber cell.
- Adding a note when rejecting a shift trade or claim helps employees understand the decision and reduces back-and-forth.

## Troubleshooting

**The Time-Off tab badge shows a number but I don't see any requests under Action needed.**
The badge reflects the count from when the page loaded. Refresh the page to get the latest data. Requests already decided by another manager will no longer appear in the pending queue.

**I can't submit a new time-off request — the Submit Request button is grayed out.**
All three required fields must be filled in: Employee, Start Date, and End Date. Also confirm that the End Date is on or after the Start Date — the dialog shows an error if the end date is earlier.

**A green cell in the Team Availability Grid shows a lightning-bolt icon.**
That icon means a one-time availability exception (the employee is available) is overriding the regular weekly schedule for that specific date. An amber cell (no icon) means a one-time unavailability exception is in effect. Click any cell to view or edit the exception.

**I clicked Approve on a shift trade but nothing happened.**
If the button shows "Processing..." it is still working. Wait a moment. If it fails, an error message will appear. Check that your internet connection is stable and try again.

**An employee's row in the availability grid says "No availability set".**
That employee has no recurring schedule configured yet. Click **Set now** (shown inline in the row) or use the **Set Availability** button to add their weekly availability.

## Frequently asked questions

**Can I create a time-off request on behalf of an employee?**
Yes. Click **New Request** on the Time-Off tab, select the employee from the dropdown, and fill in the dates. The request is created immediately with a Pending status.

**Does approving a time-off request automatically remove any scheduled shifts?**
No. Approving a time-off request records the decision and notifies the employee, but it does not automatically delete or modify existing shifts. You will see a conflict warning on any shift that overlaps with an approved time-off period when building the schedule.

**What is the difference between recurring availability and an availability exception?**
Recurring availability sets the employee's standard weekly schedule — for example, "Available Monday through Friday, 9 am to 5 pm." An exception overrides that for a single specific date — for example, "Unavailable on June 15" or "Available only until 2 pm on July 4."

**Can a manager add notes when approving or rejecting a shift trade?**
Yes. After clicking Approve or Reject on a trade, a dialog opens where you can type an optional note before confirming. When rejecting, adding a note is recommended so the employee understands the reason.

**What happens to a shift once I approve a trade?**
Approving a trade transfers the shift from the original employee to the accepting employee. Both employees are notified by email and the schedule updates automatically.

## Related articles

- [Build, Edit, and Publish the Weekly Schedule](/help/build-publish-weekly-schedule)
- [Roles and What Each One Can Access](/help/roles-and-permissions)
- [Manage Your Team: Invite, Change Roles, Remove, and Add Collaborators](/help/manage-team-members)
- [Use the Shift Planner: Templates and AI Schedule Generation](/help/shift-planner-templates-auto-generate)
