import { describe, it, expect } from 'vitest';
import { deriveDefaultAvailability } from '@/lib/availabilityDefaults';

const T = (days: number[], start: string, end: string) => ({
  days,
  start_time: start,
  end_time: end,
});

describe('deriveDefaultAvailability', () => {
  it('returns exactly 7 rows, one per day_of_week 0..6, in order', () => {
    const rows = deriveDefaultAvailability({ templates: [] });
    expect(rows).toHaveLength(7);
    expect(rows.map((r) => r.day_of_week)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it('marks days with no template and no business_hours as is_available=false 09:00-17:00', () => {
    const rows = deriveDefaultAvailability({ templates: [] });
    for (const row of rows) {
      expect(row).toMatchObject({
        start_time: '09:00:00',
        end_time: '17:00:00',
        is_available: false,
      });
    }
  });

  it('uses MIN(start) and MAX(end) across templates that touch the day', () => {
    const templates = [
      T([1, 2, 3], '10:00:00', '18:00:00'),   // weekday open
      T([1, 2, 3], '07:00:00', '15:00:00'),   // weekday early
      T([5, 6],    '11:00:00', '23:00:00'),   // weekend close
    ];
    const rows = deriveDefaultAvailability({ templates });
    const monday = rows.find((r) => r.day_of_week === 1)!;
    const saturday = rows.find((r) => r.day_of_week === 6)!;
    const sunday = rows.find((r) => r.day_of_week === 0)!;

    expect(monday).toMatchObject({
      day_of_week: 1,
      start_time: '07:00:00',
      end_time: '18:00:00',
      is_available: true,
    });
    expect(saturday).toMatchObject({
      day_of_week: 6,
      start_time: '11:00:00',
      end_time: '23:00:00',
      is_available: true,
    });
    // Sunday has no templates and no business_hours → closed default
    expect(sunday).toMatchObject({
      day_of_week: 0,
      start_time: '09:00:00',
      end_time: '17:00:00',
      is_available: false,
    });
  });

  it('honors business_hours fallback when no template covers the day', () => {
    const rows = deriveDefaultAvailability({
      templates: [T([1], '10:00:00', '18:00:00')],
      businessHours: {
        0: { open: '08:00:00', close: '14:00:00', is_closed: false },
        2: { open: '09:00:00', close: '17:00:00', is_closed: true },
      },
    });
    const sunday = rows.find((r) => r.day_of_week === 0)!;
    const tuesday = rows.find((r) => r.day_of_week === 2)!;

    expect(sunday).toMatchObject({
      day_of_week: 0,
      start_time: '08:00:00',
      end_time: '14:00:00',
      is_available: true,
    });
    // is_closed=true → closed default, NOT business_hours window
    expect(tuesday).toMatchObject({
      day_of_week: 2,
      start_time: '09:00:00',
      end_time: '17:00:00',
      is_available: false,
    });
  });

  it('handles HH:MM (no seconds) template values by normalizing to HH:MM:SS', () => {
    const rows = deriveDefaultAvailability({
      templates: [{ days: [3], start_time: '08:30', end_time: '22:30' }],
    });
    const wednesday = rows.find((r) => r.day_of_week === 3)!;
    expect(wednesday.start_time).toBe('08:30:00');
    expect(wednesday.end_time).toBe('22:30:00');
    expect(wednesday.is_available).toBe(true);
  });
});
