import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { scaleMealToServings } from "./servingScaler.ts";

Deno.test("scaleMealToServings scales numeric and fractional ingredient quantities", () => {
  const meal = scaleMealToServings({
    servings: 4,
    ingredients: [
      { name: "chicken thighs", quantity: 2, unit: "lbs" },
      { name: "cumin", quantity: "1/2", unit: "tsp" },
    ],
  }, 1);

  assertEquals(meal.servings, 1);
  assertEquals(meal.ingredients, [
    { name: "chicken thighs", quantity: 0.5, unit: "lbs" },
    { name: "cumin", quantity: 0.13, unit: "tsp" },
  ]);
});

Deno.test("scaleMealToServings is defensive for schema-invalid AI meals", () => {
  const meal: { servings?: number; ingredients?: Array<{ name: string; quantity: number | string; unit: string }> } = scaleMealToServings({
    servings: 4,
  }, 1);

  assertEquals(meal, {
    servings: 1,
    ingredients: [],
  });
});
