import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { toBusinessDay } from '@/lib/restaurantClock';
import { BUSINESS_DAY_FIXTURES } from '../fixtures/businessDayFixtures';

describe('toBusinessDay matches the fixture table', () => {
  it.each(BUSINESS_DAY_FIXTURES)('$instant in $tz is $expectedDay', ({ instant, tz, expectedDay }) => {
    expect(toBusinessDay(instant, tz)).toBe(expectedDay);
  });
});

describe('the pgTAP file has not drifted from the fixtures', () => {
  it('contains one VALUES row per fixture, in order', () => {
    const sql = readFileSync(
      resolve(__dirname, '../../supabase/tests/business_day_parity.sql'),
      'utf8',
    );

    const rows = [...sql.matchAll(/\('([^']+)',\s*'([^']+)',\s*'([^']+)'\)/g)].map((m) => ({
      instant: m[1],
      tz: m[2],
      expectedDay: m[3],
    }));

    expect(rows).toEqual(BUSINESS_DAY_FIXTURES.map(({ instant, tz, expectedDay }) => ({
      instant,
      tz,
      expectedDay,
    })));
  });

  it('declares a plan matching the fixture count', () => {
    const sql = readFileSync(
      resolve(__dirname, '../../supabase/tests/business_day_parity.sql'),
      'utf8',
    );
    expect(sql).toContain(`SELECT plan(${BUSINESS_DAY_FIXTURES.length});`);
  });
});
