import { describe, expect, it } from "vitest";
import { applyLeftoverCascade, findDependentMeals } from "./leftoverCascade";
import type { MealRecipe, WeekPlan } from "@/types/mealPlan";

function meal(overrides: Partial<MealRecipe> & Pick<MealRecipe, "id" | "mealType" | "title">): MealRecipe {
  return {
    prepTime: "10 min",
    servings: 4,
    calories: 400,
    protein: 30,
    carbs: 30,
    fats: 15,
    tags: [],
    ingredients: [],
    steps: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// MAMMASCHEF-32 canonical fixture: Thursday dinner (creates S1) is
// the source; Friday lunch (uses S1, source_meal_id=thu-dinner) is its
// leftover. 17-CONTEXT.md <specifics>.
// ---------------------------------------------------------------------------

function buildMammaschef32Fixture(): WeekPlan {
  return {
    title: "Test Week",
    batches: [
      {
        id: "S1",
        task: "Cook and portion salmon. Cool and store.",
        yield: "4 servings Baked Salmon",
        storage: "Refrigerate up to 4 days.",
        useBy: "Saturday",
        time: "~20 min",
      },
    ],
    days: [
      {
        day: "Thursday",
        meals: [
          meal({
            id: "thu-dinner",
            mealType: "dinner",
            title: "Baked Salmon",
            servings: 4,
            creates: "S1",
          }),
        ],
      },
      {
        day: "Friday",
        meals: [
          meal({
            id: "fri-lunch",
            mealType: "lunch",
            title: "Leftover Baked Salmon",
            source_meal_id: "thu-dinner",
            uses: ["S1"],
            ingredients: [
              { name: "prepared salmon portions from Batch S1", quantity: 3, unit: "" },
              { name: "prepared asparagus portions from Batch S1", quantity: 3, unit: "" },
              { name: "cooked rice", quantity: 1, unit: "cup" },
            ],
          }),
        ],
      },
    ],
  };
}

describe("applyLeftoverCascade — MAMMASCHEF-32 canonical fixture", () => {
  it("re-points the dependent's title, portion-reference ingredient lines, and the batch entity to the new source", () => {
    const weekPlan = buildMammaschef32Fixture();
    const oldMeal = weekPlan.days[0].meals[0]; // Thursday dinner (Baked Salmon)
    const newMeal = meal({
      id: "thu-dinner", // swap preserves the slot id (Planner.tsx L266)
      mealType: "dinner",
      title: "Lemon Herb Chicken",
      servings: 4,
    });

    // Mirror Planner.tsx: newMeal is already placed into the day's meals
    // before the cascade runs.
    const updatedDays = weekPlan.days.map((day, i) => (i === 0 ? { ...day, meals: [newMeal] } : day));
    const result = applyLeftoverCascade({ ...weekPlan, days: updatedDays }, oldMeal, newMeal);

    const friLunch = result.weekPlan.days[1].meals[0];
    expect(friLunch.title).toBe("Leftover Lemon Herb Chicken");
    expect(friLunch.ingredients).toEqual([
      { name: "prepared Lemon Herb Chicken portions from Batch S1", quantity: 3, unit: "" },
      { name: "prepared Lemon Herb Chicken portions from Batch S1", quantity: 3, unit: "" },
      { name: "cooked rice", quantity: 1, unit: "cup" },
    ]);
    // Linkage stays intact (D-10) — never dropped.
    expect(friLunch.source_meal_id).toBe("thu-dinner");
    expect(friLunch.uses).toEqual(["S1"]);

    // Batch entity keeps the SAME id (stable identity) but the content is rewritten.
    expect(result.weekPlan.batches).toHaveLength(1);
    const batch = result.weekPlan.batches![0];
    expect(batch.id).toBe("S1");
    expect(batch.task).toContain("Lemon Herb Chicken");
    expect(batch.yield).toContain("Lemon Herb Chicken");
    // Storage was already set — kept, not replaced with the conservative default.
    expect(batch.storage).toBe("Refrigerate up to 4 days.");

    expect(result.toastDescriptionSuffix).toBe("Friday lunch updated to leftover Lemon Herb Chicken.");
  });

  it("falls back to the conservative default storage when the batch had none", () => {
    const weekPlan = buildMammaschef32Fixture();
    weekPlan.batches![0].storage = null;
    const oldMeal = weekPlan.days[0].meals[0];
    const newMeal = meal({ id: "thu-dinner", mealType: "dinner", title: "Lemon Herb Chicken", servings: 4 });
    const updatedDays = weekPlan.days.map((day, i) => (i === 0 ? { ...day, meals: [newMeal] } : day));

    const result = applyLeftoverCascade({ ...weekPlan, days: updatedDays }, oldMeal, newMeal);

    expect(result.weekPlan.batches![0].storage).toBe("Refrigerate up to 3 days.");
  });
});

describe("applyLeftoverCascade — zero dependents", () => {
  it("is a no-op (unchanged weekPlan reference, null suffix) when the swapped meal has no dependents", () => {
    const weekPlan: WeekPlan = {
      title: "Test Week",
      batches: [],
      days: [
        { day: "Monday", meals: [meal({ id: "mon-dinner", mealType: "dinner", title: "Herb-Baked Salmon" })] },
        { day: "Tuesday", meals: [] },
      ],
    };
    const oldMeal = weekPlan.days[0].meals[0];
    const newMeal = meal({ id: "mon-dinner", mealType: "dinner", title: "Chicken Tagine" });
    const updatedDays = weekPlan.days.map((day, i) => (i === 0 ? { ...day, meals: [newMeal] } : day));
    const inputWeekPlan = { ...weekPlan, days: updatedDays };

    const result = applyLeftoverCascade(inputWeekPlan, oldMeal, newMeal);

    expect(result.toastDescriptionSuffix).toBeNull();
    expect(result.weekPlan).toBe(inputWeekPlan);
  });

  it("is a no-op when the swapped meal creates a batch but nothing consumes it yet", () => {
    const weekPlan: WeekPlan = {
      title: "Test Week",
      batches: [
        { id: "S1", task: "Cook salmon.", yield: "4 servings", storage: null, useBy: null, time: null },
      ],
      days: [
        { day: "Thursday", meals: [meal({ id: "thu-dinner", mealType: "dinner", title: "Baked Salmon", creates: "S1" })] },
      ],
    };
    const oldMeal = weekPlan.days[0].meals[0];
    const newMeal = meal({ id: "thu-dinner", mealType: "dinner", title: "Lemon Herb Chicken" });
    const updatedDays = weekPlan.days.map((day, i) => (i === 0 ? { ...day, meals: [newMeal] } : day));
    const inputWeekPlan = { ...weekPlan, days: updatedDays };

    const result = applyLeftoverCascade(inputWeekPlan, oldMeal, newMeal);

    expect(result.toastDescriptionSuffix).toBeNull();
    expect(result.weekPlan).toBe(inputWeekPlan);
  });
});

describe("applyLeftoverCascade — D-12 orphan-drop", () => {
  it("drops the now-orphaned batch when the leftover itself is swapped away, leaving the source meal untouched", () => {
    const weekPlan = buildMammaschef32Fixture();
    const oldMeal = weekPlan.days[1].meals[0]; // Friday lunch (the leftover itself)
    // swap-meal's narrowed schema never emits uses/creates — the replacement
    // consumes nothing.
    const newMeal = meal({ id: "fri-lunch", mealType: "lunch", title: "Fresh Greek Salad" });
    const updatedDays = weekPlan.days.map((day, i) => (i === 1 ? { ...day, meals: [newMeal] } : day));

    const result = applyLeftoverCascade({ ...weekPlan, days: updatedDays }, oldMeal, newMeal);

    // Batch S1 had exactly one consumer (Friday lunch) — now orphaned, dropped.
    expect(result.weekPlan.batches).toEqual([]);
    // The source meal (Thursday dinner) is untouched — still creates S1,
    // over-provisioned food is not an error (D-12).
    const thuDinner = result.weekPlan.days[0].meals[0];
    expect(thuDinner.creates).toBe("S1");
    expect(thuDinner.title).toBe("Baked Salmon");
    // Silent — no toast confirmation for a drop (Copywriting Contract).
    expect(result.toastDescriptionSuffix).toBeNull();
  });

  it("does NOT drop the batch when another meal still consumes it", () => {
    const weekPlan = buildMammaschef32Fixture();
    // Add a second consumer of S1 on Saturday.
    weekPlan.days.push({
      day: "Saturday",
      meals: [
        meal({
          id: "sat-breakfast",
          mealType: "breakfast",
          title: "Leftover Baked Salmon",
          source_meal_id: "thu-dinner",
          uses: ["S1"],
        }),
      ],
    });
    const oldMeal = weekPlan.days[1].meals[0]; // Friday lunch
    const newMeal = meal({ id: "fri-lunch", mealType: "lunch", title: "Fresh Greek Salad" });
    const updatedDays = weekPlan.days.map((day, i) => (i === 1 ? { ...day, meals: [newMeal] } : day));

    const result = applyLeftoverCascade({ ...weekPlan, days: updatedDays }, oldMeal, newMeal);

    expect(result.weekPlan.batches).toHaveLength(1);
    expect(result.weekPlan.batches![0].id).toBe("S1");
  });
});

describe("applyLeftoverCascade — multi-dependent suffix", () => {
  it("summarizes 3+ dependents into one toast suffix (Oxford comma join) and re-points all of them", () => {
    const weekPlan: WeekPlan = {
      title: "Test Week",
      batches: [
        { id: "S1", task: "Cook salmon.", yield: "4 servings salmon", storage: "Refrigerate up to 4 days.", useBy: "Sunday", time: "~20 min" },
      ],
      days: [
        { day: "Thursday", meals: [meal({ id: "thu-dinner", mealType: "dinner", title: "Baked Salmon", servings: 4, creates: "S1" })] },
        {
          day: "Friday",
          meals: [
            meal({
              id: "fri-lunch",
              mealType: "lunch",
              title: "Leftover Baked Salmon",
              source_meal_id: "thu-dinner",
              uses: ["S1"],
              ingredients: [{ name: "prepared salmon portions from Batch S1", quantity: 2, unit: "" }],
            }),
          ],
        },
        {
          day: "Saturday",
          meals: [
            meal({
              id: "sat-breakfast",
              mealType: "breakfast",
              title: "Leftover Baked Salmon",
              source_meal_id: "thu-dinner",
              uses: ["S1"],
              ingredients: [{ name: "prepared salmon portions from Batch S1", quantity: 1, unit: "" }],
            }),
          ],
        },
        {
          day: "Sunday",
          meals: [
            meal({
              id: "sun-lunch",
              mealType: "lunch",
              title: "Leftover Baked Salmon",
              source_meal_id: "thu-dinner",
              uses: ["S1"],
              ingredients: [{ name: "prepared salmon portions from Batch S1", quantity: 1, unit: "" }],
            }),
          ],
        },
      ],
    };
    const oldMeal = weekPlan.days[0].meals[0];
    const newMeal = meal({ id: "thu-dinner", mealType: "dinner", title: "Herb-Crusted Cod", servings: 4 });
    const updatedDays = weekPlan.days.map((day, i) => (i === 0 ? { ...day, meals: [newMeal] } : day));

    const result = applyLeftoverCascade({ ...weekPlan, days: updatedDays }, oldMeal, newMeal);

    expect(result.toastDescriptionSuffix).toBe(
      "Friday lunch, Saturday breakfast, and Sunday lunch updated to leftover Herb-Crusted Cod.",
    );
    for (const dayIdx of [1, 2, 3]) {
      const dependent = result.weekPlan.days[dayIdx].meals[0];
      expect(dependent.title).toBe("Leftover Herb-Crusted Cod");
      expect(dependent.ingredients[0].name).toBe("prepared Herb-Crusted Cod portions from Batch S1");
    }
  });

  it("joins exactly two dependents with 'and' (no Oxford comma)", () => {
    const weekPlan: WeekPlan = {
      title: "Test Week",
      batches: [{ id: "S1", task: "Cook salmon.", yield: "4 servings", storage: null, useBy: null, time: null }],
      days: [
        { day: "Thursday", meals: [meal({ id: "thu-dinner", mealType: "dinner", title: "Baked Salmon", creates: "S1" })] },
        {
          day: "Friday",
          meals: [meal({ id: "fri-lunch", mealType: "lunch", title: "Leftover Baked Salmon", source_meal_id: "thu-dinner", uses: ["S1"] })],
        },
        {
          day: "Saturday",
          meals: [meal({ id: "sat-breakfast", mealType: "breakfast", title: "Leftover Baked Salmon", source_meal_id: "thu-dinner", uses: ["S1"] })],
        },
      ],
    };
    const oldMeal = weekPlan.days[0].meals[0];
    const newMeal = meal({ id: "thu-dinner", mealType: "dinner", title: "Herb-Crusted Cod" });
    const updatedDays = weekPlan.days.map((day, i) => (i === 0 ? { ...day, meals: [newMeal] } : day));

    const result = applyLeftoverCascade({ ...weekPlan, days: updatedDays }, oldMeal, newMeal);

    expect(result.toastDescriptionSuffix).toBe("Friday lunch and Saturday breakfast updated to leftover Herb-Crusted Cod.");
  });
});

describe("findDependentMeals", () => {
  it("returns source_meal_id / uses consumers, excluding the meal itself by identity", () => {
    const weekPlan = buildMammaschef32Fixture();
    const source = weekPlan.days[0].meals[0];
    const leftover = weekPlan.days[1].meals[0];

    expect(findDependentMeals(weekPlan, source)).toEqual([{ meal: leftover, day: "Friday" }]);
    // The leftover creates no batch and nothing points at it.
    expect(findDependentMeals(weekPlan, leftover)).toEqual([]);
  });
});
