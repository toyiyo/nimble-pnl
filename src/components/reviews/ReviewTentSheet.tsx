import { useState } from 'react';

import { BrandMark } from './BrandMark';

import { SHEET_SIZES, type SheetSizeKey } from '@/lib/reviews/printSheet';

import '@fontsource/zilla-slab/400.css';
import '@fontsource/zilla-slab/600.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@/styles/counter-theme.css';
import '@/styles/print-sheet.css';

interface ReviewTentSheetProps {
  size: SheetSizeKey;
  restaurantName: string;
  logoUrl: string | null;
  message: string;
  /** Null until the encoder finishes. The sheet renders the rest meanwhile. */
  qrSvg: string | null;
  publicUrl: string;
}

/**
 * Paper type is set in points, not pixels. A 12 px line looks fine on a monitor
 * and disappears on a 4 in card held at arm's length.
 */
interface TypeScale {
  markIn: number;
  namePt: number;
  messagePt: number;
  urlPt: number;
  padIn: number;
  gapIn: number;
}

const TYPE: Readonly<Record<SheetSizeKey, TypeScale>> = {
  tent: { markIn: 0.62, namePt: 8, messagePt: 17, urlPt: 7.5, padIn: 0.42, gapIn: 0.16 },
  card: { markIn: 0.86, namePt: 10, messagePt: 22, urlPt: 9, padIn: 0.6, gapIn: 0.22 },
  stickers: { markIn: 0.3, namePt: 5.5, messagePt: 8, urlPt: 5, padIn: 0.16, gapIn: 0.07 },
};

/**
 * Initials height against the circle diameter. One inch is 72 pt, so 34 pt per
 * inch sets the cap height near half the circle. Two letters then fill the
 * circle without a collision with the edge.
 */
const INITIALS_PT_PER_IN = 34;

/** `https://app.example.com/r/slug` reads better on paper without the scheme. */
function displayUrl(url: string): string {
  return url.replace(/^https?:\/\//, '');
}

function SheetTile({
  size,
  restaurantName,
  logoUrl,
  message,
  qrSvg,
  publicUrl,
  logoBroken,
  onLogoBroken,
}: ReviewTentSheetProps & { logoBroken: boolean; onLogoBroken: () => void }) {
  const sheet = SHEET_SIZES[size];
  const type = TYPE[size];

  return (
    <div
      className="print-tile flex h-full w-full flex-col items-center justify-center text-center"
      style={{ padding: `${type.padIn}in`, gap: `${type.gapIn}in` }}
    >
      {/* `print-ink` on the mark, not only on the logo. A printer with
          background graphics off drops the initials circle otherwise, and a
          restaurant with no logo loses the one mark of identity on the page. */}
      <BrandMark
        logoUrl={logoUrl}
        name={restaurantName}
        broken={logoBroken}
        onBroken={onLogoBroken}
        className="print-ink"
        style={{
          width: `${type.markIn}in`,
          height: `${type.markIn}in`,
          fontSize: `${type.markIn * INITIALS_PT_PER_IN}pt`,
        }}
      />

      <p
        className="counter-micro uppercase text-muted-foreground"
        style={{ fontSize: `${type.namePt}pt`, letterSpacing: '0.09em' }}
      >
        {restaurantName}
      </p>

      <div className="counter-rule w-1/2" />

      <p
        className="counter-display font-semibold text-foreground"
        style={{ fontSize: `${type.messagePt}pt`, lineHeight: 1.25 }}
      >
        {message}
      </p>

      {qrSvg && (
        <div
          className="print-ink print-qr-paper [&>svg]:h-full [&>svg]:w-full"
          style={{ width: `${sheet.qrIn}in`, height: `${sheet.qrIn}in` }}
          // `qrSvg` is the `qrcode` package's own SVG output, not user HTML. It
          // encodes `publicUrl`, built from `slug`, which SLUG_PATTERN limits to
          // [a-z0-9-] (see reviewSlug.ts). The database holds the same pattern
          // as a CHECK constraint. No attacker-controlled markup reaches
          // innerHTML here.
          dangerouslySetInnerHTML={{ __html: qrSvg }}
        />
      )}

      <p
        className="counter-micro text-muted-foreground"
        style={{ fontSize: `${type.urlPt}pt` }}
      >
        {displayUrl(publicUrl)}
      </p>
    </div>
  );
}

/**
 * The printed sheet, and the preview of it.
 *
 * `ReviewQrDialog` mounts this twice from one props object: once scaled down
 * inside the dialog, once in a portal on document.body for the print. Two
 * mounts of one component from one props object cannot drift. Two components
 * can — see memory/lessons.md, 2026-06-28, where a print path re-derived its
 * own roster and leaked inactive employees onto paper.
 *
 * Presentational only. No data fetch, no context, no query.
 */
export function ReviewTentSheet(props: ReviewTentSheetProps) {
  const sheet = SHEET_SIZES[props.size];

  // One flag for the whole sheet. The sticker page draws six marks from one
  // URL. Six local flags let one slow request print five logos and one circle.
  //
  // Keyed by URL, as BrandMark keys its own flag. A manager can upload a new
  // logo while this dialog stays open, and a plain boolean would then hide it.
  const [brokenLogoUrl, setBrokenLogoUrl] = useState<string | null>(null);
  const logoBroken = props.logoUrl !== null && brokenLogoUrl === props.logoUrl;

  return (
    <div
      // The sheet is a picture of paper, not a control. The dialog carries the
      // accessible name for this subtree — see the `role="img"` wrapper on the
      // preview and the `aria-live` status line in ReviewQrDialog.
      aria-hidden="true"
      data-size={props.size}
      className="theme-counter bg-background text-foreground"
      style={{
        width: `${sheet.widthIn}in`,
        height: `${sheet.heightIn}in`,
        display: 'grid',
        gridTemplateColumns: `repeat(${sheet.columns}, 1fr)`,
        gridAutoRows: `${sheet.heightIn / (sheet.tiles / sheet.columns)}in`,
      }}
    >
      {Array.from({ length: sheet.tiles }, (_, index) => (
        <SheetTile
          key={index}
          {...props}
          logoBroken={logoBroken}
          onLogoBroken={() => setBrokenLogoUrl(props.logoUrl)}
        />
      ))}
    </div>
  );
}
