/**
 * Shared test helpers for scheduling hook tests.
 *
 * Extracts the duplicated QueryClient wrapper, constants, and mock-chain
 * factory that were copy-pasted across useScheduleSlots, useSchedulePublish,
 * useShiftDefinitions, and useWeekTemplates test files.
 *
 * NOTE: vi.hoisted() / vi.mock() blocks MUST remain in each test file because
 * Vitest hoists them to the module scope before imports run.
 */

import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi } from 'vitest';

// ---------------------------------------------------------------------------
// Shared constants
// ---------------------------------------------------------------------------

/** Default restaurant ID used across all scheduling tests. */
export const RESTAURANT_ID = 'rest-abc-123';

// ---------------------------------------------------------------------------
// QueryClient wrapper
// ---------------------------------------------------------------------------

/**
 * Create a React Query wrapper for renderHook tests.
 * Each call produces a fresh QueryClient so tests are isolated.
 */
export function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: 0 },
      mutations: { retry: false },
    },
  });

  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

// ---------------------------------------------------------------------------
// Mock chain factory
// ---------------------------------------------------------------------------

export type MockFromChain = Record<string, ReturnType<typeof vi.fn>>;

export interface MockChainOptions {
  /** Default resolved data for terminal calls (order, single, maybeSingle). */
  terminalData?: unknown;
  /** Default resolved error for terminal calls. */
  terminalError?: { message: string } | null;
  /** Which terminal methods to include. Defaults to ['order', 'single']. */
  terminalMethods?: Array<'order' | 'single' | 'maybeSingle'>;
  /** Extra chain methods to include (e.g. 'limit'). All use mockReturnThis(). */
  extraChainMethods?: string[];
}

/**
 * Build a Supabase-style mock chain object for `mockSupabase.from()`.
 *
 * By default includes: select, insert, update, delete, eq (all chainable)
 * plus order and single as terminal calls that resolve with `{ data, error }`.
 *
 * Use `terminalMethods` to control which terminal methods are included,
 * and `extraChainMethods` to add additional chainable methods like 'limit'.
 */
export function buildMockFromChain(options: MockChainOptions = {}): MockFromChain {
  const {
    terminalData = [],
    terminalError = null,
    terminalMethods = ['order', 'single'],
    extraChainMethods = [],
  } = options;

  const chain: MockFromChain = {};

  // Chainable methods (return `this` so further methods can be called)
  const chainableMethods = ['select', 'insert', 'update', 'delete', 'eq', ...extraChainMethods];
  for (const method of chainableMethods) {
    chain[method] = vi.fn().mockReturnThis();
  }

  // Terminal methods (resolve with { data, error })
  for (const method of terminalMethods) {
    chain[method] = vi.fn().mockResolvedValue({ data: terminalData, error: terminalError });
  }

  return chain;
}
