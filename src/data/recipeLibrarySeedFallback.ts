import type { MealRecipe } from "@/types/mealPlan";
import type { RecipeLibraryInput, RecipeMealType } from "@/types/recipeLibrary";
import seedRecipesRaw from "../../data/recipes/seed-recipes.json?raw";

const MEAL_TYPES = new Set<RecipeMealType>(["breakfast", "lunch", "dinner", "snack"]);

function prepTime(recipe: RecipeLibraryInput): string {
  if (recipe.activeTimeMinutes && recipe.totalTimeMinutes && recipe.activeTimeMinutes !== recipe.totalTimeMinutes) {
    return `${recipe.activeTimeMinutes} min active / ${recipe.totalTimeMinutes} min total`;
  }
  if (recipe.totalTimeMinutes) return `${recipe.totalTimeMinutes} min`;
  if (recipe.activeTimeMinutes) return `${recipe.activeTimeMinutes} min active`;
  return "Time varies";
}

function toMealRecipes(recipe: RecipeLibraryInput, index: number): MealRecipe[] {
  const validMealTypes = recipe.mealTypes
    .filter((value): value is RecipeMealType => MEAL_TYPES.has(value));

  // Defensive: if the seed JSON has zero valid meal types (malformed entry), fall back to
  // a single "dinner" recipe so the recipe still surfaces somewhere instead of being silently
  // dropped from the library. Matches the previous asMealType default.
  const mealTypes: RecipeMealType[] = validMealTypes.length > 0 ? validMealTypes : ["dinner"];

  const baseSlug = recipe.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

  const tags = Array.from(new Set([
    ...(recipe.dietTags ?? []),
    ...(recipe.flavorTags ?? []),
    recipe.cuisine,
    recipe.region,
  ].filter((tag): tag is string => typeof tag === "string" && tag.trim().length > 0)));

  const sharedFields = {
    title: recipe.title,
    prepTime: prepTime(recipe),
    servings: recipe.servings,
    calories: recipe.nutrition?.calories ?? 0,
    protein: recipe.nutrition?.protein ?? 0,
    carbs: recipe.nutrition?.carbs ?? 0,
    fats: recipe.nutrition?.fats ?? 0,
    tags,
    ingredients: recipe.ingredients.map((ingredient) => ({
      name: ingredient.name,
      quantity: ingredient.quantity,
      unit: ingredient.unit,
      prep: ingredient.prep,
    })),
    steps: recipe.steps
      .sort((a, b) => a.order - b.order)
      .map((step) => step.text),
    toddlerTip: recipe.toddlerTip,
    glucoseTip: recipe.glucoseTip,
    flavorNotes: undefined,
  } satisfies Omit<MealRecipe, "id" | "mealType">;

  return mealTypes.map((mealType) => ({
    ...sharedFields,
    // Per-mealType id keeps React keys unique in the grid; the legacy single-mealType case
    // (recipe with only one mealType) produces the same id format as before with a mealType segment.
    // Old schema: seed-{n}-{slug}  →  New schema: seed-{n}-{mealType}-{slug}
    id: `seed-${index + 1}-${mealType}-${baseSlug}`,
    mealType,
  }));
}

const seedRecipes = JSON.parse(seedRecipesRaw) as RecipeLibraryInput[];

/**
 * Offline/unseeded fallback for the Recipes page. Keep this generated from the
 * same reviewed fixture set as the Supabase seed so local browse/search behaves
 * like the canonical recipe library instead of the older demo recipe list.
 */
export const recipeLibrarySeedFallbackRecipes: MealRecipe[] = seedRecipes.flatMap(toMealRecipes);
