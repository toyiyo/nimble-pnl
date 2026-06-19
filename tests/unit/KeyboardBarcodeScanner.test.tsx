import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, act, cleanup, screen } from '@testing-library/react';
import React from 'react';
import { KeyboardBarcodeScanner } from '@/components/KeyboardBarcodeScanner';
import { SCAN_IDLE_MS } from '@/lib/barcodeScanInput';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function getHiddenInput(container: HTMLElement): HTMLInputElement {
  const input = container.querySelector('input');
  if (!input) throw new Error('hidden capture input not found');
  return input as HTMLInputElement;
}

describe('KeyboardBarcodeScanner', () => {
  beforeEach(() => vi.useFakeTimers());

  it('iOS path: Enter keydown emits the scanned value exactly once', () => {
    const onScan = vi.fn();
    const { container } = render(<KeyboardBarcodeScanner onScan={onScan} autoStart />);
    const input = getHiddenInput(container);
    act(() => {
      input.focus();
      fireEvent.input(input, { target: { value: '012345678905' } });
      fireEvent.keyDown(input, { key: 'Enter', keyCode: 13 });
    });
    expect(onScan).toHaveBeenCalledTimes(1);
    expect(onScan).toHaveBeenCalledWith('012345678905', 'KeyboardHID');
    act(() => { vi.advanceTimersByTime(SCAN_IDLE_MS * 2); });
    expect(onScan).toHaveBeenCalledTimes(1);
  });

  it('Android path: IME-masked keydown + no Enter, idle timeout emits once', () => {
    const onScan = vi.fn();
    const { container } = render(<KeyboardBarcodeScanner onScan={onScan} autoStart />);
    const input = getHiddenInput(container);
    act(() => {
      input.focus();
      // IME masks the key as 'Unidentified'/229; the characters land in the input value.
      fireEvent.keyDown(input, { key: 'Unidentified', keyCode: 229 });
      fireEvent.input(input, { target: { value: '012345678905' } });
    });
    expect(onScan).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(SCAN_IDLE_MS); });
    expect(onScan).toHaveBeenCalledTimes(1);
    expect(onScan).toHaveBeenCalledWith('012345678905', 'KeyboardHID');
  });

  it('does not emit after the scanner is stopped (assembler disposed)', () => {
    const onScan = vi.fn();
    const { container } = render(<KeyboardBarcodeScanner onScan={onScan} autoStart />);
    const input = getHiddenInput(container);
    act(() => {
      input.focus();
      fireEvent.input(input, { target: { value: '012345678905' } });
    });
    act(() => { fireEvent.click(screen.getByRole('button', { name: /stop scanner/i })); });
    act(() => { vi.advanceTimersByTime(SCAN_IDLE_MS * 2); });
    expect(onScan).not.toHaveBeenCalled();
  });

  it('invokes the latest onScan prop (stable ref, no stale closure)', () => {
    const first = vi.fn();
    const second = vi.fn();
    const { container, rerender } = render(<KeyboardBarcodeScanner onScan={first} autoStart />);
    rerender(<KeyboardBarcodeScanner onScan={second} autoStart />);
    const input = getHiddenInput(container);
    act(() => {
      input.focus();
      fireEvent.input(input, { target: { value: '012345678905' } });
      fireEvent.keyDown(input, { key: 'Enter', keyCode: 13 });
    });
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith('012345678905', 'KeyboardHID');
  });

  it('announces the last scan to screen readers via an aria-live region', () => {
    const onScan = vi.fn();
    const { container } = render(<KeyboardBarcodeScanner onScan={onScan} autoStart />);
    const input = getHiddenInput(container);
    act(() => {
      input.focus();
      fireEvent.input(input, { target: { value: '012345678905' } });
      fireEvent.keyDown(input, { key: 'Enter', keyCode: 13 });
    });
    const live = container.querySelector('[aria-live="polite"]');
    expect(live).not.toBeNull();
    expect(live?.textContent).toContain('012345678905');
  });
});
