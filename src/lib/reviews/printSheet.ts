export type SheetSizeKey = 'tent' | 'card' | 'stickers';

export interface SheetSize {
  key: SheetSizeKey;
  /** Shown next to the radio button. */
  label: string;
  /** Shown under the label. */
  hint: string;
  widthIn: number;
  heightIn: number;
  /** Feeds the `@page { size }` rule. Never write this by hand twice. */
  pageSize: string;
  /** The printed side of the QR square. */
  qrIn: number;
  /** Screen preview scale. The sheet always renders at its real print size. */
  previewScale: number;
  /** How many copies the sheet carries. */
  tiles: number;
  /** Grid columns for those copies. */
  columns: number;
}

/**
 * One record for three sizes. The `@page` rule, the preview, and the printed
 * sheet all read these numbers, so a paper size can never disagree with the
 * element drawn on it.
 */
export const SHEET_SIZES: Readonly<Record<SheetSizeKey, SheetSize>> = Object.freeze({
  tent: {
    key: 'tent',
    label: 'Table tent',
    // Not "folds to stand": the sheet is one tile across the full 4 × 6, so a
    // fold would put the crease through the QR code.
    hint: '4 × 6 in — fits a countertop stand',
    widthIn: 4,
    heightIn: 6,
    pageSize: '4in 6in',
    qrIn: 2.6,
    previewScale: 0.62,
    tiles: 1,
    columns: 1,
  },
  card: {
    key: 'card',
    label: 'Counter card',
    hint: '5.5 × 8.5 in — half a letter sheet',
    widthIn: 5.5,
    heightIn: 8.5,
    pageSize: '5.5in 8.5in',
    qrIn: 3.2,
    previewScale: 0.45,
    tiles: 1,
    columns: 1,
  },
  stickers: {
    key: 'stickers',
    label: 'Sticker sheet',
    hint: '8.5 × 11 in — six to a page',
    widthIn: 8.5,
    heightIn: 11,
    pageSize: '8.5in 11in',
    qrIn: 1.9,
    previewScale: 0.35,
    tiles: 6,
    columns: 2,
  },
});

/** Radio order. `Object.keys` order is not a contract worth relying on. */
export const SHEET_SIZE_KEYS: readonly SheetSizeKey[] = ['tent', 'card', 'stickers'];

/**
 * A longer line overflows the tent and pushes the QR off the paper. The dialog
 * caps the input at this length, so the sheet never has to truncate.
 */
export const MAX_MESSAGE_LENGTH = 120;

const DEFAULT_PRINT_BUDGET_MS = 4000;

/**
 * Holds the print back until the sheet can render what it promises: the slab
 * serif rather than the Georgia fallback, and the logo rather than an empty
 * box.
 *
 * This never rejects and never hangs. A blocked font request or a stale cache
 * can leave `document.fonts.ready` pending forever, and a manager staring at a
 * dead Print button has a broken feature. A late font is a cosmetic loss, so
 * the budget wins the race and the print goes ahead.
 */
export async function waitForPrintReady(
  root: HTMLElement | null,
  budgetMs: number = DEFAULT_PRINT_BUDGET_MS
): Promise<void> {
  if (!root) return;

  const images = Array.from(root.querySelectorAll('img'));
  const work = Promise.all([
    // `document.fonts` is absent in older engines and in some test environments.
    document.fonts?.ready ?? Promise.resolve(),
    // A failed decode is the missing-logo path. The sheet already falls back to
    // the initials circle, so swallow it rather than block the print.
    ...images.map((img) => img.decode().catch(() => undefined)),
  ]);

  let timer: ReturnType<typeof setTimeout> | undefined;
  const budget = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, budgetMs);
  });

  try {
    await Promise.race([work.then(() => undefined), budget]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
