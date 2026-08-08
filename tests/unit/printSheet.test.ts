import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  SHEET_SIZES,
  SHEET_SIZE_KEYS,
  MAX_MESSAGE_LENGTH,
  waitForPrintReady,
} from '@/lib/reviews/printSheet';

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

    await vi.advanceTimersByTimeAsync(1);
    await pending;
    expect(settled).toBe(true);
  });

  it('resolves without waiting for the budget when the work finishes first', async () => {
    vi.useFakeTimers();

    let settled = false;
    const pending = waitForPrintReady(rootWithImages(['resolve']), 4000).then(() => {
      settled = true;
    });

    await vi.advanceTimersByTimeAsync(0);
    await pending;
    expect(settled).toBe(true);
  });
});
