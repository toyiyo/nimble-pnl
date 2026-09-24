-- Shift Protection: per-restaurant policy columns on staffing_settings.
--
-- Eight columns, one per rule knob. Every mode column is NOT NULL — a NULL
-- mode would make `mode != 'off'` evaluate to NULL and hide the rule
-- silently. All defaults are 'off'/false, so existing restaurants see no
-- behavior change until they opt in.
--
-- No RLS change: the staffing_settings write policy already gates on
-- user_has_capability(restaurant_id, 'edit:scheduling')
-- (20260730150000_rewrite_collaborator_policies.sql), which matches the
-- capability gate on the new settings dialog.
--
-- Design: docs/superpowers/specs/2026-09-03-shift-protection-design.md

ALTER TABLE staffing_settings
  ADD COLUMN IF NOT EXISTS trade_deadline_mode TEXT NOT NULL DEFAULT 'off'
    CONSTRAINT staffing_settings_trade_deadline_mode_check
    CHECK (trade_deadline_mode IN ('off', 'warn', 'block')),
  ADD COLUMN IF NOT EXISTS trade_deadline_hours INTEGER NOT NULL DEFAULT 24
    CONSTRAINT staffing_settings_trade_deadline_hours_check
    CHECK (trade_deadline_hours > 0),
  ADD COLUMN IF NOT EXISTS trade_auto_expire BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS timeoff_notice_mode TEXT NOT NULL DEFAULT 'off'
    CONSTRAINT staffing_settings_timeoff_notice_mode_check
    CHECK (timeoff_notice_mode IN ('off', 'warn', 'block')),
  ADD COLUMN IF NOT EXISTS timeoff_notice_days INTEGER NOT NULL DEFAULT 7
    CONSTRAINT staffing_settings_timeoff_notice_days_check
    CHECK (timeoff_notice_days > 0),
  ADD COLUMN IF NOT EXISTS timeoff_sameday_mode TEXT NOT NULL DEFAULT 'off'
    CONSTRAINT staffing_settings_timeoff_sameday_mode_check
    CHECK (timeoff_sameday_mode IN ('off', 'warn', 'block')),
  ADD COLUMN IF NOT EXISTS timeoff_sameday_limit INTEGER NOT NULL DEFAULT 2
    CONSTRAINT staffing_settings_timeoff_sameday_limit_check
    CHECK (timeoff_sameday_limit > 0),
  ADD COLUMN IF NOT EXISTS coverage_floor_mode TEXT NOT NULL DEFAULT 'off'
    CONSTRAINT staffing_settings_coverage_floor_mode_check
    CHECK (coverage_floor_mode IN ('off', 'warn', 'block'));

COMMENT ON COLUMN staffing_settings.trade_deadline_mode IS
  'Shift Protection: rule for trades near the shift start (off/warn/block)';
COMMENT ON COLUMN staffing_settings.trade_deadline_hours IS
  'Shift Protection: the trade window closes this many hours before the shift start';
COMMENT ON COLUMN staffing_settings.trade_auto_expire IS
  'Shift Protection: cancel open trades when the shift starts';
COMMENT ON COLUMN staffing_settings.timeoff_notice_mode IS
  'Shift Protection: rule for short-notice time-off requests (off/warn/block)';
COMMENT ON COLUMN staffing_settings.timeoff_notice_days IS
  'Shift Protection: time-off requests need this many days of notice';
COMMENT ON COLUMN staffing_settings.timeoff_sameday_mode IS
  'Shift Protection: rule for stacked same-day time off per position (off/warn/block)';
COMMENT ON COLUMN staffing_settings.timeoff_sameday_limit IS
  'Shift Protection: approved same-day requests per position before the rule applies';
COMMENT ON COLUMN staffing_settings.coverage_floor_mode IS
  'Shift Protection: rule for approvals that drop a day below template coverage (off/warn/block)';
