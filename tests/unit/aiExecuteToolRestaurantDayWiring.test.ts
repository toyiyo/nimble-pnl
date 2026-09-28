import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Source-contract guards for wiring executeGetScheduleOverview and
 * executeGetTimePunches to the restaurant-day helpers.
 *
 * The edge entry file uses Deno https imports, so Vitest cannot import it.
 * These tests read the source, the same pattern as
 * ai-restaurant-today-wiring.test.ts and aiLaborEmployeeReads.test.ts.
 */

const root = resolve(__dirname, '../..');
const source = readFileSync(resolve(root, 'supabase/functions/ai-execute-tool/index.ts'), 'utf8');

/** The body of `async function <name>(` up to the next top-level function. */
function functionBody(src: string, name: string): string {
  const start = src.indexOf(`async function ${name}(`);
  if (start === -1) throw new Error(`function ${name} not found`);
  const next = src.slice(start + 1).search(/\n(?:async )?function |\nserve\(|\nDeno\.serve\(/);
  return next === -1 ? src.slice(start) : src.slice(start, start + 1 + next);
}

describe('ai-execute-tool imports the restaurant-day helpers', () => {
  it('imports restaurantDayBounds from _shared/restaurantDate.ts', () => {
    expect(source).toMatch(/restaurantDayBounds/);
  });

  it('imports scheduleOverviewDays and groupShiftsByRestaurantDay from _shared/scheduleOverview.ts', () => {
    expect(source).toMatch(/from '\.\.\/_shared\/scheduleOverview\.ts'/);
    expect(source).toMatch(/scheduleOverviewDays/);
    expect(source).toMatch(/groupShiftsByRestaurantDay/);
  });

  it('imports buildTimePunchShifts from _shared/timePunchShifts.ts', () => {
    expect(source).toMatch(/from '\.\.\/_shared\/timePunchShifts\.ts'/);
    expect(source).toMatch(/buildTimePunchShifts/);
  });
});

describe('the dispatcher passes restaurantTimeZone and restaurantNow', () => {
  it('passes both to executeGetScheduleOverview', () => {
    expect(source).toMatch(
      /executeGetScheduleOverview\(args, restaurant_id, supabase, restaurantTimeZone, restaurantNow\)/
    );
  });

  it('passes both to executeGetTimePunches', () => {
    expect(source).toMatch(
      /executeGetTimePunches\(args, restaurant_id, supabase, userRestaurant\.role, restaurantTimeZone, restaurantNow\)/
    );
  });
});

describe('executeGetScheduleOverview', () => {
  const body = functionBody(source, 'executeGetScheduleOverview');

  it('takes restaurantTimeZone and restaurantNow', () => {
    expect(body).toMatch(/restaurantTimeZone: string/);
    expect(body).toMatch(/restaurantNow: Date/);
  });

  it('gets the days from scheduleOverviewDays with restaurantNow', () => {
    expect(body).toMatch(/scheduleOverviewDays\([^)]*restaurantNow\)/);
  });

  it('gets the instants from restaurantDayBounds', () => {
    expect(body).toMatch(/restaurantDayBounds\(/);
  });

  it('queries start_time with the instant ISO strings', () => {
    expect(body).toMatch(/\.gte\('start_time', \w+\.start\.toISOString\(\)\)/);
    expect(body).toMatch(/\.lte\('start_time', \w+\.end\.toISOString\(\)\)/);
  });

  it('groups with groupShiftsByRestaurantDay', () => {
    expect(body).toMatch(/groupShiftsByRestaurantDay\(/);
  });

  it('does not group with a raw toLocalYMD(new Date(shift.start_time)) call', () => {
    expect(body).not.toMatch(/toLocalYMD\(new Date\(shift\.start_time\)\)/);
  });
});

describe('executeGetTimePunches', () => {
  const body = functionBody(source, 'executeGetTimePunches');

  it('takes restaurantTimeZone and restaurantNow', () => {
    expect(body).toMatch(/restaurantTimeZone: string/);
    expect(body).toMatch(/restaurantNow: Date/);
  });

  it('gets the days from calculateDateRange with restaurantNow', () => {
    expect(body).toMatch(/calculateDateRange\([^)]*restaurantNow\)/);
  });

  it('gets the instants from restaurantDayBounds and passes them to fetchLaborData', () => {
    expect(body).toMatch(/restaurantDayBounds\(/);
    expect(body).toMatch(/fetchLaborData\(/);
  });

  it('builds the rows with buildTimePunchShifts', () => {
    expect(body).toMatch(/buildTimePunchShifts\(/);
  });
});
