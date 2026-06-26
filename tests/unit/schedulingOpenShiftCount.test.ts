/**
 * Tests for the openShiftCount logic in Scheduling.tsx.
 *
 * These tests assert the COVERAGE-based semantics:
 * - A fill-in shift that doesn't exactly match the template window still
 *   counts toward coverage (old exact-match code would report it as uncovered).
 * - The count uses computeSlotCoverage from @/lib/shiftCoverage (not
 *   buildTemplateGridData + computeOpenSpots from the old path).
 *
 * The tested function `computeOpenShiftCount` is a pure extraction of the
 * useMemo body so it can be unit-tested without mounting the full component.
 */
import { describe, it, expect } from 'vitest';
import { computeOpenShiftCount } from '@/pages/Scheduling';
import type { ShiftTemplate } from '@/types/scheduling';

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

// Helper: UTC ISO from local CDT (UTC-5 in summer)
// CDT = UTC-5; 10:00 local = 15:00Z
const CDT_OFFSET = 5; // hours behind UTC
function toCDTUtc(dateStr: string, localHour: number, localMin = 0): string {
  const h = localHour + CDT_OFFSET;
  const [y, mo, d] = dateStr.split('-');
  // handle day overflow
  if (h >= 24) {
    const nextDay = new Date(`${dateStr}T00:00:00Z`);
    nextDay.setUTCDate(nextDay.getUTCDate() + 1);
    const nd = nextDay.toISOString().slice(0, 10);
    return `${nd}T${String(h - 24).padStart(2, '0')}:${String(localMin).padStart(2, '0')}:00Z`;
  }
  return `${y}-${mo}-${d}T${String(h).padStart(2, '0')}:${String(localMin).padStart(2, '0')}:00Z`;
}

describe('computeOpenShiftCount — coverage-based banner count', () => {
  const tz = 'America/Chicago';
  // A Monday in the template's days array (Mon-Fri = [1..5])
  const weekDay = '2026-06-29'; // Monday

  it('fill-in shift with non-matching window still covers the slot => 0 open', () => {
    // Template: 10:00-16:30, cap 1.
    // Fill-in works 09:00-17:00 (wider than template window).
    // Old exact-match: assigned=0 => open=1 (phantom "needs staff")
    // New coverage: minConcurrent=1 => open=0
    const template = mkTemplate({ id: 't1', start_time: '10:00:00', end_time: '16:30:00', capacity: 1 });
    const shifts = [
      {
        id: 's1',
        restaurant_id: 'r1',
        employee_id: 'e1',
        start_time: toCDTUtc(weekDay, 9),   // 09:00 CDT
        end_time: toCDTUtc(weekDay, 17),     // 17:00 CDT
        position: 'Server',
        status: 'scheduled' as const,
        employee: { id: 'e1', name: 'Alice', position: 'Server', restaurant_id: 'r1', status: 'active' as const, is_active: true, created_at: '', updated_at: '' },
        break_duration: 0,
        is_published: false,
        locked: false,
        source: 'manual' as const,
        created_at: '',
        updated_at: '',
      },
    ];

    const count = computeOpenShiftCount([template], shifts, [weekDay], tz);
    expect(count).toBe(0); // fill-in covers the slot; no open spots
  });

  it('no shifts => 1 open per active template/day that applies', () => {
    const template = mkTemplate({ id: 't1', capacity: 1 });
    const count = computeOpenShiftCount([template], [], [weekDay], tz);
    expect(count).toBe(1);
  });

  it('two fill-ins whose union covers a cap-1 window => 0 open', () => {
    // Template: 14:00-18:00, cap 1. A covers 14-15, B covers 15-18.
    const template = mkTemplate({ id: 't1', start_time: '14:00:00', end_time: '18:00:00', capacity: 1 });
    const mkShift = (emp: string, sh: number, eh: number) => ({
      id: emp,
      restaurant_id: 'r1',
      employee_id: emp,
      start_time: toCDTUtc(weekDay, sh),
      end_time: toCDTUtc(weekDay, eh),
      position: 'Server',
      status: 'scheduled' as const,
      employee: { id: emp, name: emp, position: 'Server', restaurant_id: 'r1', status: 'active' as const, is_active: true, created_at: '', updated_at: '' },
      break_duration: 0,
      is_published: false,
      locked: false,
      source: 'manual' as const,
      created_at: '',
      updated_at: '',
    });
    const shifts = [mkShift('A', 14, 15), mkShift('B', 15, 18)];
    expect(computeOpenShiftCount([template], shifts, [weekDay], tz)).toBe(0);
  });

  it('shift covers only part of window (gap at end) => 1 open', () => {
    // Template: 10:00-18:00, cap 1. Shift: 10:00-14:00 — leaves 14:00-18:00 uncovered.
    const template = mkTemplate({ id: 't1', start_time: '10:00:00', end_time: '18:00:00', capacity: 1 });
    const shifts = [
      {
        id: 's1',
        restaurant_id: 'r1',
        employee_id: 'e1',
        start_time: toCDTUtc(weekDay, 10),
        end_time: toCDTUtc(weekDay, 14),
        position: 'Server',
        status: 'scheduled' as const,
        employee: { id: 'e1', name: 'Alice', position: 'Server', restaurant_id: 'r1', status: 'active' as const, is_active: true, created_at: '', updated_at: '' },
        break_duration: 0,
        is_published: false,
        locked: false,
        source: 'manual' as const,
        created_at: '',
        updated_at: '',
      },
    ];
    expect(computeOpenShiftCount([template], shifts, [weekDay], tz)).toBe(1);
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
