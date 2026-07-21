/**
 * Tests for ShiftCell's React.memo comparator (Task 5, design doc Major C3).
 *
 * The coverage map (`coverageByTemplateDay`) is rebuilt wholesale on every
 * planner edit, so `prev.coverage === next.coverage` (identity) always fails —
 * ShiftCell re-renders on every edit regardless of whether its own slot
 * actually changed. The fix: compare the primitive fields that actually drive
 * ShiftCell's render (`openSpots`, `coveragePct`, `coveringEmployees.length`,
 * `loanedOut.length`) instead of object identity.
 *
 * `React.memo(Component, compare)` exposes the comparator as `.compare` on the
 * returned memo object — call it directly rather than trying to infer
 * re-renders indirectly through DOM diffing.
 */
import { describe, it, expect, vi } from 'vitest';
import { ShiftCell } from '@/components/scheduling/ShiftPlanner/ShiftCell';
import type { Shift, SlotCoverage } from '@/types/scheduling';

vi.mock('@dnd-kit/core', () => ({
  useDroppable: () => ({ isOver: false, setNodeRef: () => {} }),
}));

function makeCoverage(overrides?: Partial<SlotCoverage>): SlotCoverage {
  return {
    minConcurrent: 1,
    openSpots: 0,
    coveragePct: 100,
    segments: [{ startMin: 600, endMin: 990, covered: true }],
    coveringEmployees: [{ employeeId: 'e1', employeeName: 'Alice', startMin: 600, endMin: 990 }],
    loanedOut: [],
    ...overrides,
  };
}

const BASE_PROPS = {
  templateId: 't1',
  day: '2026-06-27',
  isActiveDay: true,
  shifts: [] as Shift[],
  capacity: 1,
  onRemoveShift: vi.fn(),
};

describe("ShiftCell memo comparator (.compare) — value-based coverage comparison", () => {
  it('exposes a .compare function (React.memo second arg)', () => {
    expect(typeof (ShiftCell as unknown as { compare?: unknown }).compare).toBe('function');
  });

  it('returns true (skip re-render) when coverage is a new object reference but all compared fields are equal', () => {
    const compare = (ShiftCell as unknown as {
      compare: (prev: Record<string, unknown>, next: Record<string, unknown>) => boolean;
    }).compare;
    const prevCoverage = makeCoverage();
    const nextCoverage = makeCoverage(); // structurally equal, different reference
    expect(prevCoverage).not.toBe(nextCoverage);

    const equal = compare(
      { ...BASE_PROPS, coverage: prevCoverage },
      { ...BASE_PROPS, coverage: nextCoverage },
    );
    expect(equal).toBe(true);
  });

  it('returns false when openSpots differs', () => {
    const compare = (ShiftCell as unknown as {
      compare: (prev: Record<string, unknown>, next: Record<string, unknown>) => boolean;
    }).compare;
    const equal = compare(
      { ...BASE_PROPS, coverage: makeCoverage({ openSpots: 0 }) },
      { ...BASE_PROPS, coverage: makeCoverage({ openSpots: 1 }) },
    );
    expect(equal).toBe(false);
  });

  it('returns false when coveragePct differs', () => {
    const compare = (ShiftCell as unknown as {
      compare: (prev: Record<string, unknown>, next: Record<string, unknown>) => boolean;
    }).compare;
    const equal = compare(
      { ...BASE_PROPS, coverage: makeCoverage({ coveragePct: 50 }) },
      { ...BASE_PROPS, coverage: makeCoverage({ coveragePct: 80 }) },
    );
    expect(equal).toBe(false);
  });

  it('returns false when coveringEmployees.length differs', () => {
    const compare = (ShiftCell as unknown as {
      compare: (prev: Record<string, unknown>, next: Record<string, unknown>) => boolean;
    }).compare;
    const equal = compare(
      { ...BASE_PROPS, coverage: makeCoverage({ coveringEmployees: [] }) },
      {
        ...BASE_PROPS,
        coverage: makeCoverage({
          coveringEmployees: [{ employeeId: 'e1', startMin: 600, endMin: 990 }],
        }),
      },
    );
    expect(equal).toBe(false);
  });

  it('returns false when loanedOut.length differs', () => {
    const compare = (ShiftCell as unknown as {
      compare: (prev: Record<string, unknown>, next: Record<string, unknown>) => boolean;
    }).compare;
    const equal = compare(
      { ...BASE_PROPS, coverage: makeCoverage({ loanedOut: [] }) },
      {
        ...BASE_PROPS,
        coverage: makeCoverage({
          loanedOut: [{ employeeId: 'e2', startMin: 600, endMin: 990 }],
        }),
      },
    );
    expect(equal).toBe(false);
  });

  it('returns false when coverage goes from undefined to defined (or vice versa)', () => {
    const compare = (ShiftCell as unknown as {
      compare: (prev: Record<string, unknown>, next: Record<string, unknown>) => boolean;
    }).compare;
    expect(
      compare({ ...BASE_PROPS, coverage: undefined }, { ...BASE_PROPS, coverage: makeCoverage() }),
    ).toBe(false);
    expect(
      compare({ ...BASE_PROPS, coverage: makeCoverage() }, { ...BASE_PROPS, coverage: undefined }),
    ).toBe(false);
  });

  it('returns true when both coverage values are undefined', () => {
    const compare = (ShiftCell as unknown as {
      compare: (prev: Record<string, unknown>, next: Record<string, unknown>) => boolean;
    }).compare;
    expect(
      compare({ ...BASE_PROPS, coverage: undefined }, { ...BASE_PROPS, coverage: undefined }),
    ).toBe(true);
  });

  it('still returns false when an unrelated primitive prop changes (e.g. templateId)', () => {
    const compare = (ShiftCell as unknown as {
      compare: (prev: Record<string, unknown>, next: Record<string, unknown>) => boolean;
    }).compare;
    const coverage = makeCoverage();
    const equal = compare(
      { ...BASE_PROPS, templateId: 't1', coverage },
      { ...BASE_PROPS, templateId: 't2', coverage },
    );
    expect(equal).toBe(false);
  });
});
