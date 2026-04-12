# Open Shift Claiming PR2 — Employees Can Find and Claim Open Shifts

**Date:** 2026-04-11
**Status:** Draft
**Parent spec:** `docs/superpowers/specs/2026-04-11-open-shift-claiming-design.md`
**Depends on:** PR1 (merged — capacity column on shift_templates), area column on shift_templates (merged)

## Problem

Managers can see where they're short-staffed (PR1), but employees have no way to voluntarily pick up those open shifts. Managers must manually assign every employee or text people individually.

## Solution

A unified "Available Shifts" feed for employees that merges open shifts (from template capacity gaps) with existing shift trades. Employees can claim open shifts directly. The feature is opt-in per restaurant — managers enable it when ready, preventing unintended exposure of planning-stage gaps.

## Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Feature gate | `open_shifts_enabled` on `staffing_settings`, default **false** | Managers may intentionally under-staff; don't surface gaps without consent |
| Open shift visibility | Published weeks only | Unpublished schedules are still being planned |
| Open shift computation | Server-side SQL RPC | Atomic capacity checks, clean RLS, prevents race conditions |
| Approval flow | Configurable per restaurant, default instant | Manager already expressed the need via capacity; approval adds friction |
| Onboarding | Publish dialog nudge (B) + settings page callout (C) | Contextual discovery when relevant, settings for configuration |

## Database Changes

### 1. New table: `open_shift_claims`

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

-- Prevent same employee claiming same template/date twice
CREATE UNIQUE INDEX idx_unique_active_claim
  ON open_shift_claims (shift_template_id, shift_date, claimed_by_employee_id)
  WHERE status IN ('pending_approval', 'approved');

-- Query indexes
CREATE INDEX idx_claims_restaurant ON open_shift_claims (restaurant_id);
CREATE INDEX idx_claims_employee ON open_shift_claims (claimed_by_employee_id);
CREATE INDEX idx_claims_status ON open_shift_claims (restaurant_id, status);
```

### 2. Add settings columns to `staffing_settings`

```sql
ALTER TABLE staffing_settings
  ADD COLUMN open_shifts_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN require_shift_claim_approval BOOLEAN NOT NULL DEFAULT false;
```

### 3. RLS policies on `open_shift_claims`

```sql
-- Employees see their own claims
CREATE POLICY "Employees can view own claims"
  ON open_shift_claims FOR SELECT
  USING (claimed_by_employee_id IN (
    SELECT id FROM employees WHERE user_id = auth.uid()
  ));

-- Managers see all claims for their restaurant
CREATE POLICY "Managers can view restaurant claims"
  ON open_shift_claims FOR SELECT
  USING (restaurant_id IN (
    SELECT restaurant_id FROM restaurant_members
    WHERE user_id = auth.uid() AND role IN ('owner', 'manager')
  ));

-- Employees can create claims for themselves
CREATE POLICY "Employees can create claims"
  ON open_shift_claims FOR INSERT
  WITH CHECK (claimed_by_employee_id IN (
    SELECT id FROM employees WHERE user_id = auth.uid()
  ));

-- Employees can cancel their own pending claims
CREATE POLICY "Employees can cancel own pending claims"
  ON open_shift_claims FOR UPDATE
  USING (
    claimed_by_employee_id IN (SELECT id FROM employees WHERE user_id = auth.uid())
    AND status = 'pending_approval'
  );

-- Managers can approve/reject
CREATE POLICY "Managers can review claims"
  ON open_shift_claims FOR UPDATE
  USING (restaurant_id IN (
    SELECT restaurant_id FROM restaurant_members
    WHERE user_id = auth.uid() AND role IN ('owner', 'manager')
  ));
```

### 4. SQL RPC: `get_open_shifts`

```sql
CREATE OR REPLACE FUNCTION get_open_shifts(
  p_restaurant_id UUID,
  p_week_start DATE,
  p_week_end DATE
) RETURNS TABLE (
  template_id UUID,
  template_name TEXT,
  shift_date DATE,
  start_time TIME,
  end_time TIME,
  position TEXT,
  capacity INT,
  assigned_count BIGINT,
  pending_claims BIGINT,
  open_spots BIGINT
) AS $$
BEGIN
  -- Only return open shifts for published weeks when feature is enabled
  IF NOT EXISTS (
    SELECT 1 FROM staffing_settings
    WHERE restaurant_id = p_restaurant_id AND open_shifts_enabled = true
  ) THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH published_dates AS (
    -- Only dates within published schedule ranges
    SELECT DISTINCT d::date AS pub_date
    FROM schedule_publications sp,
         generate_series(sp.week_start, sp.week_end, '1 day'::interval) d
    WHERE sp.restaurant_id = p_restaurant_id
      AND d::date BETWEEN p_week_start AND p_week_end
  ),
  template_days AS (
    SELECT
      st.id AS tid,
      st.name,
      st.start_time,
      st.end_time,
      st.position,
      st.capacity,
      pd.pub_date
    FROM shift_templates st
    CROSS JOIN published_dates pd
    WHERE st.restaurant_id = p_restaurant_id
      AND st.is_active = true
      AND st.capacity > 1
      AND EXTRACT(DOW FROM pd.pub_date)::int = ANY(st.days)
  ),
  assigned AS (
    SELECT td.tid, td.pub_date, COUNT(s.id) AS cnt
    FROM template_days td
    LEFT JOIN shifts s ON s.restaurant_id = p_restaurant_id
      AND s.position = td.position
      AND s.start_time::time = td.start_time
      AND s.end_time::time = td.end_time
      AND s.start_time::date = td.pub_date
      AND s.status != 'cancelled'
    GROUP BY td.tid, td.pub_date
  ),
  pending AS (
    SELECT td.tid, td.pub_date, COUNT(c.id) AS cnt
    FROM template_days td
    LEFT JOIN open_shift_claims c ON c.shift_template_id = td.tid
      AND c.shift_date = td.pub_date
      AND c.status = 'pending_approval'
    GROUP BY td.tid, td.pub_date
  )
  SELECT
    td.tid,
    td.name,
    td.pub_date,
    td.start_time,
    td.end_time,
    td.position,
    td.capacity,
    COALESCE(a.cnt, 0),
    COALESCE(p.cnt, 0),
    GREATEST(0, td.capacity - COALESCE(a.cnt, 0) - COALESCE(p.cnt, 0))
  FROM template_days td
  LEFT JOIN assigned a ON a.tid = td.tid AND a.pub_date = td.pub_date
  LEFT JOIN pending p ON p.tid = td.tid AND p.pub_date = td.pub_date
  WHERE td.capacity - COALESCE(a.cnt, 0) - COALESCE(p.cnt, 0) > 0;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

### 5. SQL RPC: `claim_open_shift`

```sql
CREATE OR REPLACE FUNCTION claim_open_shift(
  p_restaurant_id UUID,
  p_template_id UUID,
  p_shift_date DATE,
  p_employee_id UUID
) RETURNS JSON AS $$
DECLARE
  v_template shift_templates%ROWTYPE;
  v_capacity INT;
  v_assigned INT;
  v_pending INT;
  v_open INT;
  v_require_approval BOOLEAN;
  v_claim_id UUID;
  v_shift_id UUID;
  v_conflict BOOLEAN;
BEGIN
  -- 1. Lock and fetch template
  SELECT * INTO v_template
  FROM shift_templates
  WHERE id = p_template_id AND restaurant_id = p_restaurant_id AND is_active = true
  FOR SHARE;

  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Template not found');
  END IF;

  -- 2. Verify the date falls on a template day
  IF NOT (EXTRACT(DOW FROM p_shift_date)::int = ANY(v_template.days)) THEN
    RETURN json_build_object('success', false, 'error', 'Template does not apply to this date');
  END IF;

  -- 3. Check remaining capacity
  SELECT COUNT(*) INTO v_assigned
  FROM shifts
  WHERE restaurant_id = p_restaurant_id
    AND position = v_template.position
    AND start_time::time = v_template.start_time
    AND end_time::time = v_template.end_time
    AND start_time::date = p_shift_date
    AND status != 'cancelled';

  SELECT COUNT(*) INTO v_pending
  FROM open_shift_claims
  WHERE shift_template_id = p_template_id
    AND shift_date = p_shift_date
    AND status = 'pending_approval';

  v_open := v_template.capacity - v_assigned - v_pending;

  IF v_open <= 0 THEN
    RETURN json_build_object('success', false, 'error', 'No open spots remaining');
  END IF;

  -- 4. Check schedule conflict
  SELECT EXISTS (
    SELECT 1 FROM shifts
    WHERE employee_id = p_employee_id
      AND status != 'cancelled'
      AND start_time::date = p_shift_date
      AND (
        (start_time::time, end_time::time) OVERLAPS
        (v_template.start_time, v_template.end_time)
      )
  ) INTO v_conflict;

  IF v_conflict THEN
    RETURN json_build_object('success', false, 'error', 'Schedule conflict with existing shift');
  END IF;

  -- 5. Check approval setting
  SELECT COALESCE(require_shift_claim_approval, false) INTO v_require_approval
  FROM staffing_settings
  WHERE restaurant_id = p_restaurant_id;

  -- 6. Create claim
  IF v_require_approval THEN
    INSERT INTO open_shift_claims (restaurant_id, shift_template_id, shift_date, claimed_by_employee_id, status)
    VALUES (p_restaurant_id, p_template_id, p_shift_date, p_employee_id, 'pending_approval')
    RETURNING id INTO v_claim_id;

    RETURN json_build_object(
      'success', true,
      'claim_id', v_claim_id,
      'status', 'pending_approval',
      'message', 'Claim submitted for manager approval'
    );
  ELSE
    -- Instant: create shift + approved claim
    INSERT INTO shifts (restaurant_id, employee_id, start_time, end_time, position, break_duration, status, is_published, locked, source)
    VALUES (
      p_restaurant_id,
      p_employee_id,
      (p_shift_date || ' ' || v_template.start_time)::timestamptz,
      (p_shift_date || ' ' || v_template.end_time)::timestamptz,
      v_template.position,
      v_template.break_duration,
      'scheduled',
      true,
      false,
      'claimed'
    )
    RETURNING id INTO v_shift_id;

    INSERT INTO open_shift_claims (restaurant_id, shift_template_id, shift_date, claimed_by_employee_id, status, resulting_shift_id)
    VALUES (p_restaurant_id, p_template_id, p_shift_date, p_employee_id, 'approved', v_shift_id)
    RETURNING id INTO v_claim_id;

    RETURN json_build_object(
      'success', true,
      'claim_id', v_claim_id,
      'shift_id', v_shift_id,
      'status', 'approved',
      'message', 'Shift claimed successfully'
    );
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

### 6. SQL RPC: `approve_open_shift_claim` / `reject_open_shift_claim`

```sql
CREATE OR REPLACE FUNCTION approve_open_shift_claim(
  p_claim_id UUID,
  p_reviewer_note TEXT DEFAULT NULL
) RETURNS JSON AS $$
DECLARE
  v_claim open_shift_claims%ROWTYPE;
  v_template shift_templates%ROWTYPE;
  v_shift_id UUID;
BEGIN
  SELECT * INTO v_claim FROM open_shift_claims WHERE id = p_claim_id FOR UPDATE;
  IF NOT FOUND OR v_claim.status != 'pending_approval' THEN
    RETURN json_build_object('success', false, 'error', 'Claim not found or not pending');
  END IF;

  SELECT * INTO v_template FROM shift_templates WHERE id = v_claim.shift_template_id;

  -- Create the shift
  INSERT INTO shifts (restaurant_id, employee_id, start_time, end_time, position, break_duration, status, is_published, locked, source)
  VALUES (
    v_claim.restaurant_id,
    v_claim.claimed_by_employee_id,
    (v_claim.shift_date || ' ' || v_template.start_time)::timestamptz,
    (v_claim.shift_date || ' ' || v_template.end_time)::timestamptz,
    v_template.position,
    v_template.break_duration,
    'scheduled',
    true,
    false,
    'claimed'
  )
  RETURNING id INTO v_shift_id;

  -- Update claim
  UPDATE open_shift_claims
  SET status = 'approved',
      resulting_shift_id = v_shift_id,
      reviewed_by = auth.uid(),
      reviewed_at = NOW()
  WHERE id = p_claim_id;

  RETURN json_build_object('success', true, 'shift_id', v_shift_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION reject_open_shift_claim(
  p_claim_id UUID,
  p_reviewer_note TEXT DEFAULT NULL
) RETURNS JSON AS $$
BEGIN
  UPDATE open_shift_claims
  SET status = 'rejected',
      reviewed_by = auth.uid(),
      reviewed_at = NOW()
  WHERE id = p_claim_id AND status = 'pending_approval';

  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Claim not found or not pending');
  END IF;

  RETURN json_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

## UI Components

### Employee: Unified Available Shifts Page

Replaces `EmployeeShiftMarketplace` at route `/employee/shifts`.

**Layout:**
- Page header: "Available Shifts" with count badge
- Virtualized list (per CLAUDE.md performance rules) with two card types:
  - **Open Shift card** — Green `OPEN SHIFT` badge, template name, date, time range, position, spots remaining ("2 spots left"), "Claim" button. Grayed out with "Schedule conflict" note when employee has overlapping shift.
  - **Trade card** — Amber `TRADE` badge, existing marketplace design brought into unified feed.
- Empty state when no open shifts or trades available

**Claim flow:**
1. Employee taps "Claim"
2. Confirmation dialog: "Claim [Template Name] on [Date], [Time]?" with Confirm/Cancel
3. On confirm: call `claim_open_shift` RPC
4. Success: toast "Shift claimed!" (instant) or "Claim submitted for approval" (pending)
5. Card updates or removes from list

### Employee: My Claims section

Below the available shifts feed, a collapsible "My Claims" section showing:
- Pending claims (amber badge, with "Cancel" option)
- Recently approved claims (green badge)
- Recently rejected claims (red badge, with reason if provided)

### Manager: Approval Setting

In the staffing settings panel (existing `StaffingConfigPanel`):
- **"Open Shift Claiming" section** with:
  - Toggle: "Allow employees to claim open shifts" (`open_shifts_enabled`)
  - When enabled, sub-toggle: "Require manager approval for claims" (`require_shift_claim_approval`)
  - Helper text for each toggle explaining the behavior
- First-enable explanation: brief inline note when toggling on for the first time: "Employees will be able to see and claim unfilled shifts after you publish. You control which shifts are open through template capacity."

### Manager: Publish Dialog Nudge

When `open_shifts_enabled` is false and `openShiftCount > 0`, the existing amber alert in `PublishScheduleDialog` changes to:
> "N shifts still need staff. Want employees to fill these? [Enable open shift claiming →]"

Link goes to staffing settings. When feature is already enabled, shows the current message: "You can fill these now or broadcast to your team later."

### Manager: Pending Claims in Approval Queue

The existing "Trades" tab on the scheduling page shows trade approvals. Add open shift claim approvals alongside them with a distinct badge ("CLAIM" vs "TRADE").

## Hooks

- `useOpenShifts(restaurantId)` — calls `get_open_shifts` RPC, returns open shifts for current/next week
- `useClaimOpenShift()` — mutation calling `claim_open_shift` RPC, invalidates open shifts + employee schedule
- `useOpenShiftClaims(restaurantId, employeeId?)` — fetches claims, used by both employee (own) and manager (all)
- `useApproveClaimMutation()` / `useRejectClaimMutation()` — manager actions
- `useAvailableShifts(restaurantId, employeeId)` — merges `useOpenShifts` + `useMarketplaceTrades` into unified sorted feed
- `useStaffingSettings(restaurantId)` — extends existing hook to include new boolean columns

## Conflict Detection

Before rendering "Claim" button, check employee's existing shifts for the same date/time overlap. This is a client-side UX hint — the RPC double-checks server-side.

Reuse existing `useConflictDetection` pattern or compute inline from the employee's schedule data.

## Edge Cases

1. **Race condition** — Two employees claim last spot simultaneously. RPC uses `FOR SHARE` lock on template row; second claim gets "No open spots remaining."
2. **Manager fills manually** — Manager assigns employee to a shift that fills capacity. Pending claims for that slot are NOT auto-rejected (they may be for a different person). The `get_open_shifts` RPC simply stops returning that slot.
3. **Employee cancels claim** — If status is `pending_approval`, set to `cancelled`. If status is `approved` (instant mode), delete the resulting shift and set claim to `cancelled`.
4. **Template capacity reduced** — Open spots clamp to 0. Existing claims unaffected.
5. **Overnight shifts** — Template start_time > end_time (e.g., 22:00-06:00). The conflict detection and shift creation handle this via the existing shift model.

## Testing Strategy

| Layer | Tests |
|-------|-------|
| pgTAP | `get_open_shifts` returns correct gaps for published weeks only; `claim_open_shift` enforces capacity, conflicts, approval mode; race condition handling; RLS policies; feature gate check |
| Unit (Vitest) | `useAvailableShifts` merges open shifts + trades; conflict detection; settings hook |
| E2E (Playwright) | Employee views unified feed, claims shift, sees on schedule; manager enables feature, sets approval, approves claim |
