/**
 * Vitest test setup file
 * This runs before each test file
 */

// Make vitest globals available
import { expect, vi } from 'vitest';
import '@testing-library/jest-dom';

// Global test utilities can be added here as needed

class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

// @ts-expect-error jsdom global patch
global.ResizeObserver = ResizeObserver;
