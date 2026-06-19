import { describe, it, expect } from 'vitest';
import { createScanGate } from '@/utils/scannerConfig';

describe('createScanGate', () => {
  it('accepts the first scan', () => {
    const gate = createScanGate();
    expect(gate.shouldAccept('0123456789012')).toBe(true);
  });

  it('suppresses the same value once it has been marked accepted', () => {
    const gate = createScanGate();
    gate.markAccepted('0123456789012');
    expect(gate.shouldAccept('0123456789012')).toBe(false);
  });

  it('accepts a different value and then no longer suppresses the old one', () => {
    const gate = createScanGate();
    gate.markAccepted('111');
    expect(gate.shouldAccept('222')).toBe(true); // different code clears suppression
    expect(gate.shouldAccept('111')).toBe(true); // old code no longer suppressed
  });

  it('reset() clears suppression', () => {
    const gate = createScanGate();
    gate.markAccepted('111');
    gate.reset();
    expect(gate.shouldAccept('111')).toBe(true);
  });
});
