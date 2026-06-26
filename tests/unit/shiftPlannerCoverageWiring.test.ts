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
 * 5. (Task 2a) `employees` is in the coverageByTemplateDay useMemo dep array.
 * 6. (Task 2a) An employee→area map (empArea) is built from `employees` inside coverageByTemplateDay.
 * 7. (Task 2a) CoverageShift objects carry `area` field derived from empArea.
 * 8. (Task 2a) `computeSlotCoverage` is called with `{ area: ...}` options (threads t.area).
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, it, expect } from 'vitest';

const SRC = readFileSync(
  resolve(__dirname, '../../src/components/scheduling/ShiftPlanner/ShiftPlannerTab.tsx'),
  'utf-8',
);

describe('ShiftPlannerTab — coverage wiring (source-text)', () => {
  it('declares coverageByTemplateDay useMemo', () => {
    expect(SRC).toMatch(/coverageByTemplateDay/);
  });

  it('uses computeSlotCoverage import from shiftCoverage', () => {
    expect(SRC).toMatch(/computeSlotCoverage/);
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
  it('`employees` is in the coverageByTemplateDay useMemo dependency array', () => {
    // The useMemo dep array must include `employees` so the area map stays fresh.
    // Strategy: find the coverageByTemplateDay memo block and assert the trailing
    // dep-array (the last [...] before the closing paren of useMemo) contains `employees`.
    // We look for the deps comment pattern or the trailing dep array right before the closing `);`
    // The dep array is the second argument to useMemo: useMemo(() => { ... }, [deps]).
    // Since the first `[` inside the callback is `employees.map(e => [e.id, ...])`,
    // we look specifically for the pattern `}, [...]` (the second arg to useMemo).
    expect(SRC).toMatch(/},\s*\[[^\]]*\bemployees\b[^\]]*\]/);
  });

  it('builds an empArea Map from employees inside coverageByTemplateDay', () => {
    // Must construct a Map keyed by employee id → area.
    // The idiomatic form: new Map(employees.map(e => [e.id, ...])) or similar.
    expect(SRC).toMatch(/empArea/);
    expect(SRC).toMatch(/new Map\s*\(\s*employees/);
  });

  it('sets `area` field on CoverageShift objects using the empArea map', () => {
    // The cov objects must carry area: empArea.get(s.employee_id) or similar.
    expect(SRC).toMatch(/area\s*:\s*empArea/);
  });

  it('passes { area: t.area } (or equivalent) as options to computeSlotCoverage', () => {
    // computeSlotCoverage must receive an options object with the template area.
    // Accept any of: { area: t.area }, { area: t.area ?? null }, { area: t.area ?? undefined }
    expect(SRC).toMatch(/computeSlotCoverage\s*\([\s\S]*?\{[\s\S]*?area\s*:\s*t\.area/);
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
    // The new format must branch on t.area. Assert the IIFE or computed value references t.area.
    expect(SRC).toMatch(/coverageSlotLabel[\s\S]{0,300}t\.area/);
  });
});
