import { describe, it, expect } from 'vitest';
import { solveSchedule } from '../../supabase/functions/_shared/schedule-solver';
import { validateGeneratedShifts } from '../../supabase/functions/_shared/schedule-validator';
import fixture from '../fixtures/schedule-solver-trace.json';

function toCtx(raw: unknown) {
  const r = raw as Record<string, unknown>;
  return {
    ...r,
    requiredStaff: new Map(Object.entries((r.requiredStaff as Record<string, unknown>) ?? {})),
    excludedEmployeeIds: new Set((r.excludedEmployeeIds as string[]) ?? []),
  } as unknown as Parameters<typeof solveSchedule>[0];
}

describe('Solver → validator (defense-in-depth)', () => {
  it('every solver-emitted shift passes the validator with zero drops', () => {
    const ctx = toCtx(fixture);
    const result = solveSchedule(ctx);

    const validationCtx = {
      employees: new Map(ctx.employees.map((e: any) => [e.id, {
        position: e.position, is_minor: e.is_minor, max_weekly_hours: e.max_weekly_hours,
      }])),
      templates: new Map(ctx.templates.map((t: any) => [t.id, {
        days: t.days_of_week, position: t.position,
      }])),
      availability: new Map<string, any>(),
      excludedEmployeeIds: ctx.excludedEmployeeIds,
      existingShifts: ctx.lockedShifts ?? [],
    };
    for (const [empId, byDay] of Object.entries(ctx.availability as Record<string, any>)) {
      for (const [dow, slot] of Object.entries(byDay)) {
        validationCtx.availability.set(`${empId}:${dow}`, slot as any);
      }
    }
    const vr = validateGeneratedShifts(result.shifts, validationCtx as any);
    expect(vr.dropped).toEqual([]);
  });
});
