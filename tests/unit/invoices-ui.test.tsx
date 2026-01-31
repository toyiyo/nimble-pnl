import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import Invoices from "@/pages/Invoices";

const navigateMock = vi.fn();
let mockInvoices: any[] = [];

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

vi.mock("@/contexts/RestaurantContext", () => ({
  useRestaurantContext: () => ({
    selectedRestaurant: {
      restaurant_id: "rest-1",
      restaurant: {
        subscription_tier: 'pro',
        subscription_status: 'active',
      },
    },
    restaurants: [],
  }),
}));

vi.mock("@/hooks/useSubscription", () => ({
  useSubscription: () => ({
    subscription: { tier: 'pro', status: 'active' },
    effectiveTier: 'pro',
    hasFeature: () => true,
    needsUpgrade: () => false,
    isTrialing: false,
    isGrandfathered: false,
    isPastDue: false,
    isCanceled: false,
    isActive: true,
    trialDaysRemaining: null,
    grandfatheredDaysRemaining: null,
    volumeDiscount: { percent: 0, locationCount: 1, qualifies: false },
    ownedRestaurantCount: 1,
    getPriceInfo: vi.fn(),
    createCheckout: vi.fn(),
    isCreatingCheckout: false,
    openPortal: vi.fn(),
    isOpeningPortal: false,
  }),
}));

vi.mock("@/hooks/useCustomers", () => ({
  useCustomers: () => ({
    customers: [
      { id: "cust-1", name: "Alice", email: "alice@example.com" },
      { id: "cust-2", name: "Bob", email: "bob@example.com" },
    ],
  }),
}));

vi.mock("@/hooks/useStripeConnect", () => ({
  useStripeConnect: () => ({
    connectedAccount: { id: "acct_123" },
    isReadyForInvoicing: true,
    createAccount: vi.fn(),
    isCreatingAccount: false,
  }),
}));

vi.mock("@/hooks/useInvoices", () => ({
  useInvoices: () => ({
    invoices: mockInvoices,
    loading: false,
  }),
}));

describe("Invoices list", () => {
  beforeEach(() => {
    navigateMock.mockReset();
    mockInvoices = [
      {
        id: "inv-1",
        status: "paid",
        invoice_number: "INV-001",
        customers: { name: "Alice", email: "alice@example.com" },
        total: 12345,
        paid_at: "2024-01-01T00:00:00Z",
        due_date: null,
      },
      {
        id: "inv-2",
        status: "draft",
        invoice_number: "INV-002",
        customers: { name: "Bob", email: "bob@example.com" },
        total: 5000,
        due_date: null,
      },
    ];
  });

  const renderPage = () => {
    const queryClient = new QueryClient();
    return render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/invoices"]}>
          <Invoices />
        </MemoryRouter>
      </QueryClientProvider>
    );
  };

  it("filters by customer name", async () => {
    renderPage();

    fireEvent.change(screen.getByPlaceholderText(/search invoices/i), { target: { value: "bob" } });

    const buttons = screen.getAllByRole("button", { name: /INV-/i });
    expect(buttons).toHaveLength(1);
    expect(screen.getByText("INV-002")).toBeInTheDocument();
  });

  it("renders invoice rows as accessible buttons", () => {
    renderPage();

    const buttons = screen.getAllByRole("button", { name: /INV-/i });
    expect(buttons.length).toBeGreaterThan(0);
  });
});
