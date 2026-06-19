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
