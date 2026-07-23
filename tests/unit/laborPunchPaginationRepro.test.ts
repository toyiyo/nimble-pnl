import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { calculateActualLaborCost } from '@/services/laborCalculations';
import type { TimePunch } from '@/types/timeTracking';

/**
 * Root-cause proof for the /labor "$0 labor for recent days" bug.
 *
 * `useLaborCostsFromTimeTracking` fetches `time_punches` with a single
 * unpaginated `.select('*').order('punch_time', ascending)`. PostgREST caps an
 * unpaginated response at its default `db-max-rows` (1000). Once a restaurant
 * accumulates >1000 punches in the ~18-week fetch window, the query silently
 * returns only the OLDEST 1000 rows and drops the newest — so the most recent
 * days (today, yesterday) lose their punches and read $0, while older days
 * (fully inside the first 1000) still compute correctly. The boundary creeps
 * earlier as punches accumulate. The chart path (`useSplhData`) paginates via
 * `.range()`, which is why the intraday labor line renders while the KPI is $0.
 *
 * Real prod data (Wetzel-Cold Stone Alamo Ranch, restaurant tz America/Chicago):
 *   - 1039 punches in the window → 1000-row cap trips.
 *   - 8 employees worked Jul 22 (all hourly @ $10/hr); every shift closed.
 *   - Full punch set → Jul 22 labor = $586.72.
 *   - Truncated to oldest 1000 → all Jul 22 punches dropped → Jul 22 = $0.
 */

const RESTAURANT = '7c0c76e3-e770-401b-a2a9-c1edd407efed';
const PG_DEFAULT_MAX_ROWS = 1000;

const EMP_IDS = [
  '0a385d92-df60-4c6e-9dfc-78f15bb8c31b', '0f1a7667-f7af-4f86-a500-701f69bf42e8',
  '0f5da8cc-c3f9-41e9-b9d1-6b73ede15a7e', '3ebf26d5-efc2-4078-b6c9-60e1803e3ab1',
  '86e3ae03-0e76-4b01-9dfc-7dab2f2b7b7a', '99beacc9-daa5-4ea4-936b-be8913a2c562',
  'e54ce149-344f-4136-bc65-851e3478ac9f', 'fbf104fe-eb01-435c-b38c-ec601863590d',
];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const employees: any[] = EMP_IDS.map((id) => ({
  id, restaurant_id: RESTAURANT,
  is_active: true, status: 'active', compensation_type: 'hourly', hourly_rate: 1000,
}));
// A filler employee for the older "backlog" punches that fill the first 1000 rows.
 
employees.push({ id: 'filler', restaurant_id: RESTAURANT, is_active: true, status: 'active', compensation_type: 'hourly', hourly_rate: 1000 });

// Real prod punches for Jul 22 (UTC). Each shift closed.
const jul22: Array<[string, string, string]> = [
  ['0a385d92-df60-4c6e-9dfc-78f15bb8c31b', '2026-07-22T22:29:33.134+00:00', 'clock_in'],
  ['0a385d92-df60-4c6e-9dfc-78f15bb8c31b', '2026-07-23T04:45:13.252+00:00', 'clock_out'],
  ['0f1a7667-f7af-4f86-a500-701f69bf42e8', '2026-07-22T21:34:01.811+00:00', 'clock_in'],
  ['0f1a7667-f7af-4f86-a500-701f69bf42e8', '2026-07-23T04:45:39.744+00:00', 'clock_out'],
  ['0f5da8cc-c3f9-41e9-b9d1-6b73ede15a7e', '2026-07-22T21:02:59.08+00:00', 'clock_in'],
  ['0f5da8cc-c3f9-41e9-b9d1-6b73ede15a7e', '2026-07-23T01:25:23.454+00:00', 'clock_out'],
  ['0f5da8cc-c3f9-41e9-b9d1-6b73ede15a7e', '2026-07-23T01:56:20.499+00:00', 'clock_in'],
  ['0f5da8cc-c3f9-41e9-b9d1-6b73ede15a7e', '2026-07-23T04:34:57.377+00:00', 'clock_out'],
  ['3ebf26d5-efc2-4078-b6c9-60e1803e3ab1', '2026-07-22T14:56:50.942+00:00', 'clock_in'],
  ['3ebf26d5-efc2-4078-b6c9-60e1803e3ab1', '2026-07-22T21:22:01.744+00:00', 'clock_out'],
  ['86e3ae03-0e76-4b01-9dfc-7dab2f2b7b7a', '2026-07-22T21:51:43.134+00:00', 'clock_in'],
  ['86e3ae03-0e76-4b01-9dfc-7dab2f2b7b7a', '2026-07-23T02:09:10.082+00:00', 'clock_out'],
  ['99beacc9-daa5-4ea4-936b-be8913a2c562', '2026-07-22T15:02:31.828+00:00', 'clock_in'],
  ['99beacc9-daa5-4ea4-936b-be8913a2c562', '2026-07-22T18:39:30.297+00:00', 'clock_out'],
  ['99beacc9-daa5-4ea4-936b-be8913a2c562', '2026-07-22T18:39:51.204+00:00', 'clock_in'],
  ['99beacc9-daa5-4ea4-936b-be8913a2c562', '2026-07-22T22:05:22.045+00:00', 'clock_out'],
  ['e54ce149-344f-4136-bc65-851e3478ac9f', '2026-07-22T17:00:04.698+00:00', 'clock_in'],
  ['e54ce149-344f-4136-bc65-851e3478ac9f', '2026-07-22T23:00:03.694+00:00', 'clock_out'],
  ['fbf104fe-eb01-435c-b38c-ec601863590d', '2026-07-22T14:15:29.714+00:00', 'clock_in'],
  ['fbf104fe-eb01-435c-b38c-ec601863590d', '2026-07-23T04:42:22.985+00:00', 'clock_out'],
];

function toPunch([employee_id, punch_time, punch_type]: [string, string, string], i: number): TimePunch {
  return {
    id: `p${i}`, employee_id, restaurant_id: RESTAURANT,
    punch_time, punch_type: punch_type as TimePunch['punch_type'],
    created_at: punch_time, updated_at: punch_time,
  };
}

// Build a realistic backlog of OLD punches (March–early July) so the total
// exceeds 1000 and the Jul 22 rows fall beyond the cap when sorted asc.
function buildBacklog(count: number): TimePunch[] {
  const rows: TimePunch[] = [];
  // Spread the whole backlog across Mar 20 → Jul 20 (before the Jul 21 cutoff)
  // so these older rows occupy the oldest 1000 slots and push Jul 22 past the cap.
  const start = Date.UTC(2026, 2, 20, 12, 0, 0); // Mar 20
  const end = Date.UTC(2026, 6, 20, 12, 0, 0);   // Jul 20
  const step = (end - start) / count;
  for (let i = 0; i < count; i++) {
    const t = new Date(start + i * step);
    rows.push({
      id: `f${i}`, employee_id: 'filler', restaurant_id: RESTAURANT,
      punch_time: t.toISOString(),
      punch_type: (i % 2 === 0 ? 'clock_in' : 'clock_out') as TimePunch['punch_type'],
      created_at: t.toISOString(), updated_at: t.toISOString(),
    });
  }
  return rows;
}

function jul22Labor(punches: TimePunch[]): number {
  // Constructed at call time (inside the pinned-TZ tests) so the local
  // window bounds resolve under America/Chicago, matching laborCostWindow.
  const windowStart = new Date(2026, 2, 19); // host-local, matches laborCostWindow
  const windowEnd = new Date(2026, 6, 23, 23, 59, 59, 999);
  const { dailyCosts } = calculateActualLaborCost(employees, punches, windowStart, windowEnd);
  return dailyCosts.find((d) => d.date === '2026-07-22')?.total_cost ?? 0;
}

describe('time_punches 1000-row truncation zeroes recent-day labor (/labor bug)', () => {
  // Pin to the restaurant's real timezone (America/Chicago). Day-bucketing in
  // calculateActualLaborCost uses the HOST-local day (formatDateUTC reads
  // getFullYear/Month/Date), and $586.72 is the Jul 22 total as seen in
  // Chicago. Without pinning, CI's UTC host buckets employee 0f5da8cc's second
  // split shift (clock-in 2026-07-23T01:56Z = Jul 22 20:56 Chicago) onto Jul 23
  // instead of Jul 22, dropping $26.44 and yielding $560.28.
  let originalTZ: string | undefined;
  beforeAll(() => {
    originalTZ = process.env.TZ;
    process.env.TZ = 'America/Chicago';
  });
  afterAll(() => {
    if (originalTZ === undefined) delete process.env.TZ;
    else process.env.TZ = originalTZ;
  });

  // Backlog large enough that total > 1000 and all Jul 22 rows sort past row 1000.
  const backlog = buildBacklog(1020);
  const jul22Punches = jul22.map(toPunch);
  const allPunches = [...backlog, ...jul22Punches];

  it('sanity: full (paginated) punch set computes real Jul 22 labor', () => {
    expect(allPunches.length).toBeGreaterThan(PG_DEFAULT_MAX_ROWS);
    expect(jul22Labor(allPunches)).toBeCloseTo(586.72, 1);
  });

  it('BUG: unpaginated fetch (oldest 1000 by punch_time) drops Jul 22 → $0', () => {
    // Simulate PostgREST: order by punch_time asc, keep first 1000.
    const truncated = [...allPunches]
      .sort((a, b) => a.punch_time.localeCompare(b.punch_time))
      .slice(0, PG_DEFAULT_MAX_ROWS);
    // Every Jul 22 punch is beyond the cap.
    expect(truncated.some((p) => p.punch_time.startsWith('2026-07-22'))).toBe(false);
    expect(jul22Labor(truncated)).toBe(0);
  });
});
