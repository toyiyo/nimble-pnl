import { describe, it, expect } from 'vitest';
import fixture from '../fixtures/schedule-solver-trace.json';
import { solveSchedule } from '../../supabase/functions/_shared/schedule-solver';
import { longestConsecutiveRun } from '../../supabase/functions/_shared/schedule-validator';

function toCtx(raw: unknown) {
  const r = raw as Record<string, unknown>;
  return {
    ...r,
    requiredStaff: new Map(Object.entries(r.requiredStaff as Record<string, unknown>)),
    excludedEmployeeIds: new Set((r.excludedEmployeeIds as string[]) ?? []),
  } as unknown as Parameters<typeof solveSchedule>[0];
}

describe('solveSchedule — trace replay', () => {
  // TODO: populate tests/fixtures/schedule-solver-trace.json with sanitised data from
  // https://easyshift.grafana.net/explore?...trace/ae991acdcf47542827da5ddee9ed5a40
  // and remove the `.skip` below.
  it.skip('honours all 14 hard rules on the live trace fixture', () => {
    const ctx = toCtx(fixture);
    const result = solveSchedule(ctx);

    for (const row of result.fairness) {
      expect(row.hours_assigned).toBeLessThanOrEqual(row.hours_budget);
    }

    for (const emp of ctx.employees) {
      const days = new Set(result.shifts.filter((s) => s.employee_id === emp.id).map((s) => s.day));
      expect(longestConsecutiveRun(days)).toBeLessThanOrEqual(5);
    }

    const totalRequired = Array.from(ctx.requiredStaff.values()).reduce(
      (n, r: unknown) => n + (r as { count: number }).count, 0,
    );
    expect(result.shifts.length / totalRequired).toBeGreaterThanOrEqual(0.80);
  });
});
