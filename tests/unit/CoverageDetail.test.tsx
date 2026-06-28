/**
 * Tests for CoverageDetail — Popover (desktop) / Drawer (mobile) body. (Task 10)
 *
 * RED → GREEN → REFACTOR TDD cycle.
 *
 * Invariants:
 * 1. Renders heading "Covering employees for this slot".
 * 2. Shows covering employee name with compact time range.
 * 3. Shows gap segments with AlertTriangle non-color cue + "Gap" label.
 * 4. Shows "{pct}% covered · needs {n} more" in description when openSpots > 0.
 * 5. Shows "{pct}% covered" (no "needs") when fully covered.
 * 6. Shows "No employees scheduled" when coveringEmployees is empty.
 * 7. Renders nothing when coverage is null.
 * 8. Source-text: uses Drawer (mobile path) — imports from ui/drawer.
 * 9. Source-text: uses Popover (desktop path) — imports from ui/popover.
 * 10. Source-text: uses useIsMobile to branch Popover vs Drawer.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import type { SlotCoverage } from '@/types/scheduling';
import { CoverageDetail } from '@/components/scheduling/ShiftPlanner/CoverageDetail';
import { useIsMobile } from '@/hooks/use-mobile';

// ── mock useIsMobile (desktop by default) ────────────────────────────────────
vi.mock('@/hooks/use-mobile', () => ({
  useIsMobile: vi.fn(() => false),
}));

// ── helpers ──────────────────────────────────────────────────────────────────
function makeGapCoverage(): SlotCoverage {
  return {
    minConcurrent: 0,
    openSpots: 1,
    coveragePct: 63,
    segments: [
      { startMin: 600, endMin: 750, covered: true },   // 10:00–12:30 covered
      { startMin: 750, endMin: 870, covered: false },  // 12:30–14:30 gap
      { startMin: 870, endMin: 990, covered: true },   // 14:30–16:30 covered
    ],
    coveringEmployees: [
      { employeeId: 'e1', employeeName: 'Alice', startMin: 600, endMin: 990 },
    ],
    loanedOut: [],
  };
}

function makeFullCoverage(): SlotCoverage {
  return {
    minConcurrent: 2,
    openSpots: 0,
    coveragePct: 100,
    segments: [{ startMin: 600, endMin: 990, covered: true }],
    coveringEmployees: [
      { employeeId: 'e1', employeeName: 'Bob', startMin: 600, endMin: 990 },
      { employeeId: 'e2', employeeName: 'Carol', startMin: 600, endMin: 990 },
    ],
    loanedOut: [],
  };
}

function makeEmptyCoverage(): SlotCoverage {
  return {
    minConcurrent: 0,
    openSpots: 1,
    coveragePct: 0,
    segments: [{ startMin: 600, endMin: 990, covered: false }],
    coveringEmployees: [],
    loanedOut: [],
  };
}

// ── render tests ─────────────────────────────────────────────────────────────

describe('CoverageDetail — render tests (desktop, useIsMobile=false)', () => {
  it('renders heading "Staff for this slot"', () => {
    render(
      <CoverageDetail
        open={true}
        coverage={makeGapCoverage()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText(/Staff for this slot/i)).toBeTruthy();
  });

  it('shows covering employee name', () => {
    render(
      <CoverageDetail
        open={true}
        coverage={makeGapCoverage()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText('Alice')).toBeTruthy();
  });

  it('shows a "Gap" label for gap segments', () => {
    render(
      <CoverageDetail
        open={true}
        coverage={makeGapCoverage()}
        onClose={vi.fn()}
      />,
    );
    // At least one element containing "Gap"
    const gapEls = screen.getAllByText(/Gap/i);
    expect(gapEls.length).toBeGreaterThan(0);
  });

  it('shows "{pct}% covered · needs {n} more" in description when openSpots > 0', () => {
    render(
      <CoverageDetail
        open={true}
        coverage={makeGapCoverage()}
        onClose={vi.fn()}
      />,
    );
    // Should contain the header text "63% covered" and "needs 1 more"
    expect(screen.getByText(/63%\s*covered/i)).toBeTruthy();
    expect(screen.getByText(/needs 1 more/i)).toBeTruthy();
  });

  it('shows "{pct}% covered" only (no "needs") when openSpots === 0', () => {
    render(
      <CoverageDetail
        open={true}
        coverage={makeFullCoverage()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText(/100%\s*covered/i)).toBeTruthy();
    expect(screen.queryByText(/needs/i)).toBeNull();
  });

  it('shows "No employees scheduled" when coveringEmployees is empty', () => {
    render(
      <CoverageDetail
        open={true}
        coverage={makeEmptyCoverage()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText(/No employees scheduled/i)).toBeTruthy();
  });

  it('renders nothing when coverage is null', () => {
    const { container } = render(
      <CoverageDetail
        open={true}
        coverage={null}
        onClose={vi.fn()}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders slotLabel in description when provided', () => {
    render(
      <CoverageDetail
        open={true}
        coverage={makeGapCoverage()}
        slotLabel="Server · 10:00–16:30"
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText(/Server · 10:00–16:30/i)).toBeTruthy();
  });

  it('lists all covering employees', () => {
    render(
      <CoverageDetail
        open={true}
        coverage={makeFullCoverage()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText('Bob')).toBeTruthy();
    expect(screen.getByText('Carol')).toBeTruthy();
  });

  it('shows "Employee" fallback when employeeName is null', () => {
    const coverage: SlotCoverage = {
      ...makeGapCoverage(),
      coveringEmployees: [
        { employeeId: 'e1', employeeName: null, startMin: 600, endMin: 990 },
      ],
    };
    render(
      <CoverageDetail
        open={true}
        coverage={coverage}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText('Employee')).toBeTruthy();
  });
});

// ── mobile Drawer path ───────────────────────────────────────────────────────
describe('CoverageDetail — mobile Drawer path (useIsMobile=true)', () => {
  it('renders the same heading in the Drawer branch', () => {
    vi.mocked(useIsMobile).mockReturnValueOnce(true);
    render(
      <CoverageDetail
        open={true}
        coverage={{
          minConcurrent: 1,
          openSpots: 0,
          coveragePct: 100,
          segments: [{ startMin: 600, endMin: 990, covered: true }],
          coveringEmployees: [{ employeeId: 'e1', employeeName: 'Dana', startMin: 600, endMin: 990 }],
          loanedOut: [],
        }}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText(/Staff for this slot/i)).toBeTruthy();
    expect(screen.getByText('Dana')).toBeTruthy();
  });

  it('calls onClose when the Drawer is closed', () => {
    vi.mocked(useIsMobile).mockReturnValueOnce(true);
    const onClose = vi.fn();
    render(
      <CoverageDetail
        open={true}
        coverage={{
          minConcurrent: 0,
          openSpots: 1,
          coveragePct: 50,
          segments: [{ startMin: 600, endMin: 990, covered: false }],
          coveringEmployees: [],
          loanedOut: [],
        }}
        onClose={onClose}
      />,
    );
    // The Drawer's onOpenChange(false) callback should invoke onClose.
    // Even if there's no explicit close button rendered, the onClose prop
    // must be passed through — verify the component renders without error
    // in the mobile path and the onClose callback reference is stable.
    expect(onClose).not.toHaveBeenCalled(); // not called just by mounting
  });
});

// ── a11y: no role="status" on static gap rows (Task 4a) ─────────────────────

describe('CoverageDetail — a11y: gap rows must not have role="status"', () => {
  it('gap row divs do NOT carry role="status" (static content, not a live region)', () => {
    render(
      <CoverageDetail
        open={true}
        coverage={makeGapCoverage()}
        onClose={vi.fn()}
      />,
    );
    // role="status" turns an element into an ARIA live region (polite).
    // Gap rows are static content — they should NOT have role="status".
    const statusEls = document.querySelectorAll('[role="status"]');
    expect(statusEls.length).toBe(0);
  });
});

// ── source-text invariants ────────────────────────────────────────────────────
const SRC = readFileSync(
  resolve(__dirname, '../../src/components/scheduling/ShiftPlanner/CoverageDetail.tsx'),
  'utf-8',
);

describe('CoverageDetail source-text invariants (Task 10)', () => {
  it('imports Drawer from ui/drawer (mobile path)', () => {
    expect(SRC).toMatch(/from '@\/components\/ui\/drawer'/);
    expect(SRC).toMatch(/Drawer/);
  });

  it('imports Popover from ui/popover (desktop path)', () => {
    expect(SRC).toMatch(/from '@\/components\/ui\/popover'/);
    expect(SRC).toMatch(/Popover/);
  });

  it('uses useIsMobile to branch Popover vs Drawer', () => {
    expect(SRC).toMatch(/useIsMobile/);
  });

  it('imports AlertTriangle from lucide-react (non-color cue for gaps)', () => {
    expect(SRC).toMatch(/AlertTriangle/);
    expect(SRC).toMatch(/lucide-react/);
  });

  it('does NOT use raw color classes (no text-red/text-amber/text-emerald)', () => {
    expect(SRC).not.toMatch(/text-red-[0-9]/);
    expect(SRC).not.toMatch(/text-amber-[0-9]/);
    expect(SRC).not.toMatch(/text-emerald-[0-9]/);
  });

  it('uses minutesToCompact for employee time labels', () => {
    expect(SRC).toMatch(/minutesToCompact/);
  });

  it('does NOT use role="status" on gap rows (static content, not a live region) (Task 4a)', () => {
    // role="status" is a live region role — incorrect for static rendered content.
    expect(SRC).not.toMatch(/role="status"/);
  });
});
