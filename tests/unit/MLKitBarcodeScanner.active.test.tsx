/**
 * Task 6: MLKitBarcodeScanner — active edge-driven scanning
 *
 * The component must:
 *  (a) NOT auto-launch BarcodeScanner.scan() when active=false on mount.
 *  (b) Launch BarcodeScanner.scan() when active=true on mount (default).
 *  (c) Re-launch on a false→true transition of the active prop.
 *  (d) NOT re-launch automatically after a scan completes (no auto-rearm).
 *  (e) Route the result through onScanRef (latest-ref pattern) so the fresh
 *      callback is always used even if it changes identity between renders.
 *
 * BarcodeScanner.scan() is the one-shot modal API. The mock resolves with one
 * barcode so we can assert onScan was called.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, act } from '@testing-library/react';
import React from 'react';

// ---------------------------------------------------------------------------
// Hoist mocks so they are defined before vi.mock factory runs
// ---------------------------------------------------------------------------
const { mockScan, mockRequestPermissions } = vi.hoisted(() => ({
  mockScan: vi.fn().mockResolvedValue({ barcodes: [] }),
  mockRequestPermissions: vi.fn().mockResolvedValue({ camera: 'granted' }),
}));

vi.mock('@capacitor-mlkit/barcode-scanning', () => ({
  BarcodeScanner: {
    scan: mockScan,
    requestPermissions: mockRequestPermissions,
  },
  BarcodeFormat: {
    Ean13: 'ean_13',
    Ean8: 'ean_8',
    UpcA: 'upc_a',
    UpcE: 'upc_e',
    QrCode: 'qr_code',
    Code128: 'code_128',
    Code39: 'code_39',
    Itf: 'itf',
    Codabar: 'codabar',
  },
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => true },
}));

import { MLKitBarcodeScanner } from '@/components/MLKitBarcodeScanner';

describe('MLKitBarcodeScanner — active prop contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: scan resolves with no barcodes (simulates user cancel / empty result)
    mockScan.mockResolvedValue({ barcodes: [] });
    mockRequestPermissions.mockResolvedValue({ camera: 'granted' });
  });

  it('(a) does NOT call BarcodeScanner.scan when active=false on mount', async () => {
    await act(async () => {
      render(<MLKitBarcodeScanner onScan={vi.fn()} active={false} />);
    });
    expect(mockScan).not.toHaveBeenCalled();
  });

  it('(b) calls BarcodeScanner.scan when active=true on mount (default)', async () => {
    await act(async () => {
      render(<MLKitBarcodeScanner onScan={vi.fn()} active={true} />);
    });
    expect(mockScan).toHaveBeenCalledTimes(1);
  });

  it('(b) calls BarcodeScanner.scan when active defaults to true (no prop)', async () => {
    await act(async () => {
      render(<MLKitBarcodeScanner onScan={vi.fn()} />);
    });
    expect(mockScan).toHaveBeenCalledTimes(1);
  });

  it('(c) re-launches on a false→true re-arm transition', async () => {
    let rerender!: (ui: React.ReactElement) => void;
    await act(async () => {
      const result = render(<MLKitBarcodeScanner onScan={vi.fn()} active={false} />);
      rerender = result.rerender;
    });
    expect(mockScan).not.toHaveBeenCalled();

    await act(async () => {
      rerender(<MLKitBarcodeScanner onScan={vi.fn()} active={true} />);
    });
    expect(mockScan).toHaveBeenCalledTimes(1);
  });

  it('(d) does NOT re-launch automatically after a successful scan (no auto-rearm)', async () => {
    // Simulate a scan returning a barcode result
    mockScan.mockResolvedValueOnce({
      barcodes: [{ rawValue: '0123456789012', format: 'ean_13' }],
    });

    await act(async () => {
      render(<MLKitBarcodeScanner onScan={vi.fn()} active={true} />);
    });

    // scan() was called once on mount — must NOT auto-relaunch after completion
    expect(mockScan).toHaveBeenCalledTimes(1);
  });

  it('(e) calls the latest onScan callback (via ref) after a successful scan', async () => {
    const firstOnScan = vi.fn();
    const secondOnScan = vi.fn();

    mockScan.mockResolvedValueOnce({
      barcodes: [{ rawValue: '0123456789012', format: 'ean_13' }],
    });

    let rerender!: (ui: React.ReactElement) => void;
    await act(async () => {
      const result = render(<MLKitBarcodeScanner onScan={firstOnScan} active={false} />);
      rerender = result.rerender;
    });

    // Update to second callback (still paused), then arm
    await act(async () => {
      rerender(<MLKitBarcodeScanner onScan={secondOnScan} active={false} />);
    });
    await act(async () => {
      rerender(<MLKitBarcodeScanner onScan={secondOnScan} active={true} />);
    });

    expect(secondOnScan).toHaveBeenCalled();
    expect(firstOnScan).not.toHaveBeenCalled();
  });

  it('(c) does NOT re-launch on a true→false→false transition (no edge)', async () => {
    let rerender!: (ui: React.ReactElement) => void;

    await act(async () => {
      const result = render(<MLKitBarcodeScanner onScan={vi.fn()} active={true} />);
      rerender = result.rerender;
    });
    // First mount with active=true: 1 call
    expect(mockScan).toHaveBeenCalledTimes(1);

    // Pause — no new calls
    await act(async () => {
      rerender(<MLKitBarcodeScanner onScan={vi.fn()} active={false} />);
    });
    expect(mockScan).toHaveBeenCalledTimes(1);

    // Still paused — still no new calls
    await act(async () => {
      rerender(<MLKitBarcodeScanner onScan={vi.fn()} active={false} />);
    });
    expect(mockScan).toHaveBeenCalledTimes(1);
  });

  it('accepts the active prop in the TypeScript interface without throwing', async () => {
    await act(async () => {
      expect(() => render(<MLKitBarcodeScanner onScan={vi.fn()} active={true} />)).not.toThrow();
    });
  });
});
