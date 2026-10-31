import type { RecipeChunkInput, RecipeLibraryInput } from "@/types/recipeLibrary";

const join = (values: Array<string | number | undefined | null>): string =>
  values.filter((value) => value !== undefined && value !== null && `${value}`.trim() !== "").join(" | ");

export function buildRecipeCanonicalText(recipe: RecipeLibraryInput): string {
  return [
    recipe.title,
    recipe.cuisine,
    recipe.region,
    recipe.mealTypes.join(" "),
    recipe.dietTags.join(" "),
    recipe.flavorTags.join(" "),
    recipe.equipment.join(" "),
    recipe.ingredients.map((ingredient) => join([
      ingredient.quantity,
      ingredient.unit,
      ingredient.name,
      ingredient.prep,
      ingredient.category,
      ingredient.optional ? "optional" : undefined,
    ])).join("; "),
    recipe.steps.map((step) => step.text).join(" "),
    recipe.prepAheadNotes,
    recipe.storageNotes,
    recipe.reheatNotes,
    recipe.toddlerTip,
    recipe.glucoseTip,
  ].filter(Boolean).join("\n");
}

export function buildRecipeChunks(recipe: RecipeLibraryInput): RecipeChunkInput[] {
  const nutrition = recipe.nutrition;
  return [
    {
      chunkType: "overview",
      chunkIndex: 0,
      content: join([
        recipe.title,
        recipe.cuisine,
        recipe.region,
        `meals: ${recipe.mealTypes.join(", ")}`,
        `tags: ${[...recipe.dietTags, ...recipe.flavorTags].join(", ")}`,
        recipe.totalTimeMinutes ? `${recipe.totalTimeMinutes} minutes total` : undefined,
        `${recipe.servings} servings`,
        nutrition?.calories ? `${nutrition.calories} calories` : undefined,
        nutrition?.protein ? `${nutrition.protein}g protein` : undefined,
      ]),
      metadata: { title: recipe.title, mealTypes: recipe.mealTypes, tags: [...recipe.dietTags, ...recipe.flavorTags] },
    },
    {
      chunkType: "ingredients",
      chunkIndex: 0,
      content: recipe.ingredients.map((ingredient) => join([
        ingredient.quantity,
        ingredient.unit,
        ingredient.name,
        ingredient.prep,
        ingredient.category,
        ingredient.optional ? "optional" : undefined,
      ])).join("\n"),
      metadata: { count: recipe.ingredients.length },
    },
    {
      chunkType: "method",
      chunkIndex: 0,
      content: recipe.steps.map((step) => `${step.order}. ${step.text}`).join("\n"),
      metadata: { equipment: recipe.equipment, activeTimeMinutes: recipe.activeTimeMinutes, totalTimeMinutes: recipe.totalTimeMinutes },
    },
    {
      chunkType: "planning",
      chunkIndex: 0,
      content: join([
        recipe.prepAheadNotes,
        recipe.storageNotes,
        recipe.reheatNotes,
        recipe.toddlerTip ? `Toddler: ${recipe.toddlerTip}` : undefined,
        recipe.glucoseTip ? `Glucose: ${recipe.glucoseTip}` : undefined,
      ]),
      metadata: { hasToddlerTip: !!recipe.toddlerTip, hasGlucoseTip: !!recipe.glucoseTip },
    },
    {
      chunkType: "shopping",
      chunkIndex: 0,
      content: recipe.ingredients.map((ingredient) => join([ingredient.name, ingredient.category])).join("\n"),
      metadata: { categories: Array.from(new Set(recipe.ingredients.map((ingredient) => ingredient.category).filter(Boolean))) },
    },
  ].filter((chunk) => chunk.content.trim().length > 0);
}
