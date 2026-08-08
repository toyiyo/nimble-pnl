import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  SHEET_SIZES,
  SHEET_SIZE_KEYS,
  MAX_MESSAGE_LENGTH,
  waitForPrintReady,
} from '@/lib/reviews/printSheet';
import { SLUG_PATTERN } from '@/lib/reviews/reviewSlug';

describe('SHEET_SIZES', () => {
  it('holds exactly the three shipped sizes', () => {
    expect(SHEET_SIZE_KEYS).toEqual(['tent', 'card', 'stickers']);
    expect(Object.keys(SHEET_SIZES).sort()).toEqual(['card', 'stickers', 'tent']);
  });

  it('gives every pageSize string the same inches as its own dimensions', () => {
    for (const key of SHEET_SIZE_KEYS) {
      const size = SHEET_SIZES[key];
      expect(size.pageSize).toBe(`${size.widthIn}in ${size.heightIn}in`);
    }
  });

  it('keys every entry by its own key', () => {
    for (const key of SHEET_SIZE_KEYS) {
      expect(SHEET_SIZES[key].key).toBe(key);
    }
  });

  it('keeps every QR at least 32 mm wide', () => {
    // 32 mm is the practical floor for a phone camera at arm's length.
    const MIN_QR_IN = 32 / 25.4;
    for (const key of SHEET_SIZE_KEYS) {
      expect(SHEET_SIZES[key].qrIn).toBeGreaterThanOrEqual(MIN_QR_IN);
    }
  });

  it('fits the QR inside its own paper', () => {
    for (const key of SHEET_SIZE_KEYS) {
      const size = SHEET_SIZES[key];
      const across = size.columns;
      expect(size.qrIn * across).toBeLessThan(size.widthIn);
    }
  });

  it('gives the sticker sheet a six-tile grid and the others a single tile', () => {
    expect(SHEET_SIZES.stickers.tiles).toBe(6);
    expect(SHEET_SIZES.stickers.columns).toBe(2);
    expect(SHEET_SIZES.tent.tiles).toBe(1);
    expect(SHEET_SIZES.card.tiles).toBe(1);
  });

  it('caps the message at 120 characters', () => {
    expect(MAX_MESSAGE_LENGTH).toBe(120);
  });
});

/** Builds a root whose images resolve or reject on demand. */
function rootWithImages(behaviours: Array<'resolve' | 'reject'>): HTMLElement {
  const root = document.createElement('div');
  for (const behaviour of behaviours) {
    const img = document.createElement('img');
    img.decode =
      behaviour === 'resolve'
        ? () => Promise.resolve()
        : () => Promise.reject(new Error('decode failed'));
    root.appendChild(img);
  }
  return root;
}

describe('waitForPrintReady', () => {
  let fontsReady: Promise<unknown>;

  beforeEach(() => {
    fontsReady = Promise.resolve();
    Object.defineProperty(document, 'fonts', {
      configurable: true,
      get: () => ({ get ready() { return fontsReady; } }),
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves when the fonts and every image resolve', async () => {
    await expect(waitForPrintReady(rootWithImages(['resolve', 'resolve']))).resolves.toBeUndefined();
  });

  it('resolves when an image decode rejects', async () => {
    // A missing logo must never block the print.
    await expect(waitForPrintReady(rootWithImages(['resolve', 'reject']))).resolves.toBeUndefined();
  });

  it('resolves for a null root', async () => {
    await expect(waitForPrintReady(null)).resolves.toBeUndefined();
  });

  it('resolves on the budget when the fonts promise never settles', async () => {
    vi.useFakeTimers();
    fontsReady = new Promise(() => {});

    let settled = false;
    const pending = waitForPrintReady(rootWithImages([]), 4000).then(() => {
      settled = true;
    });

    await vi.advanceTimersByTimeAsync(3999);
    expect(settled).toBe(false);

    // 1 ms ends the budget, then one frame lets React commit.
    await vi.advanceTimersByTimeAsync(1);
    await vi.advanceTimersByTimeAsync(20);
    await pending;
    expect(settled).toBe(true);
  });

  it('resolves without waiting for the budget when the work finishes first', async () => {
    vi.useFakeTimers();

    let settled = false;
    const pending = waitForPrintReady(rootWithImages(['resolve']), 4000).then(() => {
      settled = true;
    });

    await vi.advanceTimersByTimeAsync(20);
    await pending;
    expect(settled).toBe(true);
  });

  it('yields a frame after the images settle', async () => {
    // A logo that fails to load rejects decode() and fires onerror. The error
    // handler sets state, and React needs a frame to put the initials circle
    // on the paper. Without the yield the print captures the broken image.
    const frames: Array<() => void> = [];
    const original = globalThis.requestAnimationFrame;
    globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
      frames.push(() => cb(0));
      return 1;
    }) as typeof globalThis.requestAnimationFrame;

    try {
      let settled = false;
      const pending = waitForPrintReady(rootWithImages(['reject'])).then(() => {
        settled = true;
      });

      // Drain the microtask queue. The frame is the only thing left.
      await new Promise((done) => setTimeout(done, 0));
      expect(settled).toBe(false);
      expect(frames).toHaveLength(1);

      frames[0]();
      await pending;
      expect(settled).toBe(true);
    } finally {
      globalThis.requestAnimationFrame = original;
    }
  });
});

const PRINT_CSS = readFileSync(resolve(process.cwd(), 'src/styles/print-sheet.css'), 'utf8');

describe('print-sheet.css against SHEET_SIZES', () => {
  // `@page` cannot read a TypeScript object, so the paper sizes live twice: in
  // SHEET_SIZES and in the stylesheet. This suite is what stops them drifting.
  const pageRules = new Map<string, string>();
  for (const match of PRINT_CSS.matchAll(/@page\s+([\w-]+)\s*\{([^}]*)\}/g)) {
    const size = /size:\s*([^;]+);/.exec(match[2]);
    if (size) pageRules.set(match[1], size[1].trim());
  }

  it('declares one @page rule per sheet size and no others', () => {
    expect([...pageRules.keys()].sort()).toEqual([...SHEET_SIZE_KEYS].sort());
  });

  it('gives every @page rule the size its SHEET_SIZES entry names', () => {
    for (const key of SHEET_SIZE_KEYS) {
      expect(pageRules.get(key)).toBe(SHEET_SIZES[key].pageSize);
    }
  });

  it('zeroes the margin on every @page rule', () => {
    // A default 0.5 in margin pushes a seventh partial sticker row onto a
    // second sheet.
    for (const match of PRINT_CSS.matchAll(/@page\s+[\w-]+\s*\{([^}]*)\}/g)) {
      expect(match[1]).toMatch(/margin:\s*0\s*;/);
    }
  });

  it('opts each size into its own named page', () => {
    for (const key of SHEET_SIZE_KEYS) {
      expect(PRINT_CSS).toContain(`#review-print-root[data-size='${key}']`);
    }
  });

  it('needs the review-print-active class before it hides the app', () => {
    // The stylesheet loads with the Reviews route and never unloads. Without
    // the class the hide rule stays live for the session and every other page
    // in the app prints blank. tests/e2e/review-qr-print.spec.ts holds the
    // runtime half of this.
    expect(PRINT_CSS).toContain('body.review-print-active > *:not(#review-print-root)');
    expect(PRINT_CSS).not.toMatch(/(?<!\.review-print-active)\s*body\s*>\s*\*:not\(/);
  });
});

describe('QR module size on the smallest sheet', () => {
  /** The slug pattern allows 48 characters. Pin that, then build on it. */
  const MAX_SLUG_LENGTH = 48;

  it('caps the slug at 48 characters', () => {
    expect(SLUG_PATTERN.test('a'.repeat(MAX_SLUG_LENGTH))).toBe(true);
    expect(SLUG_PATTERN.test('a'.repeat(MAX_SLUG_LENGTH + 1))).toBe(false);
  });

  it('keeps every module at least 0.5 mm wide for the longest URL', async () => {
    // A longer URL needs a higher QR version, which puts more modules in the
    // same printed square. A phone camera loses a module below about 0.4 mm.
    const QRCode = await import('qrcode');
    const worstCaseUrl = `https://app.easyshifthq.com/r/${'a'.repeat(MAX_SLUG_LENGTH)}`;
    const svg = await QRCode.toString(worstCaseUrl, {
      margin: 4,
      type: 'svg',
      errorCorrectionLevel: 'M',
    });

    const viewBox = /viewBox="0 0 (\d+) \1"/.exec(svg);
    expect(viewBox).not.toBeNull();
    const modulesAcross = Number(viewBox![1]);

    for (const key of SHEET_SIZE_KEYS) {
      const mmPerModule = (SHEET_SIZES[key].qrIn * 25.4) / modulesAcross;
      expect(mmPerModule).toBeGreaterThanOrEqual(0.5);
    }
  });
});
