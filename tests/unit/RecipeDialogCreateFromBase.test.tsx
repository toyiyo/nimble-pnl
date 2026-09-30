import React from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { RecipeDialog } from "@/components/RecipeDialog";

// vi.hoisted so the mock ref exists before the mock factory below runs
// (vitest hoists vi.mock calls to the top of the module).
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

vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({ products: [] }),
}));

vi.mock("@/hooks/usePOSItems", () => ({
  usePOSItems: () => ({ posItems: [], loading: false }),
}));

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return {
    ...actual,
    useNavigate: () => vi.fn(),
  };
});

describe("RecipeDialog create-from-base", () => {
  beforeEach(() => {
    createRecipeMock.mockClear();
  });

  it("maps yield_pct_override onto the create payload on submit", async () => {
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

    const submit = screen.getByRole("button", { name: /create recipe/i });
    expect(submit).not.toBeDisabled();
    fireEvent.click(submit);

    await waitFor(() => expect(createRecipeMock).toHaveBeenCalledTimes(1));

    const payload = createRecipeMock.mock.calls[0][0];
    expect(payload.ingredients).toEqual([
      { product_id: "prod-1", quantity: 2, unit: "oz", notes: "", yield_pct_override: 85 },
    ]);
  });

  it("shows base banner and blocks submit when name matches base", () => {
    render(
      <RecipeDialog
        isOpen={true}
        onClose={vi.fn()}
        restaurantId="rest-1"
        basedOn={{ id: "recipe-1", name: "Carne Guisada" }}
        prefill={{ name: "Carne Guisada", serving_size: 2 }}
      />
    );

    expect(screen.getByText(/based on carne guisada/i)).toBeInTheDocument();

    const submit = screen.getByRole("button", { name: /create recipe/i });
    expect(submit).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/recipe name/i), { target: { value: "Carne Guisada Verde" } });

    expect(submit).not.toBeDisabled();
  });
});
