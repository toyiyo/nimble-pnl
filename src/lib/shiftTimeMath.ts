import { fromZonedTime } from 'date-fns-tz';
import { STEP_MIN } from '@/lib/timelineModel';

/**
 * Convert restaurant-local minutes-since-midnight (on `dateStr`) to a UTC ISO
 * string, honoring the restaurant's timezone's DST rules via `fromZonedTime`.
 *
 * `minutes` may exceed 1440 to express an overnight shift end (e.g. a shift
 * starting at 22:00 and ending 8 hours later is represented as 1800 minutes,
 * i.e. 30:00). The overflow is resolved by rolling the calendar date forward
 * by `floor(minutes / 1440)` days and using the remainder as the time-of-day,
 * so the wall-clock time-of-day is always resolved against the correct
 * (rolled-forward) calendar day before DST is applied — this is what makes a
 * shift that starts before a spring-forward/fall-back transition and ends
 * after it convert correctly.
 */
export function minutesToIso(dateStr: string, minutes: number, tz: string): string {
  const daysOverflow = Math.floor(minutes / 1440);
  const minutesOfDay = minutes - daysOverflow * 1440;

  const hours = Math.floor(minutesOfDay / 60);
  const mins = minutesOfDay % 60;

  const [year, month, day] = dateStr.split('-').map(Number);
  // Roll the calendar date forward using local (TZ-agnostic) date arithmetic
  // via Date's UTC fields, then reformat as YYYY-MM-DD. Using Date.UTC keeps
  // this arithmetic independent of the host process's timezone.
  const rolled = new Date(Date.UTC(year, month - 1, day + daysOverflow));
  const rolledDateStr = [
    rolled.getUTCFullYear(),
    String(rolled.getUTCMonth() + 1).padStart(2, '0'),
    String(rolled.getUTCDate()).padStart(2, '0'),
  ].join('-');

  const timeStr = `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}:00`;

  return fromZonedTime(`${rolledDateStr}T${timeStr}`, tz).toISOString();
}

/**
 * Snap a minute value to the nearest `step` (default `STEP_MIN`), rounding
 * half-up (ties round away from zero toward the next step boundary in the
 * positive direction), matching the timeline's drag-snap semantics.
 */
export function snapToStep(min: number, step: number = STEP_MIN): number {
  // `Math.round(min / step) * step` can produce `-0` (e.g. min=-7, step=15 ->
  // Math.round(-0.466...) === -0), which fails strict `Object.is`/`toBe`
  // equality against `0` even though `-0 === 0`. Normalize away.
  const snapped = Math.round(min / step) * step;
  return snapped === 0 ? 0 : snapped;
}
