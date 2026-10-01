import React from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { RecipeDialog } from "@/components/RecipeDialog";

// QA bug QA-01: the Zod schema had no range bound on yield_pct_override, so
// the design's field-level error message never rendered. The browser's
// native <input min/max> blocked the click with no visible feedback. This
// test locks in the fix: Zod rejects the value and shows an error.
const createRecipeMock = vi.hoisted(() => vi.fn());

vi.mock("@/hooks/useRecipes", () => ({
  useRecipes: () => ({
    createRecipe: createRecipeMock,
    updateRecipe: vi.fn(),
    updateRecipeIngredients: vi.fn(),
    fetchRecipeIngredients: vi.fn(),
    calculateRecipeCost: vi.fn(),
  }),
}));
vi.mock("@/hooks/useProducts", () => ({ useProducts: () => ({ products: [] }) }));
vi.mock("@/hooks/useRecipeWeeklyVolume", () => ({
  useRecipeWeeklyVolume: () => ({ weeklyVolume: 0, isLoading: false, isError: false }),
}));
vi.mock("@/hooks/usePOSItems", () => ({ usePOSItems: () => ({ posItems: [], loading: false }) }));
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return { ...actual, useNavigate: () => vi.fn() };
});

describe("RecipeDialog yield override range validation (QA-01)", () => {
  beforeEach(() => {
    createRecipeMock.mockClear();
  });

  it("rejects a yield_pct_override below 50 with a visible error and does not submit", async () => {
    render(
      <RecipeDialog
        isOpen={true}
        onClose={vi.fn()}
        restaurantId="rest-1"
        prefill={{
          name: "Carne Guisada Verde",
          serving_size: 2,
          ingredients: [
            { product_id: "prod-1", quantity: 2, unit: "oz", notes: "", yield_pct_override: 30 },
          ],
        }}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /create recipe/i }));

    await waitFor(() => expect(screen.getByText(/yield must be 50% or more/i)).toBeInTheDocument());
    expect(createRecipeMock).not.toHaveBeenCalled();
  });

  it("still accepts an in-range override (85)", async () => {
    render(
      <RecipeDialog
        isOpen={true}
        onClose={vi.fn()}
        restaurantId="rest-1"
        prefill={{
          name: "Carne Guisada Verde",
          serving_size: 2,
          ingredients: [
            { product_id: "prod-1", quantity: 2, unit: "oz", notes: "", yield_pct_override: 85 },
          ],
        }}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /create recipe/i }));
    await waitFor(() => expect(createRecipeMock).toHaveBeenCalledTimes(1));
  });
});
