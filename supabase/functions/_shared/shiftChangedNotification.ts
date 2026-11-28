/**
 * Validity check for the "your published shift changed" notification
 * (docs/superpowers/specs/2026-08-15-quiet-publish-live-edit-design.md).
 *
 * The recipients and the message now come from the notification ledger:
 * schedule_change_recipients() in SQL and buildChangeLines() in
 * scheduleNotificationDelivery.ts
 * (docs/superpowers/specs/2026-11-28-mcp-publish-notifications-design.md).
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
