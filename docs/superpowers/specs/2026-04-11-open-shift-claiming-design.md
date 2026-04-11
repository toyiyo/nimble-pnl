# Open Shift Claiming — Design Spec

**Date:** 2026-04-11
**Status:** Draft

## Problem

Managers set staffing needs (e.g., "need 3 closers") but currently must manually assign every employee. When a manager assigns 1 of 3 needed closers and wants the other 2 spots filled voluntarily, there's no mechanism for employees to see and claim those open spots. Managers resort to texting employees individually.

## Solution

Capacity-based open shift detection with employee self-service claiming. Managers define how many people they need per template. Unfilled spots surface automatically in a unified employee feed alongside existing shift trades. Employees claim spots directly (instant by default, configurable to require approval). Managers can optionally broadcast openings to eligible team members.

## Delivery Plan

Three value-based PRs, each independently useful:

| PR | User Value | Scope |
|----|-----------|-------|
| PR1: Managers can see open shifts | Managers see at a glance where they're short-staffed | Capacity on templates, gap detection, planner indicators |
| PR2: Employees can claim open shifts | Employees pick up extra hours on their own | Unified feed, claim flow, approval config |
| PR3: Managers can broadcast openings | Managers actively recruit for gaps instead of texting | Broadcast action with preview, notifications |

## Architecture

### Database Changes

#### 1. Add `capacity` to `shift_templates`

```sql
ALTER TABLE shift_templates ADD COLUMN capacity INTEGER NOT NULL DEFAULT 1;
ALTER TABLE shift_templates ADD CONSTRAINT valid_capacity CHECK (capacity >= 1);
```

The `capacity` column represents how many employees are needed for this template slot. Current behavior (1 employee per template) is preserved by the default of 1.

#### 2. New table: `open_shift_claims`

Separate from `shift_trades` because the semantics differ: trades are employee-initiated swaps of existing assigned shifts; claims are employee requests for unassigned capacity.

```sql
CREATE TABLE open_shift_claims (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  shift_template_id UUID NOT NULL REFERENCES shift_templates(id) ON DELETE CASCADE,
  shift_date DATE NOT NULL,
  claimed_by_employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'approved'
    CHECK (status IN ('pending_approval', 'approved', 'rejected', 'cancelled')),
  resulting_shift_id UUID REFERENCES shifts(id) ON DELETE SET NULL,
  reviewed_by UUID REFERENCES auth.users(id),
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

Key points:
- `shift_template_id` + `shift_date` identifies which open slot is being claimed
- `status` defaults to `'approved'` (instant claim mode). When approval is required, the insert sets `'pending_approval'` instead
- `resulting_shift_id` links to the actual shift created when the claim is approved — the claim creates a real `shifts` row assigned to the employee
- Unique constraint prevents double-claiming: `UNIQUE(shift_template_id, shift_date, claimed_by_employee_id)`

#### 3. Add `require_shift_claim_approval` to `staffing_settings`

```sql
ALTER TABLE staffing_settings
  ADD COLUMN require_shift_claim_approval BOOLEAN NOT NULL DEFAULT false;
```

Per-restaurant setting. Default `false` = instant claim (manager already expressed the need). Follows the existing pattern of domain-specific settings tables.

#### 4. Add `broadcast_sent_at` tracking

```sql
-- Track which weeks have been broadcasted to avoid duplicate notifications
ALTER TABLE schedule_publications
  ADD COLUMN open_shifts_broadcast_at TIMESTAMPTZ,
  ADD COLUMN open_shifts_broadcast_by UUID REFERENCES auth.users(id);
```

### Open Shift Detection (computed, not stored)

Open shifts are **not stored in a table** — they're computed at query time by comparing template capacity against assigned shifts:

```
open_spots(template, date) = template.capacity - count(shifts matching template on date)
```

A shift "matches" a template when:
- Same `restaurant_id`
- Same `position`
- Overlapping time range (start_time/end_time)
- Date falls on one of the template's `days`
- Shift is not cancelled

This is computed in a SQL function `get_open_shifts(p_restaurant_id, p_week_start, p_week_end)` that returns template + date + open_spots for all templates with unfilled capacity in the date range. Pending claims (status = `'pending_approval'`) count against open spots to prevent over-claiming.

### Data Flow

#### Manager side (PR1)

```
shift_templates.capacity → get_open_shifts() RPC → ShiftPlannerTab
                                                    ├── capacity badge on template headers
                                                    ├── "2/3 assigned" indicators per day cell
                                                    └── publish dialog shows open shift count
```

#### Employee side (PR2)

```
get_open_shifts() + useMarketplaceTrades() → useAvailableShifts() → AvailableShiftsPage
                                                                      ├── OPEN SHIFT cards (from open shifts)
                                                                      ├── TRADE cards (from marketplace trades)
                                                                      └── Claim button → claim_open_shift() RPC
```

#### Broadcast side (PR3)

```
Manager clicks "Broadcast" → BroadcastOpenShiftsDialog
                              ├── preview: which shifts, how many spots
                              ├── preview: eligible employees (position match, no conflicts)
                              └── confirm → broadcast-open-shifts edge function
                                            ├── sends push notification via send-push-notification
                                            ├── sends email via Resend
                                            └── stamps schedule_publications.open_shifts_broadcast_at
```

### Claim Flow Detail

```
Employee taps "Claim Shift"
  → claim_open_shift(p_template_id, p_date, p_employee_id) RPC
    ├── verify open spots remain (capacity - assigned - pending_claims > 0)
    ├── verify no schedule conflict for employee
    ├── verify employee position matches template (if position-restricted)
    ├── check restaurant's require_shift_claim_approval setting
    │   ├── false → status='approved', create shift row, assign employee
    │   └── true  → status='pending_approval', no shift created yet
    └── return claim record
```

Manager approval (when required):
```
Manager approves claim
  → approve_open_shift_claim(p_claim_id) RPC
    ├── create shift row from template + date, assign employee
    ├── update claim: status='approved', resulting_shift_id, reviewed_by/at
    └── notify employee
```

### UI Components

#### PR1: Manager Planner Enhancements

- **Template capacity editor** — In the existing template create/edit dialog, add a "Staff needed" number input (default 1). Maps to `shift_templates.capacity`.
- **Planner cell indicators** — Each day cell for a template shows `assigned/capacity` (e.g., "1/3"). Color-coded: green when full, amber when partially filled, red when empty.
- **Publish dialog enhancement** — Existing `PublishScheduleDialog` gets a line: "N shifts still need staff. You can fill these now or broadcast to your team later."

#### PR2: Employee Available Shifts Feed

- **Unified `AvailableShiftsPage`** — Replaces current `EmployeeShiftMarketplace`. Same route (`/employee/shifts`). Shows both open shifts and trades in a single virtualized list.
- **Open shift card** — Green `OPEN SHIFT` badge, template name, date, time, position, spots remaining, "Claim" button. Grayed out with "Conflict" badge if employee has an overlapping shift.
- **Trade card** — Amber `TRADE` badge (existing design, brought into unified feed).
- **Claim confirmation** — Brief bottom sheet: "Claim Closing Server on Fri Apr 18, 4p–10p?" with Confirm/Cancel.
- **Approval setting hint** — In restaurant staffing settings, a toggle "Require manager approval for shift claims" with helper text: "When off, employees are instantly assigned. When on, claims go to your approval queue."

#### PR3: Broadcast & Notifications

- **BroadcastOpenShiftsDialog** — Shows list of open shifts for the published week, count of eligible employees per shift, "Broadcast to N Team Members" button.
- **Notification** — Push notification (via existing `send-push-notification` function) + email (via Resend). Message: "N shifts are available for the week of [date]. Open the app to claim a spot."
- **Claim tracking** — Manager sees claimed/pending indicators on planner cells. Approval queue tab gets open shift claims alongside trade approvals.

### RLS Policies

#### open_shift_claims
- **SELECT:** Employees can see their own claims. Owners/managers can see all claims for their restaurant.
- **INSERT:** Employees can create claims for their own restaurant (enforced: `claimed_by_employee_id` matches authenticated employee).
- **UPDATE:** Only owners/managers can update status (approve/reject). Employees can cancel their own pending claims.
- **DELETE:** None (use status changes).

**Lesson applied:** Staff users need SELECT on `employees` table to see coworker names in the feed. An RLS policy for this already exists from the shift marketplace null-safety fix (2026-04-11 lesson).

### Conflict Detection

Reuses the existing `useConflictDetection` hook pattern:
- Before showing "Claim" button, check if employee has any shift overlapping the open shift's time range on that date
- If conflict exists, show the card grayed out with a "Schedule conflict" note
- The `claim_open_shift` RPC double-checks server-side (client check is for UX, server check is authoritative)

### Edge Cases

1. **Race condition: two employees claim the last spot simultaneously** — The `claim_open_shift` RPC re-checks capacity inside a transaction. Second claimer gets a "no spots remaining" error.
2. **Manager fills spot manually after employee claims (pending)** — When a shift is manually assigned that fills capacity, pending claims for that slot are auto-rejected.
3. **Template capacity reduced after open shifts posted** — If capacity drops below current assignments, no action needed (existing assignments stay). Open spots recalculate to 0 or negative (clamped to 0 in the view).
4. **Employee cancels a claim** — If instant (already has shift), the resulting shift is deleted. If pending, claim status set to 'cancelled'.
5. **Overnight shifts** — Template with start_time > end_time (e.g., 22:00–06:00) works correctly since capacity is per-template-per-date, not time-based.

### Testing Strategy

| Layer | Tests |
|-------|-------|
| SQL (pgTAP) | `get_open_shifts` returns correct gaps; `claim_open_shift` enforces capacity, conflicts, approval mode; race condition handling; RLS policies |
| Unit (Vitest) | `useAvailableShifts` merges open shifts + trades correctly; conflict detection; capacity computation |
| E2E (Playwright) | PR1: manager sets capacity, sees indicators. PR2: employee views feed, claims shift, sees it on schedule. PR3: manager broadcasts, employee receives notification |
