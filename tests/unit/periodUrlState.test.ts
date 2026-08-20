import { describe, expect, it } from 'vitest';
import { endOfDay, startOfDay } from 'date-fns';

import {
  customPeriodLabel,
  presetPeriod,
  readEnumParam,
  readPeriodParams,
  writePeriodParams,
  PRESET_PERIOD_TYPES,
} from '@/lib/periodUrlState';
import type { Period } from '@/components/PeriodSelector';

const TODAY = new Date(2026, 7, 19); // Aug 19, 2026 (a Wednesday)

describe('presetPeriod', () => {
  it('builds This Month from the first of the month through the end of today', () => {
    const period = presetPeriod('month', TODAY);
    expect(period).toEqual({
      type: 'month',
      label: 'This Month',
      from: new Date(2026, 7, 1),
      to: endOfDay(TODAY),
    });
  });

  it('builds This Week from Monday', () => {
    const period = presetPeriod('week', TODAY);
    expect(period.from).toEqual(new Date(2026, 7, 17));
    expect(period.to).toEqual(endOfDay(TODAY));
  });

  it('builds Last 30 Days as a 30-day range that includes today', () => {
    const period = presetPeriod('last30', TODAY);
    expect(period.from).toEqual(new Date(2026, 6, 21));
    expect(period.label).toBe('Last 30 Days');
  });

  it('builds This Quarter from the first day of the quarter', () => {
    const period = presetPeriod('quarter', TODAY);
    expect(period.from).toEqual(new Date(2026, 6, 1));
  });
});

describe('writePeriodParams / readPeriodParams round trip', () => {
  it('stores a preset as its type only', () => {
    const params = new URLSearchParams();
    writePeriodParams(params, presetPeriod('last90', TODAY));
    expect(params.toString()).toBe('period=last90');
  });

  it('restores every preset type relative to today', () => {
    for (const type of PRESET_PERIOD_TYPES) {
      const params = new URLSearchParams();
      writePeriodParams(params, presetPeriod(type, TODAY));
      expect(readPeriodParams(params, TODAY)).toEqual(presetPeriod(type, TODAY));
    }
  });

  it('stores a custom period with its exact dates', () => {
    const custom: Period = {
      type: 'custom',
      from: startOfDay(new Date(2026, 5, 3)),
      to: endOfDay(new Date(2026, 6, 9)),
      label: 'Jun 3 - Jul 9, 2026',
    };
    const params = new URLSearchParams();
    writePeriodParams(params, custom);
    expect(params.get('period')).toBe('custom');
    expect(params.get('from')).toBe('2026-06-03');
    expect(params.get('to')).toBe('2026-07-09');
    expect(readPeriodParams(params, TODAY)).toEqual(custom);
  });

  it('deletes stale custom dates when a preset replaces a custom period', () => {
    const params = new URLSearchParams('period=custom&from=2026-06-03&to=2026-07-09');
    writePeriodParams(params, presetPeriod('today', TODAY));
    expect(params.toString()).toBe('period=today');
  });

  it('labels a custom period across a year boundary with both years', () => {
    const params = new URLSearchParams('period=custom&from=2025-12-20&to=2026-01-10');
    expect(readPeriodParams(params, TODAY)?.label).toBe('Dec 20, 2025 - Jan 10, 2026');
  });
});

describe('readPeriodParams validation', () => {
  it('returns null when the params are absent', () => {
    expect(readPeriodParams(new URLSearchParams(), TODAY)).toBeNull();
  });

  it('returns null for an unknown period type', () => {
    expect(readPeriodParams(new URLSearchParams('period=fortnight'), TODAY)).toBeNull();
  });

  it('returns null for a custom period with a missing date', () => {
    expect(readPeriodParams(new URLSearchParams('period=custom&from=2026-06-03'), TODAY)).toBeNull();
  });

  it('returns null for a malformed date', () => {
    expect(
      readPeriodParams(new URLSearchParams('period=custom&from=06-03-2026&to=2026-07-09'), TODAY),
    ).toBeNull();
  });

  it('returns null for a rolled-over date such as February 31', () => {
    expect(
      readPeriodParams(new URLSearchParams('period=custom&from=2026-02-31&to=2026-07-09'), TODAY),
    ).toBeNull();
  });

  it('returns null when from is after to', () => {
    expect(
      readPeriodParams(new URLSearchParams('period=custom&from=2026-07-09&to=2026-06-03'), TODAY),
    ).toBeNull();
  });
});

describe('customPeriodLabel', () => {
  it('omits the start year inside one year', () => {
    expect(customPeriodLabel(new Date(2026, 5, 3), new Date(2026, 6, 9))).toBe('Jun 3 - Jul 9, 2026');
  });

  it('shows both years across a year boundary', () => {
    expect(customPeriodLabel(new Date(2025, 11, 20), new Date(2026, 0, 10))).toBe(
      'Dec 20, 2025 - Jan 10, 2026',
    );
  });
});

describe('readEnumParam', () => {
  const MODES = ['flow', 'category', 'inout'] as const;

  it('returns a listed value', () => {
    expect(readEnumParam(new URLSearchParams('view=inout'), 'view', MODES)).toBe('inout');
  });

  it('returns null for an unlisted value', () => {
    expect(readEnumParam(new URLSearchParams('view=bogus'), 'view', MODES)).toBeNull();
  });

  it('returns null when the param is absent', () => {
    expect(readEnumParam(new URLSearchParams(), 'view', MODES)).toBeNull();
  });
});
