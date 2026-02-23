import { describe, it, expect } from 'vitest';
import {
  formatSlingDateInterval,
  parseSlingShiftEvents,
  parseSlingTimesheetEntries,
} from '../../src/utils/slingApiClientHelpers';

describe('formatSlingDateInterval', () => {
  it('formats two dates into ISO 8601 interval', () => {
    expect(formatSlingDateInterval('2026-01-15', '2026-01-16')).toBe(
      '2026-01-15T00:00:00/2026-01-16T23:59:59'
    );
  });

  it('handles same start and end date', () => {
    expect(formatSlingDateInterval('2026-03-01', '2026-03-01')).toBe(
      '2026-03-01T00:00:00/2026-03-01T23:59:59'
    );
  });
});

describe('parseSlingShiftEvents', () => {
  it('extracts shift data from calendar response', () => {
    const events = [
      {
        id: 12345,
        type: 'shift',
        dtstart: '2026-01-15T09:00:00',
        dtend: '2026-01-15T17:00:00',
        breakDuration: 30,
        status: 'published',
        user: { id: 99001 },
        location: { id: 1, name: 'Main Floor' },
        position: { id: 2, name: 'Server' },
      },
    ];
    const result = parseSlingShiftEvents(events);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      sling_shift_id: 12345,
      sling_user_id: 99001,
      shift_date: '2026-01-15',
      start_time: '2026-01-15T09:00:00',
      end_time: '2026-01-15T17:00:00',
      break_duration: 30,
      position: 'Server',
      location: 'Main Floor',
      status: 'published',
    });
  });

  it('skips non-shift events', () => {
    const events = [
      {
        id: 1,
        type: 'availability',
        dtstart: '2026-01-15T09:00:00',
        dtend: '2026-01-15T17:00:00',
      },
    ];
    expect(parseSlingShiftEvents(events)).toHaveLength(0);
  });

  it('handles missing user gracefully', () => {
    const events = [
      {
        id: 100,
        type: 'shift',
        dtstart: '2026-01-15T09:00:00',
        dtend: '2026-01-15T17:00:00',
      },
    ];
    const result = parseSlingShiftEvents(events);
    expect(result).toHaveLength(1);
    expect(result[0].sling_user_id).toBeNull();
  });

  it('handles missing position and location gracefully', () => {
    const events = [
      {
        id: 200,
        type: 'shift',
        dtstart: '2026-01-15T09:00:00',
        dtend: '2026-01-15T17:00:00',
        user: { id: 1 },
      },
    ];
    const result = parseSlingShiftEvents(events);
    expect(result).toHaveLength(1);
    expect(result[0].position).toBe('');
    expect(result[0].location).toBe('');
  });

  it('defaults breakDuration to 0 when missing', () => {
    const events = [
      {
        id: 300,
        type: 'shift',
        dtstart: '2026-01-15T09:00:00',
        dtend: '2026-01-15T17:00:00',
        user: { id: 1 },
      },
    ];
    const result = parseSlingShiftEvents(events);
    expect(result[0].break_duration).toBe(0);
  });

  it('defaults status to published when missing', () => {
    const events = [
      {
        id: 400,
        type: 'shift',
        dtstart: '2026-01-15T09:00:00',
        dtend: '2026-01-15T17:00:00',
        user: { id: 1 },
      },
    ];
    const result = parseSlingShiftEvents(events);
    expect(result[0].status).toBe('published');
  });

  it('processes multiple events and filters correctly', () => {
    const events = [
      { id: 1, type: 'shift', dtstart: '2026-01-15T09:00:00', dtend: '2026-01-15T13:00:00', user: { id: 10 } },
      { id: 2, type: 'availability', dtstart: '2026-01-15T09:00:00', dtend: '2026-01-15T17:00:00' },
      { id: 3, type: 'shift', dtstart: '2026-01-15T14:00:00', dtend: '2026-01-15T22:00:00', user: { id: 20 } },
      { id: 4, type: 'timeoff', dtstart: '2026-01-16T00:00:00', dtend: '2026-01-16T23:59:59' },
    ];
    const result = parseSlingShiftEvents(events);
    expect(result).toHaveLength(2);
    expect(result[0].sling_shift_id).toBe(1);
    expect(result[1].sling_shift_id).toBe(3);
  });
});

describe('parseSlingTimesheetEntries', () => {
  it('handles empty entries array', () => {
    expect(parseSlingTimesheetEntries([])).toHaveLength(0);
  });

  it('parses clock_in entries', () => {
    const entries = [
      {
        id: 60001,
        type: 'clock_in',
        timestamp: '2026-01-15T08:55:00',
        user: { id: 99001 },
        event: { id: 50001 },
      },
    ];
    const result = parseSlingTimesheetEntries(entries);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      sling_timesheet_id: 60001,
      sling_user_id: 99001,
      punch_type: 'clock_in',
      sling_shift_id: 50001,
      punch_time: '2026-01-15T08:55:00',
    });
  });

  it('parses clock_out entries', () => {
    const entries = [
      {
        id: 60002,
        type: 'clock_out',
        timestamp: '2026-01-15T17:05:00',
        user: { id: 99001 },
        event: { id: 50001 },
      },
    ];
    const result = parseSlingTimesheetEntries(entries);
    expect(result).toHaveLength(1);
    expect(result[0].punch_type).toBe('clock_out');
  });

  it('parses break_start and break_end entries', () => {
    const entries = [
      { id: 70001, type: 'break_start', timestamp: '2026-01-15T12:00:00', user: { id: 1 }, event: { id: 100 } },
      { id: 70002, type: 'break_end', timestamp: '2026-01-15T12:30:00', user: { id: 1 }, event: { id: 100 } },
    ];
    const result = parseSlingTimesheetEntries(entries);
    expect(result).toHaveLength(2);
    expect(result[0].punch_type).toBe('break_start');
    expect(result[1].punch_type).toBe('break_end');
  });

  it('skips unknown types', () => {
    const entries = [
      {
        id: 1,
        type: 'unknown_type',
        timestamp: '2026-01-15T08:55:00',
        user: { id: 1 },
      },
    ];
    expect(parseSlingTimesheetEntries(entries)).toHaveLength(0);
  });

  it('skips entries without user', () => {
    const entries = [
      { id: 1, type: 'clock_in', timestamp: '2026-01-15T08:55:00' },
    ];
    expect(parseSlingTimesheetEntries(entries)).toHaveLength(0);
  });

  it('skips entries without id', () => {
    const entries = [
      { type: 'clock_in', timestamp: '2026-01-15T08:55:00', user: { id: 1 } },
    ];
    expect(parseSlingTimesheetEntries(entries)).toHaveLength(0);
  });

  it('handles missing event (null sling_shift_id)', () => {
    const entries = [
      {
        id: 80001,
        type: 'clock_in',
        timestamp: '2026-01-15T08:55:00',
        user: { id: 99001 },
      },
    ];
    const result = parseSlingTimesheetEntries(entries);
    expect(result).toHaveLength(1);
    expect(result[0].sling_shift_id).toBeNull();
  });

  it('skips entries where user object exists but has no id', () => {
    const entries = [
      {
        id: 90001,
        type: 'clock_in',
        timestamp: '2026-01-15T08:55:00',
        user: { name: 'John' }, // no id
      },
    ];
    expect(parseSlingTimesheetEntries(entries)).toHaveLength(0);
  });
});

describe('parseSlingShiftEvents — edge cases', () => {
  it('skips shift events with null id', () => {
    const events = [
      {
        id: null,
        type: 'shift',
        dtstart: '2026-01-15T09:00:00',
        dtend: '2026-01-15T17:00:00',
        user: { id: 1 },
      },
    ];
    expect(parseSlingShiftEvents(events)).toHaveLength(0);
  });

  it('skips shift events with undefined id', () => {
    const events = [
      {
        type: 'shift',
        dtstart: '2026-01-15T09:00:00',
        dtend: '2026-01-15T17:00:00',
        user: { id: 1 },
      },
    ];
    expect(parseSlingShiftEvents(events)).toHaveLength(0);
  });

  it('handles empty events array', () => {
    expect(parseSlingShiftEvents([])).toHaveLength(0);
  });

  it('handles missing dtstart gracefully', () => {
    const events = [
      {
        id: 500,
        type: 'shift',
        dtend: '2026-01-15T17:00:00',
        user: { id: 1 },
      },
    ];
    const result = parseSlingShiftEvents(events);
    expect(result).toHaveLength(1);
    expect(result[0].shift_date).toBe('');
    expect(result[0].start_time).toBe('');
  });

  it('handles missing dtend gracefully', () => {
    const events = [
      {
        id: 600,
        type: 'shift',
        dtstart: '2026-01-15T09:00:00',
        user: { id: 1 },
      },
    ];
    const result = parseSlingShiftEvents(events);
    expect(result).toHaveLength(1);
    expect(result[0].end_time).toBe('');
  });
});
