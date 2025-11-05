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
