/**
 * Pure helpers for assembling barcodes from HID-keyboard ("Keyboard Scanner") input.
 *
 * Background: a USB/Bluetooth scanner in HID mode "types" the barcode characters.
 * On iOS the hardware keyboard suppresses the soft keyboard, so `keydown`/`e.key`
 * arrive cleanly. On Android an active IME routes the keystrokes through composition
 * (`keyCode 229` / `e.key === 'Unidentified'`) and the characters only reliably reach
 * the focused input's `.value`. This module works off that value, so it is correct on
 * both platforms.
 */

export const SCAN_FORMAT = 'KeyboardHID';

/** Idle gap (ms) with no new input that terminates a scan when Enter is swallowed. Re-armed on each keystroke. */
export const SCAN_IDLE_MS = 80;

/** Minimum length for an idle-terminated scan (guards against a stray keystroke flushing as a "barcode"). */
export const MIN_TIMEOUT_BARCODE_LENGTH = 3;

const PREFIX_RE = /^(@@|\]Q)/;

/**
 * Normalize a raw captured buffer into a barcode string, or null if (after stripping
 * the optional @@/]Q prefix and trimming) it is shorter than `minLength`.
 */
export function parseScannedBarcode(raw: string, minLength: number): string | null {
  const cleaned = raw.replace(PREFIX_RE, '').trim();
  return cleaned.length >= minLength ? cleaned : null;
}

export interface ScanAssembler {
  /** Update the captured buffer to `value` and (re)arm the idle timer (unless composing). */
  feed(value: string): void;
  /** IME composition guard: while active, the idle timer is suppressed; arms on deactivate. */
  setComposing(active: boolean): void;
  /** Explicit terminator (Enter): emit any non-empty buffer, then reset. */
  enter(): void;
  /** Clear the buffer and cancel any pending idle timer. */
  reset(): void;
  /** Teardown: cancel pending timer and clear state (call on unmount / scanner stop). */
  dispose(): void;
}

export interface ScanAssemblerOptions {
  onScan: (code: string, format: string) => void;
  /** Injected timer scheduler (e.g. window.setTimeout). */
  schedule: (cb: () => void, ms: number) => number;
  /** Injected timer canceller (e.g. window.clearTimeout). */
  clearScheduled: (id: number) => void;
  idleMs?: number;
  minTimeoutLength?: number;
}

/**
 * Stateful barcode assembler driven by the component. Terminates a scan on an explicit
 * Enter (`enter()`, minLength 1 — matches legacy behaviour) or, when Enter is swallowed
 * by the IME, on an idle gap (`idleMs`, minLength `minTimeoutLength`). Every emit resets,
 * so a single scan cannot double-fire.
 */
export function createScanAssembler(opts: ScanAssemblerOptions): ScanAssembler {
  const idleMs = opts.idleMs ?? SCAN_IDLE_MS;
  const minTimeoutLength = opts.minTimeoutLength ?? MIN_TIMEOUT_BARCODE_LENGTH;

  let buffer = '';
  let composing = false;
  let timerId: number | null = null;

  const cancelTimer = (): void => {
    if (timerId !== null) {
      opts.clearScheduled(timerId);
      timerId = null;
    }
  };

  const reset = (): void => {
    cancelTimer();
    buffer = '';
    composing = false;
  };

  const emit = (minLength: number): void => {
    const code = parseScannedBarcode(buffer, minLength);
    // Reset before firing so a re-entrant feed (focus/refocus) starts from a clean buffer.
    reset();
    if (code !== null) {
      opts.onScan(code, SCAN_FORMAT);
    }
  };

  const armIdle = (): void => {
    cancelTimer();
    if (composing || buffer.length === 0) return;
    timerId = opts.schedule(() => {
      timerId = null;
      emit(minTimeoutLength);
    }, idleMs);
  };

  return {
    feed(value: string): void {
      buffer = value;
      armIdle();
    },
    setComposing(active: boolean): void {
      composing = active;
      if (active) {
        cancelTimer();
      } else {
        armIdle();
      }
    },
    enter(): void {
      emit(1);
    },
    reset,
    dispose(): void {
      reset();
    },
  };
}
