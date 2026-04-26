import { describe, it, expect, vi, afterEach } from 'vitest';

import { MICR_PDF_CHAR_MAP, registerMicrFont, toMicrPdfText } from '@/assets/fonts/micr-e13b';
import { MICR_TRANSIT, MICR_ON_US } from '@/utils/micrLine';

describe('MICR_PDF_CHAR_MAP', () => {
  it('maps the transit symbol to A', () => {
    expect(MICR_PDF_CHAR_MAP[MICR_TRANSIT]).toBe('A');
  });

  it('maps the on-us symbol to C', () => {
    expect(MICR_PDF_CHAR_MAP[MICR_ON_US]).toBe('C');
  });
});

describe('toMicrPdfText', () => {
  it('returns digits unchanged', () => {
    expect(toMicrPdfText('123456789')).toBe('123456789');
  });

  it('replaces transit and on-us symbols with their font glyphs', () => {
    const input = `${MICR_ON_US}239${MICR_ON_US} ${MICR_TRANSIT}111000614${MICR_TRANSIT} 2907959096${MICR_ON_US}`;
    const expected = 'C239C A111000614A 2907959096C';
    expect(toMicrPdfText(input)).toBe(expected);
  });

  it('passes through unmapped characters unchanged', () => {
    expect(toMicrPdfText('foo bar')).toBe('foo bar');
  });

  it('returns an empty string for empty input', () => {
    expect(toMicrPdfText('')).toBe('');
  });
});

describe('registerMicrFont', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fetches the TTF, registers it with jsPDF, and returns the family name', async () => {
    const ttfBytes = new Uint8Array([0x00, 0x01, 0x00, 0x00, 0x42]);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(ttfBytes, { status: 200 })),
    );

    const addFileToVFS = vi.fn();
    const addFont = vi.fn();
    const doc = { addFileToVFS, addFont } as unknown as Parameters<typeof registerMicrFont>[0];

    const family = await registerMicrFont(doc);

    expect(family).toBe('MICR-E13B');
    expect(addFileToVFS).toHaveBeenCalledWith('micr-e13b.ttf', expect.any(String));
    expect(addFont).toHaveBeenCalledWith('micr-e13b.ttf', 'MICR-E13B', 'normal');
  });
});
