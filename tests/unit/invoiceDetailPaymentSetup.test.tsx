import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import InvoiceDetail from '@/pages/InvoiceDetail';

const openSetup = vi.fn();
const checkStatus = vi.fn();
let setupState: 'not_started' | 'pending' | 'ready' = 'not_started';
let isChecking = false;
let role = 'owner';
let ready = false;

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => vi.fn(), useParams: () => ({ id: 'inv-1' }) };
});

vi.mock('@/contexts/RestaurantContext', () => ({
  useRestaurantContext: () => ({
    selectedRestaurant: { restaurant_id: 'rest-1', role, restaurant: { timezone: 'UTC' } },
    restaurants: [],
  }),
}));

vi.mock('@/hooks/useStripeConnect', () => ({
  useStripeConnect: () => ({ isReadyForInvoicing: ready }),
}));

vi.mock('@/hooks/usePaymentSetup', () => ({
  usePaymentSetup: () => ({
    state: ready ? 'ready' : setupState,
    openSetup,
    checkStatus,
    isChecking,
    isStarting: false,
    isSheetOpen: false,
  }),
}));

vi.mock('@/components/invoicing/PaymentSetupCard', () => ({
  PaymentSetupCard: ({ hideWhenReady }: { hideWhenReady?: boolean }) => (
    <div data-testid="setup-card" data-hide-when-ready={String(!!hideWhenReady)} />
  ),
}));

vi.mock('@/components/invoicing/PaymentSetupSheet', () => ({
  PaymentSetupSheet: () => <div data-testid="setup-sheet" />,
}));

vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/components/invoicing/InvoicePreviewDialog', () => ({ InvoicePreviewDialog: () => null }));

vi.mock('@/hooks/useInvoices', () => ({
  useInvoices: () => ({
    sendInvoiceAsync: vi.fn(),
    syncInvoiceStatusAsync: vi.fn(),
    isSending: false,
    isSyncingStatus: false,
  }),
  useInvoice: () => ({
    data: {
      id: 'inv-1',
      invoice_number: 'INV-001',
      status: 'draft',
      customer_id: 'c1',
      customer: { name: 'Acme', email: 'a@b.com' },
      line_items: [],
      subtotal: 0,
      tax_amount: 0,
      total: 0,
      amount_due: 0,
      amount_paid: 0,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
      invoice_date: '2026-01-01',
      due_date: '2026-02-01',
    },
    isLoading: false,
    error: null,
  }),
}));

const renderPage = () =>
  render(
    <MemoryRouter>
      <QueryClientProvider client={new QueryClient()}>
        <InvoiceDetail />
      </QueryClientProvider>
    </MemoryRouter>,
  );

describe('InvoiceDetail payment setup', () => {
  beforeEach(() => {
    openSetup.mockReset();
    checkStatus.mockReset();
    setupState = 'not_started';
    isChecking = false;
    role = 'owner';
    ready = false;
  });

  it('lets the owner open setup from the send button', () => {
    renderPage();
    const button = screen.getByRole('button', { name: /turn on payments to send/i });
    expect(button).toBeEnabled();
    fireEvent.click(button);
    expect(openSetup).toHaveBeenCalledTimes(1);
  });

  it('disables the send button for other roles and shows visible text', () => {
    role = 'manager';
    renderPage();
    const text = screen.getByText('Ask the restaurant owner to turn on payments.');
    expect(text.id).toBeTruthy();
    const button = screen.getByRole('button', { name: /send invoice/i });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-describedby', text.id);
  });

  it('renders one card with hideWhenReady and one sheet', () => {
    renderPage();
    expect(screen.getAllByTestId('setup-card')).toHaveLength(1);
    expect(screen.getByTestId('setup-card')).toHaveAttribute('data-hide-when-ready', 'true');
    expect(screen.getAllByTestId('setup-sheet')).toHaveLength(1);
  });

  it('shows the normal send button when payments are ready', () => {
    ready = true;
    renderPage();
    expect(screen.queryByText('Ask the restaurant owner to turn on payments.')).toBeNull();
    expect(screen.queryByRole('button', { name: /turn on payments to send/i })).toBeNull();
    expect(screen.getByRole('button', { name: /send invoice/i })).toBeEnabled();
  });

  it('checks the status from the send button when the account is pending', () => {
    setupState = 'pending';
    renderPage();
    expect(screen.queryByRole('button', { name: /turn on payments to send/i })).toBeNull();
    const button = screen.getByRole('button', { name: /stripe is checking your details/i });
    expect(button).toBeEnabled();
    fireEvent.click(button);
    expect(checkStatus).toHaveBeenCalledTimes(1);
    expect(openSetup).not.toHaveBeenCalled();
  });

  it('disables the pending button while the check runs', () => {
    setupState = 'pending';
    isChecking = true;
    renderPage();
    expect(screen.getByRole('button', { name: /stripe is checking your details/i })).toBeDisabled();
  });
});
