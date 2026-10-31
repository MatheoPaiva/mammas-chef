import { buildRecipeCanonicalText, buildRecipeChunks } from "./recipeChunking";
import { recipeLibraryInputSchema } from "./recipeLibrarySchema";
import type { RecipeLibraryInput } from "../types/recipeLibrary";

export function prepareRecipeLibraryInsert(recipeInput: RecipeLibraryInput) {
  const recipe = recipeLibraryInputSchema.parse(recipeInput);
  const canonicalText = buildRecipeCanonicalText(recipe);
  const chunks = buildRecipeChunks(recipe);

  return {
    source: {
      name: recipe.source.name,
      url: recipe.source.url ?? null,
      author: recipe.source.author ?? null,
      license: recipe.source.license,
      usage_notes: recipe.source.usageNotes ?? null,
    },
    recipe: {
      title: recipe.title,
      cuisine: recipe.cuisine ?? null,
      region: recipe.region ?? null,
      meal_types: recipe.mealTypes,
      diet_tags: recipe.dietTags,
      flavor_tags: recipe.flavorTags,
      equipment: recipe.equipment,
      active_time_minutes: recipe.activeTimeMinutes ?? null,
      total_time_minutes: recipe.totalTimeMinutes ?? null,
      servings: recipe.servings,
      calories: recipe.nutrition?.calories ?? null,
      protein: recipe.nutrition?.protein ?? null,
      carbs: recipe.nutrition?.carbs ?? null,
      fats: recipe.nutrition?.fats ?? null,
      ingredients: recipe.ingredients,
      steps: recipe.steps,
      storage_notes: recipe.storageNotes ?? null,
      reheat_notes: recipe.reheatNotes ?? null,
      prep_ahead_notes: recipe.prepAheadNotes ?? null,
      toddler_tip: recipe.toddlerTip ?? null,
      glucose_tip: recipe.glucoseTip ?? null,
      status: recipe.status ?? "draft",
      source_url: recipe.source.url ?? null,
      source_attribution: [recipe.source.name, recipe.source.author].filter(Boolean).join(" / "),
      canonical_text: canonicalText,
    },
    chunks: chunks.map((chunk) => ({
      chunk_type: chunk.chunkType,
      chunk_index: chunk.chunkIndex,
      content: chunk.content,
      metadata: chunk.metadata,
    })),
  };
}
