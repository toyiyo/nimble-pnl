// Single source of truth mapping each firing function's request-body `action`
// (or, for send-team-invitation/notify-pin-changed/notify-availability-reminder,
// their one implicit action) onto the matrix's `NotificationType` catalog key.
// Consumed by the retrofitted edge functions in Task 3 of the notification-
// channel-matrix feature; kept here (rather than duplicated per-function) so a
// single vitest suite (tests/unit/notificationActionTypes.test.ts) can assert
// every mapped value is a real catalog key with the channels the function
// actually gates.
//
// See docs/superpowers/specs/2026-07-13-notification-channel-matrix-design.md.

import type { NotificationType } from './resolveChannels.ts';

export const SHIFT_ACTION_TYPE: Record<'created' | 'modified' | 'deleted', NotificationType> = {
  created: 'shift_created',
  modified: 'shift_modified',
  deleted: 'shift_deleted',
};

export const TRADE_ACTION_TYPE: Record<
  'created' | 'accepted' | 'approved' | 'rejected' | 'cancelled',
  NotificationType
> = {
  created: 'shift_trade_created',
  accepted: 'shift_trade_accepted',
  approved: 'shift_trade_approved',
  rejected: 'shift_trade_rejected',
  cancelled: 'shift_trade_cancelled',
};

export const TIME_OFF_ACTION_TYPE: Record<'created' | 'approved' | 'rejected', NotificationType> = {
  created: 'time_off_requested',
  approved: 'time_off_approved',
  rejected: 'time_off_rejected',
};
