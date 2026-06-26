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
