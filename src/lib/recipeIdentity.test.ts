import { describe, expect, it } from "vitest";
import { recipeIdentityKey, recipeTitleKey } from "./recipeIdentity";

const baseRecipe = {
  id: "generated-row-1",
  title: " Lemony   Chickpea Bowls ",
  mealType: "lunch" as const,
  prepTime: "25 min",
  servings: 4,
  calories: 430,
  protein: 18,
  carbs: 52,
  fats: 16,
  tags: [],
  ingredients: [],
  steps: [],
};

describe("recipeIdentityKey", () => {
  it("prefers canonical library ids over mutable snapshot ids", () => {
    expect(recipeIdentityKey({ ...baseRecipe, libraryRecipeId: " canonical-1 " })).toBe("library:canonical-1");
  });

  it("uses custom recipe ids separately from library and generated recipes", () => {
    expect(recipeIdentityKey({ ...baseRecipe, customRecipeId: " custom-1 " })).toBe("custom:custom-1");
    expect(recipeIdentityKey({ ...baseRecipe, libraryRecipeId: "canonical-1", customRecipeId: "custom-1" })).toBe("library:canonical-1");
  });

  it("falls back to recipe id, then normalized title", () => {
    expect(recipeIdentityKey(baseRecipe)).toBe("recipe:generated-row-1");
    expect(recipeIdentityKey({ ...baseRecipe, id: "" })).toBe("title:lemony chickpea bowls");
  });
});

describe("recipeTitleKey", () => {
  it("normalizes recipe titles for duplicate suppression", () => {
    expect(recipeTitleKey(baseRecipe)).toBe("lemony chickpea bowls");
  });
});
