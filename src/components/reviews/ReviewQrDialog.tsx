import { useEffect, useState } from 'react';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

import { QrCode } from 'lucide-react';

interface ReviewQrDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  slug: string;
  publicUrl: string;
}

function download(filename: string, href: string) {
  const link = document.createElement('a');
  link.href = href;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

export function ReviewQrDialog({ open, onOpenChange, slug, publicUrl }: ReviewQrDialogProps) {
  const [svg, setSvg] = useState<string | null>(null);
  const [png, setPng] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setSvg(null);
    setPng(null);
    setFailed(false);

    (async () => {
      try {
        // Dynamic import: the QR encoder is ~50 KB and only a manager opening
        // this dialog ever needs it. A static import would put it in the main
        // chunk for every user on every page.
        const QRCode = await import('qrcode');
        const options = { margin: 1, width: 512, errorCorrectionLevel: 'M' as const };
        const [svgString, dataUrl] = await Promise.all([
          QRCode.toString(publicUrl, { ...options, type: 'svg' }),
          QRCode.toDataURL(publicUrl, options),
        ]);
        if (cancelled) return;
        setSvg(svgString);
        setPng(dataUrl);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, publicUrl]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md p-0 gap-0 border-border/40">
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

        <div className="px-6 py-5 space-y-4">
          {failed ? (
            <p className="text-[13px] text-muted-foreground">
              The code didn&apos;t generate. Close this and try again.
            </p>
          ) : svg ? (
            <div
              className="mx-auto h-48 w-48 [&>svg]:h-full [&>svg]:w-full"
              aria-label={`QR code linking to ${publicUrl}`}
              role="img"
              dangerouslySetInnerHTML={{ __html: svg }}
            />
          ) : (
            <Skeleton className="mx-auto h-48 w-48 rounded-lg" />
          )}

          <p className="text-[12px] text-muted-foreground text-center break-all">{publicUrl}</p>

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
        </div>
      </DialogContent>
    </Dialog>
  );
}
