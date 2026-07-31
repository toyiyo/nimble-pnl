/**
 * Unit Tests: the TypeScript half of the wall-clock parity contract, plus the
 * check that keeps the Postgres half honest.
 *
 * `supabase/tests/wall_clock_parity.sql` asserts Postgres resolves each
 * fixture row to `expectedInstant`. This file asserts `parseWallClock` does
 * too — and, critically, that the SQL file is testing the SAME rows. Two
 * independently-maintained lists of DST edge cases drift; a drifted pair
 * still shows two green suites while proving nothing about agreement, which
 * is the only property anyone actually cares about here.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

import { parseWallClock } from '@/lib/restaurantClock';
import { WALL_CLOCK_FIXTURES } from '../fixtures/wallClockFixtures';

// Resolved from the vitest root rather than `import.meta.url`: under the
// jsdom environment `import.meta.url` is not a `file:` URL, and `readFileSync`
// rejects it.
const SQL_PATH = resolve(process.cwd(), 'supabase/tests/wall_clock_parity.sql');

/** `  ('2026-11-01T01:30', 'America/Chicago',  '2026-11-01T07:30:00.000Z'),` */
const SQL_ROW_RE = /^\s*\('([^']+)',\s*'([^']+)',\s*'([^']+)'\),?\s*$/;

function readSqlFixtureTable(): { rows: Array<[string, string, string]>; plan: number } {
  const sql = readFileSync(SQL_PATH, 'utf8');

  const planMatch = /SELECT\s+plan\((\d+)\);/i.exec(sql);
  if (!planMatch) throw new Error('wall_clock_parity.sql: no plan(N) found');

  const rows: Array<[string, string, string]> = [];
  for (const line of sql.split('\n')) {
    const m = SQL_ROW_RE.exec(line);
    if (m) rows.push([m[1], m[2], m[3]]);
  }

  return { rows, plan: Number(planMatch[1]) };
}

describe('parseWallClock matches the shared Postgres fixture table', () => {
  it.each(WALL_CLOCK_FIXTURES.map((f) => [f.wallClock, f.tz, f.expectedInstant, f.note] as const))(
    '%s in %s is %s — %s',
    (wallClock, tz, expectedInstant) => {
      expect(parseWallClock(wallClock, tz)).toBe(expectedInstant);
    },
  );
});

describe('wall_clock_parity.sql covers exactly the shared fixtures', () => {
  // The contract the .sql file's header comment claims. Asserting it here is
  // what makes that comment true rather than aspirational: a row added to
  // either side without the other now fails, instead of silently narrowing
  // the coverage of a suite that still reports green.
  it('has the same rows, in the same order, as WALL_CLOCK_FIXTURES', () => {
    const { rows } = readSqlFixtureTable();

    expect(rows).toEqual(
      WALL_CLOCK_FIXTURES.map((f) => [f.wallClock, f.tz, f.expectedInstant]),
    );
  });

  it('declares a pgTAP plan matching its row count — an under-count silently skips rows', () => {
    const { rows, plan } = readSqlFixtureTable();

    expect(plan).toBe(rows.length);
  });

  it('parsed a non-trivial number of rows — guards the regex itself', () => {
    // If SQL_ROW_RE stopped matching (reformatting, a trailing comment), both
    // checks above would compare two empty-ish lists and pass. Anchor to the
    // fixture count so a silently-empty parse is a failure.
    const { rows } = readSqlFixtureTable();

    expect(rows.length).toBe(WALL_CLOCK_FIXTURES.length);
    expect(rows.length).toBeGreaterThan(0);
  });
});
