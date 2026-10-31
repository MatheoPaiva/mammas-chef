import type { Ingredient, MealRecipe } from "@/types/mealPlan";

export type CustomRecipeStatus = "active" | "archived";

export interface CustomRecipeStep {
  order: number;
  text: string;
}

export interface CustomRecipeNutrition {
  calories: number;
  protein: number;
  carbs: number;
  fats: number;
}

export interface CustomRecipeInput {
  title: string;
  mealType: MealRecipe["mealType"];
  servings: number;
  prepTimeMinutes?: number | null;
  tags: string[];
  ingredients: Ingredient[];
  steps: string[];
  toddlerTip?: string;
  glucoseTip?: string;
  flavorNotes?: string;
}

export interface CustomRecipeRow {
  id: string;
  user_id: string;
  title: string;
  meal_type: string;
  servings: number;
  prep_time_minutes: number | null;
  tags: unknown;
  ingredients: unknown;
  steps: unknown;
  toddler_tip: string | null;
  glucose_tip: string | null;
  flavor_notes: string | null;
  calories: number;
  protein: number;
  carbs: number;
  fats: number;
  status: CustomRecipeStatus;
  created_at: string;
  updated_at: string;
}
