/**
 * BUG-001 regression guard — static source inspection.
 *
 * These tests read the migrated component files as raw strings and assert
 * that the banned patterns are absent.  They will FAIL immediately if a
 * future edit reintroduces:
 *   – `initialFocus`  (react-day-picker prop that triggers the focus tug-of-war)
 *   – orphan `pointer-events-auto` band-aids in the two POS/Receipt files
 *     that previously carried them (toast.tsx keeps its own for legitimate
 *     reasons and is not checked here).
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const root = path.resolve(__dirname, '../../src');

function read(relPath: string): string {
  return fs.readFileSync(path.join(root, relPath), 'utf-8');
}

/** All migrated files that must never contain initialFocus. */
const MIGRATED_FILES = [
  'components/ui/date-picker.tsx',
  'components/ui/date-range-picker.tsx',
  'components/TimeOffRequestDialog.tsx',
  'components/AvailabilityExceptionDialog.tsx',
  'components/BulkInventoryDeductionDialog.tsx',
  'components/banking/ReconciliationDialog.tsx',
  'components/banking/EnhancedReconciliationDialog.tsx',
  'components/POSSalesImportReview.tsx',
  'components/ReceiptMappingReview.tsx',
];

/** Files that previously carried pointer-events-auto as a band-aid. */
const POINTER_EVENTS_BAND_AID_FILES = [
  'components/POSSalesImportReview.tsx',
  'components/ReceiptMappingReview.tsx',
];

describe('BUG-001 guard: no residual initialFocus in migrated files', () => {
  for (const relPath of MIGRATED_FILES) {
    it(`${relPath} contains no "initialFocus"`, () => {
      const src = read(relPath);
      expect(src).not.toContain('initialFocus');
    });
  }
});

describe('BUG-001 guard: no orphan pointer-events-auto band-aids', () => {
  for (const relPath of POINTER_EVENTS_BAND_AID_FILES) {
    it(`${relPath} contains no "pointer-events-auto"`, () => {
      const src = read(relPath);
      expect(src).not.toContain('pointer-events-auto');
    });
  }
});
