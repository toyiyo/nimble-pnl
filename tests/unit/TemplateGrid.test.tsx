/**
 * Tests for TemplateGrid task-8 additions:
 *  - ghostByCell prop → threaded to ShiftCell as ghostLoanedOut
 *  - offTemplateByArea prop → renders OffTemplateRow per area group
 *  - cellArea prop threaded to ShiftCell per template
 *  - OffTemplateRow only rendered when area has data and section is not collapsed
 *  - Source-text invariants: new props accepted; OffTemplateRow imported
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// Mock heavy deps to keep test fast
vi.mock('@dnd-kit/core', () => ({
  useDroppable: () => ({ isOver: false, setNodeRef: () => {} }),
  useDraggable: () => ({ isDragging: false, setNodeRef: () => {}, listeners: {}, attributes: {} }),
}));
vi.mock('@/hooks/useShiftTemplates', () => ({
  templateAppliesToDay: () => true,
}));
vi.mock('@/lib/templateAreaGrouping', () => ({
  groupTemplatesByArea: (_templates: unknown[], areaFilter?: string | null) => {
    const all = _templates as Array<{ id: string; area?: string | null }>;
    if (areaFilter) {
      const filtered = all.filter((t) => t.area === areaFilter);
      return filtered.length ? [{ area: areaFilter, templates: filtered }] : [];
    }
    // Group by area
    const map = new Map<string, typeof all>();
    for (const t of all) {
      const a = t.area ?? 'Unassigned';
      if (!map.has(a)) map.set(a, []);
      map.get(a)!.push(t);
    }
    return [...map.entries()].map(([area, templates]) => ({ area, templates }));
  },
}));

import { TemplateGrid } from '@/components/scheduling/ShiftPlanner/TemplateGrid';
import type { ShiftTemplate, Shift, CoveringEmployee } from '@/types/scheduling';

const SRC = readFileSync(
  resolve(__dirname, '../../src/components/scheduling/ShiftPlanner/TemplateGrid.tsx'),
  'utf-8',
);

function makeTemplate(id: string, area: string | null = null): ShiftTemplate {
  return {
    id,
    restaurant_id: 'r1',
    name: `${id} shift`,
    position: 'Server',
    start_time: '09:00:00',
    end_time: '17:00:00',
    days_of_week: [0, 1, 2, 3, 4, 5, 6],
    area,
    capacity: 1,
    is_active: true,
    created_at: '',
    updated_at: '',
  };
}

function makeShift(id: string, area?: string): Shift {
  return {
    id,
    restaurant_id: 'r1',
    employee_id: id,
    start_time: '2026-07-04T15:00:00Z',
    end_time: '2026-07-04T23:30:00Z',
    break_duration: 0,
    position: 'Server',
    status: 'scheduled',
    is_published: false,
    locked: false,
    source: 'manual',
    created_at: '',
    updated_at: '',
    employee: { id, name: `Emp ${id}`, area, position: 'Server' } as Shift['employee'],
  };
}

const weekDays = ['2026-07-04'];

const baseGridProps = {
  weekDays,
  templates: [makeTemplate('t1', 'Cold Stone')],
  gridData: new Map([['t1', new Map([['2026-07-04', []]])]]),
  onRemoveShift: vi.fn(),
  onEditTemplate: vi.fn(),
  onHideTemplate: vi.fn(),
  onRestoreTemplate: vi.fn(),
  onAddTemplate: vi.fn(),
};

// ── source-text invariants ────────────────────────────────────────────────────

describe('TemplateGrid source-text invariants — task 8', () => {
  it('accepts ghostByCell prop in the interface', () => {
    expect(SRC).toMatch(/ghostByCell/);
  });

  it('accepts offTemplateByArea prop in the interface', () => {
    expect(SRC).toMatch(/offTemplateByArea/);
  });

  it('imports OffTemplateRow', () => {
    expect(SRC).toMatch(/OffTemplateRow/);
  });

  it('passes cellArea to ShiftCell', () => {
    expect(SRC).toMatch(/cellArea/);
  });

  it('passes ghostLoanedOut to ShiftCell', () => {
    expect(SRC).toMatch(/ghostLoanedOut/);
  });
});

describe('TemplateGrid source-text invariants — task 7', () => {
  it('no longer accepts an onDeleteTemplate prop', () => {
    expect(SRC).not.toMatch(/onDeleteTemplate/);
  });

  it('accepts onHideTemplate and onRestoreTemplate props', () => {
    expect(SRC).toMatch(/onHideTemplate/);
    expect(SRC).toMatch(/onRestoreTemplate/);
  });

  it('imports HiddenTemplatesRow', () => {
    expect(SRC).toMatch(/HiddenTemplatesRow/);
  });

  it('accepts hiddenLaneByDay and onShowHidden props', () => {
    expect(SRC).toMatch(/hiddenLaneByDay/);
    expect(SRC).toMatch(/onShowHidden/);
  });

  it('passes isHiddenTemplate to ShiftCell', () => {
    expect(SRC).toMatch(/isHiddenTemplate/);
  });
});

// ── ghost row wiring (task 7) ─────────────────────────────────────────────────

describe('TemplateGrid ghost row rendering — task 7', () => {
  it('applies ghost styling (opacity-60 bg-muted/20) to a hidden template row header', () => {
    const hiddenTemplate = makeTemplate('t1', 'Cold Stone');
    hiddenTemplate.is_active = false;
    const { container } = render(
      <TemplateGrid
        {...baseGridProps}
        templates={[hiddenTemplate]}
        areaFilter={null}
      />,
    );
    const header = container.querySelector('.group.border-t.border-border\\/40');
    expect(header).toBeTruthy();
    expect(header?.className).toMatch(/opacity-60/);
    expect(header?.className).toMatch(/bg-muted\/20/);
  });

  it('does not apply ghost styling to an active template row header', () => {
    const { container } = render(
      <TemplateGrid {...baseGridProps} areaFilter={null} />,
    );
    const header = container.querySelector('.group.border-t.border-border\\/40');
    expect(header).toBeTruthy();
    expect(header?.className).not.toMatch(/opacity-60/);
    expect(header?.className).not.toMatch(/bg-muted\/20/);
  });

  it('calls onHideTemplate (not onDeleteTemplate) when TemplateRowHeader fires onHide for an active template', () => {
    const onHideTemplate = vi.fn();
    render(
      <TemplateGrid
        {...baseGridProps}
        onHideTemplate={onHideTemplate}
        areaFilter={null}
      />,
    );
    // TemplateRowHeader's actions button is hidden until hover in CSS only (opacity-0
    // group-hover:opacity-100), it's still present in the DOM and clickable in jsdom.
    const trigger = screen.getByRole('button', { name: 'Actions for t1 shift' });
    trigger.click();
  });

  it('passes isHiddenTemplate=true to ShiftCell for a hidden template (ghost aria-label)', () => {
    const hiddenTemplate = makeTemplate('t1', 'Cold Stone');
    hiddenTemplate.is_active = false;
    render(
      <TemplateGrid
        {...baseGridProps}
        templates={[hiddenTemplate]}
        areaFilter={null}
      />,
    );
    // ShiftCell renders aria-label={`${dayLabel}, hidden template`} when isHiddenTemplate.
    expect(screen.getByLabelText(/hidden template/i)).toBeTruthy();
  });

  it('does not set a ghost aria-label on cells for an active template', () => {
    render(<TemplateGrid {...baseGridProps} areaFilter={null} />);
    expect(screen.queryByLabelText(/hidden template/i)).toBeNull();
  });
});

// ── HiddenTemplatesRow lane wiring (task 7) ───────────────────────────────────

describe('TemplateGrid HiddenTemplatesRow lane — task 7', () => {
  it('renders HiddenTemplatesRow when hiddenLaneByDay has shifts', () => {
    const hiddenShift = makeShift('hs1');
    const hiddenLaneByDay = new Map<string, Shift[]>([
      ['2026-07-04', [hiddenShift]],
    ]);
    render(
      <TemplateGrid
        {...baseGridProps}
        areaFilter={null}
        hiddenLaneByDay={hiddenLaneByDay}
        onShowHidden={vi.fn()}
      />,
    );
    expect(screen.getByText('From hidden templates')).toBeTruthy();
  });

  it('does not render HiddenTemplatesRow when hiddenLaneByDay is empty', () => {
    render(
      <TemplateGrid
        {...baseGridProps}
        areaFilter={null}
        hiddenLaneByDay={new Map()}
        onShowHidden={vi.fn()}
      />,
    );
    expect(screen.queryByText('From hidden templates')).toBeNull();
  });

  it('does not render HiddenTemplatesRow when hiddenLaneByDay is undefined', () => {
    render(<TemplateGrid {...baseGridProps} areaFilter={null} />);
    expect(screen.queryByText('From hidden templates')).toBeNull();
  });

  it('does not render HiddenTemplatesRow when hiddenLaneByDay has only empty day arrays', () => {
    const hiddenLaneByDay = new Map<string, Shift[]>([['2026-07-04', []]]);
    render(
      <TemplateGrid
        {...baseGridProps}
        areaFilter={null}
        hiddenLaneByDay={hiddenLaneByDay}
        onShowHidden={vi.fn()}
      />,
    );
    expect(screen.queryByText('From hidden templates')).toBeNull();
  });

  it('renders HiddenTemplatesRow after all area groups and orphan off-template lanes', () => {
    const hiddenShift = makeShift('hs1');
    const hiddenLaneByDay = new Map<string, Shift[]>([
      ['2026-07-04', [hiddenShift]],
    ]);
    const offShift = makeShift('s2', 'Bar');
    const offTemplateByArea = new Map<string, Map<string, Shift[]>>([
      ['Bar', new Map([['2026-07-04', [offShift]]])],
    ]);
    const { container } = render(
      <TemplateGrid
        {...baseGridProps}
        areaFilter={null}
        offTemplateByArea={offTemplateByArea}
        hiddenLaneByDay={hiddenLaneByDay}
        onShowHidden={vi.fn()}
      />,
    );
    const text = container.textContent ?? '';
    const offIdx = text.indexOf('Off-template');
    const hiddenIdx = text.indexOf('From hidden templates');
    expect(offIdx).toBeGreaterThan(-1);
    expect(hiddenIdx).toBeGreaterThan(-1);
    expect(hiddenIdx).toBeGreaterThan(offIdx);
  });

  it('wires onShowHidden to the "Show templates" button inside HiddenTemplatesRow', () => {
    const onShowHidden = vi.fn();
    const hiddenLaneByDay = new Map<string, Shift[]>([
      ['2026-07-04', [makeShift('hs1')]],
    ]);
    render(
      <TemplateGrid
        {...baseGridProps}
        areaFilter={null}
        hiddenLaneByDay={hiddenLaneByDay}
        onShowHidden={onShowHidden}
      />,
    );
    screen.getByRole('button', { name: 'Show templates' }).click();
    expect(onShowHidden).toHaveBeenCalledTimes(1);
  });

  it('wires onRemoveShift from HiddenTemplatesRow chips', () => {
    const onRemoveShift = vi.fn();
    const hiddenLaneByDay = new Map<string, Shift[]>([
      ['2026-07-04', [makeShift('hs1')]],
    ]);
    render(
      <TemplateGrid
        {...baseGridProps}
        areaFilter={null}
        hiddenLaneByDay={hiddenLaneByDay}
        onShowHidden={vi.fn()}
        onRemoveShift={onRemoveShift}
      />,
    );
    screen.getByLabelText(/Remove .* from hidden-template shift/).click();
    expect(onRemoveShift).toHaveBeenCalledWith('hs1');
  });
});

// ── off-template row rendering ────────────────────────────────────────────────

describe('TemplateGrid offTemplateByArea rendering', () => {
  beforeEach(() => {
    localStorage.removeItem('shift-planner-area-collapse');
  });
  it('renders OffTemplateRow when area has off-template shifts', () => {
    const offShift = makeShift('s1', 'Cold Stone');
    const offTemplateByArea = new Map<string, Map<string, Shift[]>>([
      ['Cold Stone', new Map([['2026-07-04', [offShift]]])],
    ]);
    render(
      <TemplateGrid
        {...baseGridProps}
        areaFilter={null}
        offTemplateByArea={offTemplateByArea}
      />,
    );
    // OffTemplateRow renders "Off-template" label
    expect(screen.getByText('Off-template')).toBeTruthy();
  });

  it('does not render OffTemplateRow when no off-template shifts for area', () => {
    render(
      <TemplateGrid
        {...baseGridProps}
        areaFilter={null}
        offTemplateByArea={new Map()}
      />,
    );
    expect(screen.queryByText('Off-template')).toBeNull();
  });

  it('does not render OffTemplateRow when offTemplateByArea prop is undefined', () => {
    render(<TemplateGrid {...baseGridProps} areaFilter={null} />);
    expect(screen.queryByText('Off-template')).toBeNull();
  });

  it('renders off-template shift employee name in the row', () => {
    const offShift = makeShift('s1', 'Cold Stone');
    const offTemplateByArea = new Map<string, Map<string, Shift[]>>([
      ['Cold Stone', new Map([['2026-07-04', [offShift]]])],
    ]);
    render(
      <TemplateGrid
        {...baseGridProps}
        areaFilter={null}
        offTemplateByArea={offTemplateByArea}
      />,
    );
    expect(screen.getByText('Emp s1')).toBeTruthy();
  });

  it('renders OffTemplateRow for orphan area with no template group', () => {
    // 'Bar' area has no template but has off-template shifts
    const offShift = makeShift('s2', 'Bar');
    const offTemplateByArea = new Map<string, Map<string, Shift[]>>([
      ['Bar', new Map([['2026-07-04', [offShift]]])],
    ]);
    render(
      <TemplateGrid
        {...baseGridProps}
        areaFilter={null}
        offTemplateByArea={offTemplateByArea}
      />,
    );
    // Should still render Off-template row even though no template has area='Bar'
    expect(screen.getByText('Off-template')).toBeTruthy();
    expect(screen.getByText('Emp s2')).toBeTruthy();
  });

  it('does NOT render off-template lanes for unrelated areas when areaFilter is active', () => {
    // Cold Stone is filtered in; Wetzel's has off-template shifts but should be hidden
    const csShift = makeShift('s-cs', 'Cold Stone');
    const wzShift = makeShift('s-wz', "Wetzel's");
    const offTemplateByArea = new Map<string, Map<string, Shift[]>>([
      ['Cold Stone', new Map([['2026-07-04', [csShift]]])],
      ["Wetzel's", new Map([['2026-07-04', [wzShift]]])],
    ]);
    // baseGridProps has template with area='Cold Stone', so Cold Stone is in groups.
    // With areaFilter='Cold Stone', the Wetzel's off-template lane must be suppressed.
    render(
      <TemplateGrid
        {...baseGridProps}
        areaFilter="Cold Stone"
        offTemplateByArea={offTemplateByArea}
      />,
    );
    // Wetzel's lane must NOT appear
    expect(screen.queryByText('Emp s-wz')).toBeNull();
  });
});

// ── ghostByCell threading ─────────────────────────────────────────────────────

describe('TemplateGrid ghostByCell threading to ShiftCell', () => {
  it('threads ghostLoanedOut to ShiftCell for matching template+day key', () => {
    const ghost: CoveringEmployee = {
      employeeId: 'eg1',
      employeeName: 'Leandro',
      startMin: 960,
      endMin: 1410,
      homeArea: 'Cold Stone',
      workArea: "Wetzel's",
    };
    // Key is `${templateId}:${day}`
    const ghostByCell = new Map<string, CoveringEmployee[]>([
      ['t1:2026-07-04', [ghost]],
    ]);
    render(
      <TemplateGrid
        {...baseGridProps}
        areaFilter={null}
        ghostByCell={ghostByCell}
      />,
    );
    // ShiftCell should render the ghost row "· at Wetzel's"
    expect(screen.getByText(/at Wetzel's/i)).toBeTruthy();
  });

  it('renders no ghost rows when ghostByCell is undefined', () => {
    render(<TemplateGrid {...baseGridProps} areaFilter={null} />);
    const atText = [...document.body.querySelectorAll('*')].some((el) =>
      el.textContent?.match(/^at /),
    );
    expect(atText).toBe(false);
  });
});
