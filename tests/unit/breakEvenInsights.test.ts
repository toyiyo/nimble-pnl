import { describe, it, expect } from 'vitest';
import { deriveWeekdayPattern, type BreakEvenHistoryEntry } from '@/lib/breakEvenInsights';

/**
 * `date` strings are `yyyy-MM-dd`. Days below index dates against Monday
 * 2026-06-01 so the weekday-of-week is unambiguous:
 *   2026-06-01 Mon, 06-02 Tue, 06-03 Wed, 06-04 Thu,
 *   2026-06-05 Fri, 06-06 Sat, 06-07 Sun.
 */
function entry(
  date: string,
  delta: number,
  overrides: Partial<BreakEvenHistoryEntry> = {},
): BreakEvenHistoryEntry {
  const breakEven = 1000;
  return {
    date,
    sales: breakEven + delta,
    breakEven,
    delta,
    status: delta > 50 ? 'above' : delta < -50 ? 'below' : 'at',
    isPartial: false,
    ...overrides,
  };
}

describe('deriveWeekdayPattern', () => {
  it('returns null with fewer than 7 complete days', () => {
    const history = [
      entry('2026-06-01', 100),
      entry('2026-06-02', 100),
      entry('2026-06-03', 100),
      entry('2026-06-04', 100),
      entry('2026-06-05', 100),
    ];

    expect(deriveWeekdayPattern(history)).toBeNull();
  });

  it('returns null when every weekday appears only once (no repeated samples)', () => {
    const history = [
      entry('2026-06-01', 100), // Mon
      entry('2026-06-02', -100), // Tue
      entry('2026-06-03', 100), // Wed
      entry('2026-06-04', -100), // Thu
      entry('2026-06-05', 100), // Fri
      entry('2026-06-06', -100), // Sat
      entry('2026-06-07', 100), // Sun
    ];

    expect(deriveWeekdayPattern(history)).toBeNull();
  });

  it('detects a clean weekday split (Mon-Thu below, Fri-Sun above)', () => {
    // Two full weeks: 2026-06-01 (Mon) .. 2026-06-14 (Sun).
    const history: BreakEvenHistoryEntry[] = [];
    const weekdayDeltas: Record<number, number> = {
      1: -900, // Mon
      2: -1000, // Tue
      3: -1100, // Wed
      4: -1200, // Thu
      5: 800, // Fri
      6: 700, // Sat
      0: 600, // Sun
    };
    const dates = [
      '2026-06-01', '2026-06-02', '2026-06-03', '2026-06-04', '2026-06-05', '2026-06-06', '2026-06-07',
      '2026-06-08', '2026-06-09', '2026-06-10', '2026-06-11', '2026-06-12', '2026-06-13', '2026-06-14',
    ];
    for (const date of dates) {
      const weekday = new Date(
        Number(date.slice(0, 4)),
        Number(date.slice(5, 7)) - 1,
        Number(date.slice(8, 10)),
      ).getDay();
      history.push(entry(date, weekdayDeltas[weekday]));
    }

    const result = deriveWeekdayPattern(history);

    expect(result).not.toBeNull();
    expect(result).toContain('Mon–Thu');
    expect(result).toContain('never break even');
    expect(result).toContain('Fri–Sun');
    expect(result).toContain('always do');
    expect(result).toMatch(/gap averages \$[\d,]+\/day/);
  });

  it('falls back to the weakest-day claim when the split is not clean', () => {
    // 14 days, every weekday sampled twice, but Monday and Thursday each mix
    // an above day with a non-above day — that alone rules out a clean
    // split. Tuesday is the only weekday that is consistently and
    // materially below break-even.
    const dates = [
      '2026-06-01', '2026-06-02', '2026-06-03', '2026-06-04', '2026-06-05', '2026-06-06', '2026-06-07',
      '2026-06-08', '2026-06-09', '2026-06-10', '2026-06-11', '2026-06-12', '2026-06-13', '2026-06-14',
    ];
    const weekdayDeltaSequence: Record<number, number[]> = {
      1: [80, -80], // Mon — mixed (above then below)
      2: [-900, -900], // Tue — consistently, materially below
      3: [90, 90], // Wed — above
      4: [100, -30], // Thu — mixed (above then "at")
      5: [70, 70], // Fri — above
      6: [-70, -70], // Sat — below
      0: [60, 60], // Sun — above
    };
    const seen: Record<number, number> = {};
    const history = dates.map((date) => {
      const weekday = new Date(
        Number(date.slice(0, 4)),
        Number(date.slice(5, 7)) - 1,
        Number(date.slice(8, 10)),
      ).getDay();
      const occurrence = seen[weekday] ?? 0;
      seen[weekday] = occurrence + 1;
      return entry(date, weekdayDeltaSequence[weekday][occurrence]);
    });

    const result = deriveWeekdayPattern(history);

    expect(result).not.toBeNull();
    expect(result).toContain('Tue is your weakest day');
    expect(result).toContain('below break-even');
    expect(result).not.toContain('never break even');
  });

  it('makes no "never break even" claim when every complete day is above break-even', () => {
    const dates = [
      '2026-06-01', '2026-06-02', '2026-06-03', '2026-06-04', '2026-06-05', '2026-06-06', '2026-06-07',
      '2026-06-08', '2026-06-09', '2026-06-10', '2026-06-11', '2026-06-12', '2026-06-13', '2026-06-14',
    ];
    const weekdayDeltas: Record<number, number> = {
      1: 900,
      2: 200, // relatively "weakest", but still comfortably above break-even
      3: 950,
      4: 1000,
      5: 850,
      6: 800,
      0: 750,
    };
    const history = dates.map((date) => {
      const weekday = new Date(
        Number(date.slice(0, 4)),
        Number(date.slice(5, 7)) - 1,
        Number(date.slice(8, 10)),
      ).getDay();
      return entry(date, weekdayDeltas[weekday], { status: 'above' });
    });

    const result = deriveWeekdayPattern(history);

    expect(result).toBeNull();
  });

  it('does not fold single-sample weekdays into a clean-split claim just because one other weekday has 2+ samples', () => {
    // 8 complete days: Tue appears twice (consistently, materially below),
    // every other weekday appears exactly once (all above). The busiest
    // weekday alone clears MIN_SAMPLES_PER_WEEKDAY, but the six single-sample
    // weekdays must not ride along into an "always do" claim — each of those
    // would be asserted from exactly one observation.
    const history: BreakEvenHistoryEntry[] = [
      entry('2026-06-01', 100), // Mon — single sample, above
      entry('2026-06-02', -900), // Tue #1 — below
      entry('2026-06-09', -900), // Tue #2 — below
      entry('2026-06-03', 100), // Wed — single sample, above
      entry('2026-06-04', 100), // Thu — single sample, above
      entry('2026-06-05', 100), // Fri — single sample, above
      entry('2026-06-06', 100), // Sat — single sample, above
      entry('2026-06-07', 100), // Sun — single sample, above
    ];

    const result = deriveWeekdayPattern(history);

    expect(result).not.toBeNull();
    // The only defensible claim here is Tuesday's, backed by its own 2
    // samples — not a "Mon,Wed,Thu,Fri,Sat,Sun always do" range built out of
    // six single-observation weekdays.
    expect(result).toContain('Tue is your weakest day');
    expect(result).not.toContain('never break even');
    expect(result).not.toContain('always do');
  });

  it('excludes the partial (today) row from the sample and its averages', () => {
    // 8 complete rows: Mon..Sun once each, Tue twice — Tue is materially
    // below break-even, every other weekday is comfortably above.
    const history: BreakEvenHistoryEntry[] = [
      entry('2026-06-01', 80), // Mon
      entry('2026-06-02', -900), // Tue #1
      entry('2026-06-09', -900), // Tue #2
      entry('2026-06-03', 90), // Wed
      entry('2026-06-04', 100), // Thu
      entry('2026-06-05', 70), // Fri
      entry('2026-06-06', 60), // Sat
      entry('2026-06-07', 50), // Sun
    ];
    // A same-day-as-Monday partial row with an extreme shortfall. If it were
    // wrongly folded into the complete-day averages, it would drag the mean
    // far enough down that Monday — not Tuesday — reads as the weakest day.
    history.push(entry('2026-06-15', -9000, { isPartial: true })); // also a Mon

    const result = deriveWeekdayPattern(history);

    expect(result).not.toBeNull();
    expect(result).toContain('Tue is your weakest day');
    expect(result).not.toContain('Mon is your weakest day');
  });
});
