import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';

// ── Tests that run in the native (MLKit) context ─────────────────────────────
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => true },
}));

// Mock child scanners so we can inspect the props they receive.
vi.mock('@/components/MLKitBarcodeScanner', () => ({
  MLKitBarcodeScanner: (props: { onScan: () => void; active?: boolean }) => (
    <div data-testid="mlkit-scanner" data-active={String(props.active)}>MLKit Scanner</div>
  ),
}));

vi.mock('@/components/NativeBarcodeScanner', () => ({
  NativeBarcodeScanner: (props: { active?: boolean }) => (
    <div data-testid="native-scanner" data-active={String(props.active)}>Native Scanner</div>
  ),
}));

vi.mock('@/components/Html5QrcodeScanner', () => ({
  Html5QrcodeScanner: (props: { active?: boolean }) => (
    <div data-testid="html5-scanner" data-active={String(props.active)}>HTML5 Scanner</div>
  ),
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

  it('passes active=true by default to MLKitBarcodeScanner', () => {
    render(<SmartBarcodeScanner onScan={vi.fn()} />);
    expect(screen.getByTestId('mlkit-scanner')).toHaveAttribute('data-active', 'true');
  });

  it('passes active=false to MLKitBarcodeScanner when active prop is false', () => {
    render(<SmartBarcodeScanner onScan={vi.fn()} active={false} />);
    expect(screen.getByTestId('mlkit-scanner')).toHaveAttribute('data-active', 'false');
  });
});
