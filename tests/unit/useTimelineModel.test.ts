import { describe, it, expect } from 'vitest';
import { deriveWindow } from '@/components/scheduling/ShiftTimeline/useTimelineModel';
import type { Shift } from '@/types/scheduling';

const shift = (start: string, end: string): Shift => ({
  id: start, restaurant_id: 'r', employee_id: 'e', start_time: start, end_time: end,
  break_duration: 0, position: 'Server', status: 'scheduled', is_published: false, source: 'manual',
  locked: false, created_at: '', updated_at: '',
} as Shift);

describe('deriveWindow', () => {
  it('floors start and ceils end to the hour', () => {
    // 10:30–16:15 CT
    const w = deriveWindow([shift('2026-07-11T15:30:00Z', '2026-07-11T21:15:00Z')], '2026-07-11', 'America/Chicago');
    expect(w.startMin).toBe(600); // 10:00
    expect(w.endMin).toBe(1020);  // 17:00
  });
  it('extends past 1440 for overnight shifts', () => {
    const w = deriveWindow([shift('2026-07-12T03:00:00Z', '2026-07-12T07:00:00Z')], '2026-07-11', 'America/Chicago'); // 22:00–02:00
    expect(w.startMin).toBe(1320); // 22:00
    expect(w.endMin).toBe(1560);   // 02:00 next day
  });
  it('returns a sane default span for an empty day', () => {
    const w = deriveWindow([], '2026-07-11', 'America/Chicago');
    expect(w.startMin).toBe(600);  // 10:00 default
    expect(w.endMin).toBe(1380);   // 23:00 default
  });
});
