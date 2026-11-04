-- Add notified_at to schedule_change_logs.
-- Tracks when the notify-shift-changed job sent an alert for a log row.
-- Null means no alert went out yet.
ALTER TABLE schedule_change_logs
  ADD COLUMN IF NOT EXISTS notified_at TIMESTAMPTZ;
