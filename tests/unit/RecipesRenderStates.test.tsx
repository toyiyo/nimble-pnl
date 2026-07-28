import React from "react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const retryMock = vi.fn();

/** Mutable so each test can drive the hook's return without re-mocking. */
const recipesState = {
  recipes: [] as unknown[],
  loading: false,
  isError: false,
};

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: "user-1" } }) }));
vi.mock("@/contexts/RestaurantContext", () => ({
  useRestaurantContext: () => ({
    selectedRestaurant: { restaurant_id: "rest-1", restaurant: { name: "Test" } },
    setSelectedRestaurant: vi.fn(),
    restaurants: [],
    loading: false,
    createRestaurant: vi.fn(),
    canCreateRestaurant: true,
  }),
}));
vi.mock("@/hooks/useRecipes", () => ({
  useRecipes: () => ({
    recipes: recipesState.recipes,
    loading: recipesState.loading,
    isError: recipesState.isError,
    fetchRecipes: retryMock,
    fetchRecipeIngredients: vi.fn().mockResolvedValue([]),
  }),
}));
vi.mock("@/hooks/useProducts", () => ({ useProducts: () => ({ products: [] }) }));
vi.mock("@/hooks/useUnmappedSaleItems", () => ({ useUnmappedSaleItems: () => ({ unmappedItems: [] }) }));
vi.mock("@/hooks/useAutomaticInventoryDeduction", () => ({
  useAutomaticInventoryDeduction: () => ({ setupAutoDeduction: vi.fn() }),
}));
vi.mock("@/hooks/useBulkInventoryDeduction", () => ({
  useBulkInventoryDeduction: () => ({ loading: false, bulkProcessHistoricalSales: vi.fn() }),
}));

import Recipes from "@/pages/Recipes";

const makeRecipe = (id: string, name: string) => ({
  id,
  restaurant_id: "rest-1",
  name,
  serving_size: 1,
  estimated_cost: 0,
  is_active: true,
  created_at: "2024-01-01T00:00:00Z",
  updated_at: "2024-01-01T00:00:00Z",
  ingredients: [],
});

/** jsdom has no matchMedia; `useIsMobile` needs one to decide the viewport. */
const setViewport = (width: number) => {
  window.innerWidth = width;
  window.matchMedia = ((query: string) => ({
    matches: width < 768,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;
};

const originalMatchMedia = window.matchMedia;
const originalInnerWidth = window.innerWidth;

/**
 * The list is virtualized, and jsdom runs no layout: without a measurable
 * scroll container and row height the virtual window is empty and no recipe
 * renders at all. Stub both paths @tanstack/react-virtual measures with.
 */
let offsetHeightSpy: ReturnType<typeof vi.spyOn>;
let rectSpy: ReturnType<typeof vi.spyOn>;

const stubLayout = () => {
  offsetHeightSpy = vi
    .spyOn(HTMLElement.prototype, "offsetHeight", "get")
    .mockReturnValue(800);
  rectSpy = vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
    height: 72,
    width: 1280,
    top: 0,
    left: 0,
    right: 1280,
    bottom: 72,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect);
};

const renderPage = () =>
  render(
    <MemoryRouter>
      <Recipes />
    </MemoryRouter>
  );

beforeEach(() => {
  vi.clearAllMocks();
  recipesState.recipes = [];
  recipesState.loading = false;
  recipesState.isError = false;
  setViewport(1280);
  stubLayout();
});

afterEach(() => {
  offsetHeightSpy.mockRestore();
  rectSpy.mockRestore();
  window.matchMedia = originalMatchMedia;
  window.innerWidth = originalInnerWidth;
});

describe("Recipes error state", () => {
  it("CRITICAL: a failed load reads as an outage, not as an empty menu", () => {
    recipesState.isError = true;
    renderPage();

    expect(screen.getAllByRole("alert").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/couldn't load recipes/i).length).toBeGreaterThan(0);
    // The empty state invites creating a first recipe -- exactly the wrong
    // prompt during an outage, since the recipes still exist.
    expect(screen.queryByText(/create your first recipe/i)).not.toBeInTheDocument();
  });

  it("offers a retry that refetches", () => {
    recipesState.isError = true;
    renderPage();

    fireEvent.click(screen.getAllByRole("button", { name: /retry loading recipes/i })[0]);

    expect(retryMock).toHaveBeenCalled();
  });

  it("shows the empty state, not the error state, when the load simply found nothing", () => {
    renderPage();

    expect(screen.queryByText(/couldn't load recipes/i)).not.toBeInTheDocument();
    expect(screen.getAllByText(/no recipes found/i).length).toBeGreaterThan(0);
  });
});

describe("Recipes viewport rendering", () => {
  it("renders the desktop table only, not both variants, on a wide viewport", () => {
    recipesState.recipes = [makeRecipe("r1", "Carne Guisada")];
    renderPage();

    // One row per tab (all / mapped / unmapped), not two per tab: the mobile
    // card variant used to mount alongside the table and be hidden with CSS.
    expect(screen.getAllByText("Carne Guisada")).toHaveLength(1);
    expect(screen.getAllByRole("table").length).toBeGreaterThan(0);
  });

  it("renders the mobile cards only, not the table, on a narrow viewport", () => {
    setViewport(500);
    recipesState.recipes = [makeRecipe("r1", "Carne Guisada")];
    renderPage();

    expect(screen.getAllByText("Carne Guisada")).toHaveLength(1);
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
});
