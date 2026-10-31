import type { MealRecipe } from "@/types/mealPlan";

function normalizeTitle(title: string): string {
  return title.toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Stable key for recipe UI state across canonical library rows, saved snapshots,
 * and generated/fallback recipes. Prefer libraryRecipeId because saved plan/favorite
 * snapshots may keep a generated row id while still pointing to the same canonical recipe.
 */
export function recipeIdentityKey(recipe: Pick<MealRecipe, "id" | "title" | "libraryRecipeId" | "customRecipeId">): string {
  if (recipe.libraryRecipeId?.trim()) return `library:${recipe.libraryRecipeId.trim()}`;
  if ("customRecipeId" in recipe && recipe.customRecipeId?.trim()) return `custom:${recipe.customRecipeId.trim()}`;
  if (recipe.id?.trim()) return `recipe:${recipe.id.trim()}`;
  return `title:${normalizeTitle(recipe.title)}`;
}

/** Title-level key used when the UX should collapse older fallback/favorite copies
 * into a newer canonical library result with the same visible recipe name.
 */
export function recipeTitleKey(recipe: Pick<MealRecipe, "title">): string {
  return normalizeTitle(recipe.title);
}
