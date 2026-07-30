import { parseWallClock, toWallClockInput } from '@/lib/restaurantClock';

/** Shape of the punch edit dialog's controlled fields. */
export interface PunchEditForm {
  /** Naive wall clock in the restaurant's zone, for `<input type="datetime-local">`. */
  punch_time: string;
  notes: string;
}

/** Load a stored punch into the edit form, in the restaurant's zone. */
export function punchToEditForm(
  punch: { punch_time: string; notes?: string | null },
  tz: string
): PunchEditForm {
  return {
    punch_time: toWallClockInput(punch.punch_time, tz),
    notes: punch.notes ?? '',
  };
}

/**
 * Convert the form's wall clock back to a UTC instant. Paired with
 * `punchToEditForm` so a save that changed only `notes` is a no-op on the time.
 */
export function editFormToPunchTime(form: PunchEditForm, tz: string): string {
  return parseWallClock(form.punch_time, tz);
}
