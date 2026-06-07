/**
 * Vitest test setup file
 * This runs before each test file
 */

// Make vitest globals available
import { expect, vi } from 'vitest';
import '@testing-library/jest-dom';
import { webcrypto } from 'crypto';

// jsdom does not expose crypto.subtle — polyfill from Node's webcrypto
if (typeof globalThis.crypto === 'undefined' || typeof globalThis.crypto.subtle === 'undefined') {
  // @ts-expect-error jsdom global patch
  globalThis.crypto = webcrypto;
}

// jsdom's Blob is missing arrayBuffer() — polyfill via FileReader
if (typeof Blob !== 'undefined' && typeof Blob.prototype.arrayBuffer === 'undefined') {
  Blob.prototype.arrayBuffer = function (): Promise<ArrayBuffer> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as ArrayBuffer);
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(this);
    });
  };
}

// Global test utilities can be added here as needed

// Radix UI Popover (and other Floating-UI primitives) call setPointerCapture /
// hasPointerCapture in jsdom, which doesn't implement the Pointer Events API.
// Stubbing once here prevents "not a function" errors across every test file.
if (!Element.prototype.hasPointerCapture)
  Element.prototype.hasPointerCapture = () => false;
if (!Element.prototype.setPointerCapture)
  Element.prototype.setPointerCapture = () => {};
if (!Element.prototype.releasePointerCapture)
  Element.prototype.releasePointerCapture = () => {};
// react-day-picker and Radix ScrollArea call scrollIntoView on focus.
if (!Element.prototype.scrollIntoView)
  Element.prototype.scrollIntoView = () => {};

class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

// @ts-expect-error jsdom global patch
global.ResizeObserver = ResizeObserver;
