import { describe, expect, it } from "vitest";
import { normalizeCustomRecipeInput, normalizeCustomRecipeNutrition, validateCustomRecipeInput } from "./customRecipeValidation";
import type { CustomRecipeInput } from "@/types/customRecipe";

const validInput: CustomRecipeInput = {
  title: " Turkey Chili ",
  mealType: "dinner",
  servings: 4,
  prepTimeMinutes: 35,
  tags: [" family ", ""],
  ingredients: [
    { quantity: 1, unit: "lb", name: " ground turkey ", prep: " browned " },
  ],
  steps: [" Simmer everything. "],
  toddlerTip: "Serve mild.",
};

describe("validateCustomRecipeInput", () => {
  it("requires title, meal type, servings, ingredients, and steps", () => {
    expect(validateCustomRecipeInput({
      title: "",
      mealType: "dinner",
      servings: 0,
      prepTimeMinutes: null,
      tags: [],
      ingredients: [],
      steps: [],
    })).toEqual([
      "Recipe name is required.",
      "Servings must be at least 1.",
      "Add at least one ingredient.",
      "Add at least one instruction step.",
    ]);
  });

  it("accepts normalized valid input", () => {
    expect(validateCustomRecipeInput(normalizeCustomRecipeInput(validInput))).toEqual([]);
  });
});

describe("normalizeCustomRecipeInput", () => {
  it("trims rows and removes empty tags, ingredients, and steps", () => {
    expect(normalizeCustomRecipeInput({
      ...validInput,
      ingredients: [...validInput.ingredients, { quantity: 1, unit: "", name: " ", prep: "" }],
      steps: [...validInput.steps, " "],
    })).toMatchObject({
      title: "Turkey Chili",
      tags: ["family"],
      ingredients: [{ quantity: 1, unit: "lb", name: "ground turkey", prep: "browned" }],
      steps: ["Simmer everything."],
    });
  });
});

describe("normalizeCustomRecipeNutrition", () => {
  it("normalizes whole non-negative macro values", () => {
    expect(normalizeCustomRecipeNutrition({ calories: 312.4, protein: 22.5, carbs: 30, fats: 11 })).toEqual({
      calories: 312,
      protein: 23,
      carbs: 30,
      fats: 11,
    });
  });

  it("rejects empty or invalid AI nutrition responses", () => {
    expect(normalizeCustomRecipeNutrition({ calories: 0, protein: 10, carbs: 20, fats: 5 })).toBeNull();
    expect(normalizeCustomRecipeNutrition({ calories: 300, protein: -1, carbs: 20, fats: 5 })).toBeNull();
    expect(normalizeCustomRecipeNutrition({ calories: "300", protein: 10, carbs: 20, fats: 5 })).toBeNull();
  });
});
