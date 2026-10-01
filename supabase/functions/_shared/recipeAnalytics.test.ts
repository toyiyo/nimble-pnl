// Deno test for the recipe deduction calculation.
//
// See docs/superpowers/specs/2026-09-30-recipe-yield-waste-design.md, section 7.
import { assertEquals, assertAlmostEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { calculateDeduction, buildRecipeDeductions } from "./recipeAnalytics.ts";

Deno.test("calculateDeduction applies the 90% yield to portion, loaded, and waste cost", () => {
  const result = calculateDeduction([
    {
      product_name: "Chicken Breast",
      quantity: 1,
      unit: "lb",
      purchase_unit: "lb",
      size_value: null,
      size_unit: null,
      cost_per_unit: 10,
      yield_pct: 90,
      yield_source: "product",
    },
  ]);

  assertAlmostEquals(result.portion_cost, 10, 0.0001);
  assertAlmostEquals(result.loaded_cost, 11.1111, 0.0001);
  assertAlmostEquals(result.waste_cost, 1.1111, 0.0001);
});

Deno.test("calculateDeduction returns one ingredients[] entry per input line", () => {
  const result = calculateDeduction([
    {
      product_name: "Chicken Breast",
      quantity: 1,
      unit: "lb",
      purchase_unit: "lb",
      size_value: null,
      size_unit: null,
      cost_per_unit: 10,
      yield_pct: 90,
      yield_source: "product",
    },
  ]);

  assertEquals(result.ingredients.length, 1);
  const line = result.ingredients[0];
  assertEquals(line.product_name, "Chicken Breast");
  assertEquals(line.quantity, 1);
  assertEquals(line.unit, "lb");
  assertEquals(line.yield_pct, 90);
  assertEquals(line.yield_source, "product");
  assertAlmostEquals(line.portion_cost, 10, 0.0001);
  assertAlmostEquals(line.loaded_cost, 11.1111, 0.0001);
});

Deno.test("calculateDeduction sums cost across several ingredient lines", () => {
  const result = calculateDeduction([
    {
      product_name: "Chicken Breast",
      quantity: 1,
      unit: "lb",
      purchase_unit: "lb",
      size_value: null,
      size_unit: null,
      cost_per_unit: 10,
      yield_pct: 90,
      yield_source: "product",
    },
    {
      product_name: "Sea Salt",
      quantity: 1,
      unit: "oz",
      purchase_unit: "oz",
      size_value: null,
      size_unit: null,
      cost_per_unit: 1,
      yield_pct: 100,
      yield_source: "product",
    },
  ]);

  assertEquals(result.ingredients.length, 2);
  assertAlmostEquals(result.portion_cost, 11, 0.0001);
  assertAlmostEquals(result.loaded_cost, 12.1111, 0.0001);
  assertAlmostEquals(result.waste_cost, 1.1111, 0.0001);
});

Deno.test("calculateDeduction has zero waste cost at 100% yield", () => {
  const result = calculateDeduction([
    {
      product_name: "Sea Salt",
      quantity: 2,
      unit: "oz",
      purchase_unit: "oz",
      size_value: null,
      size_unit: null,
      cost_per_unit: 1,
      yield_pct: 100,
      yield_source: "product",
    },
  ]);

  assertAlmostEquals(result.loaded_cost, result.portion_cost, 0.0001);
  assertAlmostEquals(result.waste_cost, 0, 0.0001);
});

Deno.test("buildRecipeDeductions groups ingredient rows by recipe_id and resolves yield", () => {
  const result = buildRecipeDeductions([
    {
      recipe_id: "recipe-1",
      product_name: "Chicken Breast",
      quantity: 1,
      unit: "lb",
      purchase_unit: "lb",
      size_value: null,
      size_unit: null,
      cost_per_unit: 10,
      product_yield_pct: 90,
      yield_pct_override: null,
    },
    {
      recipe_id: "recipe-2",
      product_name: "Sea Salt",
      quantity: 2,
      unit: "oz",
      purchase_unit: "oz",
      size_value: null,
      size_unit: null,
      cost_per_unit: 1,
      product_yield_pct: 100,
      yield_pct_override: null,
    },
  ]);

  assertEquals(result.size, 2);
  const recipe1 = result.get("recipe-1")!;
  assertAlmostEquals(recipe1.portion_cost, 10, 0.0001);
  assertAlmostEquals(recipe1.loaded_cost, 11.1111, 0.0001);
  assertAlmostEquals(recipe1.waste_cost, 1.1111, 0.0001);
  assertEquals(recipe1.ingredients[0].yield_source, "product");

  const recipe2 = result.get("recipe-2")!;
  assertAlmostEquals(recipe2.waste_cost, 0, 0.0001);
});

Deno.test("buildRecipeDeductions prefers the line override over the product yield", () => {
  const result = buildRecipeDeductions([
    {
      recipe_id: "recipe-1",
      product_name: "Chicken Breast",
      quantity: 1,
      unit: "lb",
      purchase_unit: "lb",
      size_value: null,
      size_unit: null,
      cost_per_unit: 10,
      product_yield_pct: 90,
      yield_pct_override: 80,
    },
  ]);

  const recipe1 = result.get("recipe-1")!;
  assertEquals(recipe1.ingredients[0].yield_pct, 80);
  assertEquals(recipe1.ingredients[0].yield_source, "override");
});

Deno.test("buildRecipeDeductions defaults to 100% yield and clamps out-of-range values", () => {
  const result = buildRecipeDeductions([
    {
      recipe_id: "recipe-1",
      product_name: "Flour",
      quantity: 1,
      unit: "lb",
      purchase_unit: "lb",
      size_value: null,
      size_unit: null,
      cost_per_unit: 1,
      product_yield_pct: null,
      yield_pct_override: null,
    },
    {
      recipe_id: "recipe-2",
      product_name: "Cream",
      quantity: 1,
      unit: "lb",
      purchase_unit: "lb",
      size_value: null,
      size_unit: null,
      cost_per_unit: 1,
      product_yield_pct: 10,
      yield_pct_override: null,
    },
  ]);

  assertEquals(result.get("recipe-1")!.ingredients[0].yield_pct, 100);
  assertEquals(result.get("recipe-2")!.ingredients[0].yield_pct, 50);
});
