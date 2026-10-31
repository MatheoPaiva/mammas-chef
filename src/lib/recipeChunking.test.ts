import { describe, expect, it } from "vitest";

import { buildRecipeCanonicalText, buildRecipeChunks } from "./recipeChunking";
import type { RecipeLibraryInput } from "@/types/recipeLibrary";

const recipe: RecipeLibraryInput = {
  title: "Sheet Pan Salmon Bowls",
  cuisine: "Mediterranean",
  region: "Greek-inspired",
  mealTypes: ["dinner"],
  dietTags: ["high-protein"],
  flavorTags: ["lemony", "herby"],
  equipment: ["sheet pan", "mixing bowl"],
  activeTimeMinutes: 15,
  totalTimeMinutes: 35,
  servings: 4,
  nutrition: { calories: 520, protein: 38 },
  ingredients: [
    { name: "salmon fillets", quantity: 1.5, unit: "lb", prep: "cut into portions", category: "meat/seafood" },
    { name: "green beans", quantity: 12, unit: "oz", prep: "trimmed", category: "produce" },
  ],
  steps: [
    { order: 1, text: "Roast salmon and green beans on a sheet pan." },
    { order: 2, text: "Serve with lemon yogurt sauce." },
  ],
  storageNotes: "Store cooked salmon up to 3 days.",
  reheatNotes: "Reheat gently in a low oven.",
  prepAheadNotes: "Mix the yogurt sauce the night before.",
  toddlerTip: "Serve sauce on the side.",
  glucoseTip: "Pair with extra vegetables before adding grains.",
  status: "reviewed",
  source: { name: "Mammas Chef Original", author: "Mammas Chef", license: "original" },
};

describe("buildRecipeCanonicalText", () => {
  it("includes classification, ingredients, equipment, and planning notes for MVP text search", () => {
    const text = buildRecipeCanonicalText(recipe);

    expect(text).toContain("Sheet Pan Salmon Bowls");
    expect(text).toContain("dinner");
    expect(text).toContain("high-protein");
    expect(text).toContain("sheet pan");
    expect(text).toContain("meat/seafood");
    expect(text).toContain("Roast salmon");
    expect(text).toContain("Store cooked salmon");
    expect(text).toContain("Reheat gently");
    expect(text).toContain("Mix the yogurt sauce");
  });
});

describe("buildRecipeChunks", () => {
  it("builds purpose-specific recipe chunks with stable metadata", () => {
    const chunks = buildRecipeChunks(recipe);

    expect(chunks.map((chunk) => chunk.chunkType)).toEqual(["overview", "ingredients", "method", "planning", "shopping"]);
    expect(chunks.find((chunk) => chunk.chunkType === "overview")).toMatchObject({
      chunkIndex: 0,
      metadata: {
        title: "Sheet Pan Salmon Bowls",
        mealTypes: ["dinner"],
        tags: ["high-protein", "lemony", "herby"],
      },
    });
    expect(chunks.find((chunk) => chunk.chunkType === "ingredients")?.content).toContain("salmon fillets");
    expect(chunks.find((chunk) => chunk.chunkType === "method")?.metadata).toMatchObject({
      equipment: ["sheet pan", "mixing bowl"],
      activeTimeMinutes: 15,
      totalTimeMinutes: 35,
    });
    expect(chunks.find((chunk) => chunk.chunkType === "shopping")?.metadata).toEqual({
      categories: ["meat/seafood", "produce"],
    });
  });
});
