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
 *
 * When the form's wall clock still equals the original punch's rendered wall
 * clock, the manager never touched the time field -- return the stored
 * instant verbatim instead of re-deriving it through `parseWallClock`. This
 * matters at the DST fall-back boundary: a punch stored at, say, the FIRST
 * occurrence of a repeated local hour renders to a wall clock that is
 * genuinely ambiguous, and `parseWallClock` (correctly, matching Postgres)
 * always resolves an ambiguous wall clock to the standard-offset (second)
 * occurrence. Re-parsing an untouched field would silently move that punch
 * by up to an hour.
 */
export function editFormToPunchTime(
  form: PunchEditForm,
  original: { punch_time: string },
  tz: string
): string {
  if (form.punch_time === toWallClockInput(original.punch_time, tz)) {
    return original.punch_time;
  }
  return parseWallClock(form.punch_time, tz);
}
