# Printable review QR — implementation plan

Date: 2026-08-07
Branch: `feature/review-qr-printable`
Design: [2026-08-07-review-qr-printable-design.md](../specs/2026-08-07-review-qr-printable-design.md)

Build order follows TDD. Write the test first. See it fail. Write the code.

## Step 1 — Extract the branding helpers

Create `src/lib/reviews/reviewBranding.ts`.

```ts
export function initials(name: string): string;
export function logoPublicUrl(path: string | null): string | null;
```

Move `initials` out of `ReviewPage.tsx:31`. Keep the body identical.
`logoPublicUrl` returns `null` for a null path. Otherwise it returns
`supabase.storage.from('review-page-logos').getPublicUrl(path).data.publicUrl`.
This mirrors the edge function at `review-public/index.ts:137-138`.

Change `ReviewPage.tsx`: import `initials`, delete the private copy.

**Test** `tests/unit/reviewBranding.test.ts`:
- `initials('Blue Fin')` returns `BF`.
- `initials('Nobu')` returns `N`.
- `initials('')` returns an empty string.
- `initials('Café Ñoño')` handles the accents.
- `logoPublicUrl(null)` returns `null`.
- `logoPublicUrl('a/b/c.png')` returns a string that ends with the path.

## Step 2 — The size record and the ready gate

Create `src/lib/reviews/printSheet.ts`.

```ts
export type SheetSizeKey = 'tent' | 'card' | 'stickers';

export interface SheetSize {
  key: SheetSizeKey;
  label: string;      // "4 x 6 tent"
  widthIn: number;
  heightIn: number;
  pageSize: string;   // "4in 6in"
  qrIn: number;
  previewScale: number;
  tiles: number;      // 1, or 6 for stickers
}

export const SHEET_SIZES: Readonly<Record<SheetSizeKey, SheetSize>>;
export const MAX_MESSAGE_LENGTH = 120;
export async function waitForPrintReady(root: HTMLElement | null, budgetMs?: number): Promise<void>;
```

Values: `tent` 4×6 in, QR 2.6 in, 1 tile. `card` 5.5×8.5 in, QR 3.2 in, 1 tile.
`stickers` 8.5×11 in, QR 1.9 in, 6 tiles.

`waitForPrintReady` races two promises:
1. `Promise.all([document.fonts.ready, ...images.map(decode)])`, where every
    `decode()` rejection resolves instead.
2. A timer of `budgetMs`, default 4000.

The race never rejects. A dead Print button is worse than a late font.

**Test** `tests/unit/printSheet.test.ts`:
- `SHEET_SIZES` holds exactly three keys.
- Every `pageSize` string matches its own `widthIn` and `heightIn`.
- `waitForPrintReady` resolves when fonts and images resolve.
- It resolves when an image `decode()` rejects.
- It resolves on the budget when `document.fonts.ready` never settles.
  Use fake timers.

## Step 3 — The print CSS

Create `src/styles/print-sheet.css`.

```css
#review-print-root { position: absolute; left: -100000px; top: 0; }

@media print {
  body > *:not(#review-print-root) { display: none !important; }
  #review-print-root { position: static; left: auto; }
}

@media print {
  .sheet-tent     { /* @page rule via a size-specific class on <html> */ }
}
```

The three `@page` rules need a size selector. CSS cannot read a class inside
`@page`. Use three named pages instead:

```css
@page tent     { size: 4in 6in;    margin: 0; }
@page card     { size: 5.5in 8.5in; margin: 0; }
@page stickers { size: 8.5in 11in;  margin: 0; }

#review-print-root[data-size='tent']     { page: tent; }
#review-print-root[data-size='card']     { page: card; }
#review-print-root[data-size='stickers'] { page: stickers; }
```

Add `break-inside: avoid` to each sticker tile. Add
`print-color-adjust: exact` to the logo image and the QR block only.

Do not use `display: none` on the print root. A `display: none` image may reject
`decode()`.

## Step 4 — The sheet component

Create `src/components/reviews/ReviewTentSheet.tsx`.

```tsx
interface ReviewTentSheetProps {
  size: SheetSizeKey;
  restaurantName: string;
  logoUrl: string | null;
  message: string;
  qrSvg: string | null;
  publicUrl: string;
}
```

Rules:
- No hooks. No data fetch. Props only.
- Root element carries `theme-counter` and `aria-hidden="true"`.
- Import the four `@fontsource` CSS files, `@/styles/counter-theme.css`, and
  `@/styles/print-sheet.css`.
- Stack: logo or initials circle, restaurant name in `counter-micro` uppercase,
  `counter-rule`, message in `counter-display`, QR block, `publicUrl` in
  `counter-micro`.
- Size the type in `pt`, not `px`.
- The logo `<img>` carries `crossOrigin="anonymous"` and `alt=""`.
- On a logo load error, switch to the initials circle. Use local state on a
  small inner component, or an `onError` handler that sets a flag on the
  element. Keep the sheet itself hook-free.
- `stickers` renders `SHEET_SIZES.stickers.tiles` copies of the tile in a 2 × 3
  grid.
- Inject `qrSvg` with `dangerouslySetInnerHTML`. Carry the existing safety
  comment from `ReviewQrDialog.tsx:109-113`.
- Draw a dashed cut line around the trim area. Risk 1 in the design needs it.

**Test** `tests/unit/ReviewTentSheet.test.tsx`:
- Renders the restaurant name, the message, and the URL.
- Shows the initials circle when `logoUrl` is `null`.
- Shows the `<img>` when `logoUrl` is a string.
- Renders 6 tiles for `stickers` and 1 for `tent`.
- The root carries `aria-hidden="true"` and `data-size`.

## Step 5 — Rewire the dialog

Change `src/components/reviews/ReviewQrDialog.tsx`.

New props: `restaurantName: string`, `logoPath: string | null`,
`defaultMessage: string`.

State: `size` (default `'tent'`), `message` (default `defaultMessage`),
`printSvg`, `printing`, `printAttempt`.

Reset `message` to `defaultMessage` whenever `open` turns false, or whenever
`defaultMessage` changes.

Generate a third SVG with `margin: 4` for the sheet. Keep `margin: 1` for the
preview square and the two downloads. Add it to the existing `Promise.all` at
`ReviewQrDialog.tsx:50-53`, so one dynamic import serves all three.

Build `sheetProps` once. Render two mounts:

```tsx
const sheetProps = { size, restaurantName, logoUrl, message, qrSvg: printSvg, publicUrl };

// inside DialogContent
<div className="tent-preview rounded-xl border border-border/40 bg-muted/30 …">
  <ReviewTentSheet {...sheetProps} />
</div>

// portal
{createPortal(
  <div id="review-print-root" data-size={size} ref={printRootRef}>
    <ReviewTentSheet {...sheetProps} />
  </div>,
  document.body
)}
```

Mount the portal only while `open` is true.

Print handler:

```ts
const attempt = printAttempt + 1;
setPrintAttempt(attempt);
setPrinting(true);
await waitForPrintReady(printRootRef.current, 4000);
setPrinting(false);
window.print();
```

Extend the live region. Every string carries the attempt number, so a second
click announces a change:

- `Preparing the sheet… (attempt ${attempt})`
- `Sheet ready. The print dialog is open. (attempt ${attempt})`

Controls, with the classes from the design section 6:
- A `RadioGroup` for the three sizes, with a visible `<Label>`.
- An `<Input>` for the message, with a `<Label>` and a character counter.
  `maxLength={MAX_MESSAGE_LENGTH}`.
- A Print button with visible text and no `aria-label`. Disable it until
  `printSvg` is ready.
- Keep both download buttons unchanged.

Widen `DialogContent` from `max-w-md` to `max-w-2xl`, because the preview needs
the room.

**Test** `tests/unit/ReviewQrDialog.print.test.tsx`:
- The message field starts at `defaultMessage`.
- Close and reopen resets the message.
- `window.print` runs only after the ready promise settles.
- A second print announces a different live-region string.
- Both mounts show the same message text.
- The size radio changes `data-size` on the print root.

## Step 6 — Thread the props

`ReviewPageBuilder.tsx`:
- Add `restaurantName: string` to the props interface.
- Pass `restaurantName`, `logoPath={page.logo_path}`,
  `defaultMessage={page.headline}` to `ReviewQrDialog`.

`Reviews.tsx`:
- Pass `restaurantName={selectedRestaurant.restaurant.name}` to the builder.
  The nested path matters. `UserRestaurant` has no top-level `name`
  (`useRestaurants.tsx:60-78`).

## Step 7 — The e2e test

Create `tests/e2e/review-qr-print.spec.ts`.

- Sign in, open a review page, open the QR dialog.
- Stub `window.print` with `page.addInitScript`.
- Check the preview shows the restaurant name.
- Change the size to `card`. Check `#review-print-root` carries
  `data-size="card"`.
- Type in the message field. Check the sheet text changes.
- Click Print. Check the stub ran once.

Use `page.getByRole` and `page.getByLabel`. Import helpers from
`'../helpers/e2e-supabase'`.

Run it in the foreground with `--reporter=line`. Bound it with the Bash tool's
`timeout` parameter. Start no poll loop.

## Step 8 — Verify

```bash
npm run typecheck && npm run lint && npm run test
```

Then the e2e run. Then a manual print check in Chrome **and** Safari, per design
risk 2. Use the browser print preview. Check three things: the paper size, the
QR quiet zone, and that the dialog chrome does not appear on the sheet.

## Order and dependencies

Steps 1, 2, and 3 are independent. Step 4 needs 2 and 3. Step 5 needs 1, 2,
and 4. Step 6 needs 5. Step 7 needs 6.

## Out of scope

The design section 10 lists it. No migration. No new column. No RLS change. No
change to what the QR encodes.
