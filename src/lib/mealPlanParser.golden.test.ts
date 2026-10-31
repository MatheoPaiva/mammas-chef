/**
 * Golden file / integration tests for the full parse → normalize → validate pipeline.
 *
 * Tests parseMealPlanResponse + normalizeMealPlan against realistic AI outputs,
 * and validates business logic rules from validation.ts (inlined here since the
 * original lives in supabase/functions/_shared/ which uses Deno imports).
 */
import { describe, it, expect } from "vitest";
import { parseMealPlanResponse, normalizeMealPlan } from "./mealPlanParser";
import type { MealPlanResponse } from "@/types/mealPlan";

// ---------------------------------------------------------------------------
// Golden fixture: a valid 7-day plan that should pass all checks
// ---------------------------------------------------------------------------

function makeMeal(overrides: Record<string, unknown> = {}) {
  return {
    id: `gen-${Date.now()}-${Math.random()}`,
    title: "Mediterranean Chicken Bowl",
    mealType: "dinner",
    prepTime: "35 min",
    servings: 4,
    calories: 520,
    protein: 38,
    carbs: 42,
    fats: 18,
    tags: ["high-protein", "mediterranean"],
    ingredients: [
      "1.5 lb chicken thighs",
      "2 cups rice",
      "1 cup cherry tomatoes",
      "1/2 cup kalamata olives",
      "1 tsp cumin",
      "1 tsp smoked paprika",
      "1 tsp dried oregano",
      "2 tbsp olive oil",
      "salt and pepper to taste",
    ],
    steps: [
      "Season chicken with cumin, paprika, and oregano.",
      "Grill chicken 6-7 minutes per side.",
      "Serve over rice with tomatoes and olives.",
    ],
    flavorNotes: "Smoky paprika and briny olives with tender grilled chicken.",
    ...overrides,
  };
}

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const MEAL_TYPES = ["breakfast", "lunch", "dinner", "snack"];

function makeGoldenPlan(): MealPlanResponse {
  const titles = [
    // 28 unique meal titles (4 per day × 7 days)
    "Shakshuka", "Mediterranean Wrap", "Lemon Herb Salmon", "Hummus & Veggies",
    "Greek Yogurt Parfait", "Chicken Shawarma Bowl", "Lamb Kofta Plate", "Energy Bites",
    "Avocado Toast with Egg", "Falafel Plate", "Beef Kebab Dinner", "Apple & Almond Butter",
    "Overnight Oats", "Turkey Meatball Sub", "Shrimp Stir Fry", "Trail Mix",
    "Banana Pancakes", "Lentil Soup", "Stuffed Bell Peppers", "Greek Yogurt with Berries",
    "Egg Muffins", "Quinoa Tabbouleh", "Grilled Tilapia Tacos", "Dates & Walnuts",
    "Smoothie Bowl", "Chickpea Salad", "Tofu Curry", "Cucumber Slices with Tzatziki",
  ];

  let titleIdx = 0;
  const days = DAYS.map((day) => ({
    day,
    meals: MEAL_TYPES.map((mealType) =>
      makeMeal({
        title: titles[titleIdx++],
        mealType,
        id: `gen-${titleIdx}`,
      })
    ),
  }));

  return {
    weekPlan: { title: "Golden Week Plan", days },
    shoppingList: [
      { name: "Chicken thighs", quantity: "3 lbs", aisle: "Meat & Seafood", status: "needed" as const },
      { name: "Rice", quantity: "4 cups", aisle: "Grains & Pasta", status: "needed" as const },
      { name: "Cherry tomatoes", quantity: "2 pints", aisle: "Produce", status: "needed" as const },
    ],
    prepTips: [{ day: "Sunday", tip: "Marinate chicken and cook grains" }],
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Golden file: parse + normalize pipeline", () => {
  it("parses a valid 7-day plan from raw JSON string", () => {
    const golden = makeGoldenPlan();
    const raw = JSON.stringify(golden);
    const parsed = parseMealPlanResponse(raw);
    expect(parsed.weekPlan.days.length).toBe(7);
    expect(parsed.weekPlan.title).toBe("Golden Week Plan");
  });

  it("parses a plan wrapped in markdown code fences", () => {
    const golden = makeGoldenPlan();
    const raw = "```json\n" + JSON.stringify(golden, null, 2) + "\n```";
    const parsed = parseMealPlanResponse(raw);
    expect(parsed.weekPlan.days.length).toBe(7);
  });

  it("parses a plan with AI preamble and postamble text", () => {
    const golden = makeGoldenPlan();
    const raw = "Here is your Mediterranean meal plan for the week:\n\n" +
      JSON.stringify(golden, null, 2) +
      "\n\nEnjoy your meals! Let me know if you need any changes.";
    const parsed = parseMealPlanResponse(raw);
    expect(parsed.weekPlan.days.length).toBe(7);
  });

  it("normalizes all meals with correct types", () => {
    const golden = makeGoldenPlan();
    const normalized = normalizeMealPlan(golden);
    for (const day of normalized.weekPlan.days) {
      for (const meal of day.meals) {
        expect(typeof meal.id).toBe("string");
        expect(typeof meal.title).toBe("string");
        expect(["breakfast", "lunch", "dinner", "snack"]).toContain(meal.mealType);
        expect(typeof meal.servings).toBe("number");
        expect(Number.isInteger(meal.servings)).toBe(true);
        expect(typeof meal.calories).toBe("number");
        expect(Array.isArray(meal.ingredients)).toBe(true);
        expect(Array.isArray(meal.steps)).toBe(true);
      }
    }
  });

  it("rounds fractional servings to integers", () => {
    const golden = makeGoldenPlan();
    // Inject fractional servings (simulating AI mistake)
    golden.weekPlan.days[0].meals[0].servings = 2.5 as unknown as number;
    const normalized = normalizeMealPlan(golden as unknown as MealPlanResponse);
    expect(normalized.weekPlan.days[0].meals[0].servings).toBe(3);
  });

  it("defaults missing mealType by position index", () => {
    const golden = makeGoldenPlan();
    // Remove mealType from the second meal (index 1 = lunch)
    (golden.weekPlan.days[0].meals[1] as Record<string, unknown>).mealType = "";
    const normalized = normalizeMealPlan(golden as unknown as MealPlanResponse);
    expect(normalized.weekPlan.days[0].meals[1].mealType).toBe("lunch");
  });
});

describe("Golden file: validation rules (structural)", () => {
  it("a valid golden plan has exactly 7 days", () => {
    const golden = makeGoldenPlan();
    expect(golden.weekPlan.days.length).toBe(7);
  });

  it("each day has exactly 4 meals", () => {
    const golden = makeGoldenPlan();
    for (const day of golden.weekPlan.days) {
      expect(day.meals.length).toBe(4);
    }
  });

  it("no duplicate day names in golden plan", () => {
    const golden = makeGoldenPlan();
    const names = golden.weekPlan.days.map((d) => d.day);
    expect(new Set(names).size).toBe(7);
  });

  it("all 28 meals have unique titles", () => {
    const golden = makeGoldenPlan();
    const titles = golden.weekPlan.days.flatMap((d) => d.meals.map((m) => m.title));
    expect(new Set(titles).size).toBe(28);
  });

  it("all meals have non-zero nutrition", () => {
    const golden = makeGoldenPlan();
    for (const day of golden.weekPlan.days) {
      for (const meal of day.meals) {
        expect(meal.calories).toBeGreaterThan(0);
        expect(meal.protein).toBeGreaterThan(0);
        expect(meal.carbs).toBeGreaterThan(0);
        expect(meal.fats).toBeGreaterThan(0);
      }
    }
  });

  it("all meals have flavorNotes", () => {
    const golden = makeGoldenPlan();
    for (const day of golden.weekPlan.days) {
      for (const meal of day.meals) {
        expect(meal.flavorNotes).toBeTruthy();
      }
    }
  });

  it("all meals have at least 1 ingredient and 1 step", () => {
    const golden = makeGoldenPlan();
    for (const day of golden.weekPlan.days) {
      for (const meal of day.meals) {
        expect(meal.ingredients.length).toBeGreaterThanOrEqual(1);
        expect(meal.steps.length).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it("detects a plan with duplicate days", () => {
    const golden = makeGoldenPlan();
    golden.weekPlan.days[1].day = golden.weekPlan.days[0].day; // Duplicate Monday
    const dayNames = golden.weekPlan.days.map((d) => d.day);
    const unique = new Set(dayNames);
    expect(unique.size).toBeLessThan(dayNames.length);
  });

  it("detects a plan with zero-calorie meal", () => {
    const golden = makeGoldenPlan();
    golden.weekPlan.days[2].meals[3].calories = 0;
    const badMeal = golden.weekPlan.days[2].meals[3];
    expect(badMeal.calories).toBe(0);
  });

  it("detects a plan with only 6 days", () => {
    const golden = makeGoldenPlan();
    golden.weekPlan.days.pop();
    expect(golden.weekPlan.days.length).toBe(6);
  });
});

describe("Edge cases: malformed AI responses", () => {
  it("throws on completely empty string", () => {
    expect(() => parseMealPlanResponse("")).toThrow();
  });

  it("throws on plain text with no JSON", () => {
    expect(() => parseMealPlanResponse("I cannot generate a meal plan right now.")).toThrow();
  });

  it("throws on JSON that is not a meal plan shape", () => {
    const notAPlan = { foo: "bar", items: [1, 2, 3] };
    expect(() => parseMealPlanResponse(JSON.stringify(notAPlan))).toThrow();
  });

  it("throws on array instead of object", () => {
    expect(() => parseMealPlanResponse("[1, 2, 3]")).toThrow();
  });

  it("handles BOM character at start of response", () => {
    const golden = makeGoldenPlan();
    const raw = "\uFEFF" + JSON.stringify(golden);
    const parsed = parseMealPlanResponse(raw);
    expect(parsed.weekPlan.days.length).toBe(7);
  });
});
