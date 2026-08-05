import { describe, it, expect } from 'vitest';

import {
  buildDeltaBadge,
  buildHoursChangeLedger,
  buildSaveButtonLabel,
  deriveHoursChangeSeverity,
  describeCascadeShortfall,
  formatHoursDelta,
  type HoursChangeInput,
} from '@/lib/scheduling/hoursChangeCopy';

const BASE: HoursChangeInput = {
  oldStart: '09:00',
  oldEnd: '17:00',
  newStart: '10:00',
  newEnd: '18:00',
  movingCount: 3,
  publishedCount: 0,
  pastCount: 0,
  lockedCount: 0,
  driftedCount: 0,
  selectedDriftCount: 0,
  hoursDelta: 0,
};

describe('deriveHoursChangeSeverity', () => {
  it('is low when nothing posted is affected', () => {
    expect(deriveHoursChangeSeverity(0)).toBe('low');
  });

  it('is high as soon as one posted shift moves', () => {
    expect(deriveHoursChangeSeverity(1)).toBe('high');
  });
});

describe('buildDeltaBadge', () => {
  it('reports a later start that keeps the same length', () => {
    expect(buildDeltaBadge('09:00', '17:00', '10:00', '18:00')).toBe('1h later · same length');
  });

  it('reports an earlier start', () => {
    expect(buildDeltaBadge('09:00', '17:00', '08:30', '16:30')).toBe('30m earlier · same length');
  });

  it('reports a longer shift with an unchanged start', () => {
    expect(buildDeltaBadge('09:00', '17:00', '09:00', '18:30')).toBe('1h 30m longer');
  });

  it('reports both a move and a length change', () => {
    expect(buildDeltaBadge('09:00', '17:00', '10:00', '17:00')).toBe('1h later · 1h shorter');
  });

  it('reports no change when the times are identical', () => {
    expect(buildDeltaBadge('09:00', '17:00', '09:00', '17:00')).toBe('no change');
  });
});

describe('formatHoursDelta', () => {
  it('signs a gain', () => {
    expect(formatHoursDelta(6.5)).toBe('+6.5 scheduled hours');
  });

  it('signs a loss', () => {
    expect(formatHoursDelta(-2)).toBe('-2 scheduled hours');
  });

  it('names the zero case rather than printing "+0"', () => {
    expect(formatHoursDelta(0)).toBe('No change in scheduled hours');
  });
});

describe('buildHoursChangeLedger', () => {
  it('summarises the affected count for the live region', () => {
    const ledger = buildHoursChangeLedger(BASE);
    expect(ledger.totalAffected).toBe(3);
    expect(ledger.summary).toBe('Low impact. 1h later · same length. 3 shifts move.');
  });

  it('counts opted-in drift rows as affected', () => {
    const ledger = buildHoursChangeLedger({ ...BASE, driftedCount: 2, selectedDriftCount: 1 });
    expect(ledger.totalAffected).toBe(4);
  });

  it('flips to high severity and says so in the summary when posted shifts move', () => {
    const ledger = buildHoursChangeLedger({ ...BASE, publishedCount: 2 });
    expect(ledger.severity).toBe('high');
    expect(ledger.summary).toBe('High impact. 1h later · same length. 3 shifts move, 2 already posted.');
  });

  it('emits a destructive chip only for posted shifts', () => {
    const low = buildHoursChangeLedger(BASE);
    expect(low.chips.some((c) => c.tone === 'destructive')).toBe(false);

    const high = buildHoursChangeLedger({ ...BASE, publishedCount: 2 });
    expect(high.chips.find((c) => c.tone === 'destructive')).toEqual({
      key: 'published',
      label: '2 already posted',
      tone: 'destructive',
    });
  });

  it('always shows the moving chip, even at zero', () => {
    const ledger = buildHoursChangeLedger({ ...BASE, movingCount: 0 });
    expect(ledger.chips.find((c) => c.key === 'moving')).toEqual({
      key: 'moving',
      label: '0 shifts move',
      tone: 'warning',
    });
  });

  it('lists the untouched buckets with their reasons', () => {
    const ledger = buildHoursChangeLedger({ ...BASE, pastCount: 4, lockedCount: 1, driftedCount: 2 });
    expect(ledger.untouched.map((l) => l.text)).toEqual([
      '4 past shifts stay as scheduled — payroll has seen them',
      '1 locked shift stays as scheduled',
      '2 hand-edited shifts stay as scheduled unless you pick them',
    ]);
  });

  it('drops the drift line once every drifted shift is opted in', () => {
    const ledger = buildHoursChangeLedger({ ...BASE, driftedCount: 2, selectedDriftCount: 2 });
    expect(ledger.untouched.some((l) => l.key === 'drifted')).toBe(false);
  });

  it('states the hours delta as a change line', () => {
    const ledger = buildHoursChangeLedger({ ...BASE, hoursDelta: 6.5 });
    expect(ledger.changes.map((l) => l.text)).toContain('+6.5 scheduled hours');
  });

  it('uses singular copy for a single moving shift', () => {
    const ledger = buildHoursChangeLedger({ ...BASE, movingCount: 1 });
    expect(ledger.summary).toBe('Low impact. 1h later · same length. 1 shift moves.');
  });
});

describe('describeCascadeShortfall', () => {
  it('reports the gap when fewer shifts were updated than promised', () => {
    expect(describeCascadeShortfall(3, 2)).toBe(
      'You expected 3, but only 2 were still eligible when it saved.'
    );
  });

  it('says "none were" rather than "only 0 were" when the cascade moved nothing', () => {
    expect(describeCascadeShortfall(3, 0)).toBe(
      'You expected 3, but none were still eligible when it saved.'
    );
  });

  it('says nothing when the counts match', () => {
    expect(describeCascadeShortfall(3, 3)).toBeUndefined();
  });

  it('says nothing when nothing was promised', () => {
    expect(describeCascadeShortfall(0, 0)).toBeUndefined();
  });

  it('says nothing in the (should-not-happen) case of more updated than promised', () => {
    expect(describeCascadeShortfall(2, 3)).toBeUndefined();
  });
});

describe('buildSaveButtonLabel', () => {
  it('shows the submitting label regardless of the other params', () => {
    expect(buildSaveButtonLabel({
      isSubmitting: true,
      showCascadeChoice: true,
      affectedCount: 3,
      isEdit: true,
    })).toBe('Saving...');
  });

  it('pluralizes the cascading label at the affectedCount 1 vs 2 boundary', () => {
    expect(buildSaveButtonLabel({
      isSubmitting: false,
      showCascadeChoice: true,
      affectedCount: 1,
      isEdit: true,
    })).toBe('Save & update 1 shift');

    expect(buildSaveButtonLabel({
      isSubmitting: false,
      showCascadeChoice: true,
      affectedCount: 2,
      isEdit: true,
    })).toBe('Save & update 2 shifts');
  });

  it('falls back to "Save changes" on an edit with no cascade on offer', () => {
    expect(buildSaveButtonLabel({
      isSubmitting: false,
      showCascadeChoice: false,
      affectedCount: 0,
      isEdit: true,
    })).toBe('Save changes');
  });

  it('falls back to "Add Template" in create mode', () => {
    expect(buildSaveButtonLabel({
      isSubmitting: false,
      showCascadeChoice: false,
      affectedCount: 0,
      isEdit: false,
    })).toBe('Add Template');
  });
});
