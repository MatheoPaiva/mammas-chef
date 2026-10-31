import type { MealRecipe } from "@/types/mealPlan";

export type RecipeLibraryDisplaySource = "canonical" | "fallback";

export interface RecipeLibraryDisplayOptions {
  libraryUnavailable: boolean;
  libraryHasAny: boolean | null;
  libraryLoading?: boolean;
}

export interface RecipeLibraryDisplayResult {
  recipes: MealRecipe[];
  source: RecipeLibraryDisplaySource;
  message: string;
}

export function chooseRecipeLibraryDisplay(
  libraryRecipes: MealRecipe[],
  fallbackRecipes: MealRecipe[],
  options: RecipeLibraryDisplayOptions
): RecipeLibraryDisplayResult {
  if (options.libraryUnavailable) {
    return {
      recipes: fallbackRecipes,
      source: "fallback",
      message: "Canonical library unavailable; showing bundled starter recipes.",
    };
  }

  if (options.libraryHasAny === false) {
    return {
      recipes: fallbackRecipes,
      source: "fallback",
      message: "Showing bundled starter recipes until the canonical library has reviewed recipes.",
    };
  }

  if (options.libraryLoading && options.libraryHasAny === null && libraryRecipes.length === 0) {
    return {
      recipes: fallbackRecipes,
      source: "fallback",
      message: "Loading the canonical library; showing starter recipes for now.",
    };
  }

  return {
    recipes: libraryRecipes,
    source: "canonical",
    message: "Showing reviewed recipes from the canonical RAG library.",
  };
}
