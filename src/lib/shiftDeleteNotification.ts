/**
 * Client-side helper deciding whether a deleted shift should trigger an
 * employee-facing "shift removed" notification, and building the invoke
 * body for the `send-shift-notification` edge function.
 *
 * The edge function looks up the employee's email/user_id server-side by
 * `employee_id` (never trusts client-supplied identity), so this body
 * intentionally carries only display-ish/lookup fields — never email or
 * user_id.
 */

export interface DeletableShift {
  id: string;
  restaurant_id: string;
  // Widened beyond the real Shift type (Shift.employee_id is non-nullable string,
  // is_published non-nullable boolean) ON PURPOSE — defensive against open/unassigned
  // and draft shifts. The null/undefined branches are exercised by tests; do NOT
  // "tighten" these back to match Shift or the guard branches become dead.
  employee_id: string | null;
  is_published?: boolean | null;
  position: string;
  start_time: string;
  end_time: string;
}

export interface ShiftDeletedInvokeBody {
  shiftId: string;
  action: 'deleted';
  deletedShift: {
    restaurant_id: string;
    employee_id: string;
    position: string;
    start_time: string;
    end_time: string;
  };
}

/**
 * Returns the invoke body iff the deleted shift was published AND had an
 * assigned employee; else null (drafts and open/unassigned shifts never
 * notify).
 *
 * Gate is `is_published` — the semantic "was the employee already told
 * about this shift?" predicate — NOT `locked` (an editing concern).
 * publish/unpublish set both flags in lockstep (publish_schedule /
 * unpublish_schedule), so this is safe today; a unit test documents that
 * assumption so a future divergence is caught.
 */
export function buildShiftDeletedInvoke(shift: DeletableShift): ShiftDeletedInvokeBody | null {
  if (!shift.is_published || !shift.employee_id) {
    return null;
  }

  return {
    shiftId: shift.id,
    action: 'deleted',
    deletedShift: {
      restaurant_id: shift.restaurant_id,
      employee_id: shift.employee_id,
      position: shift.position,
      start_time: shift.start_time,
      end_time: shift.end_time,
    },
  };
}
