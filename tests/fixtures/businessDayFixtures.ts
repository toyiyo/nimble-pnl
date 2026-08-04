/**
 * Instants whose restaurant-local day is NOT the same as their UTC day, plus
 * DST boundaries. Consumed twice — by Vitest against `toBusinessDay` and by
 * pgTAP against `(instant AT TIME ZONE tz)::date` — so the client helper and
 * the authoritative SQL cannot drift apart unnoticed.
 *
 * Keep this in sync with `supabase/tests/business_day_parity.sql`;
 * `tests/unit/businessDayParity.test.ts` fails if they diverge.
 */
export const BUSINESS_DAY_FIXTURES = [
  // The real incident from memory/lessons.md:1403 — Jul 22 20:56 in Chicago.
  { instant: '2026-07-23T01:56:20Z', tz: 'America/Chicago', expectedDay: '2026-07-22' },
  // Zone behind UTC, late evening local.
  { instant: '2026-07-23T04:59:00Z', tz: 'America/Chicago', expectedDay: '2026-07-22' },
  // Same instant, one minute later, crosses local midnight.
  { instant: '2026-07-23T05:00:00Z', tz: 'America/Chicago', expectedDay: '2026-07-23' },
  // Zone ahead of UTC.
  { instant: '2026-07-22T13:00:00Z', tz: 'Pacific/Auckland', expectedDay: '2026-07-23' },
  // Spring forward: 01:30 CST and 03:30 CDT, same local day.
  { instant: '2026-03-08T07:30:00Z', tz: 'America/Chicago', expectedDay: '2026-03-08' },
  { instant: '2026-03-08T08:30:00Z', tz: 'America/Chicago', expectedDay: '2026-03-08' },
  // Fall back: the repeated 01:30 local hour.
  { instant: '2026-11-01T06:30:00Z', tz: 'America/Chicago', expectedDay: '2026-11-01' },
  { instant: '2026-11-01T07:30:00Z', tz: 'America/Chicago', expectedDay: '2026-11-01' },
  // Pre-06:00 local, the first place a wrong implementation diverges.
  { instant: '2026-07-22T10:00:00Z', tz: 'America/Chicago', expectedDay: '2026-07-22' },
  // A zone with a non-hour offset.
  { instant: '2026-07-22T18:45:00Z', tz: 'Asia/Kolkata', expectedDay: '2026-07-23' },
] as const;
