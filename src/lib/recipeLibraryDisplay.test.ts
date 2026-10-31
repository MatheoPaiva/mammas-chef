import { describe, expect, it } from "vitest";
import type { MealRecipe } from "@/types/mealPlan";
import { chooseRecipeLibraryDisplay } from "./recipeLibraryDisplay";

const recipe = (id: string, title: string): MealRecipe => ({
  id,
  title,
  mealType: "dinner",
  prepTime: "20 min",
  servings: 2,
  calories: 400,
  protein: 20,
  carbs: 30,
  fats: 12,
  tags: [],
  ingredients: [],
  steps: [],
});

const libraryRecipe = recipe("library-1", "Canonical Bowl");
const fallbackRecipe = recipe("fallback-1", "Bundled Bowl");

describe("chooseRecipeLibraryDisplay", () => {
  it("uses canonical results even when the current query/filter has zero matches", () => {
    const display = chooseRecipeLibraryDisplay([], [fallbackRecipe], {
      libraryUnavailable: false,
      libraryHasAny: true,
    });

    expect(display.source).toBe("canonical");
    expect(display.recipes).toEqual([]);
  });

  it("falls back when the canonical recipe table has no reviewed recipes yet", () => {
    const display = chooseRecipeLibraryDisplay([], [fallbackRecipe], {
      libraryUnavailable: false,
      libraryHasAny: false,
    });

    expect(display.source).toBe("fallback");
    expect(display.recipes).toEqual([fallbackRecipe]);
  });

  it("shows starter recipes while the first canonical library request is still loading", () => {
    const display = chooseRecipeLibraryDisplay([], [fallbackRecipe], {
      libraryUnavailable: false,
      libraryHasAny: null,
      libraryLoading: true,
    });

    expect(display.source).toBe("fallback");
    expect(display.recipes).toEqual([fallbackRecipe]);
    expect(display.message).toContain("Loading");
  });

  it("falls back when the canonical library request fails", () => {
    const display = chooseRecipeLibraryDisplay([libraryRecipe], [fallbackRecipe], {
      libraryUnavailable: true,
      libraryHasAny: null,
    });

    expect(display.source).toBe("fallback");
    expect(display.recipes).toEqual([fallbackRecipe]);
  });
});
