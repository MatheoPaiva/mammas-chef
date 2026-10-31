import type { RecipeLibraryIngredient, RecipeMachineReviewDecision, RecipeMealType, RecipeStatus } from "@/types/recipeLibrary";

export interface RecipeReviewCandidate {
  id: string;
  title: string;
  status: RecipeStatus;
  mealTypes: RecipeMealType[];
  cuisine?: string | null;
  region?: string | null;
  dietTags: string[];
  flavorTags: string[];
  ingredients: RecipeLibraryIngredient[];
  machineReviewDecision?: RecipeMachineReviewDecision | null;
  machineReviewTags?: string[];
}

export interface RecipeReviewFilters {
  query: string;
  mealType: RecipeMealType | "all";
  status: RecipeStatus | "all";
  machineReviewDecision: RecipeMachineReviewDecision | "all" | "unreviewed";
}

export function summarizeRecipeReviewCounts(recipes: RecipeReviewCandidate[]): Record<RecipeStatus, number> {
  return recipes.reduce<Record<RecipeStatus, number>>(
    (counts, recipe) => {
      counts[recipe.status] += 1;
      return counts;
    },
    { draft: 0, reviewed: 0, tested: 0, archived: 0 },
  );
}

function tokenizeQuery(query: string): string[] {
  return query.toLowerCase().match(/[a-z0-9][a-z0-9&'-]*/g) ?? [];
}

function haystack(recipe: RecipeReviewCandidate): string[] {
  return [
    recipe.title,
    recipe.cuisine ?? "",
    recipe.region ?? "",
    recipe.machineReviewDecision ?? "",
    ...recipe.mealTypes,
    ...recipe.dietTags,
    ...recipe.flavorTags,
    ...recipe.ingredients.map((ingredient) => ingredient.name),
    ...(recipe.machineReviewTags ?? []),
  ].map((value) => value.toLowerCase());
}

export function filterRecipeReviewItems(recipes: RecipeReviewCandidate[], filters: RecipeReviewFilters): RecipeReviewCandidate[] {
  const terms = tokenizeQuery(filters.query);
  return recipes.filter((recipe) => {
    if (filters.status !== "all" && recipe.status !== filters.status) return false;
    if (filters.mealType !== "all" && !recipe.mealTypes.includes(filters.mealType)) return false;
    if (filters.machineReviewDecision === "unreviewed" && recipe.machineReviewDecision) return false;
    if (
      filters.machineReviewDecision !== "all"
      && filters.machineReviewDecision !== "unreviewed"
      && recipe.machineReviewDecision !== filters.machineReviewDecision
    ) return false;
    if (terms.length === 0) return true;

    const values = haystack(recipe);
    return terms.every((term) => values.some((value) => value.includes(term)));
  });
}
