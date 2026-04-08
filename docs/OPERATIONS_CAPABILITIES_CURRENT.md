# Operations Capabilities (Current)

As of February 21, 2026, this document reflects the **current, shipped functionality** in the Operations section:
- Scheduling
- Time Clock
- Tip Pooling
- Payroll

It is intentionally limited to what is implemented today.

## Access Scope

- Operations pages in this document describe the manager-facing experience for authenticated non-staff users with route access.
- Staff users use employee-facing pages (for example, employee clock/self-service pages), not the manager Operations pages documented here.
- Scheduling and Payroll are subscription-gated features in the current implementation.

## Scheduling

### What managers can do

- View a weekly schedule by employee and day.
- Navigate schedule periods using `Previous`, `Today`, and `Next` week controls.
- Filter the schedule by position.
- View weekly scheduling metrics:
  - Active employees ready to be scheduled
  - Total scheduled hours
  - Estimated labor cost with breakdowns (hourly, salary, contractor, daily rate)
- Create shifts.
- Edit shifts.
- Delete shifts.
- Set shift status (`Scheduled`, `Confirmed`, `Completed`, `Cancelled`).
- Add break duration and notes to shifts.
- Create recurring shifts with repeat presets and custom recurrence rules.
- Edit/delete recurring shifts by scope:
  - This shift only
  - This and following shifts
  - All shifts in series
- Detect scheduling conflicts in real time while creating/editing shifts:
  - Time-off conflicts
  - Availability conflicts
- Publish a weekly schedule (with optional notes).
- Unpublish a published schedule for corrections.
- View schedule change history for published schedules (created, updated, deleted, unpublished).
- Print/export a weekly schedule PDF.
  - Optional position labels
  - Optional hours summary per employee

### Time-off management in Scheduling

- Create time-off requests.
- Edit pending time-off requests.
- Approve time-off requests.
- Reject time-off requests.
- Delete time-off requests.
- Store optional reason text for each request.

### Availability management in Scheduling

- Create or update recurring weekly availability by employee and weekday.
- Define whether employee is available/unavailable on a weekday.
- Set weekday start/end time windows when marked available.
- Add one-time availability exceptions for specific dates.
- Set one-time date exceptions as available or unavailable.
- Add optional notes/reason for availability entries/exceptions.

### Shift trade management in Scheduling

- View pending trade approvals.
- Approve shift trade requests.
- Reject shift trade requests.
- Add optional manager notes when approving/rejecting.
- View open marketplace trade postings (read-only monitoring view).

### Current limits to note

- Availability tab currently supports creation/update dialogs; it does not currently provide a full in-tab management table for existing recurring availability/exception records.
- Locked published shifts cannot be changed until the schedule is unpublished.

## Time Clock

### What managers can do

- View Time Clock status summary:
  - Kiosk status
  - Current-period total worked hours
  - PIN coverage
  - Open session count
  - Anomaly count
- Filter punches by employee.
- Search punches by employee name.
- Switch date scope (`Day`, `Week`, `Month`) and navigate period dates.
- Export filtered time punches to CSV.

### Punch management

- View punch list with punch type, employee, position, date/time, and indicators.
- View verification details for a punch:
  - Photo (if captured)
  - GPS coordinates (if captured)
  - Device info (if captured)
- Open location in Google Maps from punch verification details.
- Edit punch timestamp and notes.
- Delete punches.

### Manual time entry

- Use manual timeline editor in **Day view** (desktop):
  - Add time blocks
  - Drag/adjust time blocks
  - Add break minutes and notes
  - Auto-save to punch records
- Use mobile manual entry in **Day view** (mobile):
  - Add/edit/delete time blocks with slider controls
  - Save to punch records

### Operational views

- Card view for per-employee session summaries.
- Stripe/barcode-style timeline view.
- Punch stream timeline/debug view.
- Receipt-style single-employee timeline view.

### Open session handling

- Detect incomplete/open sessions (for example missing clock-out).
- Force clock-out for open sessions by manager with selected clock-out time.

### Import and upload

- Upload and map punch files from the Time Clock page.
- Supported import path currently:
  - CSV
  - TXT
- Column mapping supports:
  - Employee identifiers
  - Action + timestamp mode
  - Clock in/out/break start/break end mode
  - Notes
  - Tips
- Preview import quality signals before commit:
  - Incomplete shifts
  - Overlapping shifts
  - Missing employees
  - Invalid times
- Map unmatched employee names to existing employees.
- Create missing employees during import.
- Bulk import punches and associated tip rows.

### Kiosk and PIN controls

- Launch kiosk mode for the location (device lock to PIN time clock workflow).
- Exit kiosk mode.
- Set PIN policy:
  - Minimum PIN length (4 to 6 digits)
  - Force reset on first use
- Manage employee PINs:
  - Set/reset per employee
  - Auto-generate missing PINs
  - View PIN coverage status
- Create/rotate dedicated kiosk login credentials for tablet/device sign-in.

### Current limits to note

- XLSX selection is surfaced in UI, but current flow requires exporting/importing as CSV (XLSX import is not executed in the current implementation).
- Manual time entry is only available in Day view.
- Receipt-style view requires a single employee selection.

## Tip Pooling

### Configuration capabilities

- Configure tip source:
  - Manual entry
  - POS import (when tip data is available)
- Configure share method:
  - By hours worked
  - By role weighting
  - Even split
- Configure split cadence:
  - Daily
  - Weekly
  - Per shift
- Configure participating employees for pooling.
- Configure role weight values when role-based method is used.
- Auto-save tip pool settings as changes are made.

### Daily entry and review

- Enter total tips for a selected date.
- Use POS-imported amount when available.
- Import employee-declared tips into the day’s total.
- Auto-calculate hours from time punches for hours-based splits.
- Manually override hours before approval.
- Preview allocations by employee.
- Edit allocation amounts directly and auto-rebalance remaining shares.
- Save a split as draft.
- Approve a split.

### Split lifecycle and history

- Maintain split statuses:
  - Draft
  - Approved
  - Archived (locked)
- Resume/edit draft splits.
- Reopen approved splits back to draft for editing.
- View audit trail details on approved/reopened changes.
- View locked/archived history entries for payroll reference.

### Period and payroll flow

- Overview period timeline (weekly period view) with day-level statuses.
- Click timeline day to jump into daily entry for that date.
- Validate readiness before locking period.
- Lock period for payroll when validation passes:
  - Approved splits present
  - No drafts remaining
  - Approved splits contain employee allocations

### Tip payouts

- Record cash tip payouts by employee against a split.
- Edit payout amounts before confirm.
- Delete existing payout entries.
- Show payout status by day (`none`, `partial`, `paid`).

### Disputes and manager review

- Show open employee tip disputes.
- Resolve disputes with notes.
- Dismiss disputes with notes.

### Current limits to note

- Payroll inclusion requires approved/archived split records with employee allocations; unapproved drafts are excluded.
- Historical date entry in daily flow is currently limited to the recent 30-day window.

## Payroll

### Payroll period controls

- Run payroll view by period presets:
  - Current week
  - Last week
  - Last 2 weeks
  - Custom date range
- Navigate periods with previous/next controls.
- Refresh payroll calculations on demand.

### What payroll calculates and shows

- Employee-level payroll rows with:
  - Compensation type badge
  - Rate/pay basis
  - Regular hours
  - Overtime hours
  - Regular pay
  - Overtime pay
  - Tips earned
  - Tips paid out
  - Tips owed
  - Total pay
- Period summary totals for:
  - Employee count
  - Total hours
  - Gross wages
  - Tips owed
- Overtime logic for hourly employees:
  - 1.5x for hours above 40 per calendar week
- Break time excluded from worked hours.
- Incomplete punch anomalies surfaced at employee and period level.

### Compensation type handling

- Hourly employees:
  - Punch-based regular/overtime calculation
- Salaried employees:
  - Prorated period pay calculation
- Contractors:
  - Prorated contractor pay for recurring contractor setup
- Per-job contractors:
  - Manual payment entry workflow
  - Manual payment rows included in payroll totals
- Daily-rate employees:
  - Daily-rate pay based on worked days in period

### Tip and payout integration in payroll

- Pulls tip amounts from approved/archived tip split data.
- Includes legacy/employee tip records where applicable.
- Applies tip payouts already recorded, and computes remaining tips owed.

### Export

- Export payroll period to CSV.

### Current limits to note

- Payroll relies on completed/valid punch pairings; incomplete/missing punches are flagged and should be corrected for accurate results.

## Summary

The Operations section currently delivers a full manager workflow for:
- Building and publishing schedules
- Running manager time clock operations with punch editing/import and kiosk/PIN controls
- Managing tip pooling from setup through approval, payout, lock, and dispute handling
- Producing payroll calculations and exports with tip and payout integration

This reflects current implementation only.
