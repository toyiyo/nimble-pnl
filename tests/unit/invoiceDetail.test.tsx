import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import InvoiceDetail from '@/pages/InvoiceDetail';
import { mockUseInvoices, mockUseInvoice, mockSendInvoiceAsync, mockSyncInvoiceStatusAsync } from '@/hooks/useInvoices';

const navigateMock = vi.fn();

// Mock other dependencies
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => navigateMock,
    useParams: () => ({ id: 'inv-1' }),
  };
});

vi.mock('@/contexts/RestaurantContext', () => ({
  useRestaurantContext: () => ({
    selectedRestaurant: { restaurant_id: 'rest-1' },
  }),
}));

vi.mock('@/hooks/useStripeConnect', () => ({
  useStripeConnect: () => ({
    openDashboard: vi.fn(),
    isOpeningDashboard: false,
  }),
}));

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({
    toast: vi.fn(),
  }),
}));

vi.mock('@/hooks/useInvoices', () => {
  const mockUseInvoices = vi.fn();
  const mockUseInvoice = vi.fn();
  const mockSendInvoiceAsync = vi.fn();
  const mockSyncInvoiceStatusAsync = vi.fn();

  // Default implementation
  mockUseInvoices.mockReturnValue({
    useInvoice: mockUseInvoice,
    sendInvoiceAsync: mockSendInvoiceAsync,
    syncInvoiceStatusAsync: mockSyncInvoiceStatusAsync,
    isSending: false,
    isSyncingStatus: false,
  });

  return {
    useInvoices: mockUseInvoices,
    // Export for testing
    mockUseInvoices,
    mockUseInvoice,
    mockSendInvoiceAsync,
    mockSyncInvoiceStatusAsync,
  };
});

const CreateWrapper = ({ children }: { children: React.ReactNode }) => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
};

describe('InvoiceDetail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    navigateMock.mockReset();
    mockSendInvoiceAsync.mockReset();
    mockSyncInvoiceStatusAsync.mockReset();

    // Default mock implementation for useInvoices hook
    mockUseInvoices.mockReturnValue({
      useInvoice: mockUseInvoice,
      sendInvoiceAsync: mockSendInvoiceAsync,
      syncInvoiceStatusAsync: mockSyncInvoiceStatusAsync,
      isSending: false,
      isSyncingStatus: false,
    });

    // Default mock implementation for useInvoice query
    mockUseInvoice.mockReturnValue({
      data: null,
      isLoading: false,
      error: null,
    });
  });

  describe('Loading State', () => {
    it('displays loading skeleton when invoice is loading', () => {
      mockUseInvoice.mockReturnValue({
        data: null,
        isLoading: true,
        error: null,
      });

      render(
        <MemoryRouter>
          <CreateWrapper>
            <InvoiceDetail />
          </CreateWrapper>
        </MemoryRouter>
      );

      expect(screen.getAllByText('', { selector: '.animate-pulse' })).toHaveLength(6); // Skeleton elements
    });
  });

  describe('Error State', () => {
    it('displays error message when invoice fetch fails', () => {
      const mockError = { message: 'Invoice not found' };
      mockUseInvoice.mockReturnValue({
        data: null,
        isLoading: false,
        error: mockError,
      });

      render(
        <MemoryRouter>
          <CreateWrapper>
            <InvoiceDetail />
          </CreateWrapper>
        </MemoryRouter>
      );

      expect(screen.getByText('Invoice Not Found')).toBeInTheDocument();
      expect(screen.getByText('The invoice you\'re looking for doesn\'t exist or you don\'t have permission to view it.')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /back to invoices/i })).toBeInTheDocument();
    });

    it('displays error message when invoice data is null', () => {
      mockUseInvoice.mockReturnValue({
        data: null,
        isLoading: false,
        error: null,
      });

      render(
        <MemoryRouter>
          <CreateWrapper>
            <InvoiceDetail />
          </CreateWrapper>
        </MemoryRouter>
      );

      expect(screen.getByText('Invoice Not Found')).toBeInTheDocument();
    });
  });

  describe('Invoice Display - Basic Information', () => {
    const mockInvoice = {
      id: 'inv-1',
      invoice_number: 'INV-001',
      status: 'draft',
      subtotal: 10000, // $100.00
      tax: 825, // $8.25
      total: 10825, // $108.25
      amount_due: 10825,
      amount_paid: 0,
      amount_remaining: 10825,
      stripe_fee_amount: 0,
      application_fee_amount: 0,
      pass_fees_to_customer: false,
      currency: 'usd',
      invoice_date: '2024-01-01T00:00:00Z',
      due_date: '2024-01-15T00:00:00Z',
      paid_at: null,
      description: 'Test invoice description',
      memo: 'Internal memo',
      footer: 'Payment terms',
      created_at: '2024-01-01T00:00:00Z',
      customers: {
        name: 'Test Customer',
        email: 'test@example.com',
        phone: '+1234567890',
        billing_address_line1: '123 Main St',
        billing_address_line2: 'Apt 4B',
        billing_address_city: 'Test City',
        billing_address_state: 'TS',
        billing_address_postal_code: '12345',
        billing_address_country: 'US',
      },
      invoice_line_items: [
        {
          id: 'li-1',
          description: 'Consulting Services',
          quantity: 2,
          unit_amount: 5000, // $50.00
          amount: 10000, // $100.00
        },
      ],
    };

    beforeEach(() => {
      mockUseInvoice.mockReturnValue({
        data: mockInvoice,
        isLoading: false,
        error: null,
      });
    });

    it('displays invoice header with correct information', () => {
      render(
        <MemoryRouter>
          <CreateWrapper>
            <InvoiceDetail />
          </CreateWrapper>
        </MemoryRouter>
      );

      expect(screen.getByText('Invoice INV-001')).toBeInTheDocument();
      expect(screen.getByText('Draft')).toBeInTheDocument();
      expect(screen.getByText(/Created\s+Jan 1, 2024/i)).toBeInTheDocument();
    });

    it('displays customer information correctly', () => {
      render(
        <MemoryRouter>
          <CreateWrapper>
            <InvoiceDetail />
          </CreateWrapper>
        </MemoryRouter>
      );

      expect(screen.getByText('Test Customer')).toBeInTheDocument();
      expect(screen.getByText('test@example.com')).toBeInTheDocument();
      expect(screen.getByText('+1234567890')).toBeInTheDocument();
      expect(screen.getByText('123 Main St')).toBeInTheDocument();
      expect(screen.getByText('Apt 4B')).toBeInTheDocument();
      expect(screen.getByText('Test City, TS, 12345')).toBeInTheDocument();
      expect(screen.getByText('US')).toBeInTheDocument();
    });

    it('displays line items correctly', () => {
      render(
        <MemoryRouter>
          <CreateWrapper>
            <InvoiceDetail />
          </CreateWrapper>
        </MemoryRouter>
      );

      expect(screen.getByText('Consulting Services')).toBeInTheDocument();
      expect(screen.getByText('Quantity: 2 × $50.00')).toBeInTheDocument();
      
      // Check line items in the Items section
      const itemsSection = screen.getByText('Items').closest('.rounded-lg');
      expect(itemsSection).toHaveTextContent('$100.00'); // Line item total
    });

    it('displays invoice summary without fees', () => {
      render(
        <MemoryRouter>
          <CreateWrapper>
            <InvoiceDetail />
          </CreateWrapper>
        </MemoryRouter>
      );

      // Check amounts in the invoice summary section
      const summarySection = screen.getByText('Invoice Summary').closest('.rounded-lg');
      expect(summarySection).toHaveTextContent('$100.00'); // Subtotal
      expect(summarySection).toHaveTextContent('$8.25'); // Tax
      expect(summarySection).toHaveTextContent('$108.25'); // Total
      expect(screen.queryByText('Processing Fee')).not.toBeInTheDocument();
    });

    it('displays dates correctly', () => {
      render(
        <MemoryRouter>
          <CreateWrapper>
            <InvoiceDetail />
          </CreateWrapper>
        </MemoryRouter>
      );

      expect(screen.getByText('Jan 1, 2024')).toBeInTheDocument(); // Invoice date
      expect(screen.getByText('Jan 14, 2024')).toBeInTheDocument(); // Due date
    });

    it('displays additional details when present', () => {
      render(
        <MemoryRouter>
          <CreateWrapper>
            <InvoiceDetail />
          </CreateWrapper>
        </MemoryRouter>
      );

      expect(screen.getByText('Test invoice description')).toBeInTheDocument();
      expect(screen.getByText('Internal memo')).toBeInTheDocument();
      expect(screen.getByText('Payment terms')).toBeInTheDocument();
    });
  });

  describe('Fee Display', () => {
    it('displays processing fee when stripe_fee_amount > 0', () => {
      const mockInvoiceWithFees = {
        id: 'inv-1',
        invoice_number: 'INV-001',
        status: 'paid',
        subtotal: 10000,
        tax: 825,
        total: 11155, // 10825 + 330 fee
        amount_due: 0,
        amount_paid: 11155,
        amount_remaining: 0,
        stripe_fee_amount: 330,
        stripe_fee_description: 'Stripe processing fee',
        application_fee_amount: 0,
        pass_fees_to_customer: true,
        currency: 'usd',
        invoice_date: '2024-01-01',
        paid_at: '2024-01-15T00:00:00Z',
        created_at: '2024-01-01T00:00:00Z',
        customers: { name: 'Test Customer', email: 'test@example.com' },
        invoice_line_items: [],
      };

      mockUseInvoice.mockReturnValue({
        data: mockInvoiceWithFees,
        isLoading: false,
        error: null,
      });

      render(
        <MemoryRouter>
          <CreateWrapper>
            <InvoiceDetail />
          </CreateWrapper>
        </MemoryRouter>
      );

      expect(screen.getByText('$100.00')).toBeInTheDocument(); // Subtotal
      expect(screen.getByText('$8.25')).toBeInTheDocument(); // Tax
      expect(screen.getByText('$3.30')).toBeInTheDocument(); // Processing fee
      expect(screen.getByText('$111.55')).toBeInTheDocument(); // Total
      expect(screen.getByText('Processing Fee')).toBeInTheDocument();
      expect(screen.getByText('-$111.55')).toBeInTheDocument(); // Amount paid
    });

    it('displays application fee when application_fee_amount > 0', () => {
      const mockInvoiceWithAppFee = {
        id: 'inv-1',
        status: 'paid',
        subtotal: 10000,
        tax: 0,
        total: 10100,
        stripe_fee_amount: 0,
        application_fee_amount: 100,
        currency: 'usd',
        invoice_date: '2024-01-01',
        created_at: '2024-01-01T00:00:00Z',
        customers: { name: 'Test Customer' },
        invoice_line_items: [],
      };

      mockUseInvoice.mockReturnValue({
        data: mockInvoiceWithAppFee,
        isLoading: false,
        error: null,
      });

      render(
        <MemoryRouter>
          <CreateWrapper>
            <InvoiceDetail />
          </CreateWrapper>
        </MemoryRouter>
      );

      expect(screen.getByText('$1.00')).toBeInTheDocument(); // Application fee
    });

    it('handles zero fees correctly', () => {
      const mockInvoiceNoFees = {
        id: 'inv-1',
        status: 'paid',
        subtotal: 10000,
        tax: 0,
        total: 10000,
        stripe_fee_amount: 0,
        application_fee_amount: 0,
        currency: 'usd',
        invoice_date: '2024-01-01',
        created_at: '2024-01-01T00:00:00Z',
        customers: { name: 'Test Customer' },
        invoice_line_items: [],
      };

      mockUseInvoice.mockReturnValue({
        data: mockInvoiceNoFees,
        isLoading: false,
        error: null,
      });

      render(
        <MemoryRouter>
          <CreateWrapper>
            <InvoiceDetail />
          </CreateWrapper>
        </MemoryRouter>
      );

      expect(screen.queryByText('Processing Fee')).not.toBeInTheDocument();
      expect(screen.queryByText('Application Fee')).not.toBeInTheDocument();
    });
  });

  describe('Status Display', () => {
    const baseInvoice = {
      id: 'inv-1',
      subtotal: 10000,
      tax: 0,
      total: 10000,
      stripe_fee_amount: 0,
      application_fee_amount: 0,
      currency: 'usd',
      invoice_date: '2024-01-01',
      created_at: '2024-01-01T00:00:00Z',
      customers: { name: 'Test Customer' },
      invoice_line_items: [],
    };

    it.each([
      ['draft', 'Draft'],
      ['open', 'Sent'],
      ['paid', 'Paid'],
      ['void', 'Void'],
      ['uncollectible', 'Uncollectible'],
    ])('displays correct badge for %s status', (status, expectedLabel) => {
      mockUseInvoice.mockReturnValue({
        data: { ...baseInvoice, status },
        isLoading: false,
        error: null,
      });

      render(
        <MemoryRouter>
          <CreateWrapper>
            <InvoiceDetail />
          </CreateWrapper>
        </MemoryRouter>
      );

      expect(screen.getByText(expectedLabel)).toBeInTheDocument();
    });

    it('shows payment received alert for paid invoices', () => {
      mockUseInvoice.mockReturnValue({
        data: { ...baseInvoice, status: 'paid' },
        isLoading: false,
        error: null,
      });

      render(
        <MemoryRouter>
          <CreateWrapper>
            <InvoiceDetail />
          </CreateWrapper>
        </MemoryRouter>
      );

      expect(screen.getByText('Payment Received')).toBeInTheDocument();
      expect(screen.getByText('This invoice has been paid in full. Funds have been transferred to your connected account.')).toBeInTheDocument();
    });

    it('shows awaiting payment alert for open invoices', () => {
      mockUseInvoice.mockReturnValue({
        data: { ...baseInvoice, status: 'open' },
        isLoading: false,
        error: null,
      });

      render(
        <MemoryRouter>
          <CreateWrapper>
            <InvoiceDetail />
          </CreateWrapper>
        </MemoryRouter>
      );

      expect(screen.getByText('Awaiting Payment')).toBeInTheDocument();
      expect(screen.getByText('This invoice has been sent to the customer and is awaiting payment.')).toBeInTheDocument();
    });

    it('shows payment failed alert for uncollectible invoices', () => {
      mockUseInvoice.mockReturnValue({
        data: { ...baseInvoice, status: 'uncollectible' },
        isLoading: false,
        error: null,
      });

      render(
        <MemoryRouter>
          <CreateWrapper>
            <InvoiceDetail />
          </CreateWrapper>
        </MemoryRouter>
      );

      expect(screen.getByText('Payment Failed')).toBeInTheDocument();
      expect(screen.getByText('This invoice is marked as uncollectible. You may need to follow up with the customer.')).toBeInTheDocument();
    });
  });

  describe('Action Buttons', () => {
    const baseInvoice = {
      id: 'inv-1',
      status: 'draft',
      subtotal: 10000,
      tax: 0,
      total: 10000,
      stripe_fee_amount: 0,
      application_fee_amount: 0,
      currency: 'usd',
      invoice_date: '2024-01-01',
      created_at: '2024-01-01T00:00:00Z',
      customers: { name: 'Test Customer' },
      invoice_line_items: [],
    };

    it('shows send invoice button for draft invoices', () => {
      mockUseInvoice.mockReturnValue({
        data: { ...baseInvoice, status: 'draft' },
        isLoading: false,
        error: null,
      });

      render(
        <MemoryRouter>
          <CreateWrapper>
            <InvoiceDetail />
          </CreateWrapper>
        </MemoryRouter>
      );

      expect(screen.getByRole('button', { name: /send invoice/i })).toBeInTheDocument();
    });

    it('does not show send invoice button for non-draft invoices', () => {
      mockUseInvoice.mockReturnValue({
        data: { ...baseInvoice, status: 'open' },
        isLoading: false,
        error: null,
      });

      render(
        <MemoryRouter>
          <CreateWrapper>
            <InvoiceDetail />
          </CreateWrapper>
        </MemoryRouter>
      );

      expect(screen.queryByRole('button', { name: /send invoice/i })).not.toBeInTheDocument();
    });

    it('shows sync status button when stripe_invoice_id exists', () => {
      mockUseInvoice.mockReturnValue({
        data: { ...baseInvoice, stripe_invoice_id: 'in_123' },
        isLoading: false,
        error: null,
      });

      render(
        <MemoryRouter>
          <CreateWrapper>
            <InvoiceDetail />
          </CreateWrapper>
        </MemoryRouter>
      );

      expect(screen.getByRole('button', { name: /sync status/i })).toBeInTheDocument();
    });

    it('does not show sync status button when stripe_invoice_id is null', () => {
      mockUseInvoice.mockReturnValue({
        data: { ...baseInvoice, stripe_invoice_id: null },
        isLoading: false,
        error: null,
      });

      render(
        <MemoryRouter>
          <CreateWrapper>
            <InvoiceDetail />
          </CreateWrapper>
        </MemoryRouter>
      );

      expect(screen.queryByRole('button', { name: /sync status/i })).not.toBeInTheDocument();
    });

    it('shows view invoice button when hosted_invoice_url exists', () => {
      mockUseInvoice.mockReturnValue({
        data: { ...baseInvoice, hosted_invoice_url: 'https://example.com/invoice' },
        isLoading: false,
        error: null,
      });

      render(
        <MemoryRouter>
          <CreateWrapper>
            <InvoiceDetail />
          </CreateWrapper>
        </MemoryRouter>
      );

      expect(screen.getByRole('button', { name: /view invoice/i })).toBeInTheDocument();
    });

    it('shows download PDF button when invoice_pdf_url exists', () => {
      mockUseInvoice.mockReturnValue({
        data: { ...baseInvoice, invoice_pdf_url: 'https://example.com/invoice.pdf' },
        isLoading: false,
        error: null,
      });

      render(
        <MemoryRouter>
          <CreateWrapper>
            <InvoiceDetail />
          </CreateWrapper>
        </MemoryRouter>
      );

      expect(screen.getByRole('button', { name: /download pdf/i })).toBeInTheDocument();
    });
  });

  describe('User Interactions', () => {
    const mockInvoice = {
      id: 'inv-1',
      status: 'draft',
      subtotal: 10000,
      tax: 0,
      total: 10000,
      stripe_fee_amount: 0,
      application_fee_amount: 0,
      currency: 'usd',
      invoice_date: '2024-01-01',
      created_at: '2024-01-01T00:00:00Z',
      customers: { name: 'Test Customer' },
      invoice_line_items: [],
    };

    beforeEach(() => {
      mockUseInvoice.mockReturnValue({
        data: mockInvoice,
        isLoading: false,
        error: null,
      });
    });

    it('navigates back to invoices when back button is clicked', () => {
      render(
        <MemoryRouter>
          <CreateWrapper>
            <InvoiceDetail />
          </CreateWrapper>
        </MemoryRouter>
      );

      const backButton = screen.getByRole('button', { name: /back to invoices/i });
      fireEvent.click(backButton);

      expect(navigateMock).toHaveBeenCalledWith('/invoices');
    });

    it('calls sendInvoiceAsync when send invoice button is clicked', async () => {
      mockSendInvoiceAsync.mockResolvedValue(undefined);

      render(
        <MemoryRouter>
          <CreateWrapper>
            <InvoiceDetail />
          </CreateWrapper>
        </MemoryRouter>
      );

      const sendButton = screen.getByRole('button', { name: /send invoice/i });
      fireEvent.click(sendButton);

      await waitFor(() => {
        expect(mockSendInvoiceAsync).toHaveBeenCalledWith('inv-1');
      });
    });

    it('calls syncInvoiceStatusAsync when sync status button is clicked', async () => {
      mockUseInvoice.mockReturnValue({
        data: { ...mockInvoice, stripe_invoice_id: 'in_123' },
        isLoading: false,
        error: null,
      });

      mockSyncInvoiceStatusAsync.mockResolvedValue(undefined);

      render(
        <MemoryRouter>
          <CreateWrapper>
            <InvoiceDetail />
          </CreateWrapper>
        </MemoryRouter>
      );

      const syncButton = screen.getByRole('button', { name: /sync status/i });
      fireEvent.click(syncButton);

      await waitFor(() => {
        expect(mockSyncInvoiceStatusAsync).toHaveBeenCalledWith('inv-1');
      });
    });

    it('opens hosted invoice URL in new tab when view invoice is clicked', () => {
      const mockWindowOpen = vi.spyOn(window, 'open').mockImplementation(() => null);

      mockUseInvoice.mockReturnValue({
        data: { ...mockInvoice, hosted_invoice_url: 'https://example.com/invoice' },
        isLoading: false,
        error: null,
      });

      render(
        <MemoryRouter>
          <CreateWrapper>
            <InvoiceDetail />
          </CreateWrapper>
        </MemoryRouter>
      );

      const viewButton = screen.getByRole('button', { name: /view invoice/i });
      fireEvent.click(viewButton);

      expect(mockWindowOpen).toHaveBeenCalledWith('https://example.com/invoice', '_blank');

      mockWindowOpen.mockRestore();
    });

    it('opens PDF URL in new tab when download PDF is clicked', () => {
      const mockWindowOpen = vi.spyOn(window, 'open').mockImplementation(() => null);

      mockUseInvoice.mockReturnValue({
        data: { ...mockInvoice, invoice_pdf_url: 'https://example.com/invoice.pdf' },
        isLoading: false,
        error: null,
      });

      render(
        <MemoryRouter>
          <CreateWrapper>
            <InvoiceDetail />
          </CreateWrapper>
        </MemoryRouter>
      );

      const downloadButton = screen.getByRole('button', { name: /download pdf/i });
      fireEvent.click(downloadButton);

      expect(mockWindowOpen).toHaveBeenCalledWith('https://example.com/invoice.pdf', '_blank');

      mockWindowOpen.mockRestore();
    });
  });

  describe('Edge Cases', () => {
    it('handles invoice with no line items', () => {
      const mockInvoice = {
        id: 'inv-1',
        status: 'draft',
        subtotal: 0,
        tax: 0,
        total: 0,
        stripe_fee_amount: 0,
        application_fee_amount: 0,
        currency: 'usd',
        invoice_date: '2024-01-01',
        created_at: '2024-01-01T00:00:00Z',
        customers: { name: 'Test Customer' },
        invoice_line_items: [],
      };

      mockUseInvoice.mockReturnValue({
        data: mockInvoice,
        isLoading: false,
        error: null,
      });

      render(
        <MemoryRouter>
          <CreateWrapper>
            <InvoiceDetail />
          </CreateWrapper>
        </MemoryRouter>
      );

      // Check that the invoice summary shows $0.00 amounts
      const summarySection = screen.getByText('Invoice Summary').closest('.rounded-lg');
      expect(summarySection).toHaveTextContent('$0.00');
    });

    it('handles invoice with missing customer information', () => {
      const mockInvoice = {
        id: 'inv-1',
        status: 'draft',
        subtotal: 10000,
        tax: 0,
        total: 10000,
        stripe_fee_amount: 0,
        application_fee_amount: 0,
        currency: 'usd',
        invoice_date: '2024-01-01',
        created_at: '2024-01-01T00:00:00Z',
        customers: null,
        invoice_line_items: [],
      };

      mockUseInvoice.mockReturnValue({
        data: mockInvoice,
        isLoading: false,
        error: null,
      });

      render(
        <MemoryRouter>
          <CreateWrapper>
            <InvoiceDetail />
          </CreateWrapper>
        </MemoryRouter>
      );

      // Should not crash and should still display invoice info
      expect(screen.getByText('Invoice inv-1')).toBeInTheDocument();
    });

    it('handles invoice with no invoice number (shows ID)', () => {
      const mockInvoice = {
        id: 'inv-123456789',
        invoice_number: null,
        status: 'draft',
        subtotal: 10000,
        tax: 0,
        total: 10000,
        stripe_fee_amount: 0,
        application_fee_amount: 0,
        currency: 'usd',
        invoice_date: '2024-01-01',
        created_at: '2024-01-01T00:00:00Z',
        customers: { name: 'Test Customer' },
        invoice_line_items: [],
      };

      mockUseInvoice.mockReturnValue({
        data: mockInvoice,
        isLoading: false,
        error: null,
      });

      render(
        <MemoryRouter>
          <CreateWrapper>
            <InvoiceDetail />
          </CreateWrapper>
        </MemoryRouter>
      );

      expect(screen.getByText('Invoice 23456789')).toBeInTheDocument();
    });

    it('handles very large amounts correctly', () => {
      const mockInvoice = {
        id: 'inv-1',
        status: 'draft',
        subtotal: 100000000, // $1,000,000
        tax: 8250000, // $82,500
        total: 108250000, // $1,082,500
        stripe_fee_amount: 330000, // $3,300
        application_fee_amount: 0,
        currency: 'usd',
        invoice_date: '2024-01-01',
        created_at: '2024-01-01T00:00:00Z',
        customers: { name: 'Test Customer' },
        invoice_line_items: [],
      };

      mockUseInvoice.mockReturnValue({
        data: mockInvoice,
        isLoading: false,
        error: null,
      });

      render(
        <MemoryRouter>
          <CreateWrapper>
            <InvoiceDetail />
          </CreateWrapper>
        </MemoryRouter>
      );

      expect(screen.getByText('$1,000,000.00')).toBeInTheDocument();
      expect(screen.getByText('$82,500.00')).toBeInTheDocument();
      expect(screen.getByText('$3,300.00')).toBeInTheDocument();
      expect(screen.getByText('$1,082,500.00')).toBeInTheDocument();
    });

    it('handles different currencies correctly', () => {
      const mockInvoice = {
        id: 'inv-1',
        status: 'draft',
        subtotal: 10000,
        tax: 825,
        total: 10825,
        stripe_fee_amount: 0,
        application_fee_amount: 0,
        currency: 'eur',
        invoice_date: '2024-01-01',
        created_at: '2024-01-01T00:00:00Z',
        customers: { name: 'Test Customer' },
        invoice_line_items: [],
      };

      mockUseInvoice.mockReturnValue({
        data: mockInvoice,
        isLoading: false,
        error: null,
      });

      render(
        <MemoryRouter>
          <CreateWrapper>
            <InvoiceDetail />
          </CreateWrapper>
        </MemoryRouter>
      );

      expect(screen.getByText('€100.00')).toBeInTheDocument();
      expect(screen.getByText('€8.25')).toBeInTheDocument();
      expect(screen.getByText('€108.25')).toBeInTheDocument();
    });
  });
});
