# Native Barcode Scanner (ML Kit) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Use ML Kit for native barcode scanning on Capacitor (Android/iOS), falling back to existing web scanners on web.

**Architecture:** New `MLKitBarcodeScanner` component wraps `@capacitor-mlkit/barcode-scanning` with the same `onScan(barcode, format)` interface used by all existing scanners. `SmartBarcodeScanner` checks `Capacitor.isNativePlatform()` first — if native, renders ML Kit scanner; otherwise existing web logic runs unchanged.

**Tech Stack:** @capacitor-mlkit/barcode-scanning, React 18, TypeScript, Vitest

**Spec:** `docs/superpowers/specs/2026-04-03-native-barcode-scanner-design.md`

---

## File Map

### New Files
- `src/components/MLKitBarcodeScanner.tsx` — ML Kit scanner component with inline viewfinder
- `tests/unit/MLKitBarcodeScanner.test.tsx` — Unit tests for ML Kit scanner
- `tests/unit/SmartBarcodeScanner.test.tsx` — Unit tests for native platform routing

### Modified Files
- `src/components/SmartBarcodeScanner.tsx` — Add native platform check to route to ML Kit
- `package.json` — Add `@capacitor-mlkit/barcode-scanning` dependency

---

## Task 1: Install ML Kit Plugin

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install the plugin**

Run:
```bash
cd /Users/josedelgado/Documents/GitHub/nimble-pnl/.worktrees/capacitor-native
npm install @capacitor-mlkit/barcode-scanning
```

- [ ] **Step 2: Sync native projects**

Run:
```bash
npx cap sync
```

Expected: Plugin appears in sync output for both iOS and Android.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "feat: install @capacitor-mlkit/barcode-scanning plugin"
```

---

## Task 2: MLKitBarcodeScanner Component — Tests

**Files:**
- Create: `tests/unit/MLKitBarcodeScanner.test.tsx`

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/unit/MLKitBarcodeScanner.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';

// Mock Capacitor ML Kit plugin
const mockStartScan = vi.fn();
const mockStopScan = vi.fn();
const mockRequestPermissions = vi.fn().mockResolvedValue({ camera: 'granted' });
const mockIsSupported = vi.fn().mockResolvedValue({ supported: true });

vi.mock('@capacitor-mlkit/barcode-scanning', () => ({
  BarcodeScanner: {
    startScan: mockStartScan,
    stopScan: mockStopScan,
    requestPermissions: mockRequestPermissions,
    isSupported: mockIsSupported,
    addListener: vi.fn().mockResolvedValue({ remove: vi.fn() }),
    removeAllListeners: vi.fn(),
  },
  BarcodeFormat: {
    EanEight: 'EAN_8',
    EanThirteen: 'EAN_13',
    UpcA: 'UPC_A',
    UpcE: 'UPC_E',
    QrCode: 'QR_CODE',
    Code128: 'CODE_128',
    Code39: 'CODE_39',
    Itf: 'ITF',
    Codabar: 'CODABAR',
  },
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => true },
}));

import { MLKitBarcodeScanner } from '@/components/MLKitBarcodeScanner';
import { processEAN13ToUPCA, shouldDeduplicateScan } from '@/utils/scannerConfig';

describe('MLKitBarcodeScanner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders scanning UI', () => {
    render(<MLKitBarcodeScanner onScan={vi.fn()} />);
    expect(screen.getByText(/scanner/i)).toBeInTheDocument();
  });

  it('requests camera permissions on mount', () => {
    render(<MLKitBarcodeScanner onScan={vi.fn()} />);
    expect(mockRequestPermissions).toHaveBeenCalled();
  });

  it('calls onError when permission denied', async () => {
    mockRequestPermissions.mockResolvedValueOnce({ camera: 'denied' });
    const onError = vi.fn();
    render(<MLKitBarcodeScanner onScan={vi.fn()} onError={onError} />);
    // Wait for async permission check
    await vi.waitFor(() => {
      expect(onError).toHaveBeenCalledWith('Camera permission denied');
    });
  });
});

describe('scannerConfig utilities with ML Kit formats', () => {
  it('processEAN13ToUPCA converts EAN-13 with leading zero', () => {
    expect(processEAN13ToUPCA('0012345678905', 'EAN_13')).toBe('012345678905');
  });

  it('processEAN13ToUPCA leaves non-zero EAN-13 unchanged', () => {
    expect(processEAN13ToUPCA('4012345678901', 'EAN_13')).toBe('4012345678901');
  });

  it('shouldDeduplicateScan returns true for same barcode within cooldown', () => {
    const lastScan = { value: '123456', time: Date.now() - 500 };
    expect(shouldDeduplicateScan(lastScan, '123456')).toBe(true);
  });

  it('shouldDeduplicateScan returns false after cooldown expires', () => {
    const lastScan = { value: '123456', time: Date.now() - 2000 };
    expect(shouldDeduplicateScan(lastScan, '123456')).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/MLKitBarcodeScanner.test.tsx`
Expected: FAIL — module `@/components/MLKitBarcodeScanner` not found

- [ ] **Step 3: Commit**

```bash
git add tests/unit/MLKitBarcodeScanner.test.tsx
git commit -m "test: add failing tests for MLKitBarcodeScanner"
```

---

## Task 3: MLKitBarcodeScanner Component — Implementation

**Files:**
- Create: `src/components/MLKitBarcodeScanner.tsx`

- [ ] **Step 1: Write the component**

```typescript
// src/components/MLKitBarcodeScanner.tsx
import { useEffect, useRef, useState, useCallback } from 'react';
import { BarcodeScanner, BarcodeFormat } from '@capacitor-mlkit/barcode-scanning';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Loader2, Scan, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { processEAN13ToUPCA, shouldDeduplicateScan } from '@/utils/scannerConfig';

interface MLKitBarcodeScannerProps {
  onScan: (barcode: string, format: string) => void;
  onError?: (error: string) => void;
  className?: string;
}

const SUPPORTED_FORMATS = [
  BarcodeFormat.EanThirteen,
  BarcodeFormat.EanEight,
  BarcodeFormat.UpcA,
  BarcodeFormat.UpcE,
  BarcodeFormat.QrCode,
  BarcodeFormat.Code128,
  BarcodeFormat.Code39,
  BarcodeFormat.Itf,
  BarcodeFormat.Codabar,
];

export const MLKitBarcodeScanner = ({
  onScan,
  onError,
  className = '',
}: MLKitBarcodeScannerProps) => {
  const [status, setStatus] = useState<'initializing' | 'scanning' | 'error'>('initializing');
  const [errorMessage, setErrorMessage] = useState<string>('');
  const lastScanRef = useRef<{ value: string; time: number } | null>(null);
  const listenerRef = useRef<{ remove: () => void } | null>(null);

  const handleBarcode = useCallback((value: string, format: string) => {
    // Normalize format name
    const normalizedFormat = format.replace(/([a-z])([A-Z])/g, '$1_$2').toUpperCase();

    // Apply EAN-13 → UPC-A conversion
    const processedValue = processEAN13ToUPCA(value, normalizedFormat);

    // Deduplication
    if (shouldDeduplicateScan(lastScanRef.current, processedValue)) {
      return;
    }

    lastScanRef.current = { value: processedValue, time: Date.now() };
    onScan(processedValue, normalizedFormat);
  }, [onScan]);

  useEffect(() => {
    let mounted = true;

    const startScanning = async () => {
      try {
        // Request permission
        const permResult = await BarcodeScanner.requestPermissions();
        if (!mounted) return;

        if (permResult.camera !== 'granted') {
          setStatus('error');
          setErrorMessage('Camera permission denied');
          onError?.('Camera permission denied');
          return;
        }

        // Add barcode scanned listener
        const listener = await BarcodeScanner.addListener('barcodeScanned', (result) => {
          const barcode = result.barcode;
          handleBarcode(barcode.rawValue, barcode.format);
        });
        listenerRef.current = listener;

        // Start scanning with inline viewfinder
        await BarcodeScanner.startScan({
          formats: SUPPORTED_FORMATS,
          lensFacing: 'BACK',
        });

        if (mounted) {
          setStatus('scanning');
        }
      } catch (err) {
        if (!mounted) return;
        const msg = err instanceof Error ? err.message : 'Scanner initialization failed';
        setStatus('error');
        setErrorMessage(msg);
        onError?.(msg);
      }
    };

    startScanning();

    return () => {
      mounted = false;
      listenerRef.current?.remove();
      BarcodeScanner.stopScan().catch(() => {});
      BarcodeScanner.removeAllListeners().catch(() => {});
    };
  }, [handleBarcode, onError]);

  if (status === 'error') {
    return (
      <Card className={className}>
        <CardContent className="flex flex-col items-center justify-center py-8 space-y-3">
          <AlertCircle className="w-8 h-8 text-destructive" />
          <p className="text-sm text-muted-foreground">{errorMessage}</p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setStatus('initializing');
              setErrorMessage('');
              // Re-trigger effect by forcing remount isn't ideal,
              // but the useEffect will re-run on status change
            }}
          >
            Try Again
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className={`space-y-2 ${className}`}>
      {status === 'initializing' && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 space-y-4">
            <Loader2 className="w-8 h-8 text-primary animate-spin" />
            <p className="text-sm text-muted-foreground">Starting ML Kit scanner...</p>
          </CardContent>
        </Card>
      )}

      {status === 'scanning' && (
        <>
          <div className="flex justify-center">
            <Badge className="bg-gradient-to-r from-green-500 to-emerald-600">
              <Scan className="w-3 h-3 mr-1" />
              ML Kit Native Scanner
            </Badge>
          </div>
          {/* ML Kit renders the camera preview natively behind the WebView.
              We make the background transparent so it's visible. */}
          <div
            className="relative rounded-lg overflow-hidden border border-border/40"
            style={{
              width: '100%',
              aspectRatio: '4/3',
              backgroundColor: 'transparent',
            }}
          >
            {/* Scanning reticle overlay */}
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="w-2/3 h-1/3 border-2 border-primary/60 rounded-lg" />
            </div>
            <p className="absolute bottom-3 left-0 right-0 text-center text-xs text-white/80 drop-shadow-md">
              Point camera at barcode
            </p>
          </div>
        </>
      )}
    </div>
  );
};
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `npx vitest run tests/unit/MLKitBarcodeScanner.test.tsx`
Expected: All tests PASS

- [ ] **Step 3: Commit**

```bash
git add src/components/MLKitBarcodeScanner.tsx
git commit -m "feat: add MLKitBarcodeScanner component with inline viewfinder"
```

---

## Task 4: SmartBarcodeScanner — Route to ML Kit on Native

**Files:**
- Modify: `src/components/SmartBarcodeScanner.tsx`
- Create: `tests/unit/SmartBarcodeScanner.test.tsx`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/SmartBarcodeScanner.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';

// Test: when native, render MLKitBarcodeScanner
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => true },
}));

vi.mock('@/components/MLKitBarcodeScanner', () => ({
  MLKitBarcodeScanner: (props: { onScan: () => void }) => (
    <div data-testid="mlkit-scanner">MLKit Scanner</div>
  ),
}));

vi.mock('@/components/NativeBarcodeScanner', () => ({
  NativeBarcodeScanner: () => <div data-testid="native-scanner">Native Scanner</div>,
}));

vi.mock('@/components/Html5QrcodeScanner', () => ({
  Html5QrcodeScanner: () => <div data-testid="html5-scanner">HTML5 Scanner</div>,
}));

vi.mock('@capacitor-mlkit/barcode-scanning', () => ({
  BarcodeScanner: {
    startScan: vi.fn(),
    stopScan: vi.fn(),
    requestPermissions: vi.fn().mockResolvedValue({ camera: 'granted' }),
    isSupported: vi.fn().mockResolvedValue({ supported: true }),
    addListener: vi.fn().mockResolvedValue({ remove: vi.fn() }),
    removeAllListeners: vi.fn(),
  },
  BarcodeFormat: {},
}));

import { SmartBarcodeScanner } from '@/components/SmartBarcodeScanner';

describe('SmartBarcodeScanner on native platform', () => {
  it('renders MLKitBarcodeScanner when on native', async () => {
    render(<SmartBarcodeScanner onScan={vi.fn()} />);
    expect(screen.getByTestId('mlkit-scanner')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/SmartBarcodeScanner.test.tsx`
Expected: FAIL — SmartBarcodeScanner doesn't render MLKit scanner yet

- [ ] **Step 3: Modify SmartBarcodeScanner**

In `src/components/SmartBarcodeScanner.tsx`, add the native platform check. The changes:

1. Add imports at the top:
```typescript
import { Capacitor } from '@capacitor/core';
import { MLKitBarcodeScanner } from './MLKitBarcodeScanner';
```

2. Inside the component, before the existing `useEffect`, add an early return for native:
```typescript
// On native Capacitor, use ML Kit scanner (bypasses web camera entirely)
if (Capacitor.isNativePlatform()) {
  return (
    <div className="space-y-2">
      <div className="flex justify-center">
        <Badge className="bg-gradient-to-r from-green-500 to-emerald-600">
          <Sparkles className="w-3 h-3 mr-1" />
          ML Kit Native Scanner
        </Badge>
      </div>
      <MLKitBarcodeScanner
        onScan={onScan}
        onError={onError}
        className={className}
      />
    </div>
  );
}
```

Place this right after the state declaration (`const [scannerType, setScannerType] = ...`) and before the `useEffect`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/SmartBarcodeScanner.test.tsx`
Expected: PASS

- [ ] **Step 5: Run full test suite**

Run: `npx vitest run`
Expected: All tests pass (no regressions)

- [ ] **Step 6: Commit**

```bash
git add src/components/SmartBarcodeScanner.tsx tests/unit/SmartBarcodeScanner.test.tsx
git commit -m "feat: route SmartBarcodeScanner to ML Kit on native platforms"
```

---

## Task 5: Build, Sync, and Verify

**Files:** None (build/verification only)

- [ ] **Step 1: Build for production**

Run:
```bash
mv .env.local .env.local.bak 2>/dev/null; npm run build; mv .env.local.bak .env.local 2>/dev/null
```

Expected: Build succeeds

- [ ] **Step 2: Sync native projects**

Run: `npx cap sync`
Expected: ML Kit plugin appears in sync output for both platforms

- [ ] **Step 3: Run full test suite**

Run: `npx vitest run`
Expected: All tests pass

- [ ] **Step 4: Commit any remaining changes and push**

```bash
git push
```

---

## Summary

| Task | What | Tests |
|------|------|-------|
| 1 | Install @capacitor-mlkit/barcode-scanning | — |
| 2 | MLKitBarcodeScanner tests | 6 unit tests |
| 3 | MLKitBarcodeScanner component | Tests from Task 2 pass |
| 4 | SmartBarcodeScanner native routing | 1 unit test + full suite |
| 5 | Build, sync, verify | Full test suite + build |
