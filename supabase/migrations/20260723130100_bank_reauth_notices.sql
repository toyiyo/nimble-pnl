-- Bank re-authentication flow — dedupe ledger + notification type (design §3.2, §3.3).
--
-- Adds bank_reauth_notices, the send ledger the bank-reauth-notices worker
-- (Phase 4 Task 14) uses to dedupe the day_1/day_4/day_10/recovered
-- escalation emails, modelled directly on trial_emails_sent
-- (20260507120000_create_trial_emails_sent.sql). Also adds the
-- 'bank_reauth_required' key to notification_channel_settings's CHECK
-- constraint — the third hand-maintained copy of the notification-type list,
-- alongside supabase/functions/_shared/resolveChannels.ts and
-- src/lib/notificationTypes.ts (Phase 4 Task 3 adds those two).

CREATE TABLE IF NOT EXISTS public.bank_reauth_notices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  connected_bank_id uuid NOT NULL REFERENCES public.connected_banks(id) ON DELETE CASCADE,
  stage text NOT NULL CHECK (stage IN ('day_1', 'day_4', 'day_10', 'recovered')),
  deactivated_at timestamptz NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bank_reauth_notices_once
    UNIQUE (connected_bank_id, stage, deactivated_at)
);

COMMENT ON TABLE public.bank_reauth_notices IS
  'Send ledger for the day_1/day_4/day_10/recovered bank-reauth escalation '
  'emails (bank-reauth-notices worker). deactivated_at is part of the dedupe '
  'key so a later, separate outage on the same bank re-notifies rather than '
  'being suppressed by the first outage''s rows.';

CREATE INDEX IF NOT EXISTS bank_reauth_notices_restaurant_idx
  ON public.bank_reauth_notices (restaurant_id);

-- RLS: service-role writes only (the worker uses the service-role key and
-- bypasses RLS); a single SELECT policy so support tooling / restaurant
-- members can read the send history. No INSERT/UPDATE/DELETE policy for
-- authenticated users.
ALTER TABLE public.bank_reauth_notices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Restaurant members can view bank reauth notices"
  ON public.bank_reauth_notices FOR SELECT
  USING (public.user_has_restaurant_access(restaurant_id));

-- Table-level grants: required as of 20260628000000_grant_user_restaurants_select
-- (local Supabase CLI runs migrations as `postgres`, whose default-privilege
-- entry does NOT include SELECT/INSERT/UPDATE for authenticated/anon/
-- service_role — RLS alone isn't enough, PostgreSQL checks the table ACL
-- before evaluating policies). Without this GRANT the SELECT above fails with
-- "permission denied" before RLS is even evaluated, so a policy-only test
-- would pass vacuously.
GRANT SELECT ON public.bank_reauth_notices TO authenticated;
GRANT ALL    ON public.bank_reauth_notices TO service_role;

-- ============================================================
-- Notification type: add 'bank_reauth_required' to the CHECK constraint.
-- Third copy of the catalog — see src/lib/notificationTypes.ts and
-- supabase/functions/_shared/resolveChannels.ts for the other two.
-- ============================================================

-- Re-lists all 16 existing keys (15 from 20260719120000 + open_shift_claim_reviewed
-- from 20260721000000_open_shift_claim_notify.sql) plus the new bank_reauth_required
-- key = 17. A CHECK constraint can't be ALTERed in place; drop + re-add, matching
-- the pattern 20260721000000 already established for this same constraint.
ALTER TABLE public.notification_channel_settings
  DROP CONSTRAINT IF EXISTS notification_channel_settings_type_check;

ALTER TABLE public.notification_channel_settings
  ADD CONSTRAINT notification_channel_settings_type_check
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
      'availability_reminder',
      'open_shift_claim_reviewed',
      'bank_reauth_required'
    ));

COMMENT ON COLUMN public.notification_channel_settings.notification_type IS
  'One of the 17 catalog keys in src/lib/notificationTypes.ts — kept in sync '
  'with the CHECK constraint above. (team_invite is excluded: a transactional '
  'invite email is always sent, not admin-toggleable.)';
