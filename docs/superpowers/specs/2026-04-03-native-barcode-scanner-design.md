# Native Barcode Scanner via ML Kit — Design Spec

**Date:** 2026-04-03
**Status:** Draft
**Goal:** Use Google ML Kit (Android) and Apple Vision (iOS) for fast, offline barcode scanning on native Capacitor app, falling back to existing web scanners on web.

## Context

The app has 5 barcode scanning implementations:
- `SmartBarcodeScanner` — wrapper that picks between NativeBarcodeScanner (Chrome) and Html5QrcodeScanner (fallback)
- `NativeBarcodeScanner` — uses browser's BarcodeDetector API (Chrome/Edge only)
- `Html5QrcodeScanner` — uses html5-qrcode library (all browsers)
- `OCRBarcodeScanner` — AI-based via Grok Vision
- `KeyboardBarcodeScanner` — HID keyboard input from Bluetooth scanners

All share the same interface: `onScan(barcode: string, format: string)` and `onError?(error: string)`.

The "Camera Scanner" option in Inventory and ReconciliationSession renders `SmartBarcodeScanner`, which uses web camera APIs. On Android/iOS WebView, these are less reliable than native ML Kit scanning.

## Approach

Add `@capacitor-mlkit/barcode-scanning` and create a new `MLKitBarcodeScanner` component. Modify `SmartBarcodeScanner` to render `MLKitBarcodeScanner` when running on native, keeping the web path completely unchanged.

## 1. New Component: MLKitBarcodeScanner

**File:** `src/components/MLKitBarcodeScanner.tsx`

**Props:** Same interface as all other scanners:
```typescript
interface MLKitBarcodeScannerProps {
  onScan: (barcode: string, format: string) => void;
  onError?: (error: string) => void;
  className?: string;
}
```

**Behavior:**
- On mount, requests camera permission via `BarcodeScanner.requestPermissions()`
- Starts scanning with `BarcodeScanner.startScan()` using an inline viewfinder element (not full-screen takeover)
- Supported formats: EAN-13, EAN-8, UPC-A, UPC-E, QR Code, Code 128, Code 39, ITF, Codabar
- On barcode detected: applies `processEAN13ToUPCA` normalization, then calls `onScan(value, format)`
- Deduplication: uses `shouldDeduplicateScan` from `scannerConfig.ts` (1500ms cooldown)
- On unmount: calls `BarcodeScanner.stopScan()` to release camera
- Shows scanning reticle overlay matching existing scanner UI style

**Error handling:**
- Permission denied: calls `onError('Camera permission denied')` and shows message
- No camera available: calls `onError` with descriptive message
- General errors: caught and reported via `onError`

## 2. SmartBarcodeScanner Modification

**File:** `src/components/SmartBarcodeScanner.tsx`

**Change:** Add a platform check at the top of the scanner type decision:
```
if (Capacitor.isNativePlatform()) → render MLKitBarcodeScanner
else → existing browser detection logic (NativeBarcodeScanner vs Html5QrcodeScanner)
```

This is the only integration point. No changes to parent pages.

## 3. Dependencies

- Install `@capacitor-mlkit/barcode-scanning` (Capacitor 7.x compatible)
- Android: plugin auto-configures via Capacitor plugin system
- iOS: CocoaPods handles ML Kit dependency via `pod install`

## 4. Permissions

Already configured:
- Android: `CAMERA` permission in AndroidManifest.xml
- iOS: `NSCameraUsageDescription` in Info.plist

ML Kit plugin handles runtime permission prompts.

## 5. What Doesn't Change

- `Inventory.tsx` — no changes (already uses SmartBarcodeScanner)
- `ReconciliationSession.tsx` — no changes (same)
- `OCRBarcodeScanner` — untouched
- `KeyboardBarcodeScanner` — untouched
- `NativeBarcodeScanner` — untouched (still used on web Chrome/Edge)
- `Html5QrcodeScanner` — untouched (still used on web Safari/Firefox)
- `scannerConfig.ts` — reused as-is (normalization + deduplication utilities)
- Scanner selection UI in parent pages — untouched

## 6. Testing

- **Unit test:** `MLKitBarcodeScanner` with mocked `@capacitor-mlkit/barcode-scanning` plugin — verify `onScan` callback, format normalization, deduplication, cleanup on unmount
- **Unit test:** `SmartBarcodeScanner` — verify it renders `MLKitBarcodeScanner` when `isNativePlatform()` returns true
- **Manual test:** Scan UPC-A, EAN-13, QR Code on physical Android/iOS device
- **Existing tests:** Must continue passing (web path unchanged)
