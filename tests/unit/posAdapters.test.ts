import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { usePOSIntegrations } from '@/hooks/usePOSIntegrations';

// Mock all the adapter hooks
vi.mock('@/hooks/adapters/useSquareSalesAdapter', () => ({
  useSquareSalesAdapter: () => ({
    system: 'square',
    isConnected: false,
    fetchSales: vi.fn(),
    syncToUnified: vi.fn(),
    getIntegrationStatus: () => ({ system: 'square', isConnected: false, isConfigured: false }),
  }),
}));

vi.mock('@/hooks/adapters/useCloverSalesAdapter', () => ({
  useCloverSalesAdapter: () => ({
    system: 'clover',
    isConnected: false,
    fetchSales: vi.fn(),
    syncToUnified: vi.fn(),
    getIntegrationStatus: () => ({ system: 'clover', isConnected: false, isConfigured: false }),
  }),
}));

vi.mock('@/hooks/adapters/useToastSalesAdapter', () => ({
  useToastSalesAdapter: () => ({
    system: 'toast',
    isConnected: false,
    fetchSales: vi.fn(),
    syncToUnified: vi.fn(),
    getIntegrationStatus: () => ({ system: 'toast', isConnected: false, isConfigured: false }),
  }),
}));

vi.mock('@/hooks/adapters/useShift4SalesAdapter', () => ({
  useShift4SalesAdapter: () => ({
    system: 'shift4',
    isConnected: false,
    fetchSales: vi.fn(),
    syncToUnified: vi.fn(),
    getIntegrationStatus: () => ({ system: 'shift4', isConnected: false, isConfigured: false }),
  }),
}));

describe('POS Adapters Integration', () => {
  it('should initialize usePOSIntegrations without errors', () => {
    const { result } = renderHook(() => usePOSIntegrations('test-restaurant-id'));
    
    expect(result.current).toBeDefined();
    expect(result.current.adapters).toBeDefined();
    expect(result.current.integrationStatuses).toBeDefined();
    expect(result.current.isSyncing).toBe(false);
  });

  it('should have adapters object with all POS systems', () => {
    const { result } = renderHook(() => usePOSIntegrations('test-restaurant-id'));
    
    expect(result.current.adapters).toHaveProperty('square');
    expect(result.current.adapters).toHaveProperty('clover');
    expect(result.current.adapters).toHaveProperty('toast');
    expect(result.current.adapters).toHaveProperty('shift4');
    expect(result.current.adapters).toHaveProperty('manual');
  });

  it('should return hasAnyConnectedSystem function', () => {
    const { result } = renderHook(() => usePOSIntegrations('test-restaurant-id'));
    
    expect(typeof result.current.hasAnyConnectedSystem).toBe('function');
    // Manual adapter is always connected, so this should return true
    expect(result.current.hasAnyConnectedSystem()).toBe(true);
  });

  it('should not throw temporal dead zone error on initialization', () => {
    // This test verifies that the hook can be called without causing
    // "Cannot access 'Xt' before initialization" error
    expect(() => {
      renderHook(() => usePOSIntegrations('test-restaurant-id'));
    }).not.toThrow();
  });
});
