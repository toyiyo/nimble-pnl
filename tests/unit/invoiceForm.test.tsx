import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import InvoiceForm from '@/pages/InvoiceForm';

const navigateMock = vi.fn();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => navigateMock,
    useSearchParams: () => [new URLSearchParams()],
  };
});

vi.mock('@/contexts/RestaurantContext', () => ({
  useRestaurantContext: () => ({
    selectedRestaurant: { restaurant_id: 'rest-1' },
  }),
}));

vi.mock('@/hooks/useCustomers', () => ({
  useCustomers: () => ({
    customers: [
      { id: 'cust-1', name: 'Acme Corp', email: 'acme@example.com' },
      { id: 'cust-2', name: 'TechStart Inc', email: 'hello@techstart.com' },
    ],
  }),
}));

vi.mock('@/hooks/useStripeConnect', () => ({
  useStripeConnect: () => ({
    isReadyForInvoicing: true,
    createAccount: vi.fn(),
    isCreatingAccount: false,
    openDashboard: vi.fn(),
    isOpeningDashboard: false,
  }),
}));

// Mock the useInvoices hook
const mockCreateInvoice = vi.fn();

vi.mock('@/hooks/useInvoices', () => ({
  useInvoices: () => ({
    createInvoice: mockCreateInvoice,
    isCreating: false,
  }),
}));

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      {children}
    </QueryClientProvider>
  );
};

describe('InvoiceForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const Wrapper = createWrapper();

  describe('Basic Rendering', () => {
    it('renders the form with correct title', () => {
      render(
        <MemoryRouter>
          <Wrapper>
            <InvoiceForm />
          </Wrapper>
        </MemoryRouter>
      );

      expect(screen.getByRole('heading', { name: 'Create Invoice' })).toBeInTheDocument();
      expect(screen.getByText('Create a new invoice for your customer')).toBeInTheDocument();
    });

    it('renders all main sections', () => {
      render(
        <MemoryRouter>
          <Wrapper>
            <InvoiceForm />
          </Wrapper>
        </MemoryRouter>
      );

      expect(screen.getByText('Invoice Details')).toBeInTheDocument();
      expect(screen.getByText('Line Items')).toBeInTheDocument();
      expect(screen.getByText('Additional Details (Optional)')).toBeInTheDocument();
    });

    it('renders form inputs correctly', () => {
      render(
        <MemoryRouter>
          <Wrapper>
            <InvoiceForm />
          </Wrapper>
        </MemoryRouter>
      );

      expect(screen.getByLabelText('Due Date')).toBeInTheDocument();
      expect(screen.getByLabelText('Description')).toBeInTheDocument();
      expect(screen.getByLabelText('Footer')).toBeInTheDocument();
      expect(screen.getByLabelText('Internal Memo')).toBeInTheDocument();
      expect(screen.getByRole('checkbox', { name: /add processing fee to invoice/i })).toBeInTheDocument();
    });

    it('renders line item inputs', () => {
      render(
        <MemoryRouter>
          <Wrapper>
            <InvoiceForm />
          </Wrapper>
        </MemoryRouter>
      );

      expect(screen.getByPlaceholderText('Description')).toBeInTheDocument();
      expect(screen.getByPlaceholderText('Qty')).toBeInTheDocument();
      expect(screen.getByPlaceholderText('Price')).toBeInTheDocument();
    });
  });

  describe('Navigation', () => {
    it('navigates back when back button is clicked', () => {
      render(
        <MemoryRouter>
          <Wrapper>
            <InvoiceForm />
          </Wrapper>
        </MemoryRouter>
      );

      const backButton = screen.getByRole('button', { name: /back/i });
      fireEvent.click(backButton);

      expect(navigateMock).toHaveBeenCalledWith('/invoices');
    });

    it('navigates back when cancel button is clicked', () => {
      render(
        <MemoryRouter>
          <Wrapper>
            <InvoiceForm />
          </Wrapper>
        </MemoryRouter>
      );

      const cancelButton = screen.getByRole('button', { name: /cancel/i });
      fireEvent.click(cancelButton);

      expect(navigateMock).toHaveBeenCalledWith('/invoices');
    });
  });

  describe('Form Interaction', () => {
    it('allows filling line item fields', () => {
      render(
        <MemoryRouter>
          <Wrapper>
            <InvoiceForm />
          </Wrapper>
        </MemoryRouter>
      );

      const descriptionInput = screen.getByPlaceholderText('Description');
      const quantityInput = screen.getByPlaceholderText('Qty');
      const priceInput = screen.getByPlaceholderText('Price');

      fireEvent.change(descriptionInput, { target: { value: 'Test Service' } });
      fireEvent.change(quantityInput, { target: { value: '2' } });
      fireEvent.change(priceInput, { target: { value: '100' } });

      expect(descriptionInput).toHaveValue('Test Service');
      expect(quantityInput).toHaveValue(2);
      expect(priceInput).toHaveValue(100);
    });

    it('allows filling optional fields', () => {
      render(
        <MemoryRouter>
          <Wrapper>
            <InvoiceForm />
          </Wrapper>
        </MemoryRouter>
      );

      const dueDateInput = screen.getByLabelText('Due Date');
      const descriptionField = screen.getByLabelText('Description');
      const footerTextarea = screen.getByLabelText('Footer');
      const memoTextarea = screen.getByLabelText('Internal Memo');

      fireEvent.change(dueDateInput, { target: { value: '2024-12-31' } });
      fireEvent.change(descriptionField, { target: { value: 'Invoice description' } });
      fireEvent.change(footerTextarea, { target: { value: 'Payment terms here' } });
      fireEvent.change(memoTextarea, { target: { value: 'Internal notes' } });

      expect(dueDateInput).toHaveValue('2024-12-31');
      expect(descriptionField).toHaveValue('Invoice description');
      expect(footerTextarea).toHaveValue('Payment terms here');
      expect(memoTextarea).toHaveValue('Internal notes');
    });

    it('allows toggling fee pass-through', () => {
      render(
        <MemoryRouter>
          <Wrapper>
            <InvoiceForm />
          </Wrapper>
        </MemoryRouter>
      );

      const feeCheckbox = screen.getByRole('checkbox', { name: /add processing fee to invoice/i });
      expect(feeCheckbox).not.toBeChecked();

      fireEvent.click(feeCheckbox);
      expect(feeCheckbox).toBeChecked();

      fireEvent.click(feeCheckbox);
      expect(feeCheckbox).not.toBeChecked();
    });
  });

  describe('Form Validation', () => {
    it('shows validation message when trying to submit without customer', () => {
      const alertMock = vi.spyOn(window, 'alert').mockImplementation(() => {});

      render(
        <MemoryRouter>
          <Wrapper>
            <InvoiceForm />
          </Wrapper>
        </MemoryRouter>
      );

      const submitButton = screen.getByRole('button', { name: /create invoice/i });
      fireEvent.click(submitButton);

      expect(alertMock).toHaveBeenCalledWith('Please select a customer');

      alertMock.mockRestore();
    });
  });

  describe('Stripe Connect Integration', () => {
    it('does not show setup message when Stripe is ready', () => {
      render(
        <MemoryRouter>
          <Wrapper>
            <InvoiceForm />
          </Wrapper>
        </MemoryRouter>
      );

      expect(screen.queryByText('Stripe Connect Setup Required')).not.toBeInTheDocument();
    });
  });
});
