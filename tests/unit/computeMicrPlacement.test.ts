import { describe, it, expect } from 'vitest';
import { computeMicrPlacement } from '../../src/utils/checkPrinting';

describe('computeMicrPlacement', () => {
  it('CRITICAL: places right edge 1.9375" from the right (ANSI X9 position 14)', () => {
    const placement = computeMicrPlacement({
      pageWidth: 8.5,
      checkBottomY: 3.5,
      measuredTextWidth: 4.0,
      charCount: 32,
      charSpace: 0.018,
    });
    // 8.5 − 1.9375 = 6.5625
    expect(placement.rightEdgeX).toBeCloseTo(6.5625, 4);
  });

  it('CRITICAL: baseline lands 0.3125" from the bottom of the check (ANSI midpoint)', () => {
    const placement = computeMicrPlacement({
      pageWidth: 8.5,
      checkBottomY: 3.5,
      measuredTextWidth: 4.0,
      charCount: 32,
      charSpace: 0.018,
    });
    // 3.5 − 0.3125 = 3.1875
    expect(placement.baselineY).toBeCloseTo(3.1875, 4);
  });

  it('CRITICAL: totalWidth = measuredTextWidth + charSpace × (N − 1)', () => {
    const placement = computeMicrPlacement({
      pageWidth: 8.5,
      checkBottomY: 3.5,
      measuredTextWidth: 4.0,
      charCount: 32,
      charSpace: 0.018,
    });
    expect(placement.totalWidth).toBeCloseTo(4.0 + 0.018 * 31, 6);
  });

  it('CRITICAL: leftX = rightEdgeX − totalWidth', () => {
    const placement = computeMicrPlacement({
      pageWidth: 8.5,
      checkBottomY: 3.5,
      measuredTextWidth: 4.0,
      charCount: 32,
      charSpace: 0.018,
    });
    expect(placement.leftX).toBeCloseTo(
      placement.rightEdgeX - placement.totalWidth,
      6,
    );
  });

  it('CRITICAL: charSpace = 0 makes totalWidth equal measuredTextWidth', () => {
    const placement = computeMicrPlacement({
      pageWidth: 8.5,
      checkBottomY: 3.5,
      measuredTextWidth: 4.0,
      charCount: 32,
      charSpace: 0,
    });
    expect(placement.totalWidth).toBe(4.0);
  });

  it('CRITICAL: N = 1 yields zero inter-character gaps', () => {
    const placement = computeMicrPlacement({
      pageWidth: 8.5,
      checkBottomY: 3.5,
      measuredTextWidth: 0.13,
      charCount: 1,
      charSpace: 0.018,
    });
    expect(placement.totalWidth).toBe(0.13);
  });

  it('CRITICAL: charCount = 0 has no inter-character gaps (defensive Math.max guard)', () => {
    const placement = computeMicrPlacement({
      pageWidth: 8.5,
      checkBottomY: 3.5,
      measuredTextWidth: 0,
      charCount: 0,
      charSpace: 0.018,
    });
    expect(placement.totalWidth).toBe(0);
    expect(placement.leftX).toBeCloseTo(placement.rightEdgeX, 6);
  });

  it('CRITICAL: leftX stays positive at max-realistic MICR width (17-digit account)', () => {
    // ⑈9999999⑈ + 2 spaces + ⑆111000614⑆ + 2 spaces + 17-digit account + ⑈
    // ≈ 9 + 2 + 11 + 2 + 18 = 42 chars × ~0.13" = 5.46" + 41 × 0.018" = 0.74"
    // Total ≈ 6.2" — leaves leftX ≈ 0.36" on an 8.5" page
    const placement = computeMicrPlacement({
      pageWidth: 8.5,
      checkBottomY: 3.5,
      measuredTextWidth: 5.5,
      charCount: 42,
      charSpace: 0.018,
    });
    expect(placement.leftX).toBeGreaterThan(0);
    expect(placement.leftX).toBeGreaterThan(0.25);
  });

  it('CRITICAL: production geometry — 32-char line at 18pt charSpace=0 leaves leftX ≈ 2.5625"', () => {
    // 32 chars × 0.125" (8 cpi at 18pt with the bundled TTF) = 4.0"
    // rightEdgeX = 8.5 − 1.9375 = 6.5625"
    // leftX     = 6.5625 − 4.0 = 2.5625"
    const placement = computeMicrPlacement({
      pageWidth: 8.5,
      checkBottomY: 3.5,
      measuredTextWidth: 4.0,
      charCount: 32,
      charSpace: 0,
    });
    expect(placement.totalWidth).toBe(4.0);
    expect(placement.leftX).toBeCloseTo(2.5625, 4);
    // Also confirm the line still has > 2" of clear space on the left
    // (matches Toast's observed behavior).
    expect(placement.leftX).toBeGreaterThan(2.0);
  });
});
