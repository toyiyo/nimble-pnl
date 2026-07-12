import { describe, it, expect } from 'vitest';
import { buildTimelineBlocks, getImportSource } from '@/utils/manualTimelineBlocks';
import type { TimePunch } from '@/types/timeTracking';

const p = (type: string, iso: string, extra: Partial<TimePunch> = {}): TimePunch => ({
  id: `${type}-${iso}`,
  employee_id: 'e1',
  restaurant_id: 'r1',
  punch_type: type as TimePunch['punch_type'],
  punch_time: iso,
  created_at: iso,
  updated_at: iso,
  ...extra,
} as TimePunch);

// Local calendar day under test: Jul 10 2026 (constructed local → TZ-portable).
const day = new Date(2026, 6, 10);

describe('buildTimelineBlocks', () => {
  it('pairs a cross-midnight shift into ONE block on the clock-in day', () => {
    const punches = [
      p('clock_in', new Date(2026, 6, 10, 16, 45).toISOString()),
      p('clock_out', new Date(2026, 6, 11, 0, 37).toISOString()),
    ];
    const blocks = buildTimelineBlocks(punches, day);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].startTime.getTime()).toBe(new Date(2026, 6, 10, 16, 45).getTime());
    expect(blocks[0].endTime.getTime()).toBe(new Date(2026, 6, 11, 0, 37).getTime());
    expect(blocks[0].hasClockInTime).toBe(true);
    expect(blocks[0].hasClockOutTime).toBe(true);
    expect(blocks[0].clockInPunchId).toBeTruthy();
    expect(blocks[0].clockOutPunchId).toBeTruthy();
  });

  it('excludes the prior-night tail (clock-out lands on this day, clock-in was yesterday)', () => {
    const punches = [
      p('clock_in', new Date(2026, 6, 9, 20, 0).toISOString()),   // Jul 9 clock-in
      p('clock_out', new Date(2026, 6, 10, 0, 7).toISOString()),  // Jul 10 00:07 → belongs to Jul 9
    ];
    expect(buildTimelineBlocks(punches, day)).toHaveLength(0);
  });

  it('keeps normal same-day shifts and split shifts unchanged', () => {
    const punches = [
      p('clock_in', new Date(2026, 6, 10, 9, 0).toISOString()),
      p('clock_out', new Date(2026, 6, 10, 13, 0).toISOString()),
      p('clock_in', new Date(2026, 6, 10, 17, 0).toISOString()),
      p('clock_out', new Date(2026, 6, 10, 22, 0).toISOString()),
    ];
    const blocks = buildTimelineBlocks(punches, day);
    expect(blocks).toHaveLength(2);
  });

  it('ignores a shift that starts the NEXT day (pulled in by the buffer)', () => {
    const punches = [
      p('clock_in', new Date(2026, 6, 11, 10, 0).toISOString()),
      p('clock_out', new Date(2026, 6, 11, 18, 0).toISOString()),
    ];
    expect(buildTimelineBlocks(punches, day)).toHaveLength(0);
  });

  it('drops an unpaired lone clock-in (no block)', () => {
    const punches = [p('clock_in', new Date(2026, 6, 10, 16, 0).toISOString())];
    expect(buildTimelineBlocks(punches, day)).toHaveLength(0);
  });

  it('flags an imported block from device_info', () => {
    const punches = [
      p('clock_in', new Date(2026, 6, 10, 9, 0).toISOString(), { device_info: 'import:Toast' }),
      p('clock_out', new Date(2026, 6, 10, 17, 0).toISOString()),
    ];
    const blocks = buildTimelineBlocks(punches, day);
    expect(blocks[0].isImported).toBe(true);
    expect(blocks[0].importSource).toBe('Toast');
  });
});

describe('getImportSource', () => {
  it('parses the import source, or null when not imported', () => {
    expect(getImportSource(p('clock_in', '2026-07-10T09:00:00Z', { device_info: 'import:Sling' }))).toBe('Sling');
    expect(getImportSource(p('clock_in', '2026-07-10T09:00:00Z', { device_info: 'kiosk' }))).toBeNull();
    expect(getImportSource(undefined)).toBeNull();
  });
});
