import { buildRecipeCanonicalText, buildRecipeChunks } from "./recipeChunking";
import { recipeLibraryInputSchema } from "./recipeLibrarySchema";

const recipe = {
  title: "Greek Chicken Bowls",
  cuisine: "Mediterranean",
  region: "Greek-inspired",
  mealTypes: ["dinner"],
  dietTags: ["high-protein"],
  flavorTags: ["lemony", "herby"],
  equipment: ["sheet pan"],
  activeTimeMinutes: 20,
  totalTimeMinutes: 40,
  servings: 4,
  nutrition: { calories: 520, protein: 38, carbs: 45, fats: 22 },
  ingredients: [
    { name: "chicken breast", quantity: 1.5, unit: "lb", prep: "cubed", category: "meat/seafood" },
    { name: "cucumber", quantity: 1, unit: "", prep: "diced", category: "produce" },
  ],
  steps: [
    { order: 1, text: "Season chicken with lemon, garlic, oregano, salt, and pepper." },
    { order: 2, text: "Roast chicken and serve over grains with vegetables." },
  ],
  prepAheadNotes: "Marinate chicken the night before.",
  toddlerTip: "Serve deconstructed.",
  glucoseTip: "Use extra vegetables and a smaller grain portion.",
  status: "reviewed",
  source: { name: "Mammas Chef Original", license: "original" },
} as const;

describe("recipeLibraryInputSchema", () => {
  it("accepts a complete original recipe contract", () => {
    const parsed = recipeLibraryInputSchema.parse(recipe);
    expect(parsed.title).toBe("Greek Chicken Bowls");
    expect(parsed.ingredients).toHaveLength(2);
  });

  it("rejects active time greater than total time", () => {
    expect(() => recipeLibraryInputSchema.parse({ ...recipe, activeTimeMinutes: 45, totalTimeMinutes: 30 })).toThrow();
  });

  it("builds purpose-specific chunks", () => {
    const chunks = buildRecipeChunks(recipe);
    expect(chunks.map((chunk) => chunk.chunkType)).toEqual(["overview", "ingredients", "method", "planning", "shopping"]);
    expect(chunks.find((chunk) => chunk.chunkType === "shopping")?.content).toContain("chicken breast");
  });

  it("builds canonical text for full-text search", () => {
    const text = buildRecipeCanonicalText(recipe);
    expect(text).toContain("Greek Chicken Bowls");
    expect(text).toContain("high-protein");
    expect(text).toContain("Marinate chicken");
  });
});
