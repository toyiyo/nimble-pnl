/**
 * Regression guard: dead helpers removed from openShiftHelpers.ts (T11).
 *
 * `computeOpenSpots` and `classifyCapacity` were the exact-match path that
 * caused phantom open-slots. They have been replaced by the coverage engine
 * (computeSlotCoverage). These tests assert the dead exports no longer exist
 * so they cannot accidentally be re-introduced.
 */

import { describe, it, expect } from 'vitest';
import * as helpers from '@/lib/openShiftHelpers';

describe('openShiftHelpers dead exports removed', () => {
  it('does NOT export computeOpenSpots', () => {
    expect((helpers as Record<string, unknown>).computeOpenSpots).toBeUndefined();
  });

  it('does NOT export classifyCapacity', () => {
    expect((helpers as Record<string, unknown>).classifyCapacity).toBeUndefined();
  });

  it('still exports formatCompactTime', () => {
    expect(typeof helpers.formatCompactTime).toBe('function');
    expect(helpers.formatCompactTime('14:00')).toBe('2p');
  });
});
