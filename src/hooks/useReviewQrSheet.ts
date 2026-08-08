import { useCallback, useEffect, useRef, useState } from 'react';

import {
  MAX_MESSAGE_LENGTH,
  nextFrame,
  waitForPrintReady,
  type SheetSizeKey,
} from '@/lib/reviews/printSheet';

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

  // Every open is one print session, and every close ends it.
  //
  // `handlePrint` waits before it prints. It captures the session id and
  // compares the id after the wait. A live `open` flag is not enough: the
  // manager can close the dialog and open it again inside one slow wait, which
  // sets the flag back to true and lets the dead attempt print into the new
  // session. The cleanup also covers an unmount, so a print cannot follow the
  // manager to the next page.
  const sessionRef = useRef(0);
  useEffect(() => {
    if (!open) return;
    sessionRef.current += 1;
    return () => {
      sessionRef.current += 1;
    };
  }, [open]);

  // Seed the message on the open transition only.
  //
  // The headline comes from a React Query read with `refetchOnWindowFocus`. A
  // dependency on `defaultMessage` alone would let a second manager's save, or
  // a tab change, delete a message the first manager is still typing.
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open && !wasOpen.current) {
      // Clamp the seed. `review_pages.headline` is TEXT with no length limit,
      // and the headline editor sets no `maxLength`. The input `maxLength`
      // stops a manager from typing past 120, but it does not trim a value
      // that arrives past 120. An unclamped seed prints text that pushes the
      // QR code off the paper, under a counter that reads "500/120".
      setMessage(defaultMessage.slice(0, MAX_MESSAGE_LENGTH));
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
    const session = sessionRef.current;
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
    // The manager can close the dialog during that wait, and open it again.
    // Print only for the session that asked. The print root of a dead session
    // is gone, and the system print dialog would open over a screen they
    // already dismissed.
    if (session !== sessionRef.current) return;
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
