import type { PolicyContext, PolicyResult, ShiftPolicy } from './types';
import { MIN_REST_HOURS, DEFAULT_OT_WEEKLY_MINUTES } from './types';

function parseProposed(ctx: PolicyContext): { pStart: number; pEnd: number } {
  return { pStart: Date.parse(ctx.proposedStartAt), pEnd: Date.parse(ctx.proposedEndAt) };
}

export class OverlapPolicy implements ShiftPolicy {
  evaluate(ctx: PolicyContext): PolicyResult {
    const { pStart, pEnd } = parseProposed(ctx);
    for (const shift of ctx.existingShifts) {
      if (pStart < Date.parse(shift.endAt) && Date.parse(shift.startAt) < pEnd) {
        return { outcome: 'block', code: 'POLICY_OVERLAP', message: `Overlaps with shift ${shift.shiftId}` };
      }
    }
    return { outcome: 'ok' };
  }
}

export class RestHoursPolicy implements ShiftPolicy {
  evaluate(ctx: PolicyContext): PolicyResult {
    const { pStart, pEnd } = parseProposed(ctx);
    for (const shift of ctx.existingShifts) {
      const gapBefore = (pStart - Date.parse(shift.endAt)) / 3_600_000;
      if (gapBefore > 0 && gapBefore < MIN_REST_HOURS) {
        return { outcome: 'warn', code: 'POLICY_INSUFFICIENT_REST', message: `Only ${gapBefore.toFixed(1)}h rest after shift ${shift.shiftId} (minimum ${MIN_REST_HOURS}h)` };
      }
      const gapAfter = (Date.parse(shift.startAt) - pEnd) / 3_600_000;
      if (gapAfter > 0 && gapAfter < MIN_REST_HOURS) {
        return { outcome: 'warn', code: 'POLICY_INSUFFICIENT_REST', message: `Only ${gapAfter.toFixed(1)}h rest before shift ${shift.shiftId} (minimum ${MIN_REST_HOURS}h)` };
      }
    }
    return { outcome: 'ok' };
  }
}

export class AvailabilityPolicy implements ShiftPolicy {
  evaluate(ctx: PolicyContext): PolicyResult {
    if (!ctx.availability?.length) return { outcome: 'ok' };
    const shiftDate = new Date(ctx.businessDate + 'T00:00:00Z');
    const dayOfWeek = shiftDate.getUTCDay();
    const match = ctx.availability.find((a) => a.dayOfWeek === dayOfWeek);
    if (match && !match.isAvailable) {
      return { outcome: 'warn', code: 'POLICY_OUTSIDE_AVAILABILITY', message: `Employee is marked unavailable on day ${dayOfWeek}` };
    }
    return { outcome: 'ok' };
  }
}

export class TimeOffPolicy implements ShiftPolicy {
  evaluate(ctx: PolicyContext): PolicyResult {
    if (!ctx.timeOffRequests?.length) return { outcome: 'ok' };
    for (const req of ctx.timeOffRequests) {
      if (req.status !== 'approved') continue;
      if (ctx.businessDate >= req.startDate && ctx.businessDate <= req.endDate) {
        return { outcome: 'block', code: 'POLICY_TIME_OFF', message: `Employee has approved time off from ${req.startDate} to ${req.endDate}` };
      }
    }
    return { outcome: 'ok' };
  }
}

export class OvertimeForecastPolicy implements ShiftPolicy {
  evaluate(ctx: PolicyContext): PolicyResult {
    if (ctx.weeklyMinutesWorked == null) return { outcome: 'ok' };
    const { pStart, pEnd } = parseProposed(ctx);
    const totalMinutes = ctx.weeklyMinutesWorked + (pEnd - pStart) / 60_000;
    if (totalMinutes > DEFAULT_OT_WEEKLY_MINUTES) {
      return { outcome: 'warn', code: 'POLICY_OVERTIME_FORECAST', message: `Projected ${(totalMinutes / 60).toFixed(1)}h this week (threshold: ${DEFAULT_OT_WEEKLY_MINUTES / 60}h)` };
    }
    return { outcome: 'ok' };
  }
}
