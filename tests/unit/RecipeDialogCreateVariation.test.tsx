import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { RecipeDialog } from "@/components/RecipeDialog";

vi.mock("@/hooks/useRecipes", () => ({
  useRecipes: () => ({
    createRecipe: vi.fn(),
    updateRecipe: vi.fn(),
    updateRecipeIngredients: vi.fn(),
    fetchRecipeIngredients: vi.fn().mockResolvedValue([]),
    calculateRecipeCost: vi.fn(),
  }),
}));

vi.mock("@/hooks/useProducts", () => ({ useProducts: () => ({ products: [] }) }));
vi.mock("@/hooks/usePOSItems", () => ({ usePOSItems: () => ({ posItems: [], loading: false }) }));
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return { ...actual, useNavigate: () => vi.fn() };
});

describe("RecipeDialog create variation", () => {
  it("calls onCreateFromBase when editing", () => {
    const onCreateFromBase = vi.fn();

    render(
      <RecipeDialog
        isOpen={true}
        onClose={vi.fn()}
        restaurantId="rest-1"
        recipe={{
          id: "recipe-1",
          restaurant_id: "rest-1",
          name: "Carne Guisada",
          serving_size: 1,
          estimated_cost: 0,
          is_active: true,
          created_at: "2024-01-01T00:00:00Z",
          updated_at: "2024-01-01T00:00:00Z",
        } as any}
        onCreateFromBase={onCreateFromBase}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /create variation/i }));

    expect(onCreateFromBase).toHaveBeenCalledTimes(1);
  });
});
