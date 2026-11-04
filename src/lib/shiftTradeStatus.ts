/**
 * manager_note marker set only by expire_stale_shift_trades (SQL).
 * The SQL side stays a literal; keep the two in sync.
 */
export const AUTO_EXPIRED_NOTE = 'auto_expired';

/** A trade is expired when its offered shift started in the past. */
export function isTradeExpired(startTimeIso: string | undefined, now: Date): boolean {
  if (!startTimeIso) return false;
  return new Date(startTimeIso).getTime() < now.getTime();
}
