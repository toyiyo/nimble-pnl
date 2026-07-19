// Single source of truth for the admin notification channel matrix (Settings →
// Notifications). Every currently-firing notification type is listed here with
// its display metadata; `supabase/functions/_shared/resolveChannels.ts` holds an
// independent `NotificationType` union that MUST list the same keys — a vitest
// test in tests/unit/notificationTypes.test.ts asserts the two stay in sync, and
// the `notification_channel_settings` table's CHECK constraint is hand-reviewed
// against this same list. See docs/superpowers/specs/2026-07-13-notification-
// channel-matrix-design.md for the full design.
//
// `weekly_brief` is intentionally NOT a row here — it stays on the per-user
// `notification_preferences` table, out of scope for this admin matrix.

export type NotificationType =
  | 'schedule_published'
  | 'shift_created'
  | 'shift_modified'
  | 'shift_deleted'
  | 'open_shifts_broadcast'
  | 'shift_trade_created'
  | 'shift_trade_accepted'
  | 'shift_trade_approved'
  | 'shift_trade_rejected'
  | 'shift_trade_cancelled'
  | 'time_off_requested'
  | 'time_off_approved'
  | 'time_off_rejected'
  | 'pin_reset'
  | 'team_invite'
  | 'availability_reminder';

export type NotificationChannel = 'email' | 'push';

export type NotificationGroup = 'Scheduling' | 'Trades' | 'Time off' | 'Access';

export interface NotificationTypeDef {
  key: NotificationType;
  label: string;
  group: NotificationGroup;
  /** Channels this type actually sends on. A channel absent here renders as a
   *  disabled "—" cell in the matrix UI — never a live toggle for a channel the
   *  sending function doesn't use. */
  channels: NotificationChannel[];
}

export const NOTIFICATION_TYPES: NotificationTypeDef[] = [
  { key: 'schedule_published', label: 'Schedule published', group: 'Scheduling', channels: ['email', 'push'] },
  { key: 'shift_created', label: 'Shift created', group: 'Scheduling', channels: ['email', 'push'] },
  { key: 'shift_modified', label: 'Shift modified', group: 'Scheduling', channels: ['email', 'push'] },
  { key: 'shift_deleted', label: 'Shift deleted', group: 'Scheduling', channels: ['email', 'push'] },
  { key: 'open_shifts_broadcast', label: 'Open shift broadcast', group: 'Scheduling', channels: ['email', 'push'] },
  { key: 'availability_reminder', label: 'Availability reminder', group: 'Scheduling', channels: ['email'] },
  { key: 'shift_trade_created', label: 'Shift trade requested', group: 'Trades', channels: ['email', 'push'] },
  { key: 'shift_trade_accepted', label: 'Shift trade accepted', group: 'Trades', channels: ['email', 'push'] },
  { key: 'shift_trade_approved', label: 'Shift trade approved', group: 'Trades', channels: ['email', 'push'] },
  { key: 'shift_trade_rejected', label: 'Shift trade rejected', group: 'Trades', channels: ['email', 'push'] },
  { key: 'shift_trade_cancelled', label: 'Shift trade cancelled', group: 'Trades', channels: ['email', 'push'] },
  { key: 'time_off_requested', label: 'Time off requested', group: 'Time off', channels: ['email'] },
  { key: 'time_off_approved', label: 'Time off approved', group: 'Time off', channels: ['email', 'push'] },
  { key: 'time_off_rejected', label: 'Time off rejected', group: 'Time off', channels: ['email', 'push'] },
  { key: 'pin_reset', label: 'PIN reset', group: 'Access', channels: ['email', 'push'] },
  { key: 'team_invite', label: 'Team invitation', group: 'Access', channels: ['email'] },
];
