// Task 15: POSSales reads the date search params.
//
// `parseDateRangeFromSearchParams` is the pure validator extracted from the
// component's useEffect (shape /^\d{4}-\d{2}-\d{2}$/, a real-date round-trip,
// and startDate <= endDate) — tested directly here.
//
// The page-level behavior (seeds on mount; re-applies on an already-mounted
// page when params change; falls back to the 30-day default when params are
// absent or invalid) is tested by mounting the real page, matching the
// full-render precedent for this exact page in
// tests/unit/Inventory.cameraRewire.test.tsx / tests/unit/RecipesCreateFromBase.test.tsx.
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { subDays, format as formatDateFn } from "date-fns";

// ─── react-router-dom: controllable searchParams ──────────────────────────
// `vi.hoisted` so the ref exists before the mock factory (which vitest
// hoists above imports) closes over it. Tests mutate `searchParamsRef.current`
// to a *new* URLSearchParams instance before mount/rerender — a fresh
// reference is exactly what triggers the component's `useEffect` (keyed on
// `[searchParams]`) to re-run, mirroring a real react-router navigation.
const searchParamsRef = vi.hoisted(() => ({ current: new URLSearchParams() }));

vi.mock("react-router-dom", () => ({
  useNavigate: () => vi.fn(),
  useSearchParams: () => [searchParamsRef.current, vi.fn()],
}));

// ─── Hook mocks — restaurant selected, everything else empty/idle ─────────
vi.mock("@/contexts/RestaurantContext", () => ({
  useRestaurantContext: () => ({
    selectedRestaurant: {
      restaurant_id: "rest-1",
      role: "owner",
      restaurant: { name: "Test Restaurant", timezone: "UTC" },
    },
    setSelectedRestaurant: vi.fn(),
    restaurants: [],
    loading: false,
    createRestaurant: vi.fn(),
    canCreateRestaurant: false,
  }),
}));

vi.mock("@/hooks/usePOSIntegrations", () => ({
  usePOSIntegrations: () => ({
    hasAnyConnectedSystem: () => false,
    syncAllSystems: vi.fn(),
    isSyncing: false,
    integrationStatuses: [],
  }),
}));

vi.mock("@/hooks/useInventoryDeduction", () => ({
  useInventoryDeduction: () => ({ simulateDeduction: vi.fn() }),
}));

vi.mock("@/hooks/useRecipes", () => ({
  useRecipes: () => ({ recipes: [] }),
}));

vi.mock("@/hooks/useUnifiedSales", () => ({
  useUnifiedSales: () => ({
    sales: [],
    loading: false,
    loadingMore: false,
    reachedCap: false,
    loadAllRemaining: vi.fn(),
    deleteManualSale: vi.fn(),
  }),
  MAX_AUTO_ROWS: 20000,
}));

vi.mock("@/hooks/useUnifiedSalesGrouped", () => ({
  useUnifiedSalesGrouped: () => ({ groups: [], isLoading: false, error: null }),
}));

const EMPTY_TOTALS = {
  totalCount: 0,
  revenue: 0,
  discounts: 0,
  voids: 0,
  passThroughAmount: 0,
  uniqueItems: 0,
  collectedAtPOS: 0,
  uncategorizedCount: 0,
  pendingReviewCount: 0,
};

vi.mock("@/hooks/useUnifiedSalesTotals", () => ({
  useUnifiedSalesTotals: () => ({ totals: EMPTY_TOTALS, isLoading: false, error: null, refetch: vi.fn() }),
}));

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

vi.mock("@/hooks/useCategorizePosSales", () => ({
  useCategorizePosSales: () => ({ mutate: vi.fn(), isPending: false, error: null, reset: vi.fn() }),
}));

vi.mock("@/hooks/useCategorizePosSale", () => ({
  useCategorizePosSale: () => ({ mutate: vi.fn() }),
}));

vi.mock("@/hooks/useSplitPosSale", () => ({
  useSplitPosSale: () => ({ mutate: vi.fn() }),
}));

vi.mock("@/hooks/useChartOfAccounts", () => ({
  useChartOfAccounts: () => ({ accounts: [] }),
}));

vi.mock("@/hooks/useBulkSelection", () => ({
  useBulkSelection: () => ({
    isSelectionMode: false,
    selectedIds: new Set(),
    selectedCount: 0,
    hasSelection: false,
    toggleSelectionMode: vi.fn(),
    enterSelectionMode: vi.fn(),
    exitSelectionMode: vi.fn(),
    toggleItem: vi.fn(),
    selectItem: vi.fn(),
    deselectItem: vi.fn(),
    selectAll: vi.fn(),
    selectRange: vi.fn(),
    clearSelection: vi.fn(),
    isSelected: () => false,
    getSelectedItems: () => [],
  }),
}));

vi.mock("@/hooks/useBulkPosSaleActions", () => ({
  useBulkCategorizePosSales: () => ({ mutate: vi.fn(), isPending: false }),
}));

// ─── Heavy/peripheral components — always mounted by the page, stubbed out ─
vi.mock("@/components/POSSalesDashboard", () => ({ POSSalesDashboard: () => null }));
vi.mock("@/components/pos-sales/SalesTrendsPanel", () => ({ SalesTrendsPanel: () => null }));
vi.mock("@/components/financial-statements/shared/ExportDropdown", () => ({ ExportDropdown: () => null }));
vi.mock("@/components/POSSaleDialog", () => ({ POSSaleDialog: () => null }));
vi.mock("@/components/pos-sales/SplitPosSaleDialog", () => ({ SplitPosSaleDialog: () => null }));
vi.mock("@/components/banking/EnhancedCategoryRulesDialog", () => ({ EnhancedCategoryRulesDialog: () => null }));
vi.mock("@/components/pos-sales/BulkCategorizePosSalesPanel", () => ({ BulkCategorizePosSalesPanel: () => null }));

import POSSales, { parseDateRangeFromSearchParams } from "@/pages/POSSales";

// ─── Pure validator ─────────────────────────────────────────────────────────
describe("parseDateRangeFromSearchParams", () => {
  it("accepts a valid startDate/endDate pair", () => {
    const params = new URLSearchParams("startDate=2026-07-01&endDate=2026-07-10");
    expect(parseDateRangeFromSearchParams(params)).toEqual({
      startDate: "2026-07-01",
      endDate: "2026-07-10",
    });
  });

  it("accepts an equal pair (single day)", () => {
    const params = new URLSearchParams("startDate=2026-07-10&endDate=2026-07-10");
    expect(parseDateRangeFromSearchParams(params)).toEqual({
      startDate: "2026-07-10",
      endDate: "2026-07-10",
    });
  });

  it("rejects malformed shape ('potato')", () => {
    const params = new URLSearchParams("startDate=potato&endDate=2026-07-10");
    expect(parseDateRangeFromSearchParams(params)).toBeNull();
  });

  it("rejects an impossible calendar date (2026-02-31) via round-trip", () => {
    const params = new URLSearchParams("startDate=2026-02-31&endDate=2026-03-05");
    expect(parseDateRangeFromSearchParams(params)).toBeNull();
  });

  it("rejects an inverted range", () => {
    const params = new URLSearchParams("startDate=2026-07-10&endDate=2026-07-01");
    expect(parseDateRangeFromSearchParams(params)).toBeNull();
  });

  it("returns null when either param is missing", () => {
    expect(parseDateRangeFromSearchParams(new URLSearchParams("startDate=2026-07-01"))).toBeNull();
    expect(parseDateRangeFromSearchParams(new URLSearchParams("endDate=2026-07-01"))).toBeNull();
    expect(parseDateRangeFromSearchParams(new URLSearchParams())).toBeNull();
  });
});

// ─── Page-level wiring ──────────────────────────────────────────────────────
function defaultDates() {
  const today = new Date();
  return {
    startDate: formatDateFn(subDays(today, 30), "yyyy-MM-dd"),
    endDate: formatDateFn(today, "yyyy-MM-dd"),
  };
}

describe("POSSales — seeds dates from URL search params", () => {
  beforeEach(() => {
    searchParamsRef.current = new URLSearchParams();
  });

  it("defaults to the last 30 days when no params are present", () => {
    render(<POSSales />);
    const { startDate, endDate } = defaultDates();
    expect(screen.getByLabelText("Start date")).toHaveValue(startDate);
    expect(screen.getByLabelText("End date")).toHaveValue(endDate);
  });

  it("seeds the date inputs from valid search params on mount", () => {
    searchParamsRef.current = new URLSearchParams("startDate=2026-06-01&endDate=2026-06-15");
    render(<POSSales />);
    expect(screen.getByLabelText("Start date")).toHaveValue("2026-06-01");
    expect(screen.getByLabelText("End date")).toHaveValue("2026-06-15");
  });

  it("re-applies when search params change on an already-mounted page (not just a fresh mount)", () => {
    searchParamsRef.current = new URLSearchParams("startDate=2026-06-01&endDate=2026-06-15");
    const { rerender } = render(<POSSales />);
    expect(screen.getByLabelText("Start date")).toHaveValue("2026-06-01");

    searchParamsRef.current = new URLSearchParams("startDate=2026-08-01&endDate=2026-08-20");
    rerender(<POSSales />);

    expect(screen.getByLabelText("Start date")).toHaveValue("2026-08-01");
    expect(screen.getByLabelText("End date")).toHaveValue("2026-08-20");
  });

  it("ignores a malformed param and falls back to the default range", () => {
    searchParamsRef.current = new URLSearchParams("startDate=potato&endDate=2026-07-10");
    render(<POSSales />);
    const { startDate, endDate } = defaultDates();
    expect(screen.getByLabelText("Start date")).toHaveValue(startDate);
    expect(screen.getByLabelText("End date")).toHaveValue(endDate);
  });

  it("ignores an inverted range and falls back to the default range", () => {
    searchParamsRef.current = new URLSearchParams("startDate=2026-07-10&endDate=2026-07-01");
    render(<POSSales />);
    const { startDate, endDate } = defaultDates();
    expect(screen.getByLabelText("Start date")).toHaveValue(startDate);
    expect(screen.getByLabelText("End date")).toHaveValue(endDate);
  });
});
