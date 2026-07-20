import { describe, it, expect } from 'vitest';

import { appendOpenShiftClockOuts } from '@/utils/openShiftPunches';
import type { TimePunch } from '@/types/timeTracking';

const NOW = new Date('2026-07-20T16:20:00Z');

function punch(employee_id: string, punch_type: TimePunch['punch_type'], punch_time: string): TimePunch {
  return { id: `${employee_id}-${punch_type}-${punch_time}`, restaurant_id: 'r1', employee_id, punch_type, punch_time };
}

describe('appendOpenShiftClockOuts', () => {
  it('closes an open (clocked-in, no clock-out) shift at now', () => {
    const punches = [punch('e1', 'clock_in', '2026-07-20T09:00:00Z')];
    const out = appendOpenShiftClockOuts(punches, NOW);
    expect(out).toHaveLength(2);
    const synth = out[1];
    expect(synth.punch_type).toBe('clock_out');
    expect(synth.punch_time).toBe(NOW.toISOString());
    expect(synth.employee_id).toBe('e1');
    expect(synth.id).toContain('synthetic');
  });

  it('leaves a completed shift untouched', () => {
    const punches = [
      punch('e1', 'clock_in', '2026-07-20T09:00:00Z'),
      punch('e1', 'clock_out', '2026-07-20T15:00:00Z'),
    ];
    expect(appendOpenShiftClockOuts(punches, NOW)).toEqual(punches);
  });

  it('closes a shift that is currently on break (break_start last) with break_end + clock_out', () => {
    const punches = [
      punch('e1', 'clock_in', '2026-07-20T09:00:00Z'),
      punch('e1', 'break_start', '2026-07-20T16:00:00Z'),
    ];
    const out = appendOpenShiftClockOuts(punches, NOW);
    const added = out.slice(2).map((p) => p.punch_type);
    expect(added).toEqual(['break_end', 'clock_out']);
    expect(out[out.length - 1].punch_time).toBe(NOW.toISOString());
  });

  it('closes an open shift after a completed break (break_end last)', () => {
    const punches = [
      punch('e1', 'clock_in', '2026-07-20T09:00:00Z'),
      punch('e1', 'break_start', '2026-07-20T12:00:00Z'),
      punch('e1', 'break_end', '2026-07-20T12:30:00Z'),
    ];
    const out = appendOpenShiftClockOuts(punches, NOW);
    expect(out).toHaveLength(4);
    expect(out[3].punch_type).toBe('clock_out');
  });

  it('does NOT synthesize for a stale open shift older than maxShiftHours (forgotten clock-out)', () => {
    const punches = [punch('e1', 'clock_in', '2026-07-18T09:00:00Z')]; // ~55h before now
    expect(appendOpenShiftClockOuts(punches, NOW)).toEqual(punches);
  });

  it('handles multiple employees independently', () => {
    const punches = [
      punch('e1', 'clock_in', '2026-07-20T09:00:00Z'), // open
      punch('e2', 'clock_in', '2026-07-20T10:00:00Z'),
      punch('e2', 'clock_out', '2026-07-20T14:00:00Z'), // closed
      punch('e3', 'clock_in', '2026-07-20T11:00:00Z'), // open
    ];
    const out = appendOpenShiftClockOuts(punches, NOW);
    const synth = out.filter((p) => p.id.startsWith('synthetic'));
    expect(synth.map((p) => p.employee_id).sort()).toEqual(['e1', 'e3']);
  });
});
