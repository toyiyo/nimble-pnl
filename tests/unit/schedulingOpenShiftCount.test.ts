/**
 * Tests for the openShiftCount logic in Scheduling.tsx.
 *
 * These tests assert the ASSIGNMENT-based semantics (see
 * docs/superpowers/specs/2026-07-20-shift-fill-by-assignment-design.md):
 * a template slot is filled when >= capacity DISTINCT employees are assigned
 * to *that template* (by shift_template_id, or the legacy exact-time/
 * position/day fallback used by buildTemplateGridData) — never by a
 * whole-floor position sweep. A same-position shift belonging to a
 * *different* template must never reduce this template's open count (the
 * bug this fixes — see the "1/1 with zero chips" regression).
 *
 * The tested function `computeOpenShiftCount` is a pure extraction of the
 * useMemo body so it can be unit-tested without mounting the full component.
 * It's built on `buildTemplateGridData` + `distinctAssignedCount` — the same
 * bucketing the grid uses for employee chips — so the banner and the chips
 * can never disagree.
 */
import { describe, it, expect } from 'vitest';
import { computeOpenShiftCount } from '@/pages/Scheduling';
import type { Shift, ShiftTemplate } from '@/types/scheduling';

// Helper: build a minimal ShiftTemplate
function mkTemplate(overrides: Partial<ShiftTemplate> & { id: string }): ShiftTemplate {
  return {
    restaurant_id: 'r1',
    name: 'Test',
    start_time: '10:00:00',
    end_time: '16:30:00',
    position: 'Server',
    days: [1, 2, 3, 4, 5], // Mon-Fri
    capacity: 1,
    is_active: true,
    break_duration: 0,
    created_at: '',
    updated_at: '',
    ...overrides,
  } as ShiftTemplate;
}

function mkShift(overrides: Partial<Shift> & { id: string; employee_id: string }): Shift {
  return {
    restaurant_id: 'r1',
    start_time: '2026-06-29T10:00:00',
    end_time: '2026-06-29T16:30:00',
    position: 'Server',
    status: 'scheduled',
    break_duration: 0,
    is_published: false,
    locked: false,
    source: 'manual',
    created_at: '',
    updated_at: '',
    ...overrides,
  } as Shift;
}

describe('computeOpenShiftCount — assignment-based banner count', () => {
  const tz = 'America/Chicago';
  // A Monday in the template's days array (Mon-Fri = [1..5])
  const weekDay = '2026-06-29'; // Monday

  it('no shifts => 1 open per active template/day that applies', () => {
    const template = mkTemplate({ id: 't1', capacity: 1 });
    const count = computeOpenShiftCount([template], [], [weekDay], tz);
    expect(count).toBe(1);
  });

  it('FK-assigned shift on this template fills the slot => 0 open', () => {
    const template = mkTemplate({ id: 't1', capacity: 1 });
    const shifts = [
      mkShift({ id: 's1', employee_id: 'e1', shift_template_id: 't1' }),
    ];
    expect(computeOpenShiftCount([template], shifts, [weekDay], tz)).toBe(0);
  });

  it('regression: a same-position shift FK-assigned to a DIFFERENT template does not reduce this one\'s open count', () => {
    // Two same-position, same-day templates (the Rush Bowls scenario). A shift
    // assigned to t2 must never satisfy t1's slot.
    const t1 = mkTemplate({ id: 't1', capacity: 1, start_time: '10:00:00', end_time: '16:30:00' });
    const t2 = mkTemplate({ id: 't2', capacity: 1, start_time: '10:00:00', end_time: '16:30:00' });
    const shifts = [
      mkShift({ id: 's1', employee_id: 'e1', shift_template_id: 't2' }),
    ];
    // t1 stays open (1), t2 is filled (0) => total 1.
    expect(computeOpenShiftCount([t1, t2], shifts, [weekDay], tz)).toBe(1);
  });

  it('legacy null-FK shift matching this template exactly (time/position/day) still fills it', () => {
    const template = mkTemplate({ id: 't1', capacity: 1, start_time: '10:00:00', end_time: '16:30:00' });
    const shifts = [
      mkShift({
        id: 's1',
        employee_id: 'e1',
        shift_template_id: null,
        start_time: '2026-06-29T10:00:00',
        end_time: '2026-06-29T16:30:00',
        position: 'Server',
      }),
    ];
    expect(computeOpenShiftCount([template], shifts, [weekDay], tz)).toBe(0);
  });

  it('legacy null-FK shift whose window does not exactly match the template leaves it open', () => {
    // This is the inverse of the old (buggy) coverage-sweep behavior: a
    // fill-in shift with a wider/partial window no longer "covers" the slot
    // unless it's actually assigned to this template.
    const template = mkTemplate({ id: 't1', capacity: 1, start_time: '10:00:00', end_time: '16:30:00' });
    const shifts = [
      mkShift({
        id: 's1',
        employee_id: 'e1',
        shift_template_id: null,
        start_time: '2026-06-29T09:00:00',
        end_time: '2026-06-29T17:00:00',
        position: 'Server',
      }),
    ];
    expect(computeOpenShiftCount([template], shifts, [weekDay], tz)).toBe(1);
  });

  it('cancelled shift assigned to this template does not count as filled', () => {
    const template = mkTemplate({ id: 't1', capacity: 1 });
    const shifts = [
      mkShift({ id: 's1', employee_id: 'e1', shift_template_id: 't1', status: 'cancelled' }),
    ];
    expect(computeOpenShiftCount([template], shifts, [weekDay], tz)).toBe(1);
  });

  it('one employee with two shifts on the same template/day dedupes to a single assignment', () => {
    const template = mkTemplate({ id: 't1', capacity: 2 });
    const shifts = [
      mkShift({ id: 's1', employee_id: 'e1', shift_template_id: 't1' }),
      mkShift({ id: 's2', employee_id: 'e1', shift_template_id: 't1' }),
    ];
    expect(computeOpenShiftCount([template], shifts, [weekDay], tz)).toBe(1);
  });

  it('over-assignment (2 FK-assigned employees on a capacity-1 template) has no open spots', () => {
    const template = mkTemplate({ id: 't1', capacity: 1 });
    const shifts = [
      mkShift({ id: 's1', employee_id: 'e1', shift_template_id: 't1' }),
      mkShift({ id: 's2', employee_id: 'e2', shift_template_id: 't1' }),
    ];
    expect(computeOpenShiftCount([template], shifts, [weekDay], tz)).toBe(0);
  });

  it('template not applicable on the day is skipped', () => {
    // Template only applies on weekends (days=[0,6]). weekDay is Monday => not applicable.
    const template = mkTemplate({ id: 't1', days: [0, 6], capacity: 1 });
    expect(computeOpenShiftCount([template], [], [weekDay], tz)).toBe(0);
  });

  it('multiple templates on same day accumulate open counts', () => {
    // Two cap-1 templates, no shifts => 2 open
    const t1 = mkTemplate({ id: 't1', start_time: '10:00:00', end_time: '14:00:00', capacity: 1 });
    const t2 = mkTemplate({ id: 't2', start_time: '16:00:00', end_time: '22:00:00', capacity: 1 });
    expect(computeOpenShiftCount([t1, t2], [], [weekDay], tz)).toBe(2);
  });

  it('spans multiple days — each day counted independently', () => {
    // Template applies Mon-Fri; two days passed in, no shifts => 2 open
    const template = mkTemplate({ id: 't1', capacity: 1 });
    const tuesday = '2026-06-30';
    expect(computeOpenShiftCount([template], [], [weekDay, tuesday], tz)).toBe(2);
  });
});
