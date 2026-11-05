import { describe, it, expect } from 'vitest';
import {
  convertRecurringToLocal,
  convertExceptionsToLocal,
  type RawExceptionAvail,
} from '../../supabase/functions/_shared/availability-tz';

const CST = 'America/Chicago'; // UTC-6 standard, UTC-5 DST

describe('convertRecurringToLocal', () => {
  const row = (start: string | null, end: string | null, dow = 5, avail = true) => ({
    employee_id: 'e1',
    day_of_week: dow,
    is_available: avail,
    start_time_local: start,
    end_time_local: end,
  });

  it('keeps a same-day window on its stored day', () => {
    expect(convertRecurringToLocal([row('10:00:00', '22:00:00')])).toEqual([
      expect.objectContaining({ day_of_week: 5, start_time: '10:00:00', end_time: '22:00:00' }),
    ]);
  });

  it('splits an overnight window into D and D+1', () => {
    const out = convertRecurringToLocal([row('18:00:00', '02:00:00')]);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ day_of_week: 5, start_time: '18:00:00', end_time: '24:00:00' });
    expect(out[1]).toMatchObject({ day_of_week: 6, start_time: '00:00:00', end_time: '02:00:00' });
  });

  it('wraps Saturday to Sunday', () => {
    expect(convertRecurringToLocal([row('18:00:00', '02:00:00', 6)])[1]).toMatchObject({ day_of_week: 0 });
  });

  it('makes no D+1 row for a midnight end', () => {
    const out = convertRecurringToLocal([row('18:00:00', '00:00:00')]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ day_of_week: 5, end_time: '24:00:00' });
  });

  it('never writes to D-1', () => {
    const days = convertRecurringToLocal([row('20:00:00', '23:00:00')]).map((r) => r.day_of_week);
    expect(days).toEqual([5]);
  });

  it('keeps a closed day in the same shape as convertOne', () => {
    expect(convertRecurringToLocal([row(null, null, 2, false)])).toEqual([
      {
        employee_id: 'e1',
        day_of_week: 2,
        is_available: false,
        start_time: null,
        end_time: null,
        isOvernight: false,
      },
    ]);
  });

  it('gives no output for an available row with null local values', () => {
    expect(convertRecurringToLocal([row(null, null, 2, true)])).toEqual([]);
  });
});

describe('convertExceptionsToLocal', () => {
  it('uses the exception date itself as the reference (not weekStart)', () => {
    const rows: RawExceptionAvail[] = [
      {
        employee_id: 'emp-2',
        date: '2026-11-18', // a Wednesday
        is_available: true,
        start_time: '14:00:00',
        end_time: '22:00:00',
      },
    ];
    const result = convertExceptionsToLocal(rows, CST);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      employee_id: 'emp-2',
      day_of_week: 3, // Wednesday
      is_available: true,
      start_time: '08:00:00',
      end_time: '16:00:00',
      isOvernight: false,
    });
  });

  it('splits overnight exceptions across local days', () => {
    const rows: RawExceptionAvail[] = [
      {
        employee_id: 'emp-2',
        date: '2026-11-18',
        is_available: true,
        start_time: '23:00:00',
        end_time: '07:00:00',
      },
    ];
    const result = convertExceptionsToLocal(rows, CST);
    expect(result).toHaveLength(2);
    expect(result.find((r) => r.day_of_week === 3)).toMatchObject({
      start_time: '17:00:00',
      end_time: '24:00:00',
    });
    expect(result.find((r) => r.day_of_week === 4)).toMatchObject({
      start_time: '00:00:00',
      end_time: '01:00:00',
    });
  });

  it('passes through null times unchanged', () => {
    const rows: RawExceptionAvail[] = [
      {
        employee_id: 'emp-2',
        date: '2026-11-18',
        is_available: true,
        start_time: null,
        end_time: null,
      },
    ];
    const result = convertExceptionsToLocal(rows, CST);
    expect(result[0]).toMatchObject({
      start_time: null,
      end_time: null,
      isOvernight: false,
      day_of_week: 3,
    });
  });
});
