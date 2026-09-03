/**
 * Shift Protection — client-side policy calculators.
 *
 * These mirror the server rules for display only. The server enforces
 * block mode in triggers and RPCs; a client failure here fails open.
 */

export type ProtectionMode = 'off' | 'warn' | 'block';

export interface ShiftProtectionSettings {
  trade_deadline_mode: ProtectionMode;
  trade_deadline_hours: number;
  trade_auto_expire: boolean;
  timeoff_notice_mode: ProtectionMode;
  timeoff_notice_days: number;
  timeoff_sameday_mode: ProtectionMode;
  timeoff_sameday_limit: number;
  coverage_floor_mode: ProtectionMode;
}

export const SHIFT_PROTECTION_DEFAULTS: ShiftProtectionSettings = {
  trade_deadline_mode: 'off',
  trade_deadline_hours: 24,
  trade_auto_expire: false,
  timeoff_notice_mode: 'off',
  timeoff_notice_days: 7,
  timeoff_sameday_mode: 'off',
  timeoff_sameday_limit: 2,
  coverage_floor_mode: 'off',
};

export type ProtectionRule = 'trade_deadline' | 'timeoff_notice' | 'timeoff_sameday' | 'coverage_floor';

export interface PolicyFinding {
  rule: ProtectionRule;
  mode: Exclude<ProtectionMode, 'off'>;
  message: string;
}

/**
 * Deadline check for a trade post or accept. Returns a finding when the
 * shift starts inside the deadline window (strictly inside — a shift
 * exactly at the boundary passes).
 */
export function tradeDeadlineFinding(
  settings: ShiftProtectionSettings,
  shiftStartIso: string | undefined,
  now: Date
): PolicyFinding | null {
  if (settings.trade_deadline_mode === 'off') return null;
  if (!shiftStartIso) return null;

  const start = new Date(shiftStartIso).getTime();
  if (Number.isNaN(start)) return null;

  const windowMs = settings.trade_deadline_hours * 60 * 60 * 1000;
  const msUntilStart = start - now.getTime();
  if (msUntilStart >= windowMs) return null;

  const mode = settings.trade_deadline_mode;
  if (msUntilStart <= 0) {
    return { rule: 'trade_deadline', mode, message: 'This shift already started.' };
  }
  const hoursUntil = Math.floor(msUntilStart / (60 * 60 * 1000));
  return {
    rule: 'trade_deadline',
    mode,
    message: `This shift starts in ${hoursUntil} hours. The trade window closes ${settings.trade_deadline_hours} hours before a shift.`,
  };
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

const dateOnlyToUtcMs = (dateOnly: string): number | null => {
  if (!DATE_ONLY.test(dateOnly)) return null;
  const ms = Date.parse(`${dateOnly}T00:00:00Z`);
  return Number.isNaN(ms) ? null : ms;
};

/**
 * Notice check for a time-off request. Dates are restaurant-local
 * calendar days as YYYY-MM-DD strings. A start exactly `notice_days`
 * out passes.
 */
export function timeoffNoticeFinding(
  settings: ShiftProtectionSettings,
  startDate: string | undefined,
  today: string
): PolicyFinding | null {
  if (settings.timeoff_notice_mode === 'off') return null;
  if (!startDate) return null;

  const startMs = dateOnlyToUtcMs(startDate);
  const todayMs = dateOnlyToUtcMs(today);
  if (startMs === null || todayMs === null) return null;

  const daysOut = Math.round((startMs - todayMs) / (24 * 60 * 60 * 1000));
  if (daysOut >= settings.timeoff_notice_days) return null;

  return {
    rule: 'timeoff_notice',
    mode: settings.timeoff_notice_mode,
    message: `This restaurant asks for ${settings.timeoff_notice_days} days of notice. This request starts in ${Math.max(daysOut, 0)} days.`,
  };
}

const SHIFT_PROTECTION_ERROR = /shift_protection:(\w+)\s+(.+)/;

/**
 * Map a `shift_protection:<rule> <text>` trigger message to its parts.
 * Returns null for any other message.
 */
export function parseShiftProtectionError(
  message: string | undefined | null
): { rule: string; message: string } | null {
  if (!message) return null;
  const match = SHIFT_PROTECTION_ERROR.exec(message);
  if (!match) return null;
  return { rule: match[1], message: match[2].trim() };
}
