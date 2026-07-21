/**
 * Lightweight source-text tests for ShiftPlannerTab coverage wiring.
 *
 * These tests read the source file as text and assert structural invariants
 * without mounting the full component (avoids the heavy DnD / Supabase setup).
 * Pattern established in: lesson 2026-05-17 (source-text tests for wiring checks).
 *
 * Invariants checked:
 * 1. `coverageByTemplateDay` useMemo exists (tab-level coverage Map computation).
 * 2. A single `CoverageDetail` usage (ONE lifted detail — no per-cell popover).
 * 3. `coverageDetail` state for the lifted popover/Drawer is present.
 * 4. `try/catch` guard around per-slot coverage computation (one bad row never blanks the grid).
 * 5. (Task 2a) CoverageShift objects carry `area` derived from the joined shift.employee data,
 *    NOT from an active-only empArea map (fix: inactive-employee shifts must still count).
 * 6. (Shift-fill-by-assignment Task 3) `computeLoanedOut` is called with `{ area: ...}` options
 *    (threads t.area) — fill itself (`computeCellFill`) is scoped to the template's own bucket
 *    and takes no area option.
 * 7. (Task 2f) TemplateGrid.tsx assembles slotName from template.area + template.position and passes it to ShiftCell.
 * 8. (Task 2f) ShiftCell.tsx includes slotName in the memo comparator.
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, it, expect } from 'vitest';

const SRC = readFileSync(
  resolve(__dirname, '../../src/components/scheduling/ShiftPlanner/ShiftPlannerTab.tsx'),
  'utf-8',
);

const TEMPLATE_GRID_SRC = readFileSync(
  resolve(__dirname, '../../src/components/scheduling/ShiftPlanner/TemplateGrid.tsx'),
  'utf-8',
);

const SHIFT_CELL_SRC = readFileSync(
  resolve(__dirname, '../../src/components/scheduling/ShiftPlanner/ShiftCell.tsx'),
  'utf-8',
);

describe('ShiftPlannerTab — coverage wiring (source-text)', () => {
  it('declares coverageByTemplateDay useMemo', () => {
    expect(SRC).toMatch(/coverageByTemplateDay/);
  });

  it('uses computeCellFill import from shiftFill and computeLoanedOut import from loanedOut', () => {
    expect(SRC).toMatch(/import\s*\{\s*computeCellFill\s*\}\s*from\s*'@\/lib\/shiftFill'/);
    expect(SRC).toMatch(/computeLoanedOut/);
  });

  it('has try/catch for per-slot coverage (resilience guard)', () => {
    expect(SRC).toMatch(/try\s*\{/);
    expect(SRC).toMatch(/catch/);
  });

  it('declares a single lifted coverageDetail state', () => {
    expect(SRC).toMatch(/coverageDetail/);
    // Should be a useState declaration, not just a usage
    expect(SRC).toMatch(/useState.*coverageDetail|coverageDetail.*useState/s);
  });

  it('renders exactly one CoverageDetail component (no per-cell popover)', () => {
    // Count occurrences of <CoverageDetail (opening JSX tag)
    const matches = [...SRC.matchAll(/<CoverageDetail[\s/]/g)];
    expect(matches.length).toBe(1);
  });

  it('passes onCoverageClick (or similar) down to TemplateGrid or children', () => {
    expect(SRC).toMatch(/onCoverageClick/);
  });

  it('imports CoverageDetail component', () => {
    expect(SRC).toMatch(/import.*CoverageDetail/);
  });
});

describe('ShiftPlannerTab — area-scope wiring (source-text, Task 2a)', () => {
  it('sets `area` field on CoverageShift objects using template area for template-bound shifts', () => {
    // For template-bound shifts (shift_template_id set), the template's area is authoritative.
    // A cross-area employee assigned to a template slot must count toward that template's area.
    // Fallback to s.employee?.area for unbound/legacy shifts (inactive employees still count).
    expect(SRC).toMatch(/s\.shift_template_id/);
    expect(SRC).toMatch(/templateAreaMap/);
    // Employee area still appears as fallback
    expect(SRC).toMatch(/s\.employee\?\.area/);
  });

  it('does NOT use an empArea map built from active-only employees for area derivation', () => {
    // The active-only empArea pattern was replaced. If empArea reappears, it risks
    // reintroducing the inactive-employee exclusion issue.
    expect(SRC).not.toMatch(/area\s*:\s*empArea/);
  });

  it('builds templateAreaMap keyed by template id before building cov array', () => {
    // templateAreaMap must be built from templates before shifts.map so that
    // s.shift_template_id can look up the template's area for each shift.
    // If templateAreaMap disappears, cross-area assignments break coverage again.
    expect(SRC).toMatch(/templateAreaMap\s*=\s*new Map/);
    // Must be keyed with the template id
    expect(SRC).toMatch(/templateAreaMap\.get\s*\(s\.shift_template_id\)/);
  });

  it('passes { area: t.area } (or equivalent) as options to computeLoanedOut', () => {
    // computeLoanedOut must receive an options object with the template area — fill
    // (computeCellFill) is scoped to the template's own bucket and never needs an area filter.
    // Accept any of: { area: t.area }, { area: t.area ?? null }, { area: t.area || null }
    expect(SRC).toMatch(/computeLoanedOut\s*\([\s\S]*?\{[\s\S]*?area\s*:\s*t\.area/);
  });

  it('uses || null (not ?? null) for t.area to guard against empty-string templates', () => {
    // t.area ?? null coerces undefined → null but leaves '' → '' (falsy empty-string key).
    // t.area || null coerces both undefined and '' → null, disabling the area filter correctly.
    expect(SRC).toMatch(/area\s*:\s*t\.area\s*\|\|\s*null/);
  });
});

describe('ShiftPlannerTab — coverageSlotLabel area formatting (source-text, Task 2d)', () => {
  it('prepends t.area when set — e.g. "Cold Stone · Server · 10:00–16:30"', () => {
    // The label must incorporate t.area before t.position when area is truthy.
    // Look for a conditional that inserts area at the front of the label string.
    // Acceptable forms: `${t.area ? t.area + ' · ' : ''}${t.position}`
    //                   `${t.area} · ${t.position}`  (inside a truthy branch)
    //                   template literal with t.area placed before t.position.
    expect(SRC).toMatch(/t\.area\s*\?\s*.*t\.area.*t\.position|t\.area.*·.*t\.position/s);
  });

  it('appends "(all areas)" when t.area is null/falsy', () => {
    // The label must append the literal string "(all areas)" when the template has no area,
    // so managers don't mistake a restaurant-wide slot for an area-scoped one.
    expect(SRC).toMatch(/\(all areas\)/);
  });

  it('coverageSlotLabel does NOT use the old bare "position · start–end" format (must include area logic)', () => {
    // The old format was: `${t.position} · ${t.start_time.slice(0,5)}–${t.end_time.slice(0,5)}`
    // The new format must branch on t.area — either inline or via a helper function that references t.area.
    // After simplification (buildSlotLabel extracted), the area branch lives in buildSlotLabel.
    // Assert: (a) coverageSlotLabel calls buildSlotLabel, or (b) t.area appears within 400 chars of coverageSlotLabel.
    const hasBuildSlotLabel = /coverageSlotLabel[\s\S]{0,200}buildSlotLabel/.test(SRC);
    const hasInlineArea = /coverageSlotLabel[\s\S]{0,400}t\.area/.test(SRC);
    expect(hasBuildSlotLabel || hasInlineArea).toBe(true);
  });
});

describe('TemplateGrid — slotName threading to ShiftCell (source-text, Task 2f)', () => {
  it('passes a slotName prop to ShiftCell', () => {
    // TemplateGrid must pass slotName= to the ShiftCell JSX element.
    expect(TEMPLATE_GRID_SRC).toMatch(/slotName\s*=/);
  });

  it('builds slotName by prefixing template.area when set — e.g. "Cold Stone Server"', () => {
    // The formula must conditionally prepend template.area before template.position.
    // Accept: template.area ? template.area + ' ' ... template.position
    //         or `${template.area ? ...} ${template.position}`
    expect(TEMPLATE_GRID_SRC).toMatch(/template\.area\s*\?[\s\S]{0,60}template\.position/);
  });

  it('produces a pure-position slotName when template.area is null/falsy', () => {
    // When area is falsy the ternary must fall through to just template.position.
    // The pattern `template.area ? ... : ''}${template.position}` ensures this.
    expect(TEMPLATE_GRID_SRC).toMatch(/''\s*}\s*\$\{template\.position\}|template\.area\s*\?[\s\S]{0,80}template\.position/);
  });
});

describe('ShiftCell — slotName in memo comparator (source-text, Task 2f)', () => {
  it('declares optional slotName prop in ShiftCellProps', () => {
    // The prop interface must declare slotName so TypeScript enforces the contract.
    expect(SHIFT_CELL_SRC).toMatch(/slotName\s*\?\s*:\s*string/);
  });

  it('includes slotName in the React.memo comparator', () => {
    // The custom comparator passed to React.memo must compare prev.slotName === next.slotName
    // so that a slot area/position change triggers a re-render.
    expect(SHIFT_CELL_SRC).toMatch(/prev\.slotName\s*===\s*next\.slotName/);
  });

  it('uses slotName in the coverage indicator aria-label', () => {
    // The aria-label must reference slotName (possibly via fallback) so that
    // screen-readers announce the slot identity alongside the staffing count.
    expect(SHIFT_CELL_SRC).toMatch(/slotName.*aria-label|aria-label.*slotName/s);
  });
});

// ---------------------------------------------------------------------------
// Task 10: Wire homeArea, ghostByCell, offTemplateByArea, slotArea
// ---------------------------------------------------------------------------

describe('ShiftPlannerTab — Task 10: homeArea in coverage shifts (source-text)', () => {
  it('sets homeArea on CoverageShift objects using s.employee?.area', () => {
    // homeArea must be derived from the employee's own area (not the template area).
    // It is set alongside the existing `area` field in the cov array.
    expect(SRC).toMatch(/homeArea\s*:\s*s\.employee\?\.area/);
  });
});

describe('ShiftPlannerTab — Task 10: ghostByCell useMemo (source-text)', () => {
  it('imports assignLoanedOutCell from @/lib/loanedOut', () => {
    expect(SRC).toMatch(/assignLoanedOutCell/);
    expect(SRC).toMatch(/loanedOut/);
  });

  it('declares a ghostByCell useMemo that calls assignLoanedOutCell', () => {
    expect(SRC).toMatch(/ghostByCell\s*=\s*useMemo/);
    expect(SRC).toMatch(/assignLoanedOutCell\s*\(/);
  });

  it('builds a templateStart lookup from templates inside ghostByCell memo', () => {
    // The memo must map template id → start_time for tie-breaking.
    expect(SRC).toMatch(/t\.id[^\n]*t\.start_time|t\.start_time[^\n]*t\.id/);
  });

  it('ghostByCell has coverageByTemplateDay and templates in its deps', () => {
    // Both must appear as dependency array entries for ghostByCell.
    expect(SRC).toMatch(/ghostByCell[\s\S]{0,300}\[coverageByTemplateDay[\s\S]{0,50}templates\]/);
  });
});

describe('ShiftPlannerTab — Task 10: offTemplateByArea useMemo (source-text)', () => {
  it('imports groupUnmatchedByArea from useShiftPlanner', () => {
    expect(SRC).toMatch(/groupUnmatchedByArea/);
  });

  it('declares an offTemplateByArea useMemo that calls groupUnmatchedByArea', () => {
    expect(SRC).toMatch(/offTemplateByArea\s*=\s*useMemo/);
    expect(SRC).toMatch(/groupUnmatchedByArea\s*\(/);
  });

  it('offTemplateByArea memo reads the __unmatched__ bucket from templateGridData', () => {
    // groupUnmatchedByArea receives templateGridData.get('__unmatched__')
    expect(SRC).toMatch(/__unmatched__/);
  });
});

describe('ShiftPlannerTab — Task 10: TemplateGrid receives new props (source-text)', () => {
  it('passes ghostByCell to TemplateGrid', () => {
    expect(SRC).toMatch(/ghostByCell\s*=\s*\{ghostByCell\}/);
  });

  it('passes offTemplateByArea to TemplateGrid', () => {
    expect(SRC).toMatch(/offTemplateByArea\s*=\s*\{offTemplateByArea\}/);
  });
});

describe('ShiftPlannerTab — Task 10: slotArea passed to CoverageDetail (source-text)', () => {
  it('passes slotArea derived from coverageDetailTemplate.area to CoverageDetail', () => {
    // CoverageDetail must receive slotArea={coverageDetailTemplate?.area ?? null}
    // so the popover can split staff into on-area vs covering groups.
    expect(SRC).toMatch(/slotArea\s*=\s*\{coverageDetailTemplate\?\.area/);
  });
});
