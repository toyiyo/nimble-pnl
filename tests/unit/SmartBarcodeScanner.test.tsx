import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';

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
  it('renders MLKitBarcodeScanner when on native', () => {
    render(<SmartBarcodeScanner onScan={vi.fn()} />);
    expect(screen.getByTestId('mlkit-scanner')).toBeInTheDocument();
  });
});
