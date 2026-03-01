import { describe, it, expect } from 'vitest';
import {
  OverlapPolicy,
  RestHoursPolicy,
  AvailabilityPolicy,
  TimeOffPolicy,
  OvertimeForecastPolicy,
} from '@/domain/scheduling/policies';
import type { PolicyContext } from '@/domain/scheduling/types';

const baseContext: PolicyContext = {
  employeeId: 'e1',
  proposedStartAt: '2026-02-28T14:00:00Z',
  proposedEndAt: '2026-02-28T22:00:00Z',
  businessDate: '2026-02-28',
  existingShifts: [],
};

describe('OverlapPolicy', () => {
  const policy = new OverlapPolicy();

  it('returns ok when no existing shifts', () => {
    expect(policy.evaluate(baseContext).outcome).toBe('ok');
  });

  it('returns ok when shifts do not overlap', () => {
    const result = policy.evaluate({
      ...baseContext,
      existingShifts: [{ shiftId: 's2', startAt: '2026-02-28T06:00:00Z', endAt: '2026-02-28T12:00:00Z' }],
    });
    expect(result.outcome).toBe('ok');
  });

  it('blocks when shifts overlap', () => {
    const result = policy.evaluate({
      ...baseContext,
      existingShifts: [{ shiftId: 's2', startAt: '2026-02-28T20:00:00Z', endAt: '2026-02-29T04:00:00Z' }],
    });
    expect(result.outcome).toBe('block');
    expect(result.code).toBe('POLICY_OVERLAP');
  });
});

describe('RestHoursPolicy', () => {
  const policy = new RestHoursPolicy();

  it('returns ok when sufficient rest (>= 8h)', () => {
    const result = policy.evaluate({
      ...baseContext,
      existingShifts: [{ shiftId: 's2', startAt: '2026-02-27T20:00:00Z', endAt: '2026-02-28T04:00:00Z' }],
    });
    expect(result.outcome).toBe('ok');
  });

  it('warns when insufficient rest (clopening)', () => {
    const result = policy.evaluate({
      ...baseContext,
      proposedStartAt: '2026-02-28T08:00:00Z',
      proposedEndAt: '2026-02-28T14:00:00Z',
      existingShifts: [{ shiftId: 's2', startAt: '2026-02-27T18:00:00Z', endAt: '2026-02-28T02:00:00Z' }],
    });
    expect(result.outcome).toBe('warn');
    expect(result.code).toBe('POLICY_INSUFFICIENT_REST');
  });

  it('returns ok when no prior shifts', () => {
    expect(policy.evaluate(baseContext).outcome).toBe('ok');
  });
});

describe('AvailabilityPolicy', () => {
  const policy = new AvailabilityPolicy();

  it('returns ok when no availability data', () => {
    expect(policy.evaluate(baseContext).outcome).toBe('ok');
  });

  it('returns ok when employee is available', () => {
    const result = policy.evaluate({
      ...baseContext,
      availability: [{ dayOfWeek: 6, startTime: '08:00', endTime: '23:00', isAvailable: true }],
    });
    expect(result.outcome).toBe('ok');
  });

  it('warns when employee is marked unavailable for the day', () => {
    const result = policy.evaluate({
      ...baseContext,
      availability: [{ dayOfWeek: 6, startTime: '08:00', endTime: '23:00', isAvailable: false }],
    });
    expect(result.outcome).toBe('warn');
    expect(result.code).toBe('POLICY_OUTSIDE_AVAILABILITY');
  });
});

describe('TimeOffPolicy', () => {
  const policy = new TimeOffPolicy();

  it('returns ok when no time-off requests', () => {
    expect(policy.evaluate(baseContext).outcome).toBe('ok');
  });

  it('blocks when approved time-off covers the date', () => {
    const result = policy.evaluate({
      ...baseContext,
      timeOffRequests: [{ startDate: '2026-02-27', endDate: '2026-03-01', status: 'approved' }],
    });
    expect(result.outcome).toBe('block');
    expect(result.code).toBe('POLICY_TIME_OFF');
  });

  it('returns ok when time-off is pending (not approved)', () => {
    const result = policy.evaluate({
      ...baseContext,
      timeOffRequests: [{ startDate: '2026-02-27', endDate: '2026-03-01', status: 'pending' }],
    });
    expect(result.outcome).toBe('ok');
  });

  it('returns ok when time-off does not cover the date', () => {
    const result = policy.evaluate({
      ...baseContext,
      timeOffRequests: [{ startDate: '2026-03-05', endDate: '2026-03-07', status: 'approved' }],
    });
    expect(result.outcome).toBe('ok');
  });
});

describe('OvertimeForecastPolicy', () => {
  const policy = new OvertimeForecastPolicy();

  it('returns ok when under weekly threshold', () => {
    const result = policy.evaluate({ ...baseContext, weeklyMinutesWorked: 1800 });
    expect(result.outcome).toBe('ok');
  });

  it('warns when proposed shift pushes into overtime', () => {
    const result = policy.evaluate({ ...baseContext, weeklyMinutesWorked: 2100 });
    expect(result.outcome).toBe('warn');
    expect(result.code).toBe('POLICY_OVERTIME_FORECAST');
  });

  it('returns ok when no weekly data provided', () => {
    expect(policy.evaluate(baseContext).outcome).toBe('ok');
  });
});
