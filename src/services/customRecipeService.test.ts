import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: vi.fn(), functions: { invoke: vi.fn() } },
}));

vi.mock("@/services/mealPlanDbService", () => ({
  insertRecipeIntoPlan: vi.fn(),
}));

import { customRecipeRowToMealRecipe, getCustomRecipeErrorMessage } from "./customRecipeService";
import type { CustomRecipeRow } from "@/types/customRecipe";

const row: CustomRecipeRow = {
  id: "11111111-1111-4111-8111-111111111111",
  user_id: "user-1",
  title: "Turkey Chili",
  meal_type: "dinner",
  servings: 4,
  prep_time_minutes: 35,
  tags: ["high-protein", "freezer-friendly"],
  ingredients: [
    { quantity: 1, unit: "lb", name: "ground turkey", prep: "browned" },
    { quantity: 2, unit: "can", name: "white beans" },
  ],
  steps: [
    { order: 1, text: "Brown turkey." },
    { order: 2, text: "Simmer with beans." },
  ],
  toddler_tip: "Serve mild.",
  glucose_tip: "Add extra greens.",
  flavor_notes: "Smoky and bright.",
  calories: 410,
  protein: 32,
  carbs: 34,
  fats: 16,
  status: "active",
  created_at: "2026-05-19T00:00:00Z",
  updated_at: "2026-05-19T00:00:00Z",
};

describe("customRecipeRowToMealRecipe", () => {
  it("maps a custom recipe row to a meal recipe with custom identity", () => {
    expect(customRecipeRowToMealRecipe(row)).toEqual({
      id: "11111111-1111-4111-8111-111111111111",
      customRecipeId: "11111111-1111-4111-8111-111111111111",
      title: "Turkey Chili",
      mealType: "dinner",
      prepTime: "35 min",
      servings: 4,
      calories: 410,
      protein: 32,
      carbs: 34,
      fats: 16,
      tags: ["high-protein", "freezer-friendly"],
      ingredients: [
        { quantity: 1, unit: "lb", name: "ground turkey", prep: "browned", displayQuantity: "1" },
        { quantity: 2, unit: "can", name: "white beans", displayQuantity: "2" },
      ],
      steps: ["Brown turkey.", "Simmer with beans."],
      toddlerTip: "Serve mild.",
      glucoseTip: "Add extra greens.",
      flavorNotes: "Smoky and bright.",
    });
  });
});

describe("getCustomRecipeErrorMessage", () => {
  it("turns a missing custom_recipes table error into setup guidance", () => {
    expect(getCustomRecipeErrorMessage({
      code: "PGRST205",
      message: "Could not find the table 'public.custom_recipes' in the schema cache",
    }, "Failed to save custom recipe")).toBe(
      "Custom recipe storage is not set up for this Supabase project. Apply supabase/migrations/20260519000000_add_custom_recipes.sql and reload the API schema.",
    );
  });

  it("keeps unrelated Supabase error messages", () => {
    expect(getCustomRecipeErrorMessage({ message: "JWT expired" }, "Fallback")).toBe("JWT expired");
  });
});
