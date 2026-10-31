import type { MealRecipe } from "@/types/mealPlan";

const MEAL_SLOTS = new Set(["breakfast", "lunch", "dinner", "snack"] as const);

/**
 * Chooses the safest default plan slot when adding a browsed/library recipe.
 * Most recipes map directly, but imported/favorite JSON can be stale or loose.
 */
export function preferredPlanSlotForRecipe(recipe: Pick<MealRecipe, "mealType">): MealRecipe["mealType"] {
  return MEAL_SLOTS.has(recipe.mealType) ? recipe.mealType : "dinner";
}
