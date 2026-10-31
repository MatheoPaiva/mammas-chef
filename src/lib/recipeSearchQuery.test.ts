import { describe, expect, it } from "vitest";
import { parseRecipeSearchQuery, recipeMatchesSearch } from "./recipeSearchQuery";
import type { MealRecipe } from "@/types/mealPlan";

describe("parseRecipeSearchQuery", () => {
  it("keeps plain search text and extracts structured recipe filters", () => {
    const parsed = parseRecipeSearchQuery('lemon bowl ingredient:chickpea avoid:shrimp cuisine:Greek tag:lemony diet:vegetarian flavor:herby under:30 meal:lunch');

    expect(parsed).toEqual({
      query: "lemon bowl",
      filters: {
        includeIngredients: ["chickpea"],
        avoidIngredients: ["shrimp"],
        cuisine: "Greek",
        tags: ["lemony"],
        dietTags: ["vegetarian"],
        flavorTags: ["herby"],
        maxTotalTimeMinutes: 30,
        mealType: "lunch",
      },
    });
  });

  it("merges modifiers with base filters from the active meal-type tab", () => {
    const parsed = parseRecipeSearchQuery("include:cucumber,tomato without:shrimp", { mealType: "dinner" });

    expect(parsed.query).toBe("");
    expect(parsed.filters).toEqual({
      mealType: "dinner",
      includeIngredients: ["cucumber", "tomato"],
      avoidIngredients: ["shrimp"],
    });
  });

  it("leaves unknown modifiers as full-text query terms", () => {
    const parsed = parseRecipeSearchQuery("texture:crispy herby");

    expect(parsed.query).toBe("texture:crispy herby");
    expect(parsed.filters).toEqual({});
  });

  it("supports quoted multi-word modifiers for practical ingredient search", () => {
    const parsed = parseRecipeSearchQuery('"lemon bowl" ingredient:"bell pepper" avoid:"pine nuts" cuisine:"Greek-inspired"');

    expect(parsed.query).toBe("lemon bowl");
    expect(parsed.filters).toEqual({
      includeIngredients: ["bell pepper"],
      avoidIngredients: ["pine nuts"],
      cuisine: "Greek-inspired",
    });
  });
});

const fallbackRecipe: MealRecipe = {
  id: "fallback-1",
  title: "Lemony Chickpea Bowl",
  mealType: "lunch",
  prepTime: "25 min",
  servings: 4,
  calories: 430,
  protein: 18,
  carbs: 52,
  fats: 16,
  tags: ["Mediterranean", "vegetarian", "lemony"],
  ingredients: [
    { name: "chickpeas", quantity: 2, unit: "can" },
    { name: "cucumber", quantity: 1, unit: "" },
  ],
  steps: ["Warm chickpeas."],
};

describe("recipeMatchesSearch", () => {
  it("applies structured search constraints to local fallback recipes", () => {
    const parsed = parseRecipeSearchQuery("bowl include:chickpea avoid:shrimp tag:lemony diet:vegetarian under:30 meal:lunch");

    expect(recipeMatchesSearch(fallbackRecipe, parsed.filters, parsed.query)).toBe(true);
  });

  it("rejects local recipes that violate avoid or time constraints", () => {
    expect(recipeMatchesSearch(fallbackRecipe, { avoidIngredients: ["chickpea"] })).toBe(false);
    expect(recipeMatchesSearch(fallbackRecipe, { maxTotalTimeMinutes: 15 })).toBe(false);
  });

  it("uses total time, not active time, for fallback under/max filters", () => {
    const activeAndTotalRecipe = {
      ...fallbackRecipe,
      prepTime: "20 min active / 40 min total",
    };

    expect(recipeMatchesSearch(activeAndTotalRecipe, { maxTotalTimeMinutes: 30 })).toBe(false);
    expect(recipeMatchesSearch(activeAndTotalRecipe, { maxTotalTimeMinutes: 45 })).toBe(true);
  });

  it("falls back to the largest visible duration when total time is not labeled", () => {
    const unlabeledRangeRecipe = {
      ...fallbackRecipe,
      prepTime: "15 min prep / 35 min cook",
    };

    expect(recipeMatchesSearch(unlabeledRangeRecipe, { maxTotalTimeMinutes: 30 })).toBe(false);
  });

  it("matches local fallback search terms across title, tags, and ingredients instead of requiring one exact phrase", () => {
    expect(recipeMatchesSearch(fallbackRecipe, {}, "lemony vegetarian cucumber")).toBe(true);
    expect(recipeMatchesSearch(fallbackRecipe, {}, "lemony shrimp")).toBe(false);
  });
});
