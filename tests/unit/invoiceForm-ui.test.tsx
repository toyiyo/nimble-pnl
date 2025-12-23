import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import InvoiceForm from "@/pages/InvoiceForm";

const createInvoiceMock = vi.fn();
const navigateMock = vi.fn();

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

vi.mock("@/contexts/RestaurantContext", () => ({
  useRestaurantContext: () => ({ selectedRestaurant: { restaurant_id: "rest-1" } }),
}));

vi.mock("@/hooks/useCustomers", () => ({
  useCustomers: () => ({ customers: [{ id: "cust-1", name: "Acme Corp", email: "acme@example.com" }] }),
}));

vi.mock("@/hooks/useInvoices", () => ({
  useInvoices: () => ({
    createInvoice: createInvoiceMock,
    isCreating: false,
    createdInvoice: null,
  }),
}));

vi.mock("@/hooks/useStripeConnect", () => ({
  useStripeConnect: () => ({
    isReadyForInvoicing: true,
    createAccount: vi.fn(),
    isCreatingAccount: false,
    openDashboard: vi.fn(),
    isOpeningDashboard: false,
  }),
}));

describe("InvoiceForm", () => {
  beforeEach(() => {
    createInvoiceMock.mockReset();
    navigateMock.mockReset();
    vi.spyOn(globalThis, "alert").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const renderForm = (path = "/invoices/new?customer=cust-1") => {
    const queryClient = new QueryClient();
    return render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[path]}>
          <InvoiceForm />
        </MemoryRouter>
      </QueryClientProvider>
    );
  };

  it("blocks submission when all line items are empty", async () => {
    renderForm();

    const submit = screen.getByRole("button", { name: /create invoice/i });
    fireEvent.click(submit);

    expect(globalThis.alert).toHaveBeenCalled();
    expect(createInvoiceMock).not.toHaveBeenCalled();
  });

  it("converts amounts to cents and forwards pass-through fee flag", async () => {
    renderForm();

    // Fill out the first line item
    fireEvent.change(screen.getByPlaceholderText("Description"), { target: { value: "Service fee" } });
    fireEvent.change(screen.getByPlaceholderText("Qty"), { target: { value: "2" } });
    fireEvent.change(screen.getByPlaceholderText("Price"), { target: { value: "12.34" } });

    // Enable pass-through processing fee
    fireEvent.click(screen.getByRole("checkbox", { name: /add processing fee/i }));

    fireEvent.click(screen.getByRole("button", { name: /create invoice/i }));

    expect(createInvoiceMock).toHaveBeenCalledTimes(1);
    const payload = createInvoiceMock.mock.calls[0][0];
    expect(payload).toMatchObject({
      customerId: "cust-1",
      passFeesToCustomer: true,
    });
    expect(payload.lineItems[0]).toMatchObject({
      description: "Service fee",
      unit_amount: 1234,
    });
  });
});
