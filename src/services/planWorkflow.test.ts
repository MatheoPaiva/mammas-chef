import { describe, expect, it } from "vitest";
import {
  sortDays,
  mergePinnedStubs,
  allergenFlaggedMeals,
  applyPlanEdit,
  buildSwapRequest,
  computeSwapEdit,
  buildDayRegenRequest,
  computeDayRegenEdit,
} from "./planWorkflow";
import { SYNTHESIZED_ID_PREFIX } from "@/lib/mealPlanParser";
import type { MealPlanResponse, MealRecipe } from "@/types/mealPlan";

function meal(overrides: Partial<MealRecipe> & Pick<MealRecipe, "id" | "mealType" | "title">): MealRecipe {
  return {
    prepTime: "10 min", servings: 4, calories: 400, protein: 30, carbs: 30, fats: 15,
    tags: [], ingredients: [], steps: [],
    ...overrides,
  };
}

// Thursday dinner creates batch S1; Friday lunch is its leftover.
function plan(): MealPlanResponse {
  return {
    weekPlan: {
      title: "Test Week",
      days: [
        { day: "Thursday", meals: [
          meal({ id: "thu-lunch", mealType: "lunch", title: "Soup" }),
          meal({ id: "thu-dinner", mealType: "dinner", title: "Baked Salmon", creates: "S1" }),
        ] },
        { day: "Friday", meals: [
          meal({ id: "fri-lunch", mealType: "lunch", title: "Leftover Baked Salmon", status: "leftover", source_meal_id: "thu-dinner", uses: ["S1"], servings: 2 }),
          meal({ id: "fri-dinner", mealType: "dinner", title: "Tacos" }),
        ] },
      ],
    },
    shoppingList: [],
    prepTips: [{ day: "Thursday", tip: "Thaw salmon" }],
  } as MealPlanResponse;
}

describe("sortDays", () => {
  it("orders days from the week start", () => {
    const days = [{ day: "Sunday", meals: [] }, { day: "Monday", meals: [] }, { day: "Saturday", meals: [] }];
    expect(sortDays(days, "Monday").map((d) => d.day)).toEqual(["Monday", "Saturday", "Sunday"]);
    expect(sortDays(days, "Sunday").map((d) => d.day)).toEqual(["Sunday", "Monday", "Saturday"]);
  });
});

describe("mergePinnedStubs", () => {
  const pinned = meal({ id: "pin-1", mealType: "dinner", title: "Nonna's Lasagna", steps: ["full recipe"] });
  const days = [{ day: "Monday", meals: [
    meal({ id: "x", mealType: "dinner", title: "  nonna's lasagna " }),
    meal({ id: "pin-1", mealType: "lunch", title: "Stub" }),
    meal({ id: "y", mealType: "breakfast", title: "Eggs" }),
  ] }];

  it("restores pinned recipes by id or title and leaves others alone", () => {
    const [m1, m2, m3] = mergePinnedStubs(days, [pinned])[0].meals;
    expect(m1.steps).toEqual(["full recipe"]);
    expect(m2.steps).toEqual(["full recipe"]);
    expect(m3.title).toBe("Eggs");
  });

  it("is a no-op without pins", () => {
    expect(mergePinnedStubs(days, undefined)).toBe(days);
  });
});

describe("allergenFlaggedMeals", () => {
  it("returns only meals whose caution note is an allergy warning", () => {
    const p = plan();
    p.weekPlan.days[0].meals[0].cautionNote = "Allergy warning: contains sesame";
    p.weekPlan.days[1].meals[1].cautionNote = "Spicy for toddlers";
    expect(allergenFlaggedMeals(p).map((f) => [f.day, f.meal.id])).toEqual([["Thursday", "thu-lunch"]]);
  });
});

describe("swap", () => {
  it("sizes the request for leftovers that depend on the outgoing meal", () => {
    const req = buildSwapRequest(plan(), 0, "dinner")!;
    expect(req.oldMeal.id).toBe("thu-dinner");
    expect(req.remainingMeals.map((m) => m.id)).not.toContain("thu-dinner");
    expect(req.dependentSource).toEqual({ count: 1, servingsSum: 2 });
    expect(buildSwapRequest(plan(), 0, "snack")).toBeNull();
  });

  it("keeps the slot id and creates tag, and re-points the leftover", () => {
    const p = plan();
    const oldMeal = p.weekPlan.days[0].meals[1];
    const edit = computeSwapEdit(p, 0, oldMeal, {
      newMeal: meal({ id: "ai-new", mealType: "dinner", title: "Roast Chicken" }),
      newShoppingItems: [],
    });
    const thuDinner = edit.weekPlan.days[0].meals[1];
    expect(thuDinner).toMatchObject({ id: "thu-dinner", title: "Roast Chicken", creates: "S1" });
    const friLunch = edit.weekPlan.days[1].meals[0];
    expect(friLunch.source_meal_id).toBe("thu-dinner");
    expect(friLunch.title).toContain("Roast Chicken");
    expect(edit.cascadeSuffixes).toHaveLength(1);
    expect(edit.prepTips).toBeUndefined();
  });
});

describe("applyPlanEdit", () => {
  it("keeps current tips when the edit has none, and clears the shopping list", () => {
    const p = { ...plan(), notes: "keep me", shoppingList: [{ name: "x" }] } as unknown as MealPlanResponse;
    const next = applyPlanEdit(p, { weekPlan: p.weekPlan, cascadeSuffixes: [] });
    expect(next.prepTips).toEqual(p.prepTips);
    expect(next.notes).toBe("keep me");
    expect(next.shoppingList).toEqual([]);
  });
});

describe("regenerate day", () => {
  it("skips slots the plan skips and sends the day's current ids", () => {
    const p = { ...plan(), skipSlots: { "Thursday:breakfast": true, "Thursday:snack": true } } as MealPlanResponse;
    const req = buildDayRegenRequest(p, 0)!;
    expect(req.targetDayLabel).toBe("Thursday");
    expect(req.activeMealTypes).toEqual(["lunch", "dinner"]);
    expect(req.replacedMealIds).toEqual(["thu-lunch", "thu-dinner"]);
    expect(req.remainingMeals.map((m) => m.id)).toEqual(["fri-lunch", "fri-dinner"]);
  });

  it("keeps slot ids, remaps same-day leftover links and tip refs, and cascades", () => {
    const p = plan();
    const edit = computeDayRegenEdit(p, 0, "Thursday", {
      newMeals: [
        meal({ id: "r1", mealType: "lunch", title: "Leftover Pasta", source_meal_id: "r2" }),
        meal({ id: "r2", mealType: "dinner", title: "Pasta Bake" }),
        meal({ id: "r3", mealType: "snack", title: "Apple" }),
      ],
      updatedPrepTips: [{ day: "Wednesday", tip: "Boil pasta", referenced_meal_ids: ["r2"] }],
    }, "Sunday");
    const [lunch, dinner, snack] = edit.weekPlan.days[0].meals;
    expect(lunch.id).toBe("thu-lunch");
    expect(lunch.source_meal_id).toBe("thu-dinner");
    expect(dinner.id).toBe("thu-dinner");
    expect(snack.id.startsWith(SYNTHESIZED_ID_PREFIX)).toBe(true);
    expect(edit.prepTips?.[0].referenced_meal_ids).toEqual(["thu-dinner"]);
    expect(edit.weekPlan.days[1].meals[0].title).toContain("Pasta Bake");
    expect(edit.cascadeSuffixes.length).toBeGreaterThan(0);
  });

  it("inserts a missing day in week order", () => {
    const p = plan();
    const edit = computeDayRegenEdit(p, 5, "Monday", {
      newMeals: [meal({ id: "r1", mealType: "dinner", title: "Stew" })],
    }, "Sunday");
    expect(edit.weekPlan.days.map((d) => d.day)).toEqual(["Monday", "Thursday", "Friday"]);
    expect(edit.cascadeSuffixes).toEqual([]);
  });
});
