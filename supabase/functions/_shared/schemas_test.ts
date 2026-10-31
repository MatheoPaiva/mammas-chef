import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { validateMealPlanSchema, MealSchema } from "./schemas.ts";

Deno.test("validateMealPlanSchema accepts pinned stubs without mutating the raw plan", () => {
  const raw = {
    title: "Library-assisted week",
    days: [
      {
        day: "Monday",
        meals: [
          {
            id: "canonical-1",
            libraryRecipeId: "recipe-library-1",
            title: "Lemony Chickpea Bowls",
            mealType: "dinner",
            pinned: true,
            prepTime: "0 min",
            servings: 0,
            calories: 0,
            protein: 0,
            carbs: 0,
            fats: 0,
            tags: [],
            ingredients: [],
            steps: [],
            flavorNotes: "",
          },
          {
            id: "generated-1",
            title: "Greek Yogurt Berry Bowl",
            mealType: "breakfast",
            prepTime: "10 min",
            servings: 2,
            calories: 320,
            protein: 22,
            carbs: 36,
            fats: 10,
            tags: ["Mediterranean"],
            ingredients: [{ name: "Greek yogurt", quantity: 2, unit: "cups" }],
            steps: ["Spoon yogurt into bowls and top with berries."],
            flavorNotes: "Creamy yogurt with bright berries and a little crunch.",
          },
        ],
      },
    ],
    shoppingList: [],
  };

  const result = validateMealPlanSchema(raw);

  assert(result.success);
  assertEquals(raw.days[0].meals.length, 2);
  assertEquals(raw.days[0].meals[0].libraryRecipeId, "recipe-library-1");
});

const minimalDay = {
  day: "Monday",
  meals: [
    {
      id: "generated-1",
      title: "Greek Yogurt Berry Bowl",
      mealType: "breakfast",
      prepTime: "10 min",
      servings: 2,
      calories: 320,
      protein: 22,
      carbs: 36,
      fats: 10,
      tags: ["Mediterranean"],
      ingredients: [{ name: "Greek yogurt", quantity: 2, unit: "cups" }],
      steps: ["Spoon yogurt into bowls and top with berries."],
      flavorNotes: "Creamy yogurt with bright berries and a little crunch.",
    },
  ],
};

Deno.test("validateMealPlanSchema accepts {title, days} without shoppingList and defaults to []", () => {
  const raw = { title: "Test Week", days: [minimalDay] };
  const result = validateMealPlanSchema(raw);
  assert(result.success);
  if (result.success) {
    assertEquals(result.data.shoppingList, []);
  }
});

Deno.test("validateMealPlanSchema accepts {title, days, shoppingList} and preserves the array", () => {
  const raw = {
    title: "Test Week",
    days: [minimalDay],
    shoppingList: [{ name: "Olive oil", quantity: "1 bottle", aisle: "Oils" }],
  };
  const result = validateMealPlanSchema(raw);
  assert(result.success);
  if (result.success) {
    assertEquals(result.data.shoppingList, [{ name: "Olive oil", quantity: "1 bottle", aisle: "Oils" }]);
  }
});

// ---------------------------------------------------------------------------
// Phase 15 — MealSchema status/card field additions
// ---------------------------------------------------------------------------

const baseRawMeal = {
  id: "generated-1",
  title: "Greek Yogurt Berry Bowl",
  mealType: "breakfast",
  prepTime: "10 min",
  servings: 2,
  calories: 320,
  protein: 22,
  carbs: 36,
  fats: 10,
  tags: ["Mediterranean"],
  ingredients: [{ name: "Greek yogurt", quantity: 2, unit: "cups" }],
  steps: ["Spoon yogurt into bowls and top with berries."],
  flavorNotes: "Creamy yogurt with bright berries and a little crunch.",
};

Deno.test("MealSchema accepts a fixture WITH the 6 new fields (+ source_meal_id)", () => {
  const raw = {
    ...baseRawMeal,
    source_meal_id: "mon-dinner",
    status: "leftover",
    cautionNote: "High sodium — not toddler-suitable",
    workflow: "Uses Sunday Prep Batch cooked quinoa.",
    storage: "Refrigerate up to 4 days.",
    cookTime: "20 min",
    totalTime: "35 min",
  };
  const result = MealSchema.safeParse(raw);
  assert(result.success);
  if (result.success) {
    assertEquals(result.data.status, "leftover");
    assertEquals(result.data.source_meal_id, "mon-dinner");
    assertEquals(result.data.cautionNote, "High sodium — not toddler-suitable");
    assertEquals(result.data.workflow, "Uses Sunday Prep Batch cooked quinoa.");
    assertEquals(result.data.storage, "Refrigerate up to 4 days.");
    assertEquals(result.data.cookTime, "20 min");
    assertEquals(result.data.totalTime, "35 min");
  }
});

Deno.test("MealSchema accepts a fixture WITHOUT the 6 new fields (backward compat)", () => {
  const result = MealSchema.safeParse(baseRawMeal);
  assert(result.success);
  if (result.success) {
    assertEquals(result.data.status, undefined);
    assertEquals(result.data.source_meal_id, undefined);
    assertEquals(result.data.cautionNote, undefined);
    assertEquals(result.data.workflow, undefined);
    assertEquals(result.data.storage, undefined);
    assertEquals(result.data.cookTime, undefined);
    assertEquals(result.data.totalTime, undefined);
  }
});
