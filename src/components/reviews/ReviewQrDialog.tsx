import { useEffect } from 'react';
import { createPortal } from 'react-dom';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Skeleton } from '@/components/ui/skeleton';

import { Printer, QrCode } from 'lucide-react';

import { ReviewTentSheet } from './ReviewTentSheet';

import { useReviewQrSheet } from '@/hooks/useReviewQrSheet';

import { logoPublicUrl } from '@/lib/reviews/reviewBranding';
import {
  MAX_MESSAGE_LENGTH,
  SHEET_SIZES,
  SHEET_SIZE_KEYS,
  type SheetSizeKey,
} from '@/lib/reviews/printSheet';

interface ReviewQrDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  slug: string;
  publicUrl: string;
  restaurantName: string;
  logoPath: string | null;
  /** Seeds the message field. The page headline, so the paper matches the page. */
  defaultMessage: string;
}

/** The print CSS hides the app behind this class. See src/styles/print-sheet.css. */
const PRINT_ACTIVE_CLASS = 'review-print-active';

function download(filename: string, href: string) {
  const link = document.createElement('a');
  link.href = href;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

export function ReviewQrDialog({
  open,
  onOpenChange,
  slug,
  publicUrl,
  restaurantName,
  logoPath,
  defaultMessage,
}: ReviewQrDialogProps) {
  const {
    svg,
    png,
    sheetSvg,
    failed,
    size,
    setSize,
    message,
    setMessage,
    isPreparing,
    printRootRef,
    handlePrint,
    status,
  } = useReviewQrSheet({ open, publicUrl, defaultMessage });

  // The class tracks the print portal below. The print rule hides every other
  // body child, so it must never outlive the sheet it makes room for.
  useEffect(() => {
    if (!open) return;
    document.body.classList.add(PRINT_ACTIVE_CLASS);
    return () => document.body.classList.remove(PRINT_ACTIVE_CLASS);
  }, [open]);

  const logoUrl = logoPublicUrl(logoPath);

  // One props object, two mounts. React renders the same tree from the same
  // input, so the preview and the paper cannot drift — see memory/lessons.md,
  // 2026-06-28, where a second print path re-derived its own data.
  const sheetProps = {
    size,
    restaurantName,
    logoUrl,
    message,
    qrSvg: sheetSvg,
    publicUrl,
  };

  const sheet = SHEET_SIZES[size];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto p-0 gap-0 border-border/40">
        <DialogHeader className="px-6 pt-6 pb-4 border-b border-border/40">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-muted/50 flex items-center justify-center">
              <QrCode className="h-5 w-5 text-foreground" />
            </div>
            <div>
              <DialogTitle className="text-[17px] font-semibold text-foreground">
                QR code
              </DialogTitle>
              <DialogDescription className="text-[13px] text-muted-foreground mt-0.5">
                Print it for the table, the check presenter, or the door.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="px-6 py-5 space-y-5">
          {/* The encoder is a dynamic import, so on a slow connection this
              dialog can sit on a skeleton for seconds with every button
              disabled. Sighted users see the placeholder; without a live
              region a screen reader user gets an opened dialog and silence. */}
          <p aria-live="polite" className="sr-only">
            {status}
          </p>

          {failed ? (
            <p className="text-[13px] text-muted-foreground">
              The code didn&apos;t generate. Close this and try again.
            </p>
          ) : (
            // Two columns from `sm` up. In one column the preview is about
            // 385 px tall and pushes the Print button — the point of the whole
            // dialog — below the fold on a laptop.
            <div className="grid gap-5 sm:grid-cols-[1fr_auto] sm:items-start">
              <div className="space-y-5">
                <div className="space-y-2">
                  {/* `aria-labelledby`, not `htmlFor`. RadioGroup renders a
                      div, and `label for` names labelable elements only, so
                      the group would announce with no name. */}
                  <Label
                    id="review-qr-size-label"
                    className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider"
                  >
                    Paper size
                  </Label>
                  <RadioGroup
                    aria-labelledby="review-qr-size-label"
                    value={size}
                    onValueChange={(value) => setSize(value as SheetSizeKey)}
                    className="grid gap-2"
                  >
                    {SHEET_SIZE_KEYS.map((key) => (
                      <label
                        key={key}
                        htmlFor={`review-qr-size-${key}`}
                        className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-border/40 bg-muted/30 p-3 transition-colors hover:border-border"
                      >
                        <RadioGroupItem
                          value={key}
                          id={`review-qr-size-${key}`}
                          className="mt-0.5"
                        />
                        <span className="min-w-0">
                          <span className="block text-[13px] font-medium text-foreground">
                            {SHEET_SIZES[key].label}
                          </span>
                          <span className="block text-[12px] text-muted-foreground">
                            {SHEET_SIZES[key].hint}
                          </span>
                        </span>
                      </label>
                    ))}
                  </RadioGroup>
                </div>

                <div className="space-y-2">
                  <Label
                    htmlFor="review-qr-message"
                    className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider"
                  >
                    Message
                  </Label>
                  <Input
                    id="review-qr-message"
                    value={message}
                    maxLength={MAX_MESSAGE_LENGTH}
                    onChange={(event) => setMessage(event.target.value)}
                    className="h-10 text-[14px] bg-muted/30 border-border/40 rounded-lg focus-visible:ring-1 focus-visible:ring-border"
                  />
                  <p className="text-[12px] text-muted-foreground">
                    This sheet only. It does not change the page. {message.length}/
                    {MAX_MESSAGE_LENGTH}
                  </p>
                </div>

                <div className="space-y-2">
                  <Button
                    type="button"
                    disabled={!sheetSvg || isPreparing}
                    onClick={handlePrint}
                    className="h-9 w-full rounded-lg bg-foreground text-background hover:bg-foreground/90 text-[13px] font-medium"
                  >
                    <Printer className="mr-2 h-4 w-4" />
                    {isPreparing ? 'Preparing…' : 'Print'}
                  </Button>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      disabled={!svg}
                      aria-label="Download QR code as SVG"
                      className="h-9 flex-1 rounded-lg text-[13px] font-medium"
                      onClick={() =>
                        svg &&
                        download(
                          `${slug}-qr.svg`,
                          `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
                        )
                      }
                    >
                      Download SVG
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={!png}
                      aria-label="Download QR code as PNG"
                      className="h-9 flex-1 rounded-lg text-[13px] font-medium"
                      onClick={() => png && download(`${slug}-qr.png`, png)}
                    >
                      Download PNG
                    </Button>
                  </div>
                  <p className="text-[12px] text-muted-foreground break-all">{publicUrl}</p>
                </div>
              </div>

              {/* The sheet itself is `aria-hidden`: it is a picture of paper,
                  and its inner text carries no role. This wrapper is what a
                  screen reader reaches, so it names the restaurant and the
                  link the code carries. `main` had that name on the plain QR
                  preview, and the sheet must not lose it. */}
              <div
                role="img"
                aria-label={`Preview of the ${sheet.label} sheet for ${restaurantName}. The QR code links to ${publicUrl}`}
                className="rounded-xl border border-border/40 bg-muted/30 p-4"
              >
                {sheetSvg ? (
                  <div
                    className="mx-auto overflow-hidden"
                    style={{
                      width: `calc(${sheet.widthIn}in * ${sheet.previewScale})`,
                      height: `calc(${sheet.heightIn}in * ${sheet.previewScale})`,
                    }}
                  >
                    <div
                      style={{
                        transform: `scale(${sheet.previewScale})`,
                        transformOrigin: 'top left',
                      }}
                    >
                      <ReviewTentSheet {...sheetProps} />
                    </div>
                  </div>
                ) : (
                  <Skeleton className="mx-auto h-64 w-44 rounded-lg" />
                )}
              </div>
            </div>
          )}
        </div>
      </DialogContent>

      {/* The print copy. It hangs off document.body, not off DialogContent,
          which is `fixed` with `max-h-[85vh]` and `overflow-y-auto`
          (src/components/ui/dialog.tsx:40). A clipped, transformed, fixed
          ancestor prints the visible scroll window only, and WebKit often
          prints nothing at all. print-sheet.css moves this off screen and
          hides every other body child when the print starts. */}
      {open &&
        createPortal(
          <div id="review-print-root" data-size={size} ref={printRootRef}>
            <ReviewTentSheet {...sheetProps} />
          </div>,
          document.body
        )}
    </Dialog>
  );
}
