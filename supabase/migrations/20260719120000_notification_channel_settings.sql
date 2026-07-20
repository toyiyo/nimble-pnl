-- Admin per-type x per-channel notification matrix: notification_channel_settings table.
--
-- Single source of truth for the 16 notification types lives in TWO hand-maintained
-- lists that a vitest test (tests/unit/notificationTypes.test.ts) keeps in sync:
--   - src/lib/notificationTypes.ts (NOTIFICATION_TYPES / NotificationType union)
--   - supabase/functions/_shared/resolveChannels.ts (NotificationType union)
-- The CHECK constraint below is the third hand-maintained copy of that same list —
-- review it against those two files whenever a notification type is added/removed.
--
-- See docs/superpowers/specs/2026-07-13-notification-channel-matrix-design.md.

CREATE TABLE IF NOT EXISTS notification_channel_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  notification_type TEXT NOT NULL,
  email_enabled BOOLEAN NOT NULL DEFAULT true,
  push_enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT notification_channel_settings_restaurant_type_unique
    UNIQUE (restaurant_id, notification_type),

  CONSTRAINT notification_channel_settings_type_check
    CHECK (notification_type IN (
      'schedule_published',
      'shift_created',
      'shift_modified',
      'shift_deleted',
      'open_shifts_broadcast',
      'shift_trade_created',
      'shift_trade_accepted',
      'shift_trade_approved',
      'shift_trade_rejected',
      'shift_trade_cancelled',
      'time_off_requested',
      'time_off_approved',
      'time_off_rejected',
      'pin_reset',
      'availability_reminder'
    ))
);

-- Note: no separate single-column index on restaurant_id — the composite UNIQUE
-- constraint above already provides an index usable for a restaurant_id-only lookup
-- (leftmost-column prefix), so a redundant index would just be write-amplification.

-- RLS: verbatim from notification_settings (20251123100500) — any restaurant member
-- can view; only owner/manager can write. Absent-row callers fall through to
-- resolveChannels()'s fail-open default (both channels on), so RLS never needs to be
-- permissive for "no row yet".
ALTER TABLE notification_channel_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view notification channel settings"
  ON notification_channel_settings FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_restaurants
      WHERE user_restaurants.restaurant_id = notification_channel_settings.restaurant_id
      AND user_restaurants.user_id = auth.uid()
    )
  );

CREATE POLICY "Owners and managers can manage notification channel settings"
  ON notification_channel_settings FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM user_restaurants
      WHERE user_restaurants.restaurant_id = notification_channel_settings.restaurant_id
      AND user_restaurants.user_id = auth.uid()
      AND user_restaurants.role IN ('owner', 'manager')
    )
  );

-- updated_at trigger: reuse the same function notification_settings uses, so
-- updated_at actually advances on toggle-saves.
CREATE TRIGGER update_notification_channel_settings_updated_at
  BEFORE UPDATE ON notification_channel_settings
  FOR EACH ROW
  EXECUTE FUNCTION update_scheduling_updated_at();

-- Table-level grants: required as of 20260628000000_grant_user_restaurants_select
-- (local Supabase CLI runs migrations as `postgres`, whose default-privilege entry
-- does NOT include SELECT/INSERT/UPDATE for authenticated/anon/service_role — RLS
-- alone isn't enough, PostgreSQL checks the table ACL before evaluating policies).
-- RLS policies above still control which rows each role can see/write.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.notification_channel_settings TO authenticated;
GRANT SELECT ON public.notification_channel_settings TO anon;
GRANT ALL ON public.notification_channel_settings TO service_role;

COMMENT ON TABLE notification_channel_settings IS 'Per-restaurant, per-notification-type email/push channel toggles (admin matrix). Absent row = both channels on (fail-open, see resolveChannels()).';
COMMENT ON COLUMN notification_channel_settings.notification_type IS 'One of the 15 catalog keys in src/lib/notificationTypes.ts — kept in sync with the CHECK constraint above. (team_invite is excluded: a transactional invite email is always sent, not admin-toggleable.)';
COMMENT ON COLUMN notification_channel_settings.email_enabled IS 'Whether this notification type sends over email for this restaurant.';
COMMENT ON COLUMN notification_channel_settings.push_enabled IS 'Whether this notification type sends over push (web push and/or legacy FCM) for this restaurant.';

-- Data migration: preserve existing choices from the legacy notification_settings
-- single-boolean-per-type columns for the 6 types that were already gated
-- (3 shift + 3 time-off). Types that were never gated (11 others) are left absent,
-- which resolves to "both channels on" via resolveChannels() — unchanged behavior.
-- COALESCE(<legacy>, true): the legacy columns are nullable; NULL must map to
-- true (fail-open), not violate the NOT NULL channel columns.
-- ON CONFLICT DO NOTHING: idempotent re-run safety (should never actually hit,
-- since this table is brand new in this migration).
INSERT INTO notification_channel_settings (restaurant_id, notification_type, email_enabled, push_enabled)
SELECT restaurant_id, 'shift_created', COALESCE(notify_shift_created, true), COALESCE(notify_shift_created, true)
FROM notification_settings
UNION ALL
SELECT restaurant_id, 'shift_modified', COALESCE(notify_shift_modified, true), COALESCE(notify_shift_modified, true)
FROM notification_settings
UNION ALL
SELECT restaurant_id, 'shift_deleted', COALESCE(notify_shift_deleted, true), COALESCE(notify_shift_deleted, true)
FROM notification_settings
UNION ALL
SELECT restaurant_id, 'time_off_requested', COALESCE(notify_time_off_request, true), COALESCE(notify_time_off_request, true)
FROM notification_settings
UNION ALL
SELECT restaurant_id, 'time_off_approved', COALESCE(notify_time_off_approved, true), COALESCE(notify_time_off_approved, true)
FROM notification_settings
UNION ALL
SELECT restaurant_id, 'time_off_rejected', COALESCE(notify_time_off_rejected, true), COALESCE(notify_time_off_rejected, true)
FROM notification_settings
ON CONFLICT (restaurant_id, notification_type) DO NOTHING;
