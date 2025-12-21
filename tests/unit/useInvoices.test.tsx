import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useInvoices } from '@/hooks/useInvoices';
import { createClient, mockClient } from '@supabase/supabase-js';

vi.mock('@supabase/supabase-js', () => {
  const mockClient = {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          order: vi.fn(() => ({
            data: [],
            error: null,
          })),
          single: vi.fn(() => ({
            data: null,
            error: null,
          })),
        })),
      })),
      insert: vi.fn(() => ({
        select: vi.fn(() => ({
          data: [],
          error: null,
        })),
      })),
      update: vi.fn(() => ({
        eq: vi.fn(() => ({
          data: [],
          error: null,
        })),
      })),
      delete: vi.fn(() => ({
        eq: vi.fn(() => ({
          data: [],
          error: null,
        })),
      })),
    })),
    functions: {
      invoke: vi.fn(() => ({
        data: { success: true },
        error: null,
      })),
    },
  };

  return {
    createClient: vi.fn(() => mockClient),
    mockClient, // Export for testing
  };
});

vi.mock('@/contexts/RestaurantContext', () => ({
  useRestaurantContext: () => ({
    selectedRestaurant: { restaurant_id: 'rest-1' },
  }),
}));

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({
    toast: vi.fn(),
  }),
}));

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: 0 },
      mutations: { retry: false },
    },
  });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
};

describe('useInvoices', () => {
  const mockClient = vi.mocked(createClient)();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('useInvoices hook', () => {
    it('fetches invoices for restaurant successfully', async () => {
      const mockInvoices = [
        {
          id: 'inv-1',
          restaurant_id: 'rest-1',
          customer_id: 'cust-1',
          stripe_invoice_id: 'in_123',
          status: 'draft',
          subtotal_amount: 10000,
          tax_amount: 825,
          total_amount: 10825,
          amount_due: 10825,
          amount_paid: 0,
          amount_remaining: 10825,
          stripe_fee_amount: 0,
          application_fee_amount: 0,
          pass_fees_to_customer: false,
          currency: 'usd',
          invoice_date: '2024-01-01',
          created_at: '2024-01-01T00:00:00Z',
          customers: { name: 'Test Customer', email: 'test@example.com' },
          invoice_line_items: [],
        },
      ];

      mockClient.from.mockReturnValue({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            order: vi.fn(() => Promise.resolve({
              data: mockInvoices,
              error: null,
            })),
          })),
        })),
      });

      const { result } = renderHook(() => useInvoices('rest-1'), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.invoices).toEqual(mockInvoices);
      });

      expect(mockClient.from).toHaveBeenCalledWith('invoices');
      expect(result.current.loading).toBe(false);
      expect(result.current.error).toBe(null);
    });

    it('handles loading state correctly', () => {
      mockClient.from.mockReturnValue({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            order: vi.fn(() => new Promise(() => {})), // Never resolves
          })),
        })),
      });

      const { result } = renderHook(() => useInvoices('rest-1'), {
        wrapper: createWrapper(),
      });

      expect(result.current.loading).toBe(true);
      expect(result.current.invoices).toEqual([]);
    });

    it('handles error state correctly', async () => {
      const mockError = { message: 'Database error', code: 'PGRST116' };
      mockClient.from.mockReturnValue({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            order: vi.fn(() => Promise.resolve({
              data: null,
              error: mockError,
            })),
          })),
        })),
      });

      const { result } = renderHook(() => useInvoices('rest-1'), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.error).toEqual(mockError);
      });

      expect(result.current.loading).toBe(false);
      expect(result.current.invoices).toEqual([]);
    });

    it('returns empty array when no restaurant ID provided', async () => {
      const { result } = renderHook(() => useInvoices(null), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.invoices).toEqual([]);
      });

      expect(result.current.loading).toBe(false);
      expect(mockClient.from).not.toHaveBeenCalled();
    });

    it('returns empty array when restaurant ID is empty string', async () => {
      const { result } = renderHook(() => useInvoices(''), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.invoices).toEqual([]);
      });

      expect(result.current.loading).toBe(false);
      expect(mockClient.from).not.toHaveBeenCalled();
    });
  });

  describe('useInvoice (single invoice)', () => {
    it('fetches single invoice successfully', async () => {
      const mockInvoice = {
        id: 'inv-1',
        restaurant_id: 'rest-1',
        customer_id: 'cust-1',
        status: 'draft',
        subtotal_amount: 10000,
        customers: {
          name: 'Test Customer',
          email: 'test@example.com',
          phone: '+1234567890',
          billing_address_line1: '123 Main St',
          billing_address_city: 'Test City',
          billing_address_state: 'TS',
          billing_address_postal_code: '12345',
          billing_address_country: 'US',
        },
        invoice_line_items: [
          {
            id: 'li-1',
            description: 'Test Item',
            quantity: 1,
            unit_amount: 10000,
            amount: 10000,
          },
        ],
      };

      mockClient.from.mockReturnValue({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            single: vi.fn(() => Promise.resolve({
              data: mockInvoice,
              error: null,
            })),
          })),
        })),
      });

      const { result } = renderHook(() => useInvoices('rest-1'), {
        wrapper: createWrapper(),
      });

      const { result: invoiceResult } = renderHook(() => result.current.useInvoice('inv-1'), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(invoiceResult.current.data).toEqual(mockInvoice);
      });

      expect(invoiceResult.current.isLoading).toBe(false);
      expect(invoiceResult.current.error).toBe(null);
    });

    it('returns null when no invoice ID provided', async () => {
      const { result } = renderHook(() => useInvoices('rest-1'), {
        wrapper: createWrapper(),
      });

      const { result: invoiceResult } = renderHook(() => result.current.useInvoice(null), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(invoiceResult.current.data).toBe(null);
      });
    });

    it('returns null when invoice ID is empty string', async () => {
      const { result } = renderHook(() => useInvoices('rest-1'), {
        wrapper: createWrapper(),
      });

      const { result: invoiceResult } = renderHook(() => result.current.useInvoice(''), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(invoiceResult.current.data).toBe(null);
      });
    });
  });

  describe('createInvoice', () => {
    it('creates invoice successfully with fees passed to customer', async () => {
      const mockInvoiceData = {
        customerId: 'cust-1',
        lineItems: [
          { description: 'Service', quantity: 1, unit_amount: 10000 },
        ],
        passFeesToCustomer: true,
        description: 'Test invoice',
      };

      const mockCreatedInvoice = {
        success: true,
        invoiceId: 'inv-1',
        stripeInvoiceId: 'in_stripe_123',
        status: 'draft',
        total: 11155,
      };

      mockClient.functions.invoke.mockResolvedValue({
        data: mockCreatedInvoice,
        error: null,
      });

      const { result } = renderHook(() => useInvoices('rest-1'), {
        wrapper: createWrapper(),
      });

      act(() => {
        result.current.createInvoice(mockInvoiceData);
      });

      await waitFor(() => {
        expect(result.current.createdInvoice).toEqual(mockCreatedInvoice);
      });

      expect(mockClient.functions.invoke).toHaveBeenCalledWith('stripe-create-invoice', {
        body: {
          restaurantId: 'rest-1',
          ...mockInvoiceData,
        },
      });

      expect(result.current.isCreating).toBe(false);
    });

    it('creates invoice successfully without fees passed to customer', async () => {
      const mockInvoiceData = {
        customerId: 'cust-1',
        lineItems: [
          { description: 'Service', quantity: 1, unit_amount: 10000 },
        ],
        passFeesToCustomer: false,
      };

      const mockCreatedInvoice = {
        success: true,
        invoiceId: 'inv-1',
        stripeInvoiceId: 'in_stripe_123',
        status: 'draft',
        total: 10825,
      };

      mockClient.functions.invoke.mockResolvedValue({
        data: mockCreatedInvoice,
        error: null,
      });

      const { result } = renderHook(() => useInvoices('rest-1'), {
        wrapper: createWrapper(),
      });

      act(() => {
        result.current.createInvoice(mockInvoiceData);
      });

      await waitFor(() => {
        expect(result.current.createdInvoice).toEqual(mockCreatedInvoice);
      });

      expect(mockClient.functions.invoke).toHaveBeenCalledWith('stripe-create-invoice', {
        body: {
          restaurantId: 'rest-1',
          ...mockInvoiceData,
        },
      });
    });

    it('handles create invoice error', async () => {
      const mockError = { message: 'Stripe API error' };
      mockClient.functions.invoke.mockResolvedValue({
        data: null,
        error: mockError,
      });

      const { result } = renderHook(() => useInvoices('rest-1'), {
        wrapper: createWrapper(),
      });

      act(() => {
        result.current.createInvoice({
          customerId: 'cust-1',
          lineItems: [{ description: 'Service', quantity: 1, unit_amount: 10000 }],
          passFeesToCustomer: false,
        });
      });

      await waitFor(() => {
        expect(result.current.isCreating).toBe(false);
      });

      // Error should be handled by the mutation's onError callback
      expect(mockClient.functions.invoke).toHaveBeenCalled();
    });

    it('throws error when no restaurant selected', async () => {
      const { result } = renderHook(() => useInvoices(null), {
        wrapper: createWrapper(),
      });

      act(() => {
        result.current.createInvoice({
          customerId: 'cust-1',
          lineItems: [],
          passFeesToCustomer: false,
        });
      });

      await waitFor(() => {
        expect(result.current.isCreating).toBe(false);
      });

      // Since the error is thrown synchronously before the API call,
      // the functions.invoke should not be called
      expect(mockClient.functions.invoke).not.toHaveBeenCalled();
    });

    it('handles optional fields correctly', async () => {
      const mockInvoiceData = {
        customerId: 'cust-1',
        lineItems: [{ description: 'Service', quantity: 1, unit_amount: 10000 }],
        passFeesToCustomer: false,
        dueDate: '2024-12-31',
        description: 'Test invoice',
        footer: 'Payment terms',
        memo: 'Internal note',
      };

      mockClient.functions.invoke.mockResolvedValue({
        data: { invoice: { invoiceId: 'inv-1' } },
        error: null,
      });

      const { result } = renderHook(() => useInvoices('rest-1'), {
        wrapper: createWrapper(),
      });

      act(() => {
        result.current.createInvoice(mockInvoiceData);
      });

      await waitFor(() => {
        expect(result.current.createdInvoice).toBeDefined();
      });

      expect(mockClient.functions.invoke).toHaveBeenCalledWith('stripe-create-invoice', {
        body: {
          restaurantId: 'rest-1',
          ...mockInvoiceData,
        },
      });
    });
  });

  describe('sendInvoice', () => {
    it('sends invoice successfully', async () => {
      mockClient.functions.invoke.mockResolvedValue({
        data: { success: true },
        error: null,
      });

      const { result } = renderHook(() => useInvoices('rest-1'), {
        wrapper: createWrapper(),
      });

      act(() => {
        result.current.sendInvoice('inv-1');
      });

      await waitFor(() => {
        expect(result.current.isSending).toBe(false);
      });

      expect(mockClient.functions.invoke).toHaveBeenCalledWith('stripe-send-invoice', {
        body: { invoiceId: 'inv-1' },
      });
    });

    it('handles send invoice error', async () => {
      const mockError = { message: 'Send failed' };
      mockClient.functions.invoke.mockResolvedValue({
        data: null,
        error: mockError,
      });

      const { result } = renderHook(() => useInvoices('rest-1'), {
        wrapper: createWrapper(),
      });

      act(() => {
        result.current.sendInvoice('inv-1');
      });

      await waitFor(() => {
        expect(result.current.isSending).toBe(false);
      });

      expect(mockClient.functions.invoke).toHaveBeenCalled();
    });
  });

  describe('syncInvoiceStatus', () => {
    it('syncs invoice status successfully', async () => {
      const mockSyncedInvoice = {
        id: 'inv-1',
        status: 'paid',
        stripe_fee_amount: 330,
        stripe_fee_description: 'Stripe processing fees',
        application_fee_amount: 0,
      };

      mockClient.functions.invoke.mockResolvedValue({
        data: { invoice: mockSyncedInvoice },
        error: null,
      });

      const { result } = renderHook(() => useInvoices('rest-1'), {
        wrapper: createWrapper(),
      });

      act(() => {
        result.current.syncInvoiceStatus('inv-1');
      });

      await waitFor(() => {
        expect(result.current.isSyncingStatus).toBe(false);
      });

      expect(mockClient.functions.invoke).toHaveBeenCalledWith('stripe-sync-invoice-status', {
        body: { invoiceId: 'inv-1' },
      });
    });

    it('handles sync error', async () => {
      const mockError = { message: 'Sync failed' };
      mockClient.functions.invoke.mockResolvedValue({
        data: null,
        error: mockError,
      });

      const { result } = renderHook(() => useInvoices('rest-1'), {
        wrapper: createWrapper(),
      });

      act(() => {
        result.current.syncInvoiceStatus('inv-1');
      });

      await waitFor(() => {
        expect(result.current.isSyncingStatus).toBe(false);
      });

      expect(mockClient.functions.invoke).toHaveBeenCalled();
    });
  });

  describe('deleteInvoice', () => {
    it('deletes draft invoice successfully', async () => {
      mockClient.from.mockReturnValue({
        delete: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(() => Promise.resolve({
              error: null,
            })),
          })),
        })),
      });

      const { result } = renderHook(() => useInvoices('rest-1'), {
        wrapper: createWrapper(),
      });

      act(() => {
        result.current.deleteInvoice('inv-1');
      });

      await waitFor(() => {
        expect(result.current.isDeleting).toBe(false);
      });

      expect(mockClient.from).toHaveBeenCalledWith('invoices');
    });

    it('handles delete error', async () => {
      const mockError = { message: 'Delete failed' };
      mockClient.from.mockReturnValue({
        delete: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(() => Promise.resolve({
              error: mockError,
            })),
          })),
        })),
      });

      const { result } = renderHook(() => useInvoices('rest-1'), {
        wrapper: createWrapper(),
      });

      act(() => {
        result.current.deleteInvoice('inv-1');
      });

      await waitFor(() => {
        expect(result.current.isDeleting).toBe(false);
      });

      expect(mockClient.from).toHaveBeenCalled();
    });
  });

  describe('async methods', () => {
    it('provides async versions of mutations', async () => {
      mockClient.functions.invoke.mockResolvedValue({
        data: { success: true },
        error: null,
      });

      const { result } = renderHook(() => useInvoices('rest-1'), {
        wrapper: createWrapper(),
      });

      // Test async send
      await act(async () => {
        await result.current.sendInvoiceAsync('inv-1');
      });

      // Test async sync
      await act(async () => {
        await result.current.syncInvoiceStatusAsync('inv-1');
      });

      expect(mockClient.functions.invoke).toHaveBeenCalledTimes(2);
    });
  });

  describe('edge cases', () => {
    it('handles network errors gracefully', async () => {
      mockClient.functions.invoke.mockRejectedValue(new Error('Network error'));

      const { result } = renderHook(() => useInvoices('rest-1'), {
        wrapper: createWrapper(),
      });

      act(() => {
        result.current.createInvoice({
          customerId: 'cust-1',
          lineItems: [{ description: 'Service', quantity: 1, unit_amount: 10000 }],
          passFeesToCustomer: false,
        });
      });

      await waitFor(() => {
        expect(result.current.isCreating).toBe(false);
      });
    });

    it('handles malformed response data', async () => {
      mockClient.functions.invoke.mockResolvedValue({
        data: null, // Missing expected data
        error: null,
      });

      const { result } = renderHook(() => useInvoices('rest-1'), {
        wrapper: createWrapper(),
      });

      act(() => {
        result.current.createInvoice({
          customerId: 'cust-1',
          lineItems: [{ description: 'Service', quantity: 1, unit_amount: 10000 }],
          passFeesToCustomer: false,
        });
      });

      await waitFor(() => {
        expect(result.current.isCreating).toBe(false);
      });
    });

    it('handles empty line items array', async () => {
      mockClient.functions.invoke.mockResolvedValue({
        data: { invoice: { invoiceId: 'inv-1' } },
        error: null,
      });

      const { result } = renderHook(() => useInvoices('rest-1'), {
        wrapper: createWrapper(),
      });

      act(() => {
        result.current.createInvoice({
          customerId: 'cust-1',
          lineItems: [],
          passFeesToCustomer: false,
        });
      });

      await waitFor(() => {
        expect(result.current.createdInvoice).toBeDefined();
      });
    });

    it('handles very large amounts', async () => {
      const largeAmount = 100000000; // $1,000,000
      mockClient.functions.invoke.mockResolvedValue({
        data: { invoice: { invoiceId: 'inv-1' } },
        error: null,
      });

      const { result } = renderHook(() => useInvoices('rest-1'), {
        wrapper: createWrapper(),
      });

      act(() => {
        result.current.createInvoice({
          customerId: 'cust-1',
          lineItems: [{ description: 'Large Service', quantity: 1, unit_amount: largeAmount }],
          passFeesToCustomer: false,
        });
      });

      await waitFor(() => {
        expect(result.current.createdInvoice).toBeDefined();
      });
    });
  });
});