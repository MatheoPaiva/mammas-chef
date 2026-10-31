import { describe, expect, it } from "vitest";

import {
  formatRecipeFixtureCoverage,
  getRecipeFixtureCoverageIssues,
  summarizeRecipeFixtureCoverage,
} from "./recipeFixtureCoverage";
import type { RecipeLibraryInput } from "@/types/recipeLibrary";

const baseRecipe: RecipeLibraryInput = {
  title: "Greek Egg Toast",
  cuisine: "Mediterranean",
  region: "Greek-inspired",
  mealTypes: ["breakfast"],
  dietTags: ["vegetarian"],
  flavorTags: ["savory"],
  equipment: ["toaster"],
  activeTimeMinutes: 10,
  totalTimeMinutes: 10,
  servings: 2,
  ingredients: [{ name: "egg", quantity: 2, unit: "" }],
  steps: [{ order: 1, text: "Toast bread and top with egg." }],
  prepAheadNotes: "Boil eggs ahead for faster assembly.",
  status: "reviewed",
  source: { name: "Mammas Chef Original", author: "Mammas Chef", license: "original" },
};

function recipe(overrides: Partial<RecipeLibraryInput>): RecipeLibraryInput {
  return { ...baseRecipe, ...overrides };
}

function reviewedFixtureCatalog(): RecipeLibraryInput[] {
  const mealTypes = [
    ...Array.from({ length: 4 }, () => "breakfast" as const),
    ...Array.from({ length: 4 }, () => "lunch" as const),
    ...Array.from({ length: 8 }, () => "dinner" as const),
    ...Array.from({ length: 4 }, () => "snack" as const),
    ...Array.from({ length: 5 }, () => "lunch" as const),
  ];

  return mealTypes.map((mealType, index) => recipe({
    title: `Reviewed Recipe ${index + 1}`,
    mealTypes: [mealType],
    ingredients: [{ name: `${mealType} ingredient ${index + 1}`, quantity: 1, unit: "cup" }],
  }));
}

describe("recipe fixture coverage", () => {
  it("summarizes meal type, status, and source coverage", () => {
    const summary = summarizeRecipeFixtureCoverage([
      ...reviewedFixtureCatalog(),
      recipe({ title: "Tested Turkey Pita", mealTypes: ["lunch", "dinner"], status: "tested", ingredients: [{ name: "ground turkey", quantity: 1, unit: "lb" }] }),
      recipe({ title: "Draft Hummus Plate", mealTypes: ["snack"], status: "draft", ingredients: [{ name: "hummus", quantity: 0.5, unit: "cup" }] }),
    ]);

    expect(summary.total).toBe(27);
    expect(summary.reviewedOrTested).toBe(26);
    expect(summary.byMealType).toEqual({ breakfast: 4, lunch: 10, dinner: 9, snack: 5 });
    expect(summary.byStatus).toEqual({ draft: 1, reviewed: 25, tested: 1, archived: 0 });
    expect(summary.missingPlanningNotes).toEqual([]);
    expect(summary.duplicateIngredientFingerprints).toEqual([]);
    expect(getRecipeFixtureCoverageIssues(summary)).toEqual([]);
    expect(formatRecipeFixtureCoverage(summary)).toContain("breakfast=4, lunch=10, dinner=9, snack=5");
  });

  it("flags seed catalog problems that would break MVP retrieval/import", () => {
    const summary = summarizeRecipeFixtureCoverage([
      recipe({ title: "Duplicate", status: "draft", source: { name: "", license: "" } }),
      recipe({ title: "duplicate", status: "draft" }),
      recipe({ title: "Reviewed Without Notes", status: "reviewed", prepAheadNotes: undefined }),
    ]);

    expect(getRecipeFixtureCoverageIssues(summary)).toEqual([
      "At least 25 reviewed/tested recipes are required for MVP library search; found 1.",
      "At least 4 breakfast recipe(s) are required for balanced meal-plan retrieval; found 3.",
      "At least 4 lunch recipe(s) are required for balanced meal-plan retrieval; found 0.",
      "At least 8 dinner recipe(s) are required for balanced meal-plan retrieval; found 0.",
      "At least 4 snack recipe(s) are required for balanced meal-plan retrieval; found 0.",
      "Recipes missing source name/license: Duplicate.",
      "Reviewed/tested recipes need at least one planning note for prep, storage, reheat, toddler, or glucose retrieval chunks: Reviewed Without Notes.",
      "Duplicate recipe titles are not seed-safe because recipe_library.title is unique: Duplicate.",
      "Potential duplicate recipes with identical ingredient sets: Duplicate.",
    ]);
  });
});
