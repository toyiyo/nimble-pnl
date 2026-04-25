import { describe, it, expect } from 'vitest';
import { formatMicrLine, MICR_TRANSIT, MICR_ON_US } from '@/utils/micrLine';

describe('formatMicrLine', () => {
  it('formats the standard business-check MICR sequence', () => {
    const result = formatMicrLine({
      checkNumber: 239,
      routingNumber: '111000614',
      accountNumber: '2907959096',
    });
    expect(result).toBe(
      `${MICR_ON_US}239${MICR_ON_US}  ${MICR_TRANSIT}111000614${MICR_TRANSIT}  2907959096${MICR_ON_US}`
    );
  });

  it('right-pads check number with no leading zeros (raw decimal)', () => {
    const result = formatMicrLine({
      checkNumber: 1001,
      routingNumber: '111000614',
      accountNumber: '12345',
    });
    expect(result).toContain(`${MICR_ON_US}1001${MICR_ON_US}`);
  });

  it('throws on an invalid routing number', () => {
    expect(() => formatMicrLine({
      checkNumber: 1,
      routingNumber: '123',
      accountNumber: '1234',
    })).toThrow(/routing/i);
  });

  it('throws on a non-numeric account number', () => {
    expect(() => formatMicrLine({
      checkNumber: 1,
      routingNumber: '111000614',
      accountNumber: '12a4',
    })).toThrow(/account/i);
  });

  it('throws on a non-positive check number', () => {
    expect(() => formatMicrLine({
      checkNumber: 0,
      routingNumber: '111000614',
      accountNumber: '1234',
    })).toThrow(/check number/i);
  });
});

describe('glyph constants', () => {
  it('exports the on-us and transit glyphs', () => {
    expect(MICR_ON_US).toBe('⑈');
    expect(MICR_TRANSIT).toBe('⑆');
  });
});
