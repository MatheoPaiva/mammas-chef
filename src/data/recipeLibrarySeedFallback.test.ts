import { describe, expect, it } from "vitest";

import { recipeMatchesSearch } from "@/lib/recipeSearchQuery";
import { recipeLibrarySeedFallbackRecipes } from "./recipeLibrarySeedFallback";

describe("recipeLibrarySeedFallbackRecipes", () => {
  it("mirrors the reviewed fixture catalog for offline browse/pin flows", () => {
    // 34 source recipes → 52 mealType variants after WR-03 fix (17 multi-mealType recipes expand to 2 entries each)
    expect(recipeLibrarySeedFallbackRecipes).toHaveLength(52);
    expect(recipeLibrarySeedFallbackRecipes.every((recipe) => recipe.ingredients.length > 0)).toBe(true);
    expect(recipeLibrarySeedFallbackRecipes.every((recipe) => recipe.steps.length > 0)).toBe(true);
  });

  it("preserves structured metadata used by fallback search filters", () => {
    const chickpeaLunches = recipeLibrarySeedFallbackRecipes.filter((recipe) =>
      recipeMatchesSearch(recipe, { mealType: "lunch", includeIngredients: ["chickpea"] })
    );

    expect(chickpeaLunches.map((recipe) => recipe.title)).toContain("Chickpea Greek Salad Lunch Boxes");
  });
});
