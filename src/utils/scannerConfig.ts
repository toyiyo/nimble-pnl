import { Html5QrcodeSupportedFormats } from 'html5-qrcode';

/**
 * Supported barcode formats for scanning
 */
export const SCANNER_FORMATS = [
  Html5QrcodeSupportedFormats.QR_CODE,
  Html5QrcodeSupportedFormats.EAN_13,
  Html5QrcodeSupportedFormats.EAN_8,
  Html5QrcodeSupportedFormats.UPC_A,
  Html5QrcodeSupportedFormats.UPC_E,
  Html5QrcodeSupportedFormats.CODE_128,
  Html5QrcodeSupportedFormats.CODE_39,
];

/**
 * Detect if the device is iOS
 */
export const isIOSDevice = () => /iPad|iPhone|iPod/.test(navigator.userAgent);

/**
 * Get device-optimized scanner configuration
 */
export const getDeviceOptimizedConfig = (viewfinderWidth: number, viewfinderHeight: number) => {
  const isIOS = isIOSDevice();
  const minEdge = Math.min(viewfinderWidth, viewfinderHeight);
  
  const qrboxSize = isIOS 
    ? Math.min(minEdge * 0.8, 300) // Larger box for iPhone
    : Math.min(minEdge * 0.7, 250);

  return {
    fps: isIOS ? 20 : 10, // Higher FPS for iPhone
    qrbox: { width: qrboxSize, height: qrboxSize },
    aspectRatio: isIOS ? 4/3 : 16/9, // iPhone cameras prefer 4:3
    disableFlip: isIOS, // iPhone doesn't need flipping
  };
};

/**
 * Check if a scan should be deduplicated based on cooldown period
 */
export const shouldDeduplicateScan = (
  lastScan: { value: string; time: number } | null,
  decodedText: string,
  cooldownMs: number = 1500
): boolean => {
  if (!lastScan) return false;
  
  const now = Date.now();
  return (
    lastScan.value === decodedText &&
    now - lastScan.time <= cooldownMs
  );
};

/**
 * Convert EAN-13 to UPC-A if needed (remove leading zero)
 */
export const processEAN13ToUPCA = (value: string, format: string): string => {
  if (format === 'EAN_13' && value.startsWith('0')) {
    return value.slice(1);
  }
  return value;
};

export interface ScanGate {
  /** True if `value` may be handled now; a value different from the suppressed one clears suppression. */
  shouldAccept: (value: string) => boolean;
  /** Suppress `value` until a different value is seen (or reset). */
  markAccepted: (value: string) => void;
  /** Clear any suppression. */
  reset: () => void;
}

/**
 * Identity-suppression gate. After a scan is accepted and handled, the SAME code is
 * suppressed until a genuinely different code appears — so an item still sitting in the
 * camera frame after save cannot double-add. Unlike `shouldDeduplicateScan`, this has no
 * time component; it is cleared by a new value or `reset()`.
 */
export const createScanGate = (): ScanGate => {
  let suppressed: string | null = null;
  return {
    shouldAccept(value: string): boolean {
      if (suppressed !== null && value === suppressed) return false;
      suppressed = null; // a new/different value clears suppression
      return true;
    },
    markAccepted(value: string): void {
      suppressed = value;
    },
    reset(): void {
      suppressed = null;
    },
  };
};
