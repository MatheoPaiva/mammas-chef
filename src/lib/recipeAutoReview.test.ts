import { describe, expect, it } from "vitest";
import { analyzeRecipeDuplicates, assessRecipeDeterministically, mergeRecipeAutoReview, type RecipeAutoReviewInput } from "./recipeAutoReview";

function recipe(overrides: Partial<RecipeAutoReviewInput> = {}): RecipeAutoReviewInput {
  return {
    id: "recipe-1",
    title: "Greek Chickpea Skillet",
    cuisine: "Mediterranean",
    region: "Greek-inspired",
    mealTypes: ["dinner"],
    dietTags: ["high-protein"],
    flavorTags: ["lemon", "oregano"],
    equipment: ["skillet"],
    activeTimeMinutes: 15,
    totalTimeMinutes: 25,
    servings: 4,
    calories: 420,
    protein: 22,
    carbs: 28,
    fats: 19,
    ingredients: [
      { name: "chickpeas", quantity: 2, unit: "cans" },
      { name: "spinach", quantity: 5, unit: "cups" },
      { name: "feta", quantity: 0.5, unit: "cup" },
    ],
    steps: [
      { order: 1, text: "Warm the chickpeas in a skillet with spinach until wilted." },
      { order: 2, text: "Finish with feta and lemon before serving." },
    ],
    storageNotes: "Keeps for 3 days refrigerated.",
    reheatNotes: "Reheat gently in a skillet.",
    prepAheadNotes: "Drain the chickpeas ahead of time.",
    toddlerTip: "Chop the spinach finely for toddlers.",
    glucoseTip: "Serve with extra vegetables for more fiber.",
    sourceUrl: null,
    sourceAttribution: "Mammas Chef",
    ...overrides,
  };
}

describe("recipeAutoReview", () => {
  it("approves recipes with strong metadata and no major gaps", () => {
    const result = assessRecipeDeterministically(recipe());
    expect(result.decision).toBe("approve");
    expect(result.score).toBeGreaterThanOrEqual(85);
    expect(result.issues).toEqual([]);
  });

  it("rejects recipes with critical structural gaps", () => {
    const result = assessRecipeDeterministically(recipe({
      ingredients: [],
      steps: [],
      servings: 0,
      sourceAttribution: null,
      toddlerTip: null,
      glucoseTip: null,
      prepAheadNotes: null,
      storageNotes: null,
      reheatNotes: null,
    }));

    expect(result.decision).toBe("reject");
    expect(result.issues.some((issue) => issue.severity === "critical")).toBe(true);
  });

  it("flags near-duplicates against earlier recipes", () => {
    const duplicates = analyzeRecipeDuplicates([
      recipe({ id: "recipe-1", title: "Greek Chickpea Skillet" }),
      recipe({ id: "recipe-2", title: "Greek Chickpea Skillet", flavorTags: ["mint"] }),
    ]);

    const duplicateHint = duplicates.get("recipe-2");
    expect(duplicateHint?.duplicateOfTitle).toBe("Greek Chickpea Skillet");
    expect(duplicateHint?.issue?.code).toBe("duplicate-title");
  });

  it("merges deterministic and llm review outputs", () => {
    const deterministic = assessRecipeDeterministically(recipe({ sourceAttribution: null }));
    const merged = mergeRecipeAutoReview({
      deterministic,
      llm: {
        decision: "review",
        score: 72,
        confidence: 0.77,
        summary: "Usable recipe but missing source confirmation.",
        issues: [{ code: "source-check", severity: "warning", message: "Verify originality and attribution." }],
        suggestedFixes: ["Confirm the source metadata."],
        tags: ["llm-reviewed"],
        model: "gpt-4.1-mini",
      },
    });

    expect(merged.summary).toBe("Usable recipe but missing source confirmation.");
    expect(merged.tags).toContain("llm-reviewed");
    expect(merged.issues.some((issue) => issue.code === "missing-source")).toBe(true);
    expect(merged.issues.some((issue) => issue.code === "source-check")).toBe(true);
  });
});
