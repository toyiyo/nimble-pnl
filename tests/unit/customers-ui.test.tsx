import React from "react";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import Customers from "@/pages/Customers";

let mockCustomers: any[] = [];
const usePaymentSetupMock = vi.fn(() => ({ state: "not_started", isSheetOpen: false }));

vi.mock("@/contexts/RestaurantContext", () => ({
  useRestaurantContext: () => ({
    selectedRestaurant: { restaurant_id: "rest-1", role: "owner" },
  }),
}));

vi.mock("@/hooks/useCustomers", () => ({
  useCustomers: () => ({ customers: mockCustomers, loading: false, deleteCustomer: vi.fn() }),
}));

vi.mock("@/hooks/usePaymentSetup", () => ({
  usePaymentSetup: (...args: unknown[]) => usePaymentSetupMock(...(args as [])),
}));

vi.mock("@/components/invoicing/PaymentSetupCard", () => ({
  PaymentSetupCard: ({ canManage, hideWhenReady }: { canManage: boolean; hideWhenReady?: boolean }) => (
    <div data-testid="setup-card" data-can-manage={String(canManage)} data-hide={String(!!hideWhenReady)} />
  ),
}));

vi.mock("@/components/invoicing/PaymentSetupSheet", () => ({
  PaymentSetupSheet: () => <div data-testid="setup-sheet" />,
}));

vi.mock("@/components/invoicing/CustomerFormDialog", () => ({
  CustomerFormDialog: () => null,
}));

const renderPage = () => render(<MemoryRouter><Customers /></MemoryRouter>);

describe("Customers page payment setup", () => {
  beforeEach(() => {
    usePaymentSetupMock.mockClear();
  });

  it("shows the setup card with hideWhenReady when the list is empty", () => {
    mockCustomers = [];
    renderPage();
    const card = screen.getByTestId("setup-card");
    expect(card.getAttribute("data-hide")).toBe("true");
    expect(card.getAttribute("data-can-manage")).toBe("true");
  });

  it("shows one card and one sheet when customers exist", () => {
    mockCustomers = [{ id: "c1", name: "Acme", email: null, phone: null }];
    renderPage();
    expect(screen.getAllByTestId("setup-card")).toHaveLength(1);
    expect(screen.getAllByTestId("setup-sheet")).toHaveLength(1);
    expect(usePaymentSetupMock).toHaveBeenCalledWith("rest-1");
  });
});
