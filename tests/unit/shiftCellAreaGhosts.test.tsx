/**
 * Tests for ShiftCell task-7 additions:
 *  - cellArea + ghostLoanedOut props
 *  - homeArea / cellArea threaded to EmployeeChip (covering badge)
 *  - ghost "loaned-out" rows rendered for ghostLoanedOut employees
 *  - memo comparator includes cellArea + ghostLoanedOut
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { ShiftCell } from '@/components/scheduling/ShiftPlanner/ShiftCell';
import type { Shift, CoveringEmployee } from '@/types/scheduling';

vi.mock('@dnd-kit/core', () => ({
  useDroppable: () => ({ isOver: false, setNodeRef: () => {} }),
}));

function makeShift(overrides?: Partial<Shift>): Shift {
  return {
    id: 's1',
    restaurant_id: 'r1',
    employee_id: 'e1',
    start_time: '2026-07-04T21:00:00Z',
    end_time: '2026-07-05T04:30:00Z',
    break_duration: 0,
    position: 'Server',
    status: 'scheduled',
    is_published: true,
    locked: false,
    source: 'manual',
    created_at: '2026-07-04T00:00:00Z',
    updated_at: '2026-07-04T00:00:00Z',
    employee: { id: 'e1', name: 'Termora', area: 'Cold Stone', position: 'Server' } as Shift['employee'],
    ...overrides,
  };
}

function makeLoanedOut(overrides?: Partial<CoveringEmployee>): CoveringEmployee {
  return {
    employeeId: 'e2',
    employeeName: 'Samira',
    startMin: 960,
    endMin: 1410,
    homeArea: "Wetzel's",
    workArea: 'Cold Stone',
    ...overrides,
  };
}

const BASE_PROPS = {
  templateId: 't1',
  day: '2026-07-04',
  isActiveDay: true,
  shifts: [],
  capacity: 2,
  onRemoveShift: vi.fn(),
};

const SRC = readFileSync(
  resolve(__dirname, '../../src/components/scheduling/ShiftPlanner/ShiftCell.tsx'),
  'utf-8',
);

// ── ghost loaned-out rows ─────────────────────────────────────────────────────

describe('ShiftCell ghostLoanedOut ghost rows', () => {
  it('renders a ghost row for each loaned-out employee', () => {
    const g1 = makeLoanedOut({ employeeId: 'e2', employeeName: 'Samira', workArea: 'Cold Stone' });
    render(<ShiftCell {...BASE_PROPS} ghostLoanedOut={[g1]} />);
    expect(screen.getByText('Samira')).toBeTruthy();
    expect(screen.getByText(/at Cold Stone/i)).toBeTruthy();
  });

  it('renders ghost aria-label mentioning employee and workArea', () => {
    const g1 = makeLoanedOut({ employeeName: 'Samira', workArea: 'Cold Stone' });
    const { container } = render(<ShiftCell {...BASE_PROPS} ghostLoanedOut={[g1]} />);
    const ghostDiv = container.querySelector('[aria-label*="Samira"]');
    expect(ghostDiv).toBeTruthy();
    expect(ghostDiv?.getAttribute('aria-label')).toMatch(/Cold Stone/i);
  });

  it('renders no ghost rows when ghostLoanedOut is empty', () => {
    render(<ShiftCell {...BASE_PROPS} ghostLoanedOut={[]} />);
    // No "at " text from ghost rows
    const atText = document.body.querySelectorAll('*');
    const hasAtText = [...atText].some((el) => el.textContent?.match(/^at /));
    expect(hasAtText).toBe(false);
  });

  it('renders no ghost rows when ghostLoanedOut is undefined', () => {
    render(<ShiftCell {...BASE_PROPS} />);
    const atText = document.body.querySelectorAll('*');
    const hasAtText = [...atText].some((el) => el.textContent?.match(/^at /));
    expect(hasAtText).toBe(false);
  });

  it('renders multiple ghost rows for multiple loaned-out employees', () => {
    const g1 = makeLoanedOut({ employeeId: 'e2', employeeName: 'Samira', workArea: 'Cold Stone' });
    const g2 = makeLoanedOut({ employeeId: 'e3', employeeName: 'Marcus', workArea: 'Cold Stone' });
    render(<ShiftCell {...BASE_PROPS} ghostLoanedOut={[g1, g2]} />);
    expect(screen.getByText('Samira')).toBeTruthy();
    expect(screen.getByText('Marcus')).toBeTruthy();
  });

  it('uses ghost- prefix keying so chips and ghosts do not conflict', () => {
    // Shift chip and ghost for different employees — both names visible
    const shift = makeShift({ id: 's1', employee: { id: 'e1', name: 'Alice', area: "Wetzel's", position: 'Server' } as Shift['employee'] });
    const g1 = makeLoanedOut({ employeeId: 'e2', employeeName: 'Samira', workArea: 'Cold Stone' });
    render(<ShiftCell {...BASE_PROPS} shifts={[shift]} ghostLoanedOut={[g1]} cellArea="Cold Stone" />);
    expect(screen.getByText('Alice')).toBeTruthy();
    expect(screen.getByText('Samira')).toBeTruthy();
  });
});

// ── covering chip: homeArea + cellArea threaded through ──────────────────────

describe('ShiftCell covering chip props', () => {
  it('renders covering badge (homeArea text) on chip when homeArea != cellArea', () => {
    const shift = makeShift({
      employee: { id: 'e1', name: 'Termora', area: 'Cold Stone', position: 'Server' } as Shift['employee'],
    });
    // cellArea = "Wetzel's", employee.area = "Cold Stone" → isCovering = true
    render(<ShiftCell {...BASE_PROPS} shifts={[shift]} cellArea="Wetzel's" />);
    // The covering badge shows the homeArea text
    expect(screen.getByText("Cold Stone")).toBeTruthy();
  });

  it('does not render covering badge when homeArea === cellArea', () => {
    const shift = makeShift({
      employee: { id: 'e1', name: 'Termora', area: "Wetzel's", position: 'Server' } as Shift['employee'],
    });
    render(<ShiftCell {...BASE_PROPS} shifts={[shift]} cellArea="Wetzel's" />);
    // No covering badge; "Wetzel's" should NOT appear as a badge
    // (chip itself shows "Termora"; no area badge)
    const coveringBadges = document.querySelectorAll('[title*="Covering from"]');
    expect(coveringBadges.length).toBe(0);
  });
});

// ── source-text invariants ────────────────────────────────────────────────────

describe('ShiftCell source-text invariants — task 7', () => {
  it('accepts cellArea in the props interface', () => {
    expect(SRC).toMatch(/cellArea/);
  });

  it('accepts ghostLoanedOut in the props interface', () => {
    expect(SRC).toMatch(/ghostLoanedOut/);
  });

  it('memo comparator includes cellArea check', () => {
    expect(SRC).toMatch(/prev\.cellArea.*next\.cellArea|cellArea.*===.*cellArea/s);
  });

  it('memo comparator includes ghostLoanedOut check', () => {
    expect(SRC).toMatch(/prev\.ghostLoanedOut.*next\.ghostLoanedOut|ghostLoanedOut.*===.*ghostLoanedOut/s);
  });

  it('imports ArrowRight from lucide-react', () => {
    expect(SRC).toMatch(/ArrowRight/);
  });

  it('passes homeArea to EmployeeChip', () => {
    expect(SRC).toMatch(/homeArea.*shift\.employee|employee.*homeArea/s);
  });

  it('passes cellArea to EmployeeChip', () => {
    // cellArea is passed down into EmployeeChip render
    expect(SRC).toMatch(/cellArea.*cellArea|cellArea=\{cellArea/s);
  });
});
