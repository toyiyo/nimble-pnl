/**
 * Tests for ShiftCell compact accessible coverage indicator (Task 9).
 *
 * RED → GREEN → REFACTOR TDD cycle.
 *
 * Invariants:
 * 1. Renders a <button> (not a <div>) for the coverage indicator.
 * 2. button has aria-label containing coverage % and "Open details".
 * 3. Uses semantic tokens only — no hard-coded colors (text-amber-600 / text-emerald-600 / text-red-500).
 * 4. Shows AlertTriangle icon when openSpots > 0.
 * 5. Does NOT render the indicator when coveragePct === 100 AND shifts.length <= 1 (noise-reduction).
 * 6. Calls onCoverageClick with (templateId, day, rect) when clicked; stopPropagation fires.
 * 7. React.memo comparator includes coverage reference check.
 * 8. When coverage is undefined, falls back gracefully (no crash, old capacity badge shows if capacity > 1).
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/react';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { ShiftCell } from '@/components/scheduling/ShiftPlanner/ShiftCell';
import type { Shift, SlotCoverage } from '@/types/scheduling';

// ── typed fixture helper ──────────────────────────────────────────────────────
function makeShift(overrides?: Partial<Shift>): Shift {
  return {
    id: 's1',
    restaurant_id: 'r1',
    employee_id: 'e1',
    start_time: '2026-06-27T15:00:00Z',
    end_time: '2026-06-27T23:00:00Z',
    break_duration: 0,
    position: 'Server',
    status: 'scheduled',
    is_published: true,
    locked: false,
    source: 'manual',
    created_at: '2026-06-27T00:00:00Z',
    updated_at: '2026-06-27T00:00:00Z',
    ...overrides,
  };
}

vi.mock('@dnd-kit/core', () => ({
  useDroppable: () => ({ isOver: false, setNodeRef: () => {} }),
}));

// ── helpers ──────────────────────────────────────────────────────────────────
function makeCoverage(overrides?: Partial<SlotCoverage>): SlotCoverage {
  return {
    minConcurrent: 1,
    openSpots: 0,
    coveragePct: 100,
    segments: [{ startMin: 600, endMin: 990, covered: true }],
    coveringEmployees: [{ employeeId: 'e1', employeeName: 'Alice', startMin: 600, endMin: 990 }],
    ...overrides,
  };
}

const BASE_PROPS = {
  templateId: 't1',
  day: '2026-06-27',
  isActiveDay: true,
  shifts: [],
  capacity: 1,
  onRemoveShift: vi.fn(),
};

// ── render tests ──────────────────────────────────────────────────────────────

describe('ShiftCell coverage indicator — render tests', () => {
  it('renders a <button> (not div) for the coverage indicator when coverage has a gap', () => {
    const coverage = makeCoverage({ coveragePct: 47, openSpots: 1, minConcurrent: 0 });
    render(<ShiftCell {...BASE_PROPS} coverage={coverage} />);
    // There should be a button with aria-label containing "Coverage"
    const btn = screen.getByRole('button', { name: /Coverage/i });
    expect(btn.tagName).toBe('BUTTON');
  });

  it('aria-label includes filled/capacity counts and "Open details"', () => {
    // New format: "<slotName|Coverage> <day>: X of N staffed[, needs M more]. Open details"
    // BASE_PROPS has capacity=1, coverage has openSpots=1 → 0 of 1 staffed, needs 1 more
    const coverage = makeCoverage({ coveragePct: 47, openSpots: 1, minConcurrent: 0 });
    render(<ShiftCell {...BASE_PROPS} coverage={coverage} />);
    const btn = screen.getByRole('button', { name: /Coverage/i });
    const label = btn.getAttribute('aria-label') ?? '';
    expect(label).toMatch(/of 1 staffed/i);
    expect(label).toMatch(/Open details/i);
  });

  it('aria-label mentions needs N more when openSpots > 0', () => {
    const coverage = makeCoverage({ coveragePct: 47, openSpots: 2, minConcurrent: 0 });
    render(<ShiftCell {...BASE_PROPS} coverage={coverage} />);
    const btn = screen.getByRole('button', { name: /Coverage/i });
    expect(btn.getAttribute('aria-label')).toMatch(/needs 2 more/i);
  });

  it('shows AlertTriangle (non-color cue) when openSpots > 0', () => {
    const coverage = makeCoverage({ coveragePct: 47, openSpots: 1, minConcurrent: 0 });
    render(<ShiftCell {...BASE_PROPS} coverage={coverage} />);
    // AlertTriangle is aria-hidden; confirm by checking screen.getByText still works via sr-only
    // and that there is a visible non-text cue (the parent button is rendered)
    const btn = screen.getByRole('button', { name: /Coverage/i });
    // The button should have a child with aria-hidden (the icon)
    const ariaHiddenChildren = btn.querySelectorAll('[aria-hidden="true"]');
    expect(ariaHiddenChildren.length).toBeGreaterThan(0);
  });

  it('does NOT render coverage indicator when coveragePct === 100 AND shifts.length >= 1', () => {
    const coverage = makeCoverage({ coveragePct: 100, openSpots: 0 });
    // One placed shift → suppress (assignee chip already signals full coverage).
    const shifts: Shift[] = [
      makeShift({ id: 's1', employee_id: 'e1', employee: { name: 'Alice' } as Shift['employee'] }),
    ];
    render(<ShiftCell {...BASE_PROPS} coverage={coverage} shifts={shifts} />);
    const btns = screen.queryAllByRole('button', { name: /Coverage/i });
    expect(btns.length).toBe(0);
  });

  it('DOES render coverage indicator when coveragePct === 100 AND shifts.length === 0 (non-template fill-in)', () => {
    const coverage = makeCoverage({ coveragePct: 100, openSpots: 0 });
    // No placed shift in this bucket but coverage engine says full → show indicator
    // so the cell doesn't appear empty when it's actually covered by a fill-in.
    render(<ShiftCell {...BASE_PROPS} coverage={coverage} shifts={[]} />);
    const btn = screen.getByRole('button', { name: /Coverage/i });
    expect(btn).toBeTruthy();
  });

  it('does NOT render coverage indicator when coverage is undefined', () => {
    render(<ShiftCell {...BASE_PROPS} />);
    const btns = screen.queryAllByRole('button', { name: /Coverage/i });
    expect(btns.length).toBe(0);
  });

  it('calls onCoverageClick with templateId and day when indicator is clicked', () => {
    const onCoverageClick = vi.fn();
    const coverage = makeCoverage({ coveragePct: 47, openSpots: 1 });
    render(
      <ShiftCell
        {...BASE_PROPS}
        coverage={coverage}
        onCoverageClick={onCoverageClick}
      />,
    );
    const btn = screen.getByRole('button', { name: /Coverage/i });
    fireEvent.click(btn);
    expect(onCoverageClick).toHaveBeenCalledOnce();
    const [tid, day] = onCoverageClick.mock.calls[0];
    expect(tid).toBe('t1');
    expect(day).toBe('2026-06-27');
  });

  it('uses text-destructive for gap indicator (no hard-coded color class)', () => {
    const coverage = makeCoverage({ coveragePct: 47, openSpots: 1 });
    render(<ShiftCell {...BASE_PROPS} coverage={coverage} />);
    const btn = screen.getByRole('button', { name: /Coverage/i });
    // Must use semantic token, not raw color
    expect(btn.className).toContain('text-destructive');
    expect(btn.className).not.toMatch(/text-red-[0-9]/);
    expect(btn.className).not.toMatch(/text-amber-[0-9]/);
    expect(btn.className).not.toMatch(/text-emerald-[0-9]/);
  });

  it('uses text-muted-foreground for fully-covered indicator (no hard-coded color)', () => {
    const coverage = makeCoverage({ coveragePct: 100, openSpots: 0 });
    // 0 shifts in bucket but fully covered (non-template fill-in) → indicator shows
    render(<ShiftCell {...BASE_PROPS} coverage={coverage} shifts={[]} />);
    const btn = screen.getByRole('button', { name: /Coverage/i });
    expect(btn.className).toContain('text-muted-foreground');
    expect(btn.className).not.toMatch(/text-emerald-[0-9]/);
  });
});

// ── slotName prop — aria-label slot identity (Task 2e) ───────────────────────

describe('ShiftCell coverage indicator — slotName aria-label (Task 2e)', () => {
  it('uses slotName in aria-label when provided (area + position)', () => {
    const coverage = makeCoverage({ coveragePct: 100, openSpots: 0 });
    render(
      <ShiftCell
        {...BASE_PROPS}
        capacity={2}
        coverage={coverage}
        slotName="Cold Stone Server"
        shifts={[]}
      />,
    );
    // aria-label must start with the slotName, not bare "Coverage"
    const btn = screen.getByRole('button');
    const label = btn.getAttribute('aria-label') ?? '';
    expect(label).toMatch(/Cold Stone Server/i);
    expect(label).toMatch(/Open details/i);
  });

  it('aria-label includes filled/capacity counts when slotName is provided', () => {
    const coverage = makeCoverage({ coveragePct: 50, openSpots: 1 });
    render(
      <ShiftCell
        {...BASE_PROPS}
        capacity={2}
        coverage={coverage}
        slotName="Wetzel's Server"
        shifts={[]}
      />,
    );
    const btn = screen.getByRole('button');
    const label = btn.getAttribute('aria-label') ?? '';
    expect(label).toMatch(/1 of 2 staffed/i);
    expect(label).toMatch(/needs 1 more/i);
  });

  it('falls back to "Coverage" in aria-label when slotName is omitted', () => {
    const coverage = makeCoverage({ coveragePct: 50, openSpots: 1 });
    render(<ShiftCell {...BASE_PROPS} coverage={coverage} shifts={[]} />);
    const btn = screen.getByRole('button', { name: /Coverage/i });
    expect(btn).toBeTruthy();
  });
});

// ── source-text tests (memo comparator + no raw colors in source) ─────────────
const SRC = readFileSync(
  resolve(__dirname, '../../src/components/scheduling/ShiftPlanner/ShiftCell.tsx'),
  'utf-8',
);

describe('ShiftCell source-text invariants (Task 9)', () => {
  it('memo comparator includes coverage reference check', () => {
    expect(SRC).toMatch(/prev\.coverage.*next\.coverage|coverage.*===.*coverage/s);
  });

  it('indicator is a <button> in source with aria-label using slotName fallback', () => {
    // The coverage indicator must use a <button> element AND have an aria-label that
    // falls back to "Coverage" when slotName is omitted (via slotName ?? 'Coverage').
    expect(SRC).toMatch(/<button/);
    // New format: `${slotName ?? 'Coverage'} ${day}: ...`
    expect(SRC).toMatch(/slotName\s*\?\?\s*['"]Coverage['"]/);
  });

  it('uses aria-haspopup="dialog" on the indicator button', () => {
    expect(SRC).toMatch(/aria-haspopup="dialog"/);
  });

  it('has a sr-only span for screen reader summary', () => {
    expect(SRC).toMatch(/sr-only/);
  });

  it('does NOT use hard-coded raw color classes in the coverage indicator button', () => {
    // The coverage indicator <button> block uses semantic tokens only.
    // Extract the showCoverageIndicator block to verify there's no raw color in it.
    // We look for the indicator's className — it must use text-destructive/text-muted-foreground.
    // The presence of text-emerald/text-amber inside the coverage <button> block is forbidden.
    // We check: the indicator className does NOT include emerald or amber.
    // (The fallback classifyCapacity badge may still use raw colors — that's intentional.)
    const coverageButtonBlock = SRC.slice(
      SRC.indexOf('showCoverageIndicator &&'),
      SRC.indexOf('Fallback capacity badge'),
    );
    expect(coverageButtonBlock).not.toMatch(/text-emerald-[0-9]+/);
    expect(coverageButtonBlock).not.toMatch(/text-amber-[0-9]+/);
    expect(coverageButtonBlock).not.toMatch(/text-red-[0-9]+/);
  });

  it('calls stopPropagation in the onClick handler', () => {
    expect(SRC).toMatch(/stopPropagation/);
  });

  it('imports AlertTriangle from lucide-react', () => {
    expect(SRC).toMatch(/AlertTriangle/);
    expect(SRC).toMatch(/lucide-react/);
  });

  it('accepts coverage and onCoverageClick in the props interface', () => {
    expect(SRC).toMatch(/coverage\??\s*:\s*SlotCoverage|SlotCoverage/);
    expect(SRC).toMatch(/onCoverageClick/);
  });
});
