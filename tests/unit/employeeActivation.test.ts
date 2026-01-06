import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React, { ReactNode } from 'react';
import {
  filterActiveEmployees,
  filterInactiveEmployees,
  getLastActiveDate,
  canReactivate,
} from '@/utils/employeeFilters';

/**
 * Unit Tests for Employee Activation/Deactivation Logic
 * 
 * Tests cover:
 * 1. useEmployees hook filtering by activation status
 * 2. useDeactivateEmployee mutation
 * 3. useReactivateEmployee mutation
 * 4. Employee filtering utilities
 */

// Mock Supabase client
const mockSupabase = {
  from: vi.fn(),
  rpc: vi.fn(),
  auth: {
    getUser: vi.fn(),
  },
};

vi.mock('@/integrations/supabase/client', () => ({
  supabase: mockSupabase,
}));

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({
    toast: vi.fn(),
  }),
}));

// Test wrapper with QueryClient
let queryClient: QueryClient;

const createWrapper = () => {
  // Create fresh query client for each test
  queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
      mutations: { retry: false },
    },
  });

  return function Wrapper({ children }: { children: ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children);
  };
};

describe('Employee Activation Status', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryClient?.clear(); // Clear query cache
  });

  describe('useEmployees with status filter', () => {
    it('should fetch only active employees by default', async () => {
      const mockActiveEmployees = [
        { id: '1', name: 'Active Employee 1', status: 'active', is_active: true },
        { id: '2', name: 'Active Employee 2', status: 'active', is_active: true },
      ];

      const mockChain = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(), // Must return 'this' for chaining!
      };

      // Only the LAST .order() call should return the promise
      mockChain.order.mockReturnValueOnce(mockChain) // First .order() for main table
        .mockResolvedValueOnce({ data: mockActiveEmployees, error: null }); // Second .order() for nested table

      mockSupabase.from.mockReturnValue(mockChain);

      // Import after mocks are set up
      const { useEmployees } = await import('@/hooks/useEmployees');

      const { result } = renderHook(() => useEmployees('restaurant-123', { status: 'active' }), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(mockSupabase.from).toHaveBeenCalledWith('employees');
      expect(mockChain.eq).toHaveBeenCalledWith('restaurant_id', 'restaurant-123');
      expect(mockChain.eq).toHaveBeenCalledWith('is_active', true);
      expect(result.current.employees).toHaveLength(2);
      expect(result.current.employees[0].status).toBe('active');
    });

    it('should fetch only inactive employees when filter is inactive', async () => {
      const mockInactiveEmployees = [
        {
          id: '3',
          name: 'Inactive Employee 1',
          status: 'inactive',
          is_active: false,
          deactivation_reason: 'seasonal',
          deactivated_at: '2025-01-15T00:00:00Z',
        },
      ];

      const mockChain = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
      };

      mockChain.order.mockReturnValueOnce(mockChain)
        .mockResolvedValueOnce({ data: mockInactiveEmployees, error: null });

      mockSupabase.from.mockReturnValue(mockChain);

      const { useEmployees } = await import('@/hooks/useEmployees');

      const { result } = renderHook(() => useEmployees('restaurant-123', { status: 'inactive' }), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(mockChain.eq).toHaveBeenCalledWith('is_active', false);
      expect(result.current.employees).toHaveLength(1);
      expect(result.current.employees[0].is_active).toBe(false);
      expect(result.current.employees[0].deactivation_reason).toBe('seasonal');
    });

    it('should fetch all employees when status filter is all', async () => {
      const mockAllEmployees = [
        { id: '1', name: 'Active Employee', status: 'active', is_active: true },
        { id: '2', name: 'Inactive Employee', status: 'inactive', is_active: false },
      ];

      const mockChain = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
      };

      mockChain.order.mockReturnValueOnce(mockChain)
        .mockResolvedValueOnce({ data: mockAllEmployees, error: null });

      mockSupabase.from.mockReturnValue(mockChain);

      const { useEmployees } = await import('@/hooks/useEmployees');

      const { result } = renderHook(() => useEmployees('restaurant-123', { status: 'all' }), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(mockChain.eq).toHaveBeenCalledWith('restaurant_id', 'restaurant-123');
      expect(mockChain.eq).not.toHaveBeenCalledWith('is_active', expect.anything());
      expect(result.current.employees).toHaveLength(2);
    });
  });

  describe('useDeactivateEmployee', () => {
    it('should deactivate an employee with reason', async () => {
      const mockDeactivatedEmployee = {
        id: 'emp-1',
        name: 'John Doe',
        is_active: false,
        status: 'inactive',
        deactivation_reason: 'seasonal',
        deactivated_at: new Date().toISOString(),
        deactivated_by: 'user-123',
      };

      const mockRpc = vi.fn().mockResolvedValue({ 
        data: mockDeactivatedEmployee, 
        error: null 
      });

      mockSupabase.rpc = mockRpc;

      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } },
        error: null,
      });

      const { useDeactivateEmployee } = await import('@/hooks/useEmployees');

      const { result } = renderHook(() => useDeactivateEmployee(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current).toBeDefined();
      });

      // Execute mutation
      result.current.mutate({
        employeeId: 'emp-1',
        reason: 'seasonal',
        removeFromSchedules: true,
        terminationDate: '2026-01-06',
      });

      await waitFor(() => {
        expect(mockRpc).toHaveBeenCalledWith(
          'deactivate_employee',
          expect.objectContaining({
            p_employee_id: 'emp-1',
            p_deactivated_by: 'user-123',
            p_reason: 'seasonal',
            p_remove_from_future_shifts: true,
            p_termination_date: '2026-01-06',
          })
        );
      });
    });

    it('should handle deactivation without reason', async () => {
      const mockDeactivatedEmployee = {
        id: 'emp-2',
        name: 'Jane Smith',
        is_active: false,
        status: 'inactive',
        deactivation_reason: null,
        deactivated_at: new Date().toISOString(),
      };

      const mockRpc = vi.fn().mockResolvedValue({ 
        data: mockDeactivatedEmployee, 
        error: null 
      });

      mockSupabase.rpc = mockRpc;
      
      // Mock authenticated user for deactivation
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } },
        error: null,
      });

      const { useDeactivateEmployee } = await import('@/hooks/useEmployees');

      const { result } = renderHook(() => useDeactivateEmployee(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current).toBeDefined();
      });

      result.current.mutate({
        employeeId: 'emp-2',
        removeFromSchedules: false,
        terminationDate: '2026-01-06',
      });

      await waitFor(() => {
        expect(mockRpc).toHaveBeenCalledWith(
          'deactivate_employee',
          expect.objectContaining({
            p_employee_id: 'emp-2',
            p_remove_from_future_shifts: false,
            p_termination_date: '2026-01-06',
          })
        );
      });
    });

    it('CRITICAL: should set termination_date for future deactivation (two-week notice)', async () => {
      const futureDate = '2026-01-20'; // Employee gives notice but hasn't left yet
      const mockDeactivatedEmployee = {
        id: 'emp-3',
        name: 'Future Leaver',
        is_active: false,
        status: 'inactive',
        deactivation_reason: 'left_company',
        deactivated_at: new Date().toISOString(),
        deactivated_by: 'user-123',
        termination_date: futureDate,
      };

      const mockRpc = vi.fn().mockResolvedValue({ 
        data: mockDeactivatedEmployee, 
        error: null 
      });

      mockSupabase.rpc = mockRpc;
      
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } },
        error: null,
      });

      const { useDeactivateEmployee } = await import('@/hooks/useEmployees');

      const { result } = renderHook(() => useDeactivateEmployee(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current).toBeDefined();
      });

      result.current.mutate({
        employeeId: 'emp-3',
        reason: 'left_company',
        removeFromSchedules: true,
        terminationDate: futureDate,
      });

      await waitFor(() => {
        expect(mockRpc).toHaveBeenCalledWith(
          'deactivate_employee',
          expect.objectContaining({
            p_employee_id: 'emp-3',
            p_deactivated_by: 'user-123',
            p_reason: 'left_company',
            p_remove_from_future_shifts: true,
            p_termination_date: futureDate,
          })
        );
      });
    });
  });

  describe('useReactivateEmployee', () => {
    it('should reactivate an inactive employee', async () => {
      const mockReactivatedEmployee = {
        id: 'emp-3',
        name: 'Bob Johnson',
        is_active: true,
        status: 'active',
        deactivation_reason: null,
        deactivated_at: null,
        deactivated_by: null,
        reactivated_at: new Date().toISOString(),
        reactivated_by: 'user-123',
      };

      const mockRpc = vi.fn().mockResolvedValue({ 
        data: mockReactivatedEmployee, 
        error: null 
      });

      mockSupabase.rpc = mockRpc;

      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } },
        error: null,
      });

      const { useReactivateEmployee } = await import('@/hooks/useEmployees');

      const { result } = renderHook(() => useReactivateEmployee(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current).toBeDefined();
      });

      result.current.mutate({
        employeeId: 'emp-3',
        hourlyRate: 1500, // $15.00 in cents
        confirmPin: true,
      });

      await waitFor(() => {
        expect(mockRpc).toHaveBeenCalledWith(
          'reactivate_employee',
          expect.objectContaining({
            p_employee_id: 'emp-3',
            p_reactivated_by: 'user-123',
            p_new_hourly_rate: 1500,
          })
        );
      });
    });

    it('should update hourly rate during reactivation if provided', async () => {
      const mockReactivatedEmployee = {
        id: 'emp-4',
        name: 'Alice Williams',
        is_active: true,
        status: 'active',
        hourly_rate: 1800, // Updated to $18.00
      };

      const mockRpc = vi.fn().mockResolvedValue({ 
        data: mockReactivatedEmployee, 
        error: null 
      });

      mockSupabase.rpc = mockRpc;

      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-456' } },
        error: null,
      });

      const { useReactivateEmployee } = await import('@/hooks/useEmployees');

      const { result } = renderHook(() => useReactivateEmployee(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current).toBeDefined();
      });

      result.current.mutate({
        employeeId: 'emp-4',
        hourlyRate: 1800,
        confirmPin: true,
      });

      await waitFor(() => {
        expect(mockRpc).toHaveBeenCalledWith(
          'reactivate_employee',
          expect.objectContaining({
            p_employee_id: 'emp-4',
            p_new_hourly_rate: 1800,
          })
        );
      });
    });
  });

  describe('Employee filtering utilities', () => {
    it('should filter active employees', () => {
      const employees = [
        { id: '1', name: 'Active 1', is_active: true, status: 'active' },
        { id: '2', name: 'Inactive 1', is_active: false, status: 'inactive' },
        { id: '3', name: 'Active 2', is_active: true, status: 'active' },
      ];

      const result = filterActiveEmployees(employees);
      expect(result).toHaveLength(2);
      expect(result.every((e) => e.is_active)).toBe(true);
    });

    it('should filter inactive employees', () => {
      const employees = [
        { id: '1', name: 'Active 1', is_active: true, status: 'active' },
        { id: '2', name: 'Inactive 1', is_active: false, status: 'inactive' },
        { id: '3', name: 'Active 2', is_active: true, status: 'active' },
      ];

      const result = filterInactiveEmployees(employees);
      expect(result).toHaveLength(1);
      expect(result.every((e) => !e.is_active)).toBe(true);
    });

    it('should calculate last active date from deactivated_at', () => {
      const employee = {
        id: '1',
        name: 'Inactive Employee',
        is_active: false,
        deactivated_at: '2025-09-12T00:00:00Z',
      };

      const result = getLastActiveDate(employee);
      expect(result).toBeTruthy();
      expect(typeof result).toBe('string');
    });

    it('should determine if employee can be reactivated', () => {
      expect(
        canReactivate({ is_active: false, status: 'inactive' })
      ).toBe(true);

      expect(
        canReactivate({ is_active: true, status: 'active' })
      ).toBe(false);

      expect(
        canReactivate({ is_active: false, status: 'terminated' })
      ).toBe(false);
    });
  });
});
