import type { TimePunch } from '@/types/timeTracking';

/** Default cap: an open shift older than this many hours is treated as a
 * forgotten clock-out (left incomplete), not synthesized through "now". Mirrors
 * `payrollCalculations.MAX_SHIFT_HOURS`. */
const DEFAULT_MAX_SHIFT_HOURS = 16;

function lastPunch(sorted: TimePunch[]): TimePunch | undefined {
  return sorted[sorted.length - 1];
}

/**
 * Returns `punches` plus a synthetic `clock_out` at `now` for every employee
 * whose shift is still **open** (currently clocked in) — the "assume a clock-in
 * until now" rule for the in-progress day.
 *
 * The shared payroll engine (`parseWorkPeriods`) only emits a work period from a
 * matched `clock_in → clock_out` pair, so a still-open shift contributes **zero
 * hours** — which silently under-counts today's labor while staff are on the
 * clock. For a *live* labor-cost view (not payroll, where you don't pay an
 * un-clocked-out shift) we close the open shift at `now` so its in-progress
 * hours count.
 *
 * Rules per employee (punches sorted by time):
 * - Last punch is `clock_out` → shift closed, nothing added.
 * - Last punch is `clock_in` or `break_end` → currently working → append
 *   `clock_out` at `now`.
 * - Last punch is `break_start` → currently on break → append `break_end` then
 *   `clock_out` at `now` (worked time counts up to the break; the in-progress
 *   break is excluded).
 * - **Guard:** only synthesize when the open shift's `clock_in` is within
 *   `maxShiftHours` of `now`; an older open shift is a forgotten clock-out and
 *   is left incomplete (so we never fabricate a 3-day "shift").
 *
 * Pure: `now` is passed in (not read via `new Date()`), so it's deterministic
 * and TZ-agnostic (an absolute instant). Synthetic punches carry an
 * `id` prefixed `synthetic-` so they're distinguishable if ever inspected.
 */
export function appendOpenShiftClockOuts(
  punches: TimePunch[],
  now: Date,
  maxShiftHours: number = DEFAULT_MAX_SHIFT_HOURS,
): TimePunch[] {
  const nowMs = now.getTime();
  const maxMs = maxShiftHours * 3_600_000;
  const nowIso = now.toISOString();

  const byEmployee = new Map<string, TimePunch[]>();
  for (const p of punches) {
    const list = byEmployee.get(p.employee_id);
    if (list) list.push(p);
    else byEmployee.set(p.employee_id, [p]);
  }

  const synthetic: TimePunch[] = [];
  for (const [employeeId, list] of byEmployee) {
    const sorted = [...list].sort((a, b) => a.punch_time.localeCompare(b.punch_time));
    const last = lastPunch(sorted);
    if (!last || last.punch_type === 'clock_out') continue; // closed

    // The open shift's clock_in = the last clock_in with no clock_out after it.
    const lastClockIn = [...sorted].reverse().find((p) => p.punch_type === 'clock_in');
    if (!lastClockIn) continue; // dangling break punches with no clock_in — ignore
    const clockInMs = new Date(lastClockIn.punch_time).getTime();
    if (Number.isNaN(clockInMs) || nowMs - clockInMs > maxMs || clockInMs > nowMs) continue;

    const base = {
      restaurant_id: last.restaurant_id,
      employee_id: employeeId,
      punch_time: nowIso,
    };
    if (last.punch_type === 'break_start') {
      synthetic.push({ ...base, id: `synthetic-${employeeId}-break_end`, punch_type: 'break_end' });
    }
    synthetic.push({ ...base, id: `synthetic-${employeeId}-clock_out`, punch_type: 'clock_out' });
  }

  return synthetic.length ? [...punches, ...synthetic] : punches;
}
