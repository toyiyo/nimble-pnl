import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { parseWallClock } from '@/lib/restaurantClock';
import { WALL_CLOCK_FIXTURES } from '../fixtures/wallClockFixtures';

describe('parseWallClock matches the fixture table', () => {
  it.each(WALL_CLOCK_FIXTURES)('$wallClock in $tz is $expectedInstant', ({ wallClock, tz, expectedInstant }) => {
    expect(parseWallClock(wallClock, tz)).toBe(expectedInstant);
  });
});

describe('the pgTAP file has not drifted from the fixtures', () => {
  it('contains one VALUES row per fixture, in order', () => {
    const sql = readFileSync(
      resolve(__dirname, '../../supabase/tests/wall_clock_parity.sql'),
      'utf8',
    );

    const rows = [...sql.matchAll(/\('([^']+)',\s*'([^']+)',\s*'([^']+)'\)/g)].map((m) => ({
      wallClock: m[1],
      tz: m[2],
      expectedInstant: m[3],
    }));

    expect(rows).toEqual(WALL_CLOCK_FIXTURES.map(({ wallClock, tz, expectedInstant }) => ({
      wallClock,
      tz,
      expectedInstant,
    })));
  });

  it('declares a plan matching the fixture count', () => {
    const sql = readFileSync(
      resolve(__dirname, '../../supabase/tests/wall_clock_parity.sql'),
      'utf8',
    );
    expect(sql).toContain(`SELECT plan(${WALL_CLOCK_FIXTURES.length});`);
  });
});
