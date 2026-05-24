import { describe, it, expect } from 'vitest';
import traceFixture from '../fixtures/schedule-solver-trace.json';
import largeFixture from '../fixtures/schedule-solver-large.json';
import { solveSchedule } from '../../supabase/functions/_shared/schedule-solver';

function toCtx(raw: unknown) {
  const r = raw as Record<string, unknown>;
  return {
    ...r,
    requiredStaff: new Map(Object.entries(r.requiredStaff as Record<string, unknown>)),
    excludedEmployeeIds: new Set((r.excludedEmployeeIds as string[]) ?? []),
  } as unknown as Parameters<typeof solveSchedule>[0];
}

function p95(samples: number[]): number {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length * 0.95)];
}

describe('schedule-solver perf gate', () => {
  it('trace fixture: p95 < 250ms, max < 500ms over 20 iterations', () => {
    const ctx = toCtx(traceFixture);
    const samples: number[] = [];
    for (let i = 0; i < 20; i++) {
      const t0 = performance.now();
      solveSchedule(ctx);
      samples.push(performance.now() - t0);
    }
    const p = p95(samples);
    const max = Math.max(...samples);
    console.log(`[perf] trace p95=${p.toFixed(1)}ms max=${max.toFixed(1)}ms`);
    expect(p).toBeLessThan(250);
    expect(max).toBeLessThan(500);
  });

  it('large fixture: p95 < 800ms, max < 1500ms over 20 iterations', () => {
    const ctx = toCtx(largeFixture);
    const samples: number[] = [];
    for (let i = 0; i < 20; i++) {
      const t0 = performance.now();
      solveSchedule(ctx);
      samples.push(performance.now() - t0);
    }
    const p = p95(samples);
    const max = Math.max(...samples);
    console.log(`[perf] large p95=${p.toFixed(1)}ms max=${max.toFixed(1)}ms`);
    expect(p).toBeLessThan(800);
    expect(max).toBeLessThan(1500);
  });
});
