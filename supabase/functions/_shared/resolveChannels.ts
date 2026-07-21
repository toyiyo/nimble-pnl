// Shared per-type × per-channel notification gate. Every notification-sending
// edge function should call this before sending on each channel, replacing the
// old combined `shouldSendNotification` boolean.
//
// Keep this `NotificationType` union in sync with `src/lib/notificationTypes.ts`
// (asserted by tests/unit/notificationTypes.test.ts) and with the
// `notification_channel_settings` CHECK constraint in the migration.
//
// See docs/superpowers/specs/2026-07-13-notification-channel-matrix-design.md.

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
  | 'availability_reminder'
  | 'open_shift_claim_reviewed';

export interface ChannelDecision {
  email: boolean;
  push: boolean;
}

interface ChannelSettingsRow {
  email_enabled: boolean;
  push_enabled: boolean;
}

/**
 * Minimal structural shape of the Supabase client subset `resolveChannels`
 * needs. Deliberately NOT the real `SupabaseClient` type from
 * `https://esm.sh/@supabase/supabase-js@2` — that import specifier can't be
 * resolved under vitest/Node, and this file needs to be directly unit-testable
 * (mirrors the pattern already used by `_shared/availabilityReminderHandler.ts`).
 * Any real `SupabaseClient` (service-role or user-scoped) satisfies this shape.
 */
export interface SupabaseLike {
  from: (table: string) => {
    select: (columns: string) => {
      eq: (column: string, value: unknown) => {
        eq: (column: string, value: unknown) => {
          maybeSingle: () => Promise<{ data: ChannelSettingsRow | null; error: unknown }>;
        };
      };
    };
  };
}

/**
 * Restaurant-level channel decision for a notification type.
 *
 * Fail-OPEN: a missing row or a query error both resolve to `{ email: true,
 * push: true }` — matching today's `shouldSendNotification` default. This is
 * intentional (see design doc "Decided trade-offs"): a restaurant that never
 * configured the matrix, or a transient DB error, must never silently drop a
 * notification.
 */
export async function resolveChannels(
  supabase: SupabaseLike,
  restaurantId: string,
  type: NotificationType,
): Promise<ChannelDecision> {
  const { data, error } = await supabase
    .from('notification_channel_settings')
    .select('email_enabled, push_enabled')
    .eq('restaurant_id', restaurantId)
    .eq('notification_type', type)
    .maybeSingle();

  if (error || !data) {
    return { email: true, push: true };
  }

  return { email: data.email_enabled, push: data.push_enabled };
}
