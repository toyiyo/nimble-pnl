# Printable review QR — design

Date: 2026-08-07
Branch: `feature/review-qr-printable`
Status: design, revision 2 (Phase 2.5 review folded in)

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

### 2.2 The dialog shell

`DialogContent` applies these classes
([dialog.tsx:40](../../../src/components/ui/dialog.tsx)):

```text
fixed left-[50%] top-[50%] z-50 grid w-full max-w-lg max-h-[85vh]
translate-x-[-50%] translate-y-[-50%] gap-4 overflow-y-auto …
```

Four of those values matter for print: `fixed`, `max-h-[85vh]`,
`overflow-y-auto`, and the two `translate` transforms. A `position: fixed`
ancestor with a capped height and `overflow-y-auto` clips its children to the
screen. Section 4.1 records the consequence.

`DialogContent` renders inside a `DialogPortal`
([dialog.tsx:34-36](../../../src/components/ui/dialog.tsx)), so the whole dialog
is a direct child of `document.body`.

### 2.3 The parent

`ReviewPageBuilder` mounts the dialog with the saved slug
([ReviewPageBuilder.tsx:354-361](../../../src/components/reviews/ReviewPageBuilder.tsx)).
Its props are `page`, `restaurantId`, `canManage`, and `onCreated`
([ReviewPageBuilder.tsx:33-38](../../../src/components/reviews/ReviewPageBuilder.tsx)).
The QR button sits outside the `canManage` guard on purpose. The comment states
the rule: printing the tent is a read, not a write
([ReviewPageBuilder.tsx:317-327](../../../src/components/reviews/ReviewPageBuilder.tsx)).

`Reviews.tsx` renders the builder and holds `selectedRestaurant` from
`useRestaurantContext()` ([Reviews.tsx:28-30](../../../src/pages/Reviews.tsx),
[Reviews.tsx:430-437](../../../src/pages/Reviews.tsx)).

`selectedRestaurant` has type `UserRestaurant`
([useRestaurants.tsx:60-78](../../../src/hooks/useRestaurants.tsx)). That type
has **no** top-level `name` field. The name sits on the nested `restaurant`
object ([useRestaurants.tsx:10-12](../../../src/hooks/useRestaurants.tsx)). The
correct path is `selectedRestaurant.restaurant.name`. The builder does not
receive that name today.

### 2.4 The Counter theme

`.theme-counter` pins a warm paper palette and two font variables
([counter-theme.css:19-52](../../../src/styles/counter-theme.css)):

```css
--font-display: 'Zilla Slab', Georgia, serif;
--font-mono-micro: 'IBM Plex Mono', ui-monospace, monospace;
```

([counter-theme.css:50-51](../../../src/styles/counter-theme.css))

Three helper classes apply them: `.counter-display`, `.counter-micro`, and
`.counter-rule` ([counter-theme.css:54-67](../../../src/styles/counter-theme.css)).

**Both fonts already load.** `ReviewPage.tsx` imports them from `@fontsource`
([ReviewPage.tsx:24-27](../../../src/pages/ReviewPage.tsx)):

```ts
import '@fontsource/zilla-slab/400.css';
import '@fontsource/zilla-slab/600.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@/styles/counter-theme.css';
```

`package.json:53-54` lists both packages. The packages self-host the woff2
files and declare the `@font-face` rules inside `node_modules`. The guest page
renders Zilla Slab and IBM Plex Mono today.

`ReviewPage.tsx:27` is the **only** import of `counter-theme.css` in `src/`. The
manager pane therefore has neither the theme nor the fonts today.

### 2.5 The logo

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

([20260804100100_review_funnel_tables.sql:202-210](../../../supabase/migrations/20260804100100_review_funnel_tables.sql))

A public read policy also exists
([20260804100100_review_funnel_tables.sql:213-215](../../../supabase/migrations/20260804100100_review_funnel_tables.sql)).
No later migration changes the bucket or drops that policy.

The public page gets its `logo_url` from the edge function, which calls plain
`getPublicUrl` with no signature and no transform
([review-public/index.ts:137-138](../../../supabase/functions/review-public/index.ts)).
The manager side cannot reach that code, because it runs on the server.

### 2.6 The guest surface the print must match

`ReviewPage` stacks the logo, the restaurant name, a dashed rule, and the
headline ([ReviewPage.tsx:290-317](../../../src/pages/ReviewPage.tsx)):

- logo in `h-14 w-14 rounded-full object-cover`, or initials in the same circle
- restaurant name in `counter-micro`, 12 px, uppercase, wide tracking
- `counter-rule` divider
- headline in `counter-display`, 26 px, semibold, centred

The initials fallback uses a private helper, `initials`, declared inside the
page file ([ReviewPage.tsx:31](../../../src/pages/ReviewPage.tsx)). It is not
exported and no other file can reach it.

### 2.7 No print CSS exists

A search of `src/` finds no `@media print` block and no `@page` rule. This
feature adds the first one in the codebase.

## 3. Decisions

| Question | Decision |
| --- | --- |
| Message | One-off. Do not store it. The field starts at the page headline and resets when the dialog closes. No migration, no RLS change, no pgTAP test. |
| Sizes | Ship all three: 4×6 in tent, 5.5×8.5 in counter card, 6-up sticker sheet on US Letter. |
| Fonts | **Superseded.** The user chose "self-host both fonts" against a false premise. Section 2.4 shows `@fontsource` already loads both. The sheet reuses those packages. Add no font file, no `@font-face` rule, and no licence file. The guest page does not change look. |

## 4. Architecture

### 4.1 One component, one props object, two mounts

`memory/lessons.md:791` records a failure from 2026-06-28: a print surface and a
screen surface that each build their own markup drift apart. The lesson demands
one tested helper applied at the prop boundary.

An earlier revision tried to satisfy this with a single DOM node inside the
dialog, scaled down by a CSS `transform`. The Phase 2.5 review rejected that.
`DialogContent` is `position: fixed` with `max-h-[85vh]`, `overflow-y-auto`, and
two `translate` transforms ([dialog.tsx:40](../../../src/components/ui/dialog.tsx)).
A clipped, transformed, fixed ancestor prints the visible scroll window only, or
prints nothing at all in Safari.

This design therefore mounts `ReviewTentSheet` **twice**, from **one** props
object built once in `ReviewQrDialog`:

```text
ReviewQrDialog
├── sheetProps = { size, restaurantName, logoUrl, message, qrSvg, publicUrl }
│
├── inside DialogContent
│   └── <div class="tent-preview" aria-hidden="true">   ← transform: scale(k)
│       └── <ReviewTentSheet {...sheetProps} />
│
└── createPortal(
        <div id="review-print-root">
          <ReviewTentSheet {...sheetProps} />
        </div>,
        document.body)
```

The lesson forbids two **implementations**. Two mounts of one component from one
props object cannot drift: React renders the same tree from the same input. The
print copy hangs off `document.body`, so no Radix ancestor clips it.

Screen and print behaviour of the print root:

```css
/* Off screen, not display:none — a display:none image may reject decode(). */
#review-print-root { position: absolute; left: -100000px; top: 0; }

@media print {
  body > *:not(#review-print-root) { display: none !important; }
  #review-print-root { position: static; left: auto; }
}
```

`body > *` reaches the dialog, because `DialogPortal` puts it there
([dialog.tsx:34-36](../../../src/components/ui/dialog.tsx)).

`window.open` was rejected. A popup blocker kills it, the new document loses
Tailwind, and it loses the Supabase session that the logo request may need.

### 4.2 New files

| File | Purpose |
| --- | --- |
| `src/lib/reviews/reviewBranding.ts` | `initials(name)`, moved out of `ReviewPage.tsx` and exported. `logoPublicUrl(path)` wraps `supabase.storage.from('review-page-logos').getPublicUrl(path)` and returns `null` for a null path. Both are pure enough to unit test. |
| `src/lib/reviews/printSheet.ts` | `SHEET_SIZES`, a frozen record of the three sizes. Each entry holds the inch dimensions, the `@page` size string, the QR side length, and the preview scale. Also `waitForPrintReady(root, budgetMs)`. |
| `src/components/reviews/ReviewTentSheet.tsx` | Presentational. Props only, no hooks, no data fetch. Renders the paper. Imports the `@fontsource` CSS and `@/styles/counter-theme.css`. |
| `src/styles/print-sheet.css` | The `@media print` block, the `#review-print-root` rules, and the three `@page` rules. Imported by `ReviewTentSheet.tsx`. |

The earlier revision also listed `src/styles/counter-fonts.css` and four
`.woff2` files. Section 3 deletes them.

### 4.3 Changed files

| File | Change |
| --- | --- |
| `ReviewQrDialog.tsx` | Widen the props: add `restaurantName`, `logoPath`, `defaultMessage`. Add the size radio, the message input, and the Print button. Add the preview mount and the portal mount. Keep both download buttons, the dynamic import, and the live region. |
| `ReviewPageBuilder.tsx` | Add a `restaurantName` prop. Pass `restaurantName`, `page.logo_path`, and `page.headline` down to the dialog. |
| `Reviews.tsx` | Pass `selectedRestaurant.restaurant.name` into the builder as `restaurantName`. |
| `ReviewPage.tsx` | Import `initials` from `reviewBranding.ts`. Delete the private copy at line 31. Keep the four import lines at 24-27 exactly as they are. |

`counter-theme.css` does not change.

### 4.4 The three sizes

| Key | Paper | QR side | Layout |
| --- | --- | --- | --- |
| `tent` | 4 × 6 in portrait | 2.6 in | Full sheet. Logo, name, rule, message, QR, URL. |
| `card` | 5.5 × 8.5 in portrait | 3.2 in | Same stack, larger type, more air. |
| `stickers` | 8.5 × 11 in Letter | 1.9 in | A 2 × 3 grid of six identical small tiles, each with logo, QR, and one short line. |

`SHEET_SIZES` holds these values once. The `@page` rule and the sheet element
both read from the same record, so a size can never disagree with its paper.

Each sticker tile carries `break-inside: avoid`, so no tile splits across two
sheets.

### 4.5 Print correctness

The current options produce a 512 px raster
([ReviewQrDialog.tsx:49](../../../src/components/reviews/ReviewQrDialog.tsx)).
At a 2.6 in QR that is about 197 dpi, and at 3.2 in about 160 dpi. A phone
camera reads that, but the edges soften. The sheet therefore embeds the **SVG**,
which is resolution independent. The PNG download stays for managers who paste
the code into other software.

Four further rules:

1. **Quiet zone.** `margin: 1` gives one module of white border. The QR
   specification requires four. Generate a second SVG for the sheet with
   `margin: 4`. Keep `margin: 1` for the on-screen preview square and the two
   downloads, so the existing downloads do not change shape.
2. **Error correction.** Keep level `M`. The sheet places no logo over the code,
   so the higher levels only add modules and shrink each one.
3. **Page margin.** Set `@page { size: …; margin: 0 }` for every size. A browser
   applies about 0.5 in of default margin otherwise. That default shrinks the
   printable area and pushes a seventh partial row of stickers onto sheet two.
4. **Ink.** Pure black on pure white inside the QR block. Apply
   `print-color-adjust: exact` to the logo image and the QR block only. Do not
   apply it to the paper, and do not print a full-bleed warm background: a
   restaurant printer would drain a colour cartridge on every sheet.

### 4.6 The print sequence

```text
click Print
  → generate the margin-4 SVG if it is not ready yet
  → announce "Preparing the sheet… (attempt N)" in the live region
  → await waitForPrintReady(printRootRef.current, 4000)
        · document.fonts.ready
        · every <img> in the root: decode()
        · a 4 s budget wins the race and resolves anyway
  → announce "Sheet ready. The print dialog is open. (attempt N)"
  → window.print()
```

The wait matters. Without it the browser prints Georgia while Zilla Slab is
still in flight, and prints an empty box where the logo will be.

The wait must also never hang. A blocked font request or a stale cache can leave
`document.fonts.ready` pending. `waitForPrintReady` therefore races the work
against a 4 s budget and resolves either way. A late font is a cosmetic loss. A
dead Print button is a broken feature.

The logo is a cross-origin image from Supabase Storage. Set
`crossOrigin="anonymous"` so `decode()` resolves. If the logo fails to load,
fall back to the initials circle and print anyway. A missing logo must never
block the print.

### 4.7 Fonts

No new work. `ReviewTentSheet.tsx` imports the packages that already ship:

```ts
import '@fontsource/zilla-slab/400.css';
import '@fontsource/zilla-slab/600.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import '@/styles/counter-theme.css';
```

`node_modules/@fontsource/ibm-plex-mono/500.css` and
`node_modules/@fontsource/zilla-slab/600.css` both exist. Vite deduplicates a
CSS module that two entry points import, so the guest page fetches no extra
bytes.

`ReviewTentSheet` puts `theme-counter` on its own root element, so the manager
pane keeps its normal palette outside the sheet.

## 5. Access and security

The QR button stays open to a viewer
([ReviewPageBuilder.tsx:317-318](../../../src/components/reviews/ReviewPageBuilder.tsx)).
The printable adds no write, so this rule does not change. The message field is
local state and never reaches the database.

The logo URL comes from `getPublicUrl` on a bucket that is already public
([20260804100100_review_funnel_tables.sql:206](../../../supabase/migrations/20260804100100_review_funnel_tables.sql)),
so no signed URL and no service-role key is involved. `logo_path` already
travels to any user who can read the row under the existing `review_pages`
select policy, so the print adds no new exposure.

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
distinct string. Section 4.6 puts an attempt counter in every announced string.

Both sheet mounts carry `aria-hidden="true"`. The preview is a picture of paper.
The print copy sits off screen. Neither is a control, and every value they show
already appears in a labelled control above them. An `aria-hidden` ancestor
removes its whole subtree, so the sheet's QR carries **no** `role="img"` and no
`aria-label`: that markup would be unreachable. The reachable QR is the existing
preview square in the dialog body, which keeps its `role="img"` and its label
([ReviewQrDialog.tsx:105-114](../../../src/components/reviews/ReviewQrDialog.tsx)).

Other rules:

- The size control is a `RadioGroup` with a visible `<Label>`, not three buttons.
- The message input has an associated `<Label>` and a character counter.
- The Print button keeps its visible text "Print". It carries no `aria-label`,
  because a label would override the visible text with no gain.

Classes follow the CLAUDE.md Apple/Notion scale:

- `<Label>`: `text-[12px] font-medium text-muted-foreground uppercase tracking-wider`
- `<Input>`: `h-10 text-[14px] bg-muted/30 border-border/40 rounded-lg focus-visible:ring-1 focus-visible:ring-border`
- Print button: `h-9 px-4 rounded-lg bg-foreground text-background hover:bg-foreground/90 text-[13px] font-medium`
- Preview frame: `rounded-xl border border-border/40 bg-muted/30`

No direct colour appears. The sheet's paper colour comes from `theme-counter`'s
`--background` token.

## 7. Testing

| Test | Location | Covers |
| --- | --- | --- |
| `reviewBranding.test.ts` | `tests/unit/` | `initials` for one word, two words, empty, and accented input. `logoPublicUrl` returns `null` for a null path. |
| `printSheet.test.ts` | `tests/unit/` | `SHEET_SIZES` holds three keys. Each `@page` size string matches its inch dimensions. `waitForPrintReady` resolves when fonts and images resolve. It still resolves when an image rejects. It resolves on the budget when `document.fonts.ready` never settles. |
| `ReviewTentSheet.test.tsx` | `tests/unit/` | Renders the restaurant name, the message, and the URL. Falls back to initials when `logoUrl` is null. Applies the size class for each of the three keys. Carries `aria-hidden`. |
| `ReviewQrDialog.print.test.tsx` | `tests/unit/` | The message field starts at `defaultMessage` and resets on close. `window.print` runs only after the ready promise settles. A second print announces a different string. Both mounts receive the same props. |
| `review-qr-print.spec.ts` | `tests/e2e/` | Open the dialog, change the size, check the preview element carries the new size class, check the message input drives the sheet text. Stub `window.print`. |

Playwright cannot read a rendered PDF. The e2e test therefore checks the DOM and
the stubbed call, not the paper.

Follow the repository rule on unbounded waits. Run Playwright in the foreground
with `--reporter=line` and let the Bash tool's own `timeout` bound it.

## 8. Rejected alternatives

| Option | Why not |
| --- | --- |
| `window.open` and write a document | A popup blocker kills it. The new document has no Tailwind and no session. |
| One DOM node inside the dialog, scaled by `transform` | `DialogContent` is `fixed` with `max-h-[85vh]`, `overflow-y-auto`, and two translate transforms ([dialog.tsx:40](../../../src/components/ui/dialog.tsx)). It clips the print, or prints blank in Safari. |
| Render the sheet to canvas and download a PDF | Adds a PDF dependency for a job the browser already does. Rasterises the QR, which is the one element that must stay vector. |
| Store the message on `review_pages` | Needs a migration, an RLS review, and a pgTAP test for a string the manager types once and prints. |
| Two components, one for preview and one for print | This is the exact drift the 2026-06-28 lesson records. One component, two mounts, one props object. |
| Self-host the fonts | `@fontsource` already self-hosts them ([ReviewPage.tsx:24-26](../../../src/pages/ReviewPage.tsx)). A hand-written `@font-face` set would double the font bytes on the guest page. |

## 9. Risks

1. **Browser print differences.** Safari and Chrome disagree on `@page size`.
   Chrome honours it. Safari often falls back to the user's paper choice. Print
   a visible cut line on the sheet, so a Safari user on Letter still gets a
   correct trim.
2. **Safari print of a portalled node.** Section 4.1 removes the `fixed` and
   `transform` ancestors, which are the documented cause of blank Safari output.
   The print copy still needs a manual check in real Safari before the PR. Add
   this to the Phase 8 verify step. A Chrome check alone is not enough.
3. **Font weight of the print.** A 12 px `counter-micro` line at 4 in wide is
   small on paper. Set the sheet's type in `pt`, not `px`, and check the URL
   line stays readable.
4. **`node_modules` in this worktree.** A 2026-08-05 lesson (`memory/lessons.md:2325`)
   records that a worktree whose `node_modules` predates the `qrcode` dependency
   fails this exact file's tests with a Vite import-analysis overlay.
   `npm install` already ran in this worktree and `qrcode` is present.

## 10. Out of scope

- Any change to the public review page beyond the `initials` import.
- Any new database column, RPC, RLS policy, or edge function.
- Any change to what the QR encodes. The URL stays `${origin}/r/${slug}`
  ([ReviewPageBuilder.tsx:359](../../../src/components/reviews/ReviewPageBuilder.tsx)).
- Batch print across several review pages at once.
