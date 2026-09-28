import { describe, it, expect } from 'vitest';
import {
  getPunchLocationFlag,
  formatDistance,
  buildLocationFlagIndex,
  sessionLocationFlags,
  worstLocationFlag,
} from '@/utils/punchLocationFlag';
import type { TimePunch } from '@/types/timeTracking';
import type { WorkSession } from '@/utils/timePunchProcessing';

function makePunch(overrides: Partial<TimePunch>): TimePunch {
  return {
    id: overrides.id ?? 'punch-1',
    restaurant_id: 'rest-1',
    employee_id: overrides.employee_id ?? 'emp-1',
    punch_type: overrides.punch_type ?? 'clock_in',
    punch_time: overrides.punch_time ?? '2026-09-28T12:00:00Z',
    created_at: '2026-09-28T12:00:00Z',
    updated_at: '2026-09-28T12:00:00Z',
    ...overrides,
  };
}

describe('getPunchLocationFlag', () => {
  it('returns null for undefined location', () => {
    expect(getPunchLocationFlag(undefined)).toBeNull();
  });

  it('returns offsite when outside the geofence', () => {
    expect(
      getPunchLocationFlag({ within_geofence: false, distance_meters: 1200 })
    ).toBe('offsite');
  });

  it('returns null when inside the geofence', () => {
    expect(getPunchLocationFlag({ within_geofence: true })).toBeNull();
  });

  it('returns unavailable when the device has no location', () => {
    expect(getPunchLocationFlag({ location_unavailable: true })).toBe('unavailable');
  });

  it('returns null for coordinates with no flag', () => {
    expect(getPunchLocationFlag({ latitude: 1, longitude: 2 })).toBeNull();
  });
});

describe('formatDistance', () => {
  it('formats meters below 1000', () => {
    expect(formatDistance(450)).toBe('450 m');
    expect(formatDistance(999)).toBe('999 m');
  });

  it('formats 1000 meters as kilometers', () => {
    expect(formatDistance(1000)).toBe('1.0 km');
  });

  it('rounds kilometers to one decimal', () => {
    expect(formatDistance(1234)).toBe('1.2 km');
  });
});

describe('buildLocationFlagIndex', () => {
  it('keeps only flagged punches, grouped by employee_id, sorted by punch_time', () => {
    const punches: TimePunch[] = [
      makePunch({
        id: 'p1',
        employee_id: 'emp-1',
        punch_time: '2026-09-28T14:00:00Z',
        location: { within_geofence: false, distance_meters: 500 },
      }),
      makePunch({
        id: 'p2',
        employee_id: 'emp-1',
        punch_time: '2026-09-28T12:00:00Z',
        location: { within_geofence: false, distance_meters: 300 },
      }),
      makePunch({
        id: 'p3',
        employee_id: 'emp-1',
        punch_time: '2026-09-28T13:00:00Z',
        location: { within_geofence: true },
      }),
      makePunch({
        id: 'p4',
        employee_id: 'emp-2',
        punch_time: '2026-09-28T12:30:00Z',
        location: { location_unavailable: true },
      }),
    ];

    const index = buildLocationFlagIndex(punches);

    expect(Object.keys(index).sort()).toEqual(['emp-1', 'emp-2']);
    expect(index['emp-1'].map((p) => p.id)).toEqual(['p2', 'p1']);
    expect(index['emp-2'].map((p) => p.id)).toEqual(['p4']);
  });
});

describe('sessionLocationFlags', () => {
  const punches: TimePunch[] = [
    makePunch({
      id: 'p1',
      employee_id: 'emp-1',
      punch_time: '2026-09-28T12:30:00Z',
      location: { within_geofence: false, distance_meters: 300 },
    }),
    makePunch({
      id: 'p2',
      employee_id: 'emp-1',
      punch_time: '2026-09-28T16:00:00Z',
      location: { within_geofence: false, distance_meters: 400 },
    }),
    makePunch({
      id: 'p3',
      employee_id: 'emp-2',
      punch_time: '2026-09-28T13:00:00Z',
      location: { location_unavailable: true },
    }),
  ];
  const index = buildLocationFlagIndex(punches);

  it('returns flags for punches from clock_in to clock_out', () => {
    const session: WorkSession = {
      sessionId: 's1',
      employee_id: 'emp-1',
      employee_name: 'Jane',
      clock_in: new Date('2026-09-28T12:00:00Z'),
      clock_out: new Date('2026-09-28T17:00:00Z'),
      breaks: [],
      total_minutes: 300,
      break_minutes: 0,
      worked_minutes: 300,
      is_complete: true,
      has_anomalies: false,
      anomalies: [],
    };

    const flags = sessionLocationFlags(session, index);

    expect(flags.map((p) => p.id)).toEqual(['p1', 'p2']);
  });

  it('uses now for an open session', () => {
    const session: WorkSession = {
      sessionId: 's2',
      employee_id: 'emp-1',
      employee_name: 'Jane',
      clock_in: new Date('2026-09-28T12:00:00Z'),
      clock_out: undefined,
      breaks: [],
      total_minutes: 0,
      break_minutes: 0,
      worked_minutes: 0,
      is_complete: false,
      has_anomalies: false,
      anomalies: [],
    };

    const flags = sessionLocationFlags(session, index);

    expect(flags.map((p) => p.id)).toEqual(['p1', 'p2']);
  });

  it('does not include punches of another employee', () => {
    const session: WorkSession = {
      sessionId: 's3',
      employee_id: 'emp-1',
      employee_name: 'Jane',
      clock_in: new Date('2026-09-28T12:00:00Z'),
      clock_out: new Date('2026-09-28T17:00:00Z'),
      breaks: [],
      total_minutes: 300,
      break_minutes: 0,
      worked_minutes: 300,
      is_complete: true,
      has_anomalies: false,
      anomalies: [],
    };

    const flags = sessionLocationFlags(session, index);

    expect(flags.some((p) => p.employee_id === 'emp-2')).toBe(false);
  });
});

describe('worstLocationFlag', () => {
  it('returns null for an empty list', () => {
    expect(worstLocationFlag([])).toBeNull();
  });

  it('returns null when no punch is flagged', () => {
    const punches = [makePunch({ id: 'p1', location: { within_geofence: true } })];
    expect(worstLocationFlag(punches)).toBeNull();
  });

  it('picks the off-site punch with the largest distance', () => {
    const punches = [
      makePunch({ id: 'p1', location: { within_geofence: false, distance_meters: 300 } }),
      makePunch({ id: 'p2', location: { within_geofence: false, distance_meters: 900 } }),
      makePunch({ id: 'p3', location: { within_geofence: false, distance_meters: 500 } }),
    ];

    expect(worstLocationFlag(punches)?.id).toBe('p2');
  });

  it('picks off-site over unavailable', () => {
    const punches = [
      makePunch({ id: 'p1', location: { location_unavailable: true } }),
      makePunch({ id: 'p2', location: { within_geofence: false, distance_meters: 300 } }),
    ];

    expect(worstLocationFlag(punches)?.id).toBe('p2');
  });

  it('falls back to unavailable when there is no off-site punch', () => {
    const punches = [
      makePunch({ id: 'p1', location: { within_geofence: true } }),
      makePunch({ id: 'p2', location: { location_unavailable: true } }),
    ];

    expect(worstLocationFlag(punches)?.id).toBe('p2');
  });
});
