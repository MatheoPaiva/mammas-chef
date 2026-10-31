import type { CustomRecipeInput, CustomRecipeNutrition } from "@/types/customRecipe";
import type { MealRecipe } from "@/types/mealPlan";

const MEAL_TYPES = new Set<MealRecipe["mealType"]>(["breakfast", "lunch", "dinner", "snack"]);

function isValidMealType(value: unknown): value is MealRecipe["mealType"] {
  return typeof value === "string" && MEAL_TYPES.has(value as MealRecipe["mealType"]);
}

function cleanText(value: string | undefined): string {
  return (value ?? "").trim();
}

export function validateCustomRecipeInput(input: CustomRecipeInput): string[] {
  const errors: string[] = [];

  if (!cleanText(input.title)) errors.push("Recipe name is required.");
  if (!isValidMealType(input.mealType)) errors.push("Meal type is required.");
  if (!Number.isFinite(input.servings) || Math.round(input.servings) < 1) errors.push("Servings must be at least 1.");
  if (input.prepTimeMinutes != null && (!Number.isFinite(input.prepTimeMinutes) || input.prepTimeMinutes < 0)) {
    errors.push("Prep time must be zero or greater.");
  }

  const validIngredients = input.ingredients.filter((ingredient) => cleanText(ingredient.name));
  if (validIngredients.length === 0) errors.push("Add at least one ingredient.");

  const invalidQuantity = validIngredients.some((ingredient) => !Number.isFinite(ingredient.quantity) || ingredient.quantity < 0);
  if (invalidQuantity) errors.push("Ingredient quantities must be zero or greater.");

  const validSteps = input.steps.filter((step) => cleanText(step));
  if (validSteps.length === 0) errors.push("Add at least one instruction step.");

  return errors;
}

function toWholeNumber(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const rounded = Math.round(value);
  return rounded >= 0 ? rounded : null;
}

export function normalizeCustomRecipeNutrition(value: unknown): CustomRecipeNutrition | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const calories = toWholeNumber(raw.calories);
  const protein = toWholeNumber(raw.protein);
  const carbs = toWholeNumber(raw.carbs);
  const fats = toWholeNumber(raw.fats);

  if (calories == null || calories < 1 || protein == null || carbs == null || fats == null) {
    return null;
  }

  return { calories, protein, carbs, fats };
}

export function normalizeCustomRecipeInput(input: CustomRecipeInput): CustomRecipeInput {
  return {
    title: cleanText(input.title),
    mealType: isValidMealType(input.mealType) ? input.mealType : "dinner",
    servings: Math.max(1, Math.round(input.servings)),
    prepTimeMinutes: input.prepTimeMinutes == null ? null : Math.max(0, Math.round(input.prepTimeMinutes)),
    tags: input.tags.map((tag) => cleanText(tag)).filter(Boolean),
    ingredients: input.ingredients
      .map((ingredient) => ({
        name: cleanText(ingredient.name),
        quantity: Number.isFinite(ingredient.quantity) ? ingredient.quantity : 0,
        unit: cleanText(ingredient.unit),
        prep: cleanText(ingredient.prep) || undefined,
      }))
      .filter((ingredient) => ingredient.name),
    steps: input.steps.map(cleanText).filter(Boolean),
    toddlerTip: cleanText(input.toddlerTip) || undefined,
    glucoseTip: cleanText(input.glucoseTip) || undefined,
    flavorNotes: cleanText(input.flavorNotes) || undefined,
  };
}
