import { useCallback, useEffect, useRef, useState } from 'react';

import { nextFrame, waitForPrintReady, type SheetSizeKey } from '@/lib/reviews/printSheet';

interface UseReviewQrSheetOptions {
  open: boolean;
  publicUrl: string;
  /** Seeds the message field when the dialog opens. */
  defaultMessage: string;
}

interface PrintStatusInput {
  failed: boolean;
  isPreparing: boolean;
  printAttempt: number;
  ready: boolean;
}

/**
 * The screen-reader status line.
 *
 * Every branch carries the attempt number, because an `aria-live` region
 * reports a change. Two identical strings in a row announce nothing at all.
 */
export function printStatus({
  failed,
  isPreparing,
  printAttempt,
  ready,
}: PrintStatusInput): string {
  if (failed) return "The QR code didn't generate.";
  if (isPreparing) return `Preparing the sheet… (attempt ${printAttempt})`;
  if (printAttempt > 0) {
    return `Sheet ready. The print dialog is open. (attempt ${printAttempt})`;
  }
  if (ready) return 'QR code ready to print or download.';
  return 'Generating the QR code…';
}

/**
 * The QR codes, the sheet options, and the print itself.
 *
 * `ReviewQrDialog` renders what this returns. Hooks hold the business logic in
 * this codebase, and the print orchestration is business logic: it decides when
 * the paper is ready and whether the print still has a reason to start.
 */
export function useReviewQrSheet({ open, publicUrl, defaultMessage }: UseReviewQrSheetOptions) {
  const [svg, setSvg] = useState<string | null>(null);
  const [png, setPng] = useState<string | null>(null);
  // The sheet needs a four-module quiet zone, which the download codes do not
  // have. Two SVGs, one encoder import.
  const [sheetSvg, setSheetSvg] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  const [size, setSize] = useState<SheetSizeKey>('tent');
  const [message, setMessage] = useState(defaultMessage);
  const [printAttempt, setPrintAttempt] = useState(0);
  const [isPreparing, setIsPreparing] = useState(false);

  const printRootRef = useRef<HTMLDivElement | null>(null);

  // `handlePrint` waits before it prints, and the dialog can close during that
  // wait. A ref carries the live value: a plain `open` in the callback would
  // hold whatever it captured when the callback was made.
  const openRef = useRef(open);
  useEffect(() => {
    openRef.current = open;
  }, [open]);

  // Seed the message on the open transition only.
  //
  // The headline comes from a React Query read with `refetchOnWindowFocus`. A
  // dependency on `defaultMessage` alone would let a second manager's save, or
  // a tab change, delete a message the first manager is still typing.
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open && !wasOpen.current) {
      setMessage(defaultMessage);
      setPrintAttempt(0);
      setIsPreparing(false);
    }
    wasOpen.current = open;
  }, [open, defaultMessage]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setSvg(null);
    setPng(null);
    setSheetSvg(null);
    setFailed(false);

    (async () => {
      try {
        // Dynamic import: the QR encoder is ~50 KB and only a manager opening
        // this dialog ever needs it. A static import would put it in the main
        // chunk for every user on every page.
        const QRCode = await import('qrcode');
        const options = { margin: 1, width: 512, errorCorrectionLevel: 'M' as const };
        const [svgString, dataUrl, sheetString] = await Promise.all([
          QRCode.toString(publicUrl, { ...options, type: 'svg' }),
          QRCode.toDataURL(publicUrl, options),
          // The QR specification asks for a four-module quiet zone. `margin: 1`
          // survives a screen, but a printed code with one module of white
          // fails against a busy tablecloth or a dark counter.
          QRCode.toString(publicUrl, { ...options, margin: 4, type: 'svg' }),
        ]);
        if (cancelled) return;
        setSvg(svgString);
        setPng(dataUrl);
        setSheetSvg(sheetString);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, publicUrl]);

  const handlePrint = useCallback(async () => {
    setPrintAttempt((attempt) => attempt + 1);
    setIsPreparing(true);
    // Never rejects, never hangs: a 4 s budget wins the race if a font stalls.
    await waitForPrintReady(printRootRef.current);
    setIsPreparing(false);
    // `window.print()` blocks the main thread until the manager dismisses the
    // system dialog. Yield one frame first, so React paints the "Sheet ready"
    // status and the live region announces it. Without the yield a screen
    // reader user hears "Preparing" and then nothing.
    await nextFrame();
    // The manager can close the dialog during that wait. Print only what they
    // still ask for: the print root is gone, and the system print dialog would
    // open over a screen they already dismissed.
    if (!openRef.current) return;
    window.print();
  }, []);

  return {
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
    status: printStatus({ failed, isPreparing, printAttempt, ready: Boolean(sheetSvg) }),
  };
}
