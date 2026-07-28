import React from "react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const recipesState = {
  recipes: [] as unknown[],
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
    loading: false,
    isError: false,
    fetchRecipes: vi.fn(),
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

const RECIPE_COUNT = 133;
const ROW_HEIGHT = 72;
const VIEWPORT_HEIGHT = 800;

/** Names sort lexicographically, so "Recipe 000" is first ascending. */
const makeRecipes = (count: number) =>
  Array.from({ length: count }, (_, i) => ({
    id: `r${String(i).padStart(3, "0")}`,
    restaurant_id: "rest-1",
    name: `Recipe ${String(i).padStart(3, "0")}`,
    serving_size: 1,
    estimated_cost: 1,
    is_active: true,
    created_at: "2024-01-01T00:00:00Z",
    updated_at: "2024-01-01T00:00:00Z",
    ingredients: [],
  }));

/**
 * jsdom runs no layout, so every element measures 0 and the virtualizer would
 * either render nothing (scroll container of size 0) or everything (rows of
 * size 0). Stub both measurement paths @tanstack/react-virtual uses: the scroll
 * element's `offsetHeight` and each row's `getBoundingClientRect().height`.
 */
let offsetHeightSpy: ReturnType<typeof vi.spyOn>;
let rectSpy: ReturnType<typeof vi.spyOn>;

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

const renderPage = () =>
  render(
    <MemoryRouter>
      <Recipes />
    </MemoryRouter>
  );

/** One per rendered recipe in either variant: the name heading. */
const renderedRecipeNames = () =>
  screen
    .queryAllByTestId("recipe-name")
    .map((el) => el.textContent?.trim() ?? "");

beforeEach(() => {
  vi.clearAllMocks();
  recipesState.recipes = makeRecipes(RECIPE_COUNT);
  setViewport(1280);
  offsetHeightSpy = vi
    .spyOn(HTMLElement.prototype, "offsetHeight", "get")
    .mockReturnValue(VIEWPORT_HEIGHT);
  rectSpy = vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
    height: ROW_HEIGHT,
    width: 1280,
    top: 0,
    left: 0,
    right: 1280,
    bottom: ROW_HEIGHT,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect);
});

afterEach(() => {
  offsetHeightSpy.mockRestore();
  rectSpy.mockRestore();
  window.matchMedia = originalMatchMedia;
  window.innerWidth = originalInnerWidth;
});

describe("Recipes list virtualization", () => {
  it("CRITICAL: mounts a viewport-sized window of rows, not all 133", () => {
    renderPage();

    const names = renderedRecipeNames();
    expect(names.length).toBeGreaterThan(0);
    expect(names.length).toBeLessThan(RECIPE_COUNT / 2);
    // The last recipe is far below the fold and must not be mounted.
    expect(screen.queryByText("Recipe 132")).not.toBeInTheDocument();
  });

  it("mounts a window on mobile too, where the card list is even taller per row", () => {
    setViewport(500);
    renderPage();

    const names = renderedRecipeNames();
    expect(names.length).toBeGreaterThan(0);
    expect(names.length).toBeLessThan(RECIPE_COUNT / 2);
  });

  it("shows the first rows in sort order, and follows the sort when it flips", () => {
    renderPage();
    expect(renderedRecipeNames()[0]).toBe("Recipe 000");

    // The sort-direction toggle is the page's Asc/Desc control.
    fireEvent.click(screen.getByRole("button", { name: /sort direction/i }));

    expect(renderedRecipeNames()[0]).toBe("Recipe 132");
    expect(screen.queryByText("Recipe 000")).not.toBeInTheDocument();
  });

  it("row actions still fire from inside the virtualized window", () => {
    setViewport(500);
    renderPage();

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: /edit recipe/i })[0]);

    // The memoized row kept its callback wired to its own recipe, so the edit
    // dialog opens instead of the click landing nowhere.
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});
