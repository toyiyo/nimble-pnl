import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { RecipeCreateFromExistingDialog } from "@/components/RecipeCreateFromExistingDialog";

const recipes = [
  {
    id: "recipe-1",
    restaurant_id: "rest-1",
    name: "Carne Guisada",
    description: "Slow-braised beef",
    pos_item_name: "Carne Guisada Plate",
    pos_item_id: "pos-123",
    serving_size: 2,
    estimated_cost: 4.2,
    is_active: true,
    created_at: "2024-01-01T00:00:00Z",
    updated_at: "2024-01-01T00:00:00Z",
    ingredients: [{ product_id: "prod-1", quantity: 2, unit: "oz" }],
  },
];

const products = [
  { id: "prod-1", name: "Beef", cost_per_unit: 5, uom_purchase: "lb" },
];

describe("RecipeCreateFromExistingDialog", () => {
  it("advances to confirmation and calls onConfirm", async () => {
    const fetchRecipeIngredients = vi.fn().mockResolvedValue([
      {
        id: "ing-1",
        recipe_id: "recipe-1",
        product_id: "prod-1",
        quantity: 2,
        unit: "oz",
        notes: "trimmed",
        created_at: "2024-01-01T00:00:00Z",
        updated_at: "2024-01-01T00:00:00Z",
      },
    ]);
    const onConfirm = vi.fn();

    render(
      <RecipeCreateFromExistingDialog
        isOpen={true}
        onClose={vi.fn()}
        recipes={recipes as any}
        products={products as any}
        fetchRecipeIngredients={fetchRecipeIngredients}
        onConfirm={onConfirm}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /carne guisada/i }));

    await waitFor(() => {
      expect(screen.getByText(/what do you want to reuse/i)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /create from base/i }));

    await waitFor(() => {
      expect(onConfirm).toHaveBeenCalledTimes(1);
    });
  });

  it("defaults to not copying name or pos mapping", async () => {
    const fetchRecipeIngredients = vi.fn().mockResolvedValue([]);

    render(
      <RecipeCreateFromExistingDialog
        isOpen={true}
        onClose={vi.fn()}
        recipes={recipes as any}
        products={products as any}
        fetchRecipeIngredients={fetchRecipeIngredients}
        onConfirm={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /carne guisada/i }));

    expect(await screen.findByLabelText(/copy name/i)).not.toBeChecked();
    expect(screen.getByLabelText(/copy pos mapping/i)).not.toBeChecked();
  });
});
