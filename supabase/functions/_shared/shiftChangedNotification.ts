/**
 * Pure derive/validity logic for the "your published shift changed"
 * notification (design doc, "Change: the notification").
 *
 * Kept import-free of Deno-only modules so vitest can exercise it directly,
 * the same precedent as shiftDeletedNotification.ts. The edge function
 * (notify-shift-changed/index.ts) owns the DB reads, the auth/capability
 * checks, the notified_at latch, and the actual send.
 */

export interface ShiftChangeLogRow {
  id: string;
  restaurant_id: string;
  shift_id: string | null;
  change_type: string;
  changed_at: string; // ISO
  before_data: Record<string, unknown> | null;
  after_data: Record<string, unknown> | null;
}

export type ShiftChangeValidity =
  | { valid: true }
  | { valid: false; reason: 'too-old' | 'wrong-change-type' | 'no-shift-id' };

const MAX_AGE_MS = 10 * 60 * 1000;

/**
 * Design step 4: refuse rows that are too old, the wrong kind of change, or
 * restaurant-level (no shift_id — the `unpublished` change_type has none,
 * see 20251123000000_schedule_publishing.sql:243-259, and is not a valid
 * target here).
 */
export function checkShiftChangeValidity(
  row: Pick<ShiftChangeLogRow, 'change_type' | 'changed_at' | 'shift_id'>,
  now: Date = new Date(),
): ShiftChangeValidity {
  if (row.change_type !== 'updated' && row.change_type !== 'deleted') {
    return { valid: false, reason: 'wrong-change-type' };
  }
  if (!row.shift_id) {
    return { valid: false, reason: 'no-shift-id' };
  }
  const ageMs = now.getTime() - new Date(row.changed_at).getTime();
  if (ageMs > MAX_AGE_MS) {
    return { valid: false, reason: 'too-old' };
  }
  return { valid: true };
}

export type ShiftChangeRole = 'removed' | 'assigned' | 'updated';

export interface ShiftChangeRecipient {
  employeeId: string;
  role: ShiftChangeRole;
}

const employeeIdOf = (data: Record<string, unknown> | null | undefined): string | null => {
  const id = data?.employee_id;
  return typeof id === 'string' ? id : null;
};

/**
 * Design steps 6-7: derive who to tell and what happened to each of them,
 * from the row alone. `before_data.employee_id` plus `after_data.employee_id`
 * when different (reassignment). An open shift (both sides null) yields no
 * recipients.
 */
export function deriveShiftChangeRecipients(
  row: Pick<ShiftChangeLogRow, 'change_type' | 'before_data' | 'after_data'>,
): ShiftChangeRecipient[] {
  const beforeId = employeeIdOf(row.before_data);
  const afterId = employeeIdOf(row.after_data);

  if (row.change_type === 'deleted') {
    return beforeId ? [{ employeeId: beforeId, role: 'removed' }] : [];
  }

  // updated
  if (beforeId && afterId && beforeId !== afterId) {
    return [
      { employeeId: beforeId, role: 'removed' },
      { employeeId: afterId, role: 'assigned' },
    ];
  }
  const sameId = afterId ?? beforeId;
  return sameId ? [{ employeeId: sameId, role: 'updated' }] : [];
}

export interface ShiftChangeMessage {
  title: string;
  body: string;
}

const formatWeekdayTime = (iso: string, timeZone: string): string =>
  new Date(iso).toLocaleString('en-US', {
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit',
    timeZone,
  });

const formatTimeOnly = (iso: string, timeZone: string): string =>
  new Date(iso).toLocaleString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone,
  });

/**
 * Design step 8: the concrete per-recipient message, e.g. "Your Tue 5:00 PM
 * shift changed to 6:00 PM", "Your Tue shift was removed", "You have a new
 * shift".
 */
export function buildShiftChangeMessage(
  recipient: ShiftChangeRecipient,
  row: Pick<ShiftChangeLogRow, 'before_data' | 'after_data'>,
  timeZone: string,
): ShiftChangeMessage {
  if (recipient.role === 'removed') {
    const start = row.before_data?.start_time;
    const when = typeof start === 'string' ? formatWeekdayTime(start, timeZone) : '';
    return {
      title: 'Shift Removed',
      body: when ? `Your ${when} shift was removed.` : 'Your shift was removed.',
    };
  }
  if (recipient.role === 'assigned') {
    return { title: 'New Shift Assigned', body: 'You have a new shift.' };
  }
  // updated
  const oldStart = row.before_data?.start_time;
  const newStart = row.after_data?.start_time;
  const oldEnd = row.before_data?.end_time;
  const newEnd = row.after_data?.end_time;
  if (typeof oldStart === 'string' && typeof newStart === 'string') {
    const oldWhen = formatWeekdayTime(oldStart, timeZone);
    if (oldStart !== newStart) {
      const newWhen = formatTimeOnly(newStart, timeZone);
      return { title: 'Shift Updated', body: `Your ${oldWhen} shift changed to ${newWhen}.` };
    }
    // Start unchanged. "changed to <same time>" would read as no change,
    // so name the part that moved.
    if (typeof oldEnd === 'string' && typeof newEnd === 'string' && oldEnd !== newEnd) {
      const newEndWhen = formatTimeOnly(newEnd, timeZone);
      return { title: 'Shift Updated', body: `Your ${oldWhen} shift now ends at ${newEndWhen}.` };
    }
    return { title: 'Shift Updated', body: `Your ${oldWhen} shift was updated.` };
  }
  return { title: 'Shift Updated', body: 'Your shift changed.' };
}
