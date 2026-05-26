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

class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

// @ts-expect-error jsdom global patch
global.ResizeObserver = ResizeObserver;
