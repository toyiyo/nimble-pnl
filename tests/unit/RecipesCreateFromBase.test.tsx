import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import Recipes from "@/pages/Recipes";

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
    recipes: [
      {
        id: "recipe-1",
        restaurant_id: "rest-1",
        name: "Carne Guisada",
        serving_size: 1,
        estimated_cost: 0,
        is_active: true,
        created_at: "2024-01-01T00:00:00Z",
        updated_at: "2024-01-01T00:00:00Z",
        ingredients: [],
      },
    ],
    loading: false,
    fetchRecipes: vi.fn(),
    fetchRecipeIngredients: vi.fn().mockResolvedValue([]),
  }),
}));
vi.mock("@/hooks/useProducts", () => ({ useProducts: () => ({ products: [] }) }));
vi.mock("@/hooks/useUnifiedSales", () => ({ useUnifiedSales: () => ({ unmappedItems: [] }) }));
vi.mock("@/hooks/useAutomaticInventoryDeduction", () => ({ useAutomaticInventoryDeduction: () => ({ setupAutoDeduction: vi.fn() }) }));

vi.mock("@/components/RecipeCreateFromExistingDialog", () => ({
  RecipeCreateFromExistingDialog: ({ isOpen }: { isOpen: boolean }) =>
    isOpen ? <div data-testid="from-existing-dialog" /> : null,
}));

describe("Recipes create-from-base", () => {
  it("opens create-from-existing dialog from split menu", async () => {
    render(
      <MemoryRouter>
        <Recipes />
      </MemoryRouter>
    );

    const trigger = screen.getByRole("button", { name: /recipe create options/i });
    fireEvent.keyDown(trigger, { key: "Enter" });

    const menuItem = await screen.findByRole("menuitem", { name: /from existing recipe/i });
    fireEvent.click(menuItem);

    expect(screen.getByTestId("from-existing-dialog")).toBeInTheDocument();
  });
});
