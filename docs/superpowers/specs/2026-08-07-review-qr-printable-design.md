# Printable review QR — design

Date: 2026-08-07
Branch: `feature/review-qr-printable`
Status: design

## 1. The problem

A restaurant manager opens the QR dialog and gets a bare black square with two
download buttons ([ReviewQrDialog.tsx:121-148](../../../src/components/reviews/ReviewQrDialog.tsx)).
The manager must then place that square in Word or Canva, add the logo, add a
message, and set the paper size. Most managers do not do this. They tape the
raw square to the counter, or they print nothing.

Give the manager a finished sheet instead. One click prints a card that carries
the logo, the QR code, and a short message, in the same visual language as the
page the guest lands on after the scan.

## 2. What exists today

### 2.1 The dialog

`ReviewQrDialog` takes `slug` and `publicUrl` and nothing else
([ReviewQrDialog.tsx:15-20](../../../src/components/reviews/ReviewQrDialog.tsx)).
It imports the `qrcode` package on demand, because the encoder is about 50 KB
and only a manager who opens this dialog needs it
([ReviewQrDialog.tsx:45-53](../../../src/components/reviews/ReviewQrDialog.tsx)).
It builds two artefacts from one options object:

```ts
const options = { margin: 1, width: 512, errorCorrectionLevel: 'M' as const };
```

([ReviewQrDialog.tsx:49](../../../src/components/reviews/ReviewQrDialog.tsx))

It injects the SVG string with `dangerouslySetInnerHTML`. The existing comment
records why this is safe: the string is the `qrcode` package's own output, and
it encodes `publicUrl`, which is built from `slug`, which `SLUG_PATTERN` limits
to `[a-z0-9-]`
([ReviewQrDialog.tsx:105-114](../../../src/components/reviews/ReviewQrDialog.tsx)).

An `aria-live="polite"` region reports three states: generating, ready, failed
([ReviewQrDialog.tsx:92-98](../../../src/components/reviews/ReviewQrDialog.tsx)).

### 2.2 The parent

`ReviewPageBuilder` mounts the dialog with the saved slug
([ReviewPageBuilder.tsx:354-361](../../../src/components/reviews/ReviewPageBuilder.tsx)).
Its props are `page`, `restaurantId`, `canManage`, and `onCreated`
([ReviewPageBuilder.tsx:33-38](../../../src/components/reviews/ReviewPageBuilder.tsx)).
The QR button sits outside the `canManage` guard on purpose. The comment states
the rule: printing the tent is a read, not a write
([ReviewPageBuilder.tsx:317-327](../../../src/components/reviews/ReviewPageBuilder.tsx)).

`Reviews.tsx` renders the builder and holds `selectedRestaurant` from
`useRestaurantContext()` ([Reviews.tsx:28-30](../../../src/pages/Reviews.tsx),
[Reviews.tsx:430-437](../../../src/pages/Reviews.tsx)). The context type carries
a `name` field ([RestaurantContext.tsx:13](../../../src/contexts/RestaurantContext.tsx)).
The builder does not receive that name today.

### 2.3 The Counter theme

`.theme-counter` pins a warm paper palette and two font variables
([counter-theme.css:19-52](../../../src/styles/counter-theme.css)):

```css
--font-display: 'Zilla Slab', Georgia, serif;
--font-mono-micro: 'IBM Plex Mono', ui-monospace, monospace;
```

([counter-theme.css:50-51](../../../src/styles/counter-theme.css))

Three helper classes apply them: `.counter-display`, `.counter-micro`, and
`.counter-rule` ([counter-theme.css:54-67](../../../src/styles/counter-theme.css)).

**Neither font loads today.** `index.html` fetches only Roboto from Google Fonts
([index.html:26](../../../index.html)). No `@font-face` rule for Zilla Slab or
IBM Plex Mono exists anywhere in `src/`. The theme therefore renders its
Georgia and `ui-monospace` fallbacks on every guest device.

### 2.4 The logo

`uploadLogo` writes the object and stores the storage path on the row
([useReviewPages.ts:208-238](../../../src/hooks/useReviewPages.ts)):

```ts
const path = `${restaurantId}/${pageId}/${crypto.randomUUID()}.${extension}`;
```

([useReviewPages.ts:213](../../../src/hooks/useReviewPages.ts))

The manager-side type carries `logo_path`, not a URL
([useReviewPages.ts:14](../../../src/hooks/useReviewPages.ts)). The hook returns
no public-URL helper ([useReviewPages.ts:240-248](../../../src/hooks/useReviewPages.ts)).
The bucket is public, so no signature is necessary:

```sql
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('review-page-logos', 'review-page-logos', true, 2097152, ...);
```

([20260804100100_review_funnel_tables.sql:202-206](../../../supabase/migrations/20260804100100_review_funnel_tables.sql))

A public read policy also exists
([20260804100100_review_funnel_tables.sql:213-215](../../../supabase/migrations/20260804100100_review_funnel_tables.sql)).

### 2.5 The guest surface the print must match

`ReviewPage` stacks the logo, the restaurant name, a dashed rule, and the
headline ([ReviewPage.tsx:290-317](../../../src/pages/ReviewPage.tsx)):

- logo in `h-14 w-14 rounded-full object-cover`, or initials in the same circle
- restaurant name in `counter-micro`, 12 px, uppercase, wide tracking
- `counter-rule` divider
- headline in `counter-display`, 26 px, semibold, centred

The initials fallback uses a private helper, `initials`, declared inside the
page file ([ReviewPage.tsx:31](../../../src/pages/ReviewPage.tsx)). It is not
exported and no other file can reach it.

### 2.6 No print CSS exists

A search of `src/` finds no `@media print` block and no `@page` rule. This
feature adds the first one in the codebase.

## 3. Decisions the user confirmed

| Question | Decision |
| --- | --- |
| Fonts | Self-host Zilla Slab and IBM Plex Mono. Scope them to the Counter theme. The print step waits on `document.fonts.ready`. This also changes the live guest page: it starts to render the slab serif it was designed for. |
| Message | One-off. Do not store it. The field starts at the page headline and resets when the dialog closes. No migration, no RLS change, no pgTAP test. |
| Sizes | Ship all three: 4×6 in tent, 5.5×8.5 in counter card, 6-up sticker sheet on US Letter. |

## 4. Architecture

### 4.1 The one-instance rule

`memory/lessons.md` records a failure from 2026-06-28: a print surface and a
screen surface that each build their own markup drift apart. The lesson demands
one tested helper at the prop boundary.

This design goes further. **The sheet exists exactly once in the DOM.** The
dialog renders one `<ReviewTentSheet>`. On screen a wrapper scales it down with
a CSS `transform`. In print, a `@media print` block removes the transform and
hides every other element on the page. There is no second copy to drift, and
no `window.open` document to re-derive.

```text
ReviewQrDialog
├── controls (size radio, message input, Print, Download SVG, Download PNG)
└── <div class="tent-preview">        ← transform: scale(k); screen only
    └── <ReviewTentSheet …props />    ← the single instance, real print size
```

`window.open` was rejected. A popup blocker kills it, the new document loses
Tailwind, and it loses the Supabase session that the logo request may need.

### 4.2 New files

| File | Purpose |
| --- | --- |
| `src/lib/reviews/reviewBranding.ts` | `initials(name)`, moved out of `ReviewPage.tsx` and exported. `logoPublicUrl(path)` wraps `supabase.storage.from('review-page-logos').getPublicUrl(path)`. Both are pure enough to unit test. |
| `src/lib/reviews/printSheet.ts` | `SHEET_SIZES`, a frozen record of the three sizes with their inch dimensions, `@page` size string, QR side length, and preview scale. Also `waitForPrintReady(root)`, which awaits `document.fonts.ready` and every `img.decode()` inside `root`. |
| `src/components/reviews/ReviewTentSheet.tsx` | Presentational. Props only, no hooks, no data fetch. Renders the paper: logo or initials, restaurant name, rule, message, QR, and the URL in micro type. |
| `src/styles/print-sheet.css` | The `@media print` block and the three `@page` rules. Imported by `ReviewTentSheet.tsx`. |
| `src/styles/counter-fonts.css` | The four `@font-face` rules. Imported by `counter-theme.css`. |
| `src/assets/fonts/*.woff2` | Zilla Slab 400 and 600, IBM Plex Mono 400 and 500. Latin subset only. |

### 4.3 Changed files

| File | Change |
| --- | --- |
| `ReviewQrDialog.tsx` | Widen the props: add `restaurantName`, `logoPath`, `defaultMessage`. Add the size radio, the message input, and the Print button. Keep both download buttons. Keep the dynamic import. Keep the live region and extend it. |
| `ReviewPageBuilder.tsx` | Pass `restaurantName`, `page.logo_path`, and `page.headline` down to the dialog. |
| `Reviews.tsx` | Pass `selectedRestaurant.name` into the builder as `restaurantName`. |
| `ReviewPage.tsx` | Import `initials` from `reviewBranding.ts`. Delete the private copy. |
| `counter-theme.css` | Add `@import './counter-fonts.css';` at the top. |

### 4.4 The three sizes

| Key | Paper | QR side | Layout |
| --- | --- | --- | --- |
| `tent` | 4 × 6 in portrait | 2.6 in | Full sheet. Logo, name, rule, message, QR, URL. |
| `card` | 5.5 × 8.5 in portrait | 3.2 in | Same stack, larger type, more air. |
| `stickers` | 8.5 × 11 in Letter | 1.9 in | A 2 × 3 grid of six identical small tiles, each with logo, QR, and one short line. |

`SHEET_SIZES` holds these values once. The `@page` rule and the sheet element
both read from the same record, so a size can never disagree with its paper.

### 4.5 Print correctness

The current options produce a 512 px raster
([ReviewQrDialog.tsx:49](../../../src/components/reviews/ReviewQrDialog.tsx)).
At a 2.6 in QR that is about 197 dpi, and at 3.2 in about 160 dpi. A phone
camera reads that, but the edges soften. The sheet therefore embeds the **SVG**,
which is resolution independent. The PNG download stays for managers who paste
the code into other software.

Three further rules:

1. **Quiet zone.** `margin: 1` gives one module of white border. The QR
   specification requires four. Generate a second SVG for the sheet with
   `margin: 4`. Keep `margin: 1` for the on-screen preview square and the two
   downloads, so the existing downloads do not change shape.
2. **Error correction.** Keep level `M`. The sheet places no logo over the code,
   so the higher levels only add modules and shrink each one.
3. **Ink.** Pure black on pure white inside the QR block. Apply
   `print-color-adjust: exact` to the logo image and the QR block only. Do not
   apply it to the paper, and do not print a full-bleed warm background: a
   restaurant printer would drain a colour cartridge on every sheet.

### 4.6 The print sequence

```text
click Print
  → generate the margin-4 SVG if it is not ready yet
  → announce "Preparing the sheet…" in the live region
  → await waitForPrintReady(sheetRef.current)
        · document.fonts.ready
        · every <img> in the sheet: decode()
  → announce "Sheet ready. The print dialog is open."
  → window.print()
```

The wait matters. Without it the browser prints Georgia while Zilla Slab is
still in flight, and prints an empty box where the logo will be.

The logo is a cross-origin image from Supabase Storage. Set
`crossOrigin="anonymous"` so `decode()` resolves and a future canvas step is not
blocked. If the logo fails to load, fall back to the initials circle and print
anyway. A missing logo must never block the print.

### 4.7 Fonts

Self-host four files under `src/assets/fonts/`. This follows the MICR
precedent, which already stores a font in that directory and imports it with
Vite's `?url` suffix ([micr-e13b.ts:3](../../../src/assets/fonts/micr-e13b.ts)).

Each `@font-face` uses `font-display: swap` and a `unicode-range` limited to
Latin. The rules live in `counter-fonts.css`, which `counter-theme.css` imports,
so a page that never mounts the Counter theme never requests the files.

Record the licence. Both families are SIL Open Font License 1.1. Add
`src/assets/fonts/ZillaSlab-LICENSE.txt` and
`src/assets/fonts/IBMPlexMono-LICENSE.txt`, next to the existing
`MICR-E13B-LICENSE.txt`.

**Known side effect.** The guest review page changes appearance the moment this
merges. Georgia becomes Zilla Slab and the system mono becomes IBM Plex Mono.
This is intended: the theme already asks for these families
([counter-theme.css:50-51](../../../src/styles/counter-theme.css)). Re-check the
contrast gate that the theme header records — 8.1:1 for `--muted-foreground` on
`--background`. Contrast does not depend on the font, so the gate holds, but the
new faces have different stroke weights. Confirm the 12 px micro copy stays
legible.

## 5. Access and security

The QR button stays open to a viewer
([ReviewPageBuilder.tsx:317-318](../../../src/components/reviews/ReviewPageBuilder.tsx)).
The printable adds no write, so this rule does not change. The message field is
local state and never reaches the database.

The logo URL comes from `getPublicUrl` on a bucket that is already public
([20260804100100_review_funnel_tables.sql:206](../../../supabase/migrations/20260804100100_review_funnel_tables.sql)),
so no signed URL and no service-role key is involved.

The message text renders as a React text node, never through
`dangerouslySetInnerHTML`. Only the QR SVG uses that path, and the existing
comment already justifies it
([ReviewQrDialog.tsx:109-113](../../../src/components/reviews/ReviewQrDialog.tsx)).
Cap the message at 120 characters, because a longer string overflows the sheet
and pushes the QR off the paper.

## 6. Accessibility

The existing live region reports three states
([ReviewQrDialog.tsx:92-98](../../../src/components/reviews/ReviewQrDialog.tsx)).
Extend it to report the print sequence.

Warning: an `aria-live` region announces a **change**. Two identical consecutive
strings announce nothing. A second Print click must therefore announce a
distinct string, or the screen reader user hears silence and believes the button
is dead. Include an attempt counter in the announced string, or clear the region
before the next message.

Other rules:

- The size control is a `RadioGroup` with a visible `<Label>`, not three buttons.
- The message input has an associated `<Label>`.
- The Print button carries `aria-label="Print the review sheet"`.
- The sheet itself is `aria-hidden="true"` on screen. It is a preview of paper,
  and its text already appears in the controls above it.
- The QR image inside the sheet keeps `role="img"` and an `aria-label` that
  names the destination URL.

## 7. Testing

| Test | Location | Covers |
| --- | --- | --- |
| `reviewBranding.test.ts` | `tests/unit/` | `initials` for one word, two words, empty, and accented input. `logoPublicUrl` returns null for a null path. |
| `printSheet.test.ts` | `tests/unit/` | `SHEET_SIZES` holds three keys. Each `@page` size string matches its inch dimensions. `waitForPrintReady` resolves when fonts and images resolve, and still resolves when an image rejects. |
| `ReviewTentSheet.test.tsx` | `tests/unit/` | Renders the restaurant name, the message, and the URL. Falls back to initials when `logoUrl` is null. Applies the size class for each of the three keys. |
| `ReviewQrDialog.print.test.tsx` | `tests/unit/` | The message field starts at `defaultMessage` and resets on close. `window.print` is called only after the ready promise settles. A second print announces a different string. |
| `review-qr-print.spec.ts` | `tests/e2e/` | Open the dialog, switch size, confirm the preview element carries the new size class, confirm the message input drives the sheet text. Stub `window.print`. |

Playwright cannot read a rendered PDF. The e2e test therefore asserts the DOM
and the stubbed call, not the paper.

Follow the repository rule on unbounded waits. Run Playwright in the foreground
with `--reporter=line` and let the Bash tool's own `timeout` bound it.

## 8. Rejected alternatives

| Option | Why not |
| --- | --- |
| `window.open` and write a document | A popup blocker kills it. The new document has no Tailwind and no session. |
| Render the sheet to canvas and download a PDF | Adds a PDF dependency for a job the browser already does. Rasterises the QR, which is the one element that must stay vector. |
| Store the message on `review_pages` | Needs a migration, an RLS review, and a pgTAP test for a string the manager types once and prints. The user chose the one-off field. |
| Two components, one for preview and one for print | This is the exact drift the 2026-06-28 lesson records. One instance, one transform. |
| Load the fonts from Google Fonts | A third-party request on the guest page. Self-hosting removes it and keeps the print deterministic. |

## 9. Risks

1. **Browser print differences.** Safari and Chrome disagree on `@page size`.
   Chrome honours it. Safari often falls back to the user's paper choice. Print
   a visible cut line on the sheet so a Safari user on Letter still gets a
   correct trim.
2. **Font weight of the print.** A 12 px `counter-micro` line at 4 in wide is
   small on paper. Set the sheet's type in `pt`, not `px`, and verify the URL
   line stays readable.
3. **The guest page changes look.** Section 4.7 records this. It is intended and
   it needs a visual check before the PR.
4. **`node_modules` in this worktree.** A 2026-08-05 lesson records that a
   worktree whose `node_modules` predates the `qrcode` dependency fails this
   exact file's tests with a Vite import-analysis overlay. `npm install` already
   ran in this worktree and `qrcode` is present.

## 10. Out of scope

- Any change to the public review page beyond the font swap and the `initials`
  import.
- Any new database column, RPC, RLS policy, or edge function.
- Any change to what the QR encodes. The URL stays `${origin}/r/${slug}`
  ([ReviewPageBuilder.tsx:359](../../../src/components/reviews/ReviewPageBuilder.tsx)).
- Batch print across several review pages at once.
