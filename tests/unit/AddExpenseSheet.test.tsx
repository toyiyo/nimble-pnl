import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AddExpenseSheet } from '@/components/pending-outflows/AddExpenseSheet';

const toastSpy = vi.fn();
const createSupplierMock = vi.fn();
const mutateAsyncMock = vi.fn();

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({
    toast: toastSpy,
  }),
}));

vi.mock('@/hooks/useSuppliers', () => ({
  useSuppliers: () => ({
    suppliers: [{ id: 'sup-1', name: 'Vendor One' }],
    createSupplier: createSupplierMock,
  }),
}));

vi.mock('@/hooks/usePendingOutflows', () => ({
  usePendingOutflowMutations: () => ({
    createPendingOutflow: {
      mutateAsync: mutateAsyncMock,
      isPending: false,
    },
  }),
}));

vi.mock('@/hooks/useExpenseInvoiceUpload', () => ({
  useExpenseInvoiceUpload: () => ({
    uploadInvoice: vi.fn(),
    processInvoice: vi.fn(),
    updateInvoiceUpload: vi.fn(),
    isUploading: false,
    isProcessing: false,
  }),
}));

vi.mock('@/components/SearchableSupplierSelector', () => ({
  SearchableSupplierSelector: ({
    onValueChange,
  }: {
    onValueChange: (value: string, isNew: boolean) => void;
  }) => (
    <div>
      <button type="button" onClick={() => onValueChange('New Supplier', true)}>
        Create Supplier
      </button>
      <button type="button" onClick={() => onValueChange('sup-1', false)}>
        Select Supplier
      </button>
    </div>
  ),
}));

vi.mock('@/components/banking/SearchableAccountSelector', () => ({
  SearchableAccountSelector: () => <div data-testid="account-selector" />,
}));

vi.mock('@/components/ui/sheet', () => ({
  Sheet: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SheetContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SheetHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SheetTitle: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SheetDescription: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

describe('AddExpenseSheet', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows a toast when supplier creation fails', async () => {
    createSupplierMock.mockRejectedValueOnce(new Error('Create failed'));

    render(<AddExpenseSheet open onOpenChange={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /enter manually/i }));
    fireEvent.click(screen.getByRole('button', { name: /create supplier/i }));

    await waitFor(() => {
      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          description: expect.stringContaining('Failed to create supplier'),
          variant: 'destructive',
        })
      );
    });
  });

  it('shows a toast when expense creation fails', async () => {
    mutateAsyncMock.mockRejectedValueOnce(new Error('Create expense failed'));

    render(<AddExpenseSheet open onOpenChange={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /enter manually/i }));
    fireEvent.click(screen.getByRole('button', { name: /select supplier/i }));
    fireEvent.change(screen.getByPlaceholderText('0.00'), { target: { value: '12.34' } });
    fireEvent.click(screen.getByRole('button', { name: /save expense/i }));

    await waitFor(() => {
      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          description: expect.stringContaining('Failed to create expense'),
          variant: 'destructive',
        })
      );
    });
  });
});
