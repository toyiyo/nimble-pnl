import { describe, expect, it } from 'vitest';

import { editFormToPunchTime, punchToEditForm } from '@/lib/punchEditForm';

/**
 * The corruption this guards: opening the edit dialog and saving without
 * touching the time must not move the instant. The old code formatted with the
 * browser's zone on read and re-parsed with the browser's zone on write, so any
 * manager outside the restaurant's zone shifted every punch they edited --
 * including edits that only changed `notes`.
 */
const RESTAURANT_TZ = 'America/Chicago';

describe('punch edit round trip', () => {
  const cases = [
    '2026-07-23T01:56:00.000Z', // Jul 22 20:56 Chicago
    '2026-07-22T10:00:00.000Z', // Jul 22 05:00 Chicago
    '2026-03-08T08:30:00.000Z', // spring forward, 03:30 CDT
    '2026-11-01T06:30:00.000Z', // fall back, 01:30 local
  ];

  it.each(cases)('preserves %s when only notes change', (stored) => {
    const form = punchToEditForm({ punch_time: stored, notes: 'before' }, RESTAURANT_TZ);
    const edited = { ...form, notes: 'after' };
    expect(editFormToPunchTime(edited, RESTAURANT_TZ)).toBe(stored);
  });

  it('shows the restaurant wall clock, not the viewer’s', () => {
    const form = punchToEditForm({ punch_time: '2026-07-23T01:56:00.000Z' }, RESTAURANT_TZ);
    expect(form.punch_time).toBe('2026-07-22T20:56');
  });

  it('normalises a null note to an empty string', () => {
    const form = punchToEditForm({ punch_time: '2026-07-23T01:56:00.000Z', notes: null }, RESTAURANT_TZ);
    expect(form.notes).toBe('');
  });

  it('applies an edited wall clock in the restaurant zone', () => {
    const saved = editFormToPunchTime(
      { punch_time: '2026-07-22T21:30', notes: '' },
      RESTAURANT_TZ,
    );
    expect(saved).toBe('2026-07-23T02:30:00.000Z');
  });
});
