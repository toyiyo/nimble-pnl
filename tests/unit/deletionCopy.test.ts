import { describe, it, expect } from 'vitest';
import {
  deriveTemplateSeverity,
  buildTemplateLedger,
  describeAvailabilityDeletion,
  type TemplateDeletionImpact,
} from '../../src/lib/scheduling/deletionCopy';

describe('deriveTemplateSeverity', () => {
  it('returns "low" when there are no pending claims', () => {
    const impact: TemplateDeletionImpact = {
      pendingClaims: { count: 0, names: [] },
      scheduledShiftsKept: 3,
      upcomingOpenSpots: 2,
    };

    expect(deriveTemplateSeverity(impact)).toBe('low');
  });

  it('returns "high" when there is exactly one pending claim', () => {
    const impact: TemplateDeletionImpact = {
      pendingClaims: { count: 1, names: ['Alex Rivera'] },
      scheduledShiftsKept: 0,
      upcomingOpenSpots: 0,
    };

    expect(deriveTemplateSeverity(impact)).toBe('high');
  });

  it('returns "high" when there are multiple pending claims, regardless of other counts', () => {
    const impact: TemplateDeletionImpact = {
      pendingClaims: { count: 5, names: ['A', 'B', 'C', 'D', 'E'] },
      scheduledShiftsKept: 0,
      upcomingOpenSpots: 0,
    };

    expect(deriveTemplateSeverity(impact)).toBe('high');
  });
});

describe('buildTemplateLedger', () => {
  it('produces the zero-impact ledger: no ack, no pending-claims chip/line, no kept lines', () => {
    const impact: TemplateDeletionImpact = {
      pendingClaims: { count: 0, names: [] },
      scheduledShiftsKept: 0,
      upcomingOpenSpots: 0,
    };

    const ledger = buildTemplateLedger(impact, 'Closing Server');

    expect(ledger.needsAck).toBe(false);
    expect(ledger.ackLabel).toBeNull();
    expect(ledger.chips.some((c) => c.key === 'pendingClaims')).toBe(false);
    expect(ledger.removed.some((l) => l.key === 'pendingClaims')).toBe(false);
    expect(ledger.removed.some((l) => l.key === 'openShifts')).toBe(false);
    expect(ledger.kept).toHaveLength(0);
    // Claim history is always erased by a hard delete, regardless of pending count.
    expect(ledger.removed.some((l) => l.key === 'claimHistory')).toBe(true);
    expect(ledger.removed.find((l) => l.key === 'claimHistory')!.text).toContain(
      'Closing Server'
    );
  });

  it('formats a single pending claim with singular grammar and gates ack', () => {
    const impact: TemplateDeletionImpact = {
      pendingClaims: { count: 1, names: ['Alex Rivera'] },
      scheduledShiftsKept: 0,
      upcomingOpenSpots: 0,
    };

    const ledger = buildTemplateLedger(impact, 'Closing Server');

    expect(ledger.needsAck).toBe(true);
    const pendingLine = ledger.removed.find((l) => l.key === 'pendingClaims');
    expect(pendingLine).toBeDefined();
    expect(pendingLine!.text).toBe('1 pending claim is withdrawn — Alex Rivera');
    expect(ledger.ackLabel).toBe(
    "I understand 1 employee's pending claim will be withdrawn."
    );
    expect(ledger.chips.find((c) => c.key === 'pendingClaims')).toEqual({
      key: 'pendingClaims',
      label: '1 pending claim',
      tone: 'destructive',
    });
  });

  it('formats exactly two pending-claim names joined with "&"', () => {
    const impact: TemplateDeletionImpact = {
      pendingClaims: { count: 2, names: ['Alex Rivera', 'Jordan Lee'] },
      scheduledShiftsKept: 0,
      upcomingOpenSpots: 0,
    };

    const ledger = buildTemplateLedger(impact, 'Closing Server');

    const pendingLine = ledger.removed.find((l) => l.key === 'pendingClaims');
    expect(pendingLine!.text).toBe(
      '2 pending claims are withdrawn — Alex Rivera & Jordan Lee'
    );
    expect(ledger.ackLabel).toBe(
      "I understand 2 employees' pending claims will be withdrawn."
    );
  });

  it('omits the em dash when the claim count is positive but no names resolved', () => {
    // Employee join can come back empty (deleted/renamed employee) while the
    // claim rows still count — the copy must not render a dangling "withdrawn — ".
    const impact: TemplateDeletionImpact = {
      pendingClaims: { count: 2, names: [] },
      scheduledShiftsKept: 0,
      upcomingOpenSpots: 0,
    };

    const ledger = buildTemplateLedger(impact, 'Closing Server');

    const pendingLine = ledger.removed.find((l) => l.key === 'pendingClaims');
    expect(pendingLine!.text).toBe('2 pending claims are withdrawn');
    expect(pendingLine!.text).not.toContain('—');
  });

  it('formats more than two pending-claim names as "+N more"', () => {
    const impact: TemplateDeletionImpact = {
      pendingClaims: {
        count: 3,
        names: ['Alex Rivera', 'Jordan Lee', 'Sam Patel'],
      },
      scheduledShiftsKept: 0,
      upcomingOpenSpots: 0,
    };

    const ledger = buildTemplateLedger(impact, 'Closing Server');

    const pendingLine = ledger.removed.find((l) => l.key === 'pendingClaims');
    expect(pendingLine!.text).toBe(
      '3 pending claims are withdrawn — Alex Rivera, Jordan Lee +1 more'
    );
    expect(ledger.ackLabel).toBe(
      "I understand 3 employees' pending claims will be withdrawn."
    );
  });

  it('adds a singular open-shifts line and chip when exactly one open spot is upcoming', () => {
    const impact: TemplateDeletionImpact = {
      pendingClaims: { count: 0, names: [] },
      scheduledShiftsKept: 0,
      upcomingOpenSpots: 1,
    };

    const ledger = buildTemplateLedger(impact, 'Closing Server');

    const openLine = ledger.removed.find((l) => l.key === 'openShifts');
    expect(openLine!.text).toBe('1 upcoming open shift stops being claimable');
    expect(ledger.chips.find((c) => c.key === 'openShifts')).toEqual({
      key: 'openShifts',
      label: '1 open shift',
      tone: 'warning',
    });
  });

  it('pluralizes the open-shifts line/chip when more than one spot is upcoming', () => {
    const impact: TemplateDeletionImpact = {
      pendingClaims: { count: 0, names: [] },
      scheduledShiftsKept: 0,
      upcomingOpenSpots: 4,
    };

    const ledger = buildTemplateLedger(impact, 'Closing Server');

    const openLine = ledger.removed.find((l) => l.key === 'openShifts');
    expect(openLine!.text).toBe('4 upcoming open shifts stop being claimable');
    expect(ledger.chips.find((c) => c.key === 'openShifts')).toEqual({
      key: 'openShifts',
      label: '4 open shifts',
      tone: 'warning',
    });
  });

  it('always shows the open-shifts chip, even at zero, but never the line', () => {
    const impact: TemplateDeletionImpact = {
      pendingClaims: { count: 0, names: [] },
      scheduledShiftsKept: 0,
      upcomingOpenSpots: 0,
    };

    const ledger = buildTemplateLedger(impact, 'Closing Server');

    expect(ledger.chips.find((c) => c.key === 'openShifts')).toEqual({
      key: 'openShifts',
      label: '0 open shifts',
      tone: 'warning',
    });
    expect(ledger.removed.some((l) => l.key === 'openShifts')).toBe(false);
  });

  it('adds singular kept lines/chip when exactly one shift is kept', () => {
    const impact: TemplateDeletionImpact = {
      pendingClaims: { count: 0, names: [] },
      scheduledShiftsKept: 1,
      upcomingOpenSpots: 0,
    };

    const ledger = buildTemplateLedger(impact, 'Closing Server');

    expect(ledger.kept).toEqual([
      { key: 'scheduledShifts', text: '1 already-scheduled shift stays on the calendar' },
      { key: 'assignedKeepShift', text: 'Everyone assigned keeps their shift & hours' },
    ]);
    expect(ledger.chips.find((c) => c.key === 'scheduledShiftsKept')).toEqual({
      key: 'scheduledShiftsKept',
      label: '1 shift kept',
      tone: 'success',
    });
  });

  it('pluralizes kept lines/chip when multiple shifts are kept', () => {
    const impact: TemplateDeletionImpact = {
      pendingClaims: { count: 0, names: [] },
      scheduledShiftsKept: 6,
      upcomingOpenSpots: 0,
    };

    const ledger = buildTemplateLedger(impact, 'Closing Server');

    expect(ledger.kept).toEqual([
      { key: 'scheduledShifts', text: '6 already-scheduled shifts stay on the calendar' },
      { key: 'assignedKeepShift', text: 'Everyone assigned keeps their shift & hours' },
    ]);
    expect(ledger.chips.find((c) => c.key === 'scheduledShiftsKept')).toEqual({
      key: 'scheduledShiftsKept',
      label: '6 shifts kept',
      tone: 'success',
    });
  });

  it('always shows the scheduled-shifts-kept chip, even at zero, but never the kept lines', () => {
    const impact: TemplateDeletionImpact = {
      pendingClaims: { count: 0, names: [] },
      scheduledShiftsKept: 0,
      upcomingOpenSpots: 0,
    };

    const ledger = buildTemplateLedger(impact, 'Closing Server');

    expect(ledger.chips.find((c) => c.key === 'scheduledShiftsKept')).toEqual({
      key: 'scheduledShiftsKept',
      label: '0 shifts kept',
      tone: 'success',
    });
    expect(ledger.kept).toHaveLength(0);
  });
});

describe('describeAvailabilityDeletion', () => {
  it('returns a low-severity, no-ack description for an available (open) recurring window', () => {
    const result = describeAvailabilityDeletion({
      isAvailable: true,
      kind: 'availability',
      dayLabel: 'Wednesday',
      timeLabel: '9:00 AM – 5:00 PM',
      personName: 'Jamie Chen',
    });

    expect(result.severity).toBe('low');
    expect(result.heroText).toBeNull();
    expect(result.needsAck).toBe(false);
    expect(result.ackLabel).toBeNull();
    expect(result.changes).toEqual([
      'The scheduler stops suggesting this person for the window.',
      'They can still be scheduled manually.',
      'The posted schedule is unchanged.',
    ]);
  });

  it('returns a high-severity guardrail description with an ack for an unavailable recurring block, referencing the weekday', () => {
    const result = describeAvailabilityDeletion({
      isAvailable: false,
      kind: 'availability',
      dayLabel: 'Wednesday',
      timeLabel: '9:00 AM – 5:00 PM',
      personName: 'Jamie Chen',
    });

    expect(result.severity).toBe('high');
    expect(result.needsAck).toBe(true);
    expect(result.heroText).toContain('Jamie Chen');
    expect(result.heroText).toContain('Wednesday');
    expect(result.heroText).toContain('9:00 AM – 5:00 PM');
    expect(result.changes).toEqual([
      'Shifts can be scheduled over this time with no warning.',
      'Open-shift claiming no longer treats it as a conflict.',
    ]);
    expect(result.ackLabel).toBe(
      "I understand shifts can be booked during a time Jamie Chen marked off."
    );
  });

  it('references the specific date (not a weekday) for an unavailable one-time exception', () => {
    const result = describeAvailabilityDeletion({
      isAvailable: false,
      kind: 'exception',
      dateLabel: 'Jul 24',
      timeLabel: '2:00 PM – 6:00 PM',
      personName: 'Sam Patel',
    });

    expect(result.severity).toBe('high');
    expect(result.heroText).toContain('Sam Patel');
    expect(result.heroText).toContain('Jul 24');
    expect(result.heroText).not.toContain('Wednesday');
    expect(result.needsAck).toBe(true);
  });

  it('returns a low-severity, no-ack description for an available one-time exception', () => {
    const result = describeAvailabilityDeletion({
      isAvailable: true,
      kind: 'exception',
      dateLabel: 'Jul 24',
      timeLabel: '2:00 PM – 6:00 PM',
      personName: 'Sam Patel',
    });

    expect(result.severity).toBe('low');
    expect(result.heroText).toBeNull();
    expect(result.needsAck).toBe(false);
  });
});
