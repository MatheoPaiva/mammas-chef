import { describe, expect, it } from "vitest";
import {
  validateMealPlanDependencies,
  type ValidationError,
} from "@/lib/mealPlanValidation";
import type {
  DayPlan,
  MealPlanResponse,
  MealRecipe,
  PrepTip,
} from "@/types/mealPlan";

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;
const SLOTS: MealRecipe["mealType"][] = ["breakfast", "lunch", "dinner", "snack"];

function makeMeal(day: string, mealType: MealRecipe["mealType"], overrides: Partial<MealRecipe> = {}): MealRecipe {
  return {
    id: `m-${day}-${mealType}`,
    title: `${day} ${mealType}`,
    mealType,
    prepTime: "20 minutes",
    servings: 4,
    calories: 500,
    protein: 30,
    carbs: 40,
    fats: 20,
    tags: [],
    ingredients: [],
    steps: [],
    ...overrides,
  };
}

interface MakePlanOptions {
  /** Map of day-name → set of mealTypes to omit from that day. */
  skipSlots?: Record<string, MealRecipe["mealType"][]>;
  /** Per-(day, mealType) meal overrides (e.g. add source_meal_id). */
  mealOverrides?: Record<string, Partial<MealRecipe>>; // key = `${day}:${mealType}`
  /** Replace generated meals entirely with caller-supplied list per day. */
  daysOverride?: DayPlan[];
  /** Replace prepTips entirely. */
  prepTipsOverride?: PrepTip[];
  /** Force every meal id to be empty string (legacy mode). */
  legacy?: boolean;
  /** Strip referenced_meal_ids and source_meal_id everywhere (used with legacy). */
  stripNewFields?: boolean;
}

function makePlan(opts: MakePlanOptions = {}): MealPlanResponse {
  const skipSlots = opts.skipSlots ?? {};
  const mealOverrides = opts.mealOverrides ?? {};

  const days: DayPlan[] = opts.daysOverride ?? DAYS.map((day) => {
    const skip = new Set(skipSlots[day] ?? []);
    const meals: MealRecipe[] = SLOTS.filter((s) => !skip.has(s)).map((mealType) => {
      const key = `${day}:${mealType}`;
      const base = makeMeal(day, mealType);
      const override = mealOverrides[key] ?? {};
      const merged: MealRecipe = { ...base, ...override };
      if (opts.legacy) merged.id = "";
      if (opts.stripNewFields) {
        delete merged.source_meal_id;
      }
      return merged;
    });
    return { day, meals };
  });

  const defaultPrepTips: PrepTip[] = [
    { day: "Sunday", tip: "Batch-cook the proteins", id: "tip-1", referenced_meal_ids: ["m-Monday-dinner"] },
  ];
  let prepTips = opts.prepTipsOverride ?? defaultPrepTips;
  if (opts.stripNewFields) {
    prepTips = prepTips.map(({ day, tip }) => ({ day, tip }));
  }

  return {
    weekPlan: { title: "Test Plan", days },
    shoppingList: [],
    prepTips,
  };
}

describe("validateMealPlanDependencies", () => {
  it("returns valid for a fully wired new-schema plan (happy path)", () => {
    const plan = makePlan({
      mealOverrides: {
        "Tuesday:dinner": { source_meal_id: "m-Monday-dinner" },
        "Wednesday:lunch": { source_meal_id: "m-Monday-dinner" },
      },
      prepTipsOverride: [
        { day: "Sunday", tip: "Cook all proteins", id: "t1", referenced_meal_ids: ["m-Monday-dinner", "m-Tuesday-dinner"] },
        { day: "Wednesday", tip: "Reheat leftover", id: "t2", referenced_meal_ids: ["m-Wednesday-lunch"] },
      ],
    });

    const result = validateMealPlanDependencies(plan);
    expect(result).toEqual({ valid: true, errors: [] });
  });

  it("QA #1: detects future-day leftover (Thursday lunch from Friday dinner)", () => {
    const plan = makePlan({
      mealOverrides: {
        "Thursday:lunch": { source_meal_id: "m-Friday-dinner" },
      },
      prepTipsOverride: [],
    });

    const result = validateMealPlanDependencies(plan);
    expect(result.valid).toBe(false);
    const err = result.errors.find((e) => e.code === "LEFTOVER_FROM_FUTURE");
    expect(err).toBeDefined();
    expect(err!.dayIndex).toBe(3);
    expect(err!.mealType).toBe("lunch");
    expect(err!.sourceDayIndex).toBe(4);
    expect(err!.sourceMealType).toBe("dinner");
    expect(err!.message).toContain("Thursday lunch");
    expect(err!.message).toContain("Friday dinner");
    expect(err!.message).toContain("future");
  });

  it("QA #2: detects source meal that does not exist (Friday lunch missing source)", () => {
    const plan = makePlan({
      mealOverrides: {
        "Friday:lunch": { source_meal_id: "ghost-meal-id-abc" },
      },
      prepTipsOverride: [],
    });

    const result = validateMealPlanDependencies(plan);
    expect(result.valid).toBe(false);
    const err = result.errors.find((e) => e.code === "LEFTOVER_SOURCE_MISSING");
    expect(err).toBeDefined();
    expect(err!.dayIndex).toBe(4);
    expect(err!.mealType).toBe("lunch");
    expect(err!.sourceMealId).toBe("ghost-meal-id-abc");
    expect(err!.message).toContain("Friday lunch");
    expect(err!.message).toContain("ghost-meal-id-abc");
  });

  it("detects prep tip with dangling referenced_meal_ids", () => {
    const plan = makePlan({
      prepTipsOverride: [
        { day: "Sunday", tip: "Prep oats", id: "t1", referenced_meal_ids: ["non-existent-id"] },
      ],
    });

    const result = validateMealPlanDependencies(plan);
    expect(result.valid).toBe(false);
    const err = result.errors.find((e) => e.code === "PREP_TIP_REF_MISSING");
    expect(err).toBeDefined();
    expect(err!.prepTipDay).toBe("Sunday");
    expect(err!.sourceMealId).toBe("non-existent-id");
    expect(err!.message).toContain("Sunday");
    expect(err!.message).toContain("non-existent-id");
  });

  it("detects same-day same-slot self-reference", () => {
    const plan = makePlan({
      mealOverrides: {
        "Wednesday:dinner": { source_meal_id: "m-Wednesday-dinner" },
      },
      prepTipsOverride: [],
    });

    const result = validateMealPlanDependencies(plan);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === "LEFTOVER_FROM_SELF_OR_LATER")).toBe(true);
  });

  it("legacy plan (no IDs anywhere) skips all checks and returns valid", () => {
    const plan = makePlan({
      legacy: true,
      stripNewFields: true,
      prepTipsOverride: [
        { day: "Sunday", tip: "Cook proteins" },
      ],
    });

    const result = validateMealPlanDependencies(plan);
    expect(result).toEqual({ valid: true, errors: [] });
  });

  it("aggregates multiple errors without short-circuiting", () => {
    const plan = makePlan({
      mealOverrides: {
        "Thursday:lunch": { source_meal_id: "m-Friday-dinner" },
        "Friday:lunch": { source_meal_id: "ghost-meal-id-abc" },
      },
      prepTipsOverride: [],
    });

    const result = validateMealPlanDependencies(plan);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === "LEFTOVER_FROM_FUTURE")).toBe(true);
    expect(result.errors.some((e) => e.code === "LEFTOVER_SOURCE_MISSING")).toBe(true);
  });

  it("new-schema plan with prep tip missing referenced_meal_ids → valid (absence not blocking)", () => {
    const plan = makePlan({
      prepTipsOverride: [
        { day: "Sunday", tip: "Cook all proteins", id: "t1" },
      ],
    });

    const result = validateMealPlanDependencies(plan);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("new-schema plan with empty referenced_meal_ids array → valid (empty not blocking)", () => {
    const plan = makePlan({
      prepTipsOverride: [
        { day: "Sunday", tip: "Cook all proteins", id: "t1", referenced_meal_ids: [] },
      ],
    });

    const result = validateMealPlanDependencies(plan);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("slot index derived from mealType, not array position (skipped breakfast)", () => {
    // Tuesday has breakfast skipped — meals = [lunch, dinner, snack]. Wednesday lunch references
    // 'tue-breakfast', which doesn't exist. Validator must report MISSING, not silently resolve
    // to meals[0] (which is now lunch).
    const tuesdayMeals: MealRecipe[] = [
      makeMeal("Tuesday", "lunch", { id: "tue-lunch" }),
      makeMeal("Tuesday", "dinner", { id: "tue-dinner" }),
      makeMeal("Tuesday", "snack", { id: "tue-snack" }),
    ];
    const daysWithSkip: DayPlan[] = DAYS.map((day) => {
      if (day === "Tuesday") return { day, meals: tuesdayMeals };
      return {
        day,
        meals: SLOTS.map((mealType) => makeMeal(day, mealType)),
      };
    });
    const wedIdx = daysWithSkip.findIndex((d) => d.day === "Wednesday");
    daysWithSkip[wedIdx] = {
      ...daysWithSkip[wedIdx],
      meals: daysWithSkip[wedIdx].meals.map((m) =>
        m.mealType === "lunch" ? { ...m, source_meal_id: "tue-breakfast" } : m,
      ),
    };

    const plan: MealPlanResponse = {
      weekPlan: { title: "Skip-slot test", days: daysWithSkip },
      shoppingList: [],
      prepTips: [
        { day: "Sunday", tip: "Cook proteins", id: "t1", referenced_meal_ids: ["tue-lunch"] },
      ],
    };

    const result = validateMealPlanDependencies(plan);
    expect(result.valid).toBe(false);
    expect(
      result.errors.some(
        (e) => e.code === "LEFTOVER_SOURCE_MISSING" && e.sourceMealId === "tue-breakfast",
      ),
    ).toBe(true);

    // Counter-test: Wed lunch references 'tue-lunch' (slot 1 = lunch). Should resolve and pass
    // chronology check (Tuesday < Wednesday by day index).
    const counterDays: DayPlan[] = DAYS.map((day) => {
      if (day === "Tuesday") return { day, meals: tuesdayMeals };
      return {
        day,
        meals: SLOTS.map((mealType) => makeMeal(day, mealType)),
      };
    });
    const wedIdx2 = counterDays.findIndex((d) => d.day === "Wednesday");
    counterDays[wedIdx2] = {
      ...counterDays[wedIdx2],
      meals: counterDays[wedIdx2].meals.map((m) =>
        m.mealType === "lunch" ? { ...m, source_meal_id: "tue-lunch" } : m,
      ),
    };
    const counterPlan: MealPlanResponse = {
      weekPlan: { title: "Counter", days: counterDays },
      shoppingList: [],
      prepTips: [
        { day: "Sunday", tip: "Cook proteins", id: "t1", referenced_meal_ids: ["tue-lunch"] },
      ],
    };
    const counterResult = validateMealPlanDependencies(counterPlan);
    expect(counterResult.valid).toBe(true);
    expect(counterResult.errors).toEqual([]);
  });

  it("G-02: detects '(from X)' in title without resolving source_meal_id → LEFTOVER_TITLE_HALLUCINATED", () => {
    const plan = makePlan({
      mealOverrides: {
        "Friday:lunch": {
          title: "Creamy Tomato & Feta Baked Orzo (from Friday Dinner)",
          // source_meal_id intentionally absent — this is the bug
        },
      },
    });

    const result = validateMealPlanDependencies(plan);
    expect(result.valid).toBe(false);
    const err = result.errors.find((e) => e.code === "LEFTOVER_TITLE_HALLUCINATED");
    expect(err).toBeDefined();
    expect(err!.mealType).toBe("lunch");
  });

  it("G-02: '(from X)' title with valid resolving source_meal_id is allowed", () => {
    const plan = makePlan({
      mealOverrides: {
        "Tuesday:dinner": {
          title: "Reheated Chicken (from Monday Dinner)",
          source_meal_id: "m-Monday-dinner",
        },
      },
    });

    const result = validateMealPlanDependencies(plan);
    expect(result.errors.some((e) => e.code === "LEFTOVER_TITLE_HALLUCINATED")).toBe(false);
  });

  it("G-02: '(leftover from X)' phrasing also caught", () => {
    const plan = makePlan({
      mealOverrides: {
        "Friday:lunch": { title: "Roast Veggies (leftover from Tuesday)" },
      },
    });

    const result = validateMealPlanDependencies(plan);
    expect(result.errors.some((e) => e.code === "LEFTOVER_TITLE_HALLUCINATED")).toBe(true);
  });

  it("G-04 Variant A: step text promises downstream consumer with no link → LEFTOVER_STEP_HALLUCINATED", () => {
    const plan = makePlan({
      mealOverrides: {
        "Tuesday:dinner": {
          steps: [
            "Sear the chicken.",
            "Portion half (3 servings) into an airtight container and refrigerate for Wednesday lunch.",
          ],
        },
      },
    });

    const result = validateMealPlanDependencies(plan);
    const err = result.errors.find((e) => e.code === "LEFTOVER_STEP_HALLUCINATED");
    expect(err).toBeDefined();
    expect(err!.mealType).toBe("dinner");
  });

  it("G-04 Variant A: step text + matching downstream source_meal_id is allowed", () => {
    const plan = makePlan({
      mealOverrides: {
        "Tuesday:dinner": {
          steps: ["Portion half and refrigerate for Wednesday lunch."],
        },
        "Wednesday:lunch": {
          source_meal_id: "m-Tuesday-dinner",
        },
      },
    });

    const result = validateMealPlanDependencies(plan);
    expect(result.errors.some((e) => e.code === "LEFTOVER_STEP_HALLUCINATED")).toBe(false);
  });

  it("G-04 Variant A: generic portioning step (no day/mealType) is allowed", () => {
    const plan = makePlan({
      mealOverrides: {
        "Tuesday:dinner": {
          steps: ["Portion leftovers into airtight containers for later use."],
        },
      },
    });

    const result = validateMealPlanDependencies(plan);
    expect(result.errors.some((e) => e.code === "LEFTOVER_STEP_HALLUCINATED")).toBe(false);
  });

  it("G-04 Variant B: 'from Monday dinner' in ingredient line without source_meal_id → LEFTOVER_INGREDIENT_HALLUCINATED", () => {
    const plan = makePlan({
      mealOverrides: {
        "Thursday:lunch": {
          ingredients: [
            { quantity: 1, unit: "servings", name: "Tuscan Baked Tofu with Cannellini Beans & Kale, from Monday dinner" },
            { quantity: 0.5, unit: "cup", name: "arugula" },
          ],
          // no source_meal_id — this is the bug
        },
      },
    });

    const result = validateMealPlanDependencies(plan);
    const err = result.errors.find((e) => e.code === "LEFTOVER_INGREDIENT_HALLUCINATED");
    expect(err).toBeDefined();
    expect(err!.mealType).toBe("lunch");
  });

  it("G-06: meal tagged 'Leftover' without resolving source_meal_id → LEFTOVER_PHANTOM_MEAL", () => {
    const plan = makePlan({
      mealOverrides: {
        "Sunday:lunch": {
          title: "Mexican Beef & Poblano Skillet Bowl",
          tags: ["Toddler-Friendly", "Leftover", "Mexican"],
          // no source_meal_id — this is the bug
        },
      },
    });

    const result = validateMealPlanDependencies(plan);
    const err = result.errors.find((e) => e.code === "LEFTOVER_PHANTOM_MEAL");
    expect(err).toBeDefined();
    expect(err!.mealType).toBe("lunch");
  });

  it("G-06: 'Leftovers' (plural) tag also caught", () => {
    const plan = makePlan({
      mealOverrides: {
        "Tuesday:lunch": {
          title: "Mexican Tofu Scramble",
          tags: ["Vegetarian", "Leftovers"],
        },
      },
    });

    const result = validateMealPlanDependencies(plan);
    expect(result.errors.some((e) => e.code === "LEFTOVER_PHANTOM_MEAL")).toBe(true);
  });

  it("G-06: leftover-tagged meal with valid source_meal_id is allowed", () => {
    const plan = makePlan({
      mealOverrides: {
        "Tuesday:dinner": {
          tags: ["Leftover"],
          source_meal_id: "m-Monday-dinner",
        },
      },
    });

    const result = validateMealPlanDependencies(plan);
    expect(result.errors.some((e) => e.code === "LEFTOVER_PHANTOM_MEAL")).toBe(false);
  });

  it("Phase 15 dual-signal: status:'leftover' with zero tags and no source_meal_id → LEFTOVER_PHANTOM_MEAL", () => {
    const plan = makePlan({
      mealOverrides: {
        "Sunday:lunch": {
          title: "Mexican Beef & Poblano Skillet Bowl",
          tags: [], // no leftover tag at all — status is the only signal
          status: "leftover",
          // no source_meal_id — this is the bug
        },
      },
    });

    const result = validateMealPlanDependencies(plan);
    const err = result.errors.find((e) => e.code === "LEFTOVER_PHANTOM_MEAL");
    expect(err).toBeDefined();
    expect(err!.mealType).toBe("lunch");
  });

  it("Phase 15 dual-signal: status:'leftover' with a valid earlier source_meal_id produces no LEFTOVER_PHANTOM_MEAL", () => {
    const plan = makePlan({
      mealOverrides: {
        "Tuesday:dinner": {
          tags: [], // no tag — status is the only signal
          status: "leftover",
          source_meal_id: "m-Monday-dinner",
        },
      },
    });

    const result = validateMealPlanDependencies(plan);
    expect(result.errors.some((e) => e.code === "LEFTOVER_PHANTOM_MEAL")).toBe(false);
  });

  it("G-04 Variant B: 'from X' ingredient with matching source_meal_id is allowed", () => {
    const plan = makePlan({
      mealOverrides: {
        "Tuesday:lunch": {
          ingredients: [
            { quantity: 1, unit: "servings", name: "Reheated portion, from Monday dinner" },
          ],
          source_meal_id: "m-Monday-dinner",
        },
      },
    });

    const result = validateMealPlanDependencies(plan);
    expect(result.errors.some((e) => e.code === "LEFTOVER_INGREDIENT_HALLUCINATED")).toBe(false);
  });
});

// Type-only smoke probe to ensure ValidationError is exported.
const _typeProbe: ValidationError | undefined = undefined;
void _typeProbe;
