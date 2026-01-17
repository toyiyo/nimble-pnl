import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { RecipeDialog } from "@/components/RecipeDialog";

vi.mock("@/hooks/useRecipes", () => ({
  useRecipes: () => ({
    createRecipe: vi.fn(),
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
