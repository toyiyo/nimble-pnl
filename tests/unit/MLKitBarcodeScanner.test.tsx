import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';

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
