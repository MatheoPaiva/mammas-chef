import type { RecipeLibraryInput, RecipeMealType, RecipeStatus } from "@/types/recipeLibrary";

const MEAL_TYPES: RecipeMealType[] = ["breakfast", "lunch", "dinner", "snack"];
const STATUSES: RecipeStatus[] = ["draft", "reviewed", "tested", "archived"];
const MIN_REVIEWED_OR_TESTED_RECIPES = 25;
const MIN_MVP_MEAL_TYPE_COUNTS: Record<RecipeMealType, number> = {
  breakfast: 4,
  lunch: 4,
  dinner: 8,
  snack: 4,
};

export interface RecipeFixtureCoverageSummary {
  total: number;
  reviewedOrTested: number;
  byMealType: Record<RecipeMealType, number>;
  byStatus: Record<RecipeStatus, number>;
  missingSourceMetadata: string[];
  missingPlanningNotes: string[];
  duplicateTitles: string[];
  duplicateIngredientFingerprints: string[];
}

function emptyMealTypeCounts(): Record<RecipeMealType, number> {
  return { breakfast: 0, lunch: 0, dinner: 0, snack: 0 };
}

function emptyStatusCounts(): Record<RecipeStatus, number> {
  return { draft: 0, reviewed: 0, tested: 0, archived: 0 };
}

function normalizeFingerprintPart(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s'-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function ingredientFingerprint(recipe: RecipeLibraryInput): string {
  return Array.from(new Set(
    recipe.ingredients
      .map((ingredient) => normalizeFingerprintPart(ingredient.name))
      .filter(Boolean)
  )).sort().join("|");
}

export function summarizeRecipeFixtureCoverage(recipes: RecipeLibraryInput[]): RecipeFixtureCoverageSummary {
  const byMealType = emptyMealTypeCounts();
  const byStatus = emptyStatusCounts();
  const titleCounts = new Map<string, number>();
  const ingredientFingerprintCounts = new Map<string, number>();
  const ingredientFingerprintFirstTitle = new Map<string, string>();
  const missingSourceMetadata: string[] = [];
  const missingPlanningNotes: string[] = [];

  for (const recipe of recipes) {
    for (const mealType of recipe.mealTypes) {
      if (MEAL_TYPES.includes(mealType)) byMealType[mealType] += 1;
    }

    const status = recipe.status ?? "draft";
    if (STATUSES.includes(status)) byStatus[status] += 1;

    const normalizedTitle = recipe.title.trim().toLowerCase();
    titleCounts.set(normalizedTitle, (titleCounts.get(normalizedTitle) ?? 0) + 1);

    const fingerprint = ingredientFingerprint(recipe);
    if (fingerprint) {
      ingredientFingerprintCounts.set(fingerprint, (ingredientFingerprintCounts.get(fingerprint) ?? 0) + 1);
      if (!ingredientFingerprintFirstTitle.has(fingerprint)) {
        ingredientFingerprintFirstTitle.set(fingerprint, recipe.title);
      }
    }

    if (!recipe.source?.name?.trim() || !recipe.source?.license?.trim()) {
      missingSourceMetadata.push(recipe.title);
    }

    if ((status === "reviewed" || status === "tested") && ![
      recipe.prepAheadNotes,
      recipe.storageNotes,
      recipe.reheatNotes,
      recipe.toddlerTip,
      recipe.glucoseTip,
    ].some((value) => value?.trim())) {
      missingPlanningNotes.push(recipe.title);
    }
  }

  return {
    total: recipes.length,
    reviewedOrTested: byStatus.reviewed + byStatus.tested,
    byMealType,
    byStatus,
    missingSourceMetadata,
    missingPlanningNotes,
    duplicateTitles: recipes
      .map((recipe) => recipe.title)
      .filter((title, index, titles) => {
        const normalized = title.trim().toLowerCase();
        return titleCounts.get(normalized)! > 1 && titles.findIndex((item) => item.trim().toLowerCase() === normalized) === index;
      }),
    duplicateIngredientFingerprints: Array.from(ingredientFingerprintCounts.entries())
      .filter(([, count]) => count > 1)
      .map(([fingerprint]) => ingredientFingerprintFirstTitle.get(fingerprint)!)
      .filter(Boolean),
  };
}

export function formatRecipeFixtureCoverage(summary: RecipeFixtureCoverageSummary): string {
  return [
    `Meal type coverage: breakfast=${summary.byMealType.breakfast}, lunch=${summary.byMealType.lunch}, dinner=${summary.byMealType.dinner}, snack=${summary.byMealType.snack}.`,
    `Status coverage: draft=${summary.byStatus.draft}, reviewed=${summary.byStatus.reviewed}, tested=${summary.byStatus.tested}, archived=${summary.byStatus.archived}.`,
  ].join("\n");
}

export function getRecipeFixtureCoverageIssues(summary: RecipeFixtureCoverageSummary): string[] {
  const issues: string[] = [];

  if (summary.reviewedOrTested < MIN_REVIEWED_OR_TESTED_RECIPES) {
    issues.push(`At least ${MIN_REVIEWED_OR_TESTED_RECIPES} reviewed/tested recipes are required for MVP library search; found ${summary.reviewedOrTested}.`);
  }

  for (const mealType of MEAL_TYPES) {
    const minimum = MIN_MVP_MEAL_TYPE_COUNTS[mealType];
    if (summary.byMealType[mealType] < minimum) {
      issues.push(`At least ${minimum} ${mealType} recipe(s) are required for balanced meal-plan retrieval; found ${summary.byMealType[mealType]}.`);
    }
  }

  if (summary.missingSourceMetadata.length > 0) {
    issues.push(`Recipes missing source name/license: ${summary.missingSourceMetadata.join(", ")}.`);
  }

  if (summary.missingPlanningNotes.length > 0) {
    issues.push(`Reviewed/tested recipes need at least one planning note for prep, storage, reheat, toddler, or glucose retrieval chunks: ${summary.missingPlanningNotes.join(", ")}.`);
  }

  if (summary.duplicateTitles.length > 0) {
    issues.push(`Duplicate recipe titles are not seed-safe because recipe_library.title is unique: ${summary.duplicateTitles.join(", ")}.`);
  }

  if (summary.duplicateIngredientFingerprints.length > 0) {
    issues.push(`Potential duplicate recipes with identical ingredient sets: ${summary.duplicateIngredientFingerprints.join(", ")}.`);
  }

  return issues;
}
