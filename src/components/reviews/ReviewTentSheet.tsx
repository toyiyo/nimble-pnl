import { useState } from 'react';

import { initials } from '@/lib/reviews/reviewBranding';
import { SHEET_SIZES, type SheetSizeKey } from '@/lib/reviews/printSheet';

import '@fontsource/zilla-slab/400.css';
import '@fontsource/zilla-slab/600.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
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
  nameePt: number;
  messagePt: number;
  urlPt: number;
  padIn: number;
  gapIn: number;
}

const TYPE: Readonly<Record<SheetSizeKey, TypeScale>> = {
  tent: { markIn: 0.62, nameePt: 8, messagePt: 17, urlPt: 7.5, padIn: 0.42, gapIn: 0.16 },
  card: { markIn: 0.86, nameePt: 10, messagePt: 22, urlPt: 9, padIn: 0.6, gapIn: 0.22 },
  stickers: { markIn: 0.3, nameePt: 5.5, messagePt: 8, urlPt: 5, padIn: 0.16, gapIn: 0.07 },
};

/** `https://app.example.com/r/slug` reads better on paper without the scheme. */
function displayUrl(url: string): string {
  return url.replace(/^https?:\/\//, '');
}

function SheetMark({
  logoUrl,
  restaurantName,
  sizeIn,
}: {
  logoUrl: string | null;
  restaurantName: string;
  sizeIn: number;
}) {
  const [broken, setBroken] = useState(false);

  // A logo that fails to load must never block the print, and must never leave
  // a blank box on the paper. Fall back to the same circle the guest page shows.
  if (logoUrl && !broken) {
    return (
      <img
        src={logoUrl}
        alt=""
        crossOrigin="anonymous"
        onError={() => setBroken(true)}
        className="print-ink rounded-full object-cover"
        style={{ width: `${sizeIn}in`, height: `${sizeIn}in` }}
      />
    );
  }

  return (
    <div
      className="counter-display flex items-center justify-center rounded-full bg-muted font-semibold text-foreground"
      style={{ width: `${sizeIn}in`, height: `${sizeIn}in`, fontSize: `${sizeIn * 34}pt` }}
    >
      {initials(restaurantName)}
    </div>
  );
}

function SheetTile({
  size,
  restaurantName,
  logoUrl,
  message,
  qrSvg,
  publicUrl,
}: ReviewTentSheetProps) {
  const sheet = SHEET_SIZES[size];
  const type = TYPE[size];

  return (
    <div
      className="print-tile flex h-full w-full flex-col items-center justify-center text-center"
      style={{ padding: `${type.padIn}in`, gap: `${type.gapIn}in` }}
    >
      <SheetMark logoUrl={logoUrl} restaurantName={restaurantName} sizeIn={type.markIn} />

      <p
        className="counter-micro uppercase text-muted-foreground"
        style={{ fontSize: `${type.nameePt}pt`, letterSpacing: '0.09em' }}
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
          // [a-z0-9-] (see reviewSlug.ts). No attacker-controlled markup reaches
          // innerHTML here. The same reasoning covers ReviewQrDialog.tsx:109-113.
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

  return (
    <div
      // The sheet is a picture of paper, not a control. Every value it shows
      // already appears in a labelled control in the dialog, so the whole
      // subtree leaves the accessibility tree. Nothing inside carries a role or
      // a label: an aria-hidden ancestor makes that markup unreachable.
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
        <SheetTile key={index} {...props} />
      ))}
    </div>
  );
}
