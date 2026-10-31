import { describe, expect, it } from "vitest";

import { stripSkippedDayTips } from "@/lib/mealPlanParser";
import { skipSlotKey } from "@/types/mealPlan";
import type { MealPlanResponse, MealRecipe, PrepTip, SkipSlots } from "@/types/mealPlan";

/** Minimal type-valid MealRecipe fixture (mirrors mealPlanParser.test.ts style). */
function makeMeal(id: string, title: string, mealType: MealRecipe["mealType"]): MealRecipe {
  return {
    id,
    title,
    mealType,
    prepTime: "30 min",
    servings: 4,
    calories: 500,
    protein: 30,
    carbs: 40,
    fats: 18,
    tags: [],
    ingredients: [],
    steps: [],
  };
}

/**
 * Kristina repro (D-09): start_date = Tue, Fri/Sat/Sun fully skipped, recipes Mon–Thu only.
 * Today this plan's tips cite Fri/Sat/Sun for recipes actually scheduled Mon–Thu.
 */
function buildKristinaPlan(): MealPlanResponse {
  const skipSlots: SkipSlots = {};
  for (const day of ["Friday", "Saturday", "Sunday"]) {
    for (const mt of ["breakfast", "lunch", "dinner", "snack"]) {
      skipSlots[skipSlotKey(day, mt)] = true;
    }
  }

  return {
    weekPlan: {
      title: "Kristina's Week",
      batchCookDay: "Monday",
      days: [
        { day: "Tuesday", meals: [makeMeal("tue-dinner", "Sheet-Pan Salmon", "dinner")] },
        { day: "Wednesday", meals: [makeMeal("wed-dinner", "Mexican Lean Beef", "dinner")] },
        { day: "Thursday", meals: [makeMeal("thu-dinner", "White Bean Tostadas", "dinner")] },
        { day: "Monday", meals: [makeMeal("mon-breakfast", "Whole Wheat Toast", "breakfast")] },
      ],
    },
    shoppingList: [],
    skipSlots,
    prepTips: [
      // (a) skipped-day FIELD — drop.
      {
        id: "tip-fri-night",
        day: "Friday",
        tip: "Set out ingredients for the weekend.",
        referenced_meal_ids: ["wed-dinner"],
      },
      // (b) skipped weekday named in TEXT (on an active day, with a valid id) — text-scan-wins → drop.
      {
        id: "tip-tue-night-bad",
        day: "Tuesday",
        tip: "For Saturday dinner (White Bean Tostadas), thaw the beans tonight.",
        referenced_meal_ids: ["wed-dinner"],
      },
      // (c1) referenced_meal_ids resolving ONLY to a skipped/unresolvable slot — drop.
      {
        id: "tip-mon-night-bad",
        day: "Monday",
        tip: "Set out ingredients for the next dinner.",
        referenced_meal_ids: ["fri-dinner"],
      },
      // (c2) MIXED ids — keep, with only the active id retained.
      {
        id: "tip-wed-night",
        day: "Wednesday",
        tip: "Tonight, prep quick components for tomorrow.",
        referenced_meal_ids: ["wed-dinner", "fri-dinner"],
      },
      // clean control on an active day — must survive unchanged.
      {
        id: "tip-prep-1",
        day: "Tuesday",
        tip: "Wash and chop produce for the early-week dinners.",
        referenced_meal_ids: ["tue-dinner"],
      },
    ],
  };
}

function buildResolver(plan: MealPlanResponse): Map<string, { day: string; mealType: string }> {
  const m = new Map<string, { day: string; mealType: string }>();
  for (const day of plan.weekPlan.days) {
    for (const meal of day.meals) {
      m.set(meal.id, { day: day.day, mealType: meal.mealType });
    }
  }
  return m;
}

const SKIPPED_DAY_RE = /\b(Friday|Saturday|Sunday)\b/i;

describe("stripSkippedDayTips — Kristina skip-slot regression (D-09)", () => {
  it("strips every skip-violation channel while preserving valid tips", () => {
    const plan = buildKristinaPlan();
    const resolver = buildResolver(plan);
    const cleaned = stripSkippedDayTips(plan, plan.skipSlots);
    const survivors = cleaned.prepTips;

    // Channel (a): no surviving tip is tagged with a skipped day.
    expect(survivors.every((t) => !["Friday", "Saturday", "Sunday"].includes(t.day))).toBe(true);

    // Channel (b): no surviving tip's text names a skipped weekday.
    expect(survivors.every((t) => !SKIPPED_DAY_RE.test(t.tip))).toBe(true);

    // Channel (c): no surviving referenced_meal_id resolves to a skipped/unresolvable slot.
    for (const tip of survivors) {
      for (const id of tip.referenced_meal_ids ?? []) {
        const slot = resolver.get(id);
        expect(slot).toBeDefined();
        expect(plan.skipSlots![skipSlotKey(slot!.day, slot!.mealType)]).toBeUndefined();
      }
    }

    // Mixed-id tip survives with ONLY the active id retained.
    const mixed = survivors.find((t) => t.id === "tip-wed-night");
    expect(mixed).toBeDefined();
    expect(mixed!.referenced_meal_ids).toEqual(["wed-dinner"]);

    // Clean control tip survives unchanged.
    const control = survivors.find((t) => t.id === "tip-prep-1");
    expect(control).toBeDefined();
    expect(control!.referenced_meal_ids).toEqual(["tue-dinner"]);

    // Exactly the two clean tips survive; the three violations are gone.
    expect(survivors.map((t) => t.id)).toEqual(["tip-wed-night", "tip-prep-1"]);

    // The input plan is not mutated (pure function).
    expect(plan.prepTips).toHaveLength(5);
  });

  it("is a no-op when no slots are skipped (non-regression)", () => {
    const plan = buildKristinaPlan();
    const noSkipPlan: MealPlanResponse = { ...plan, skipSlots: undefined };
    const before: PrepTip[] = JSON.parse(JSON.stringify(noSkipPlan.prepTips));

    const cleaned = stripSkippedDayTips(noSkipPlan);

    expect(cleaned.prepTips).toEqual(before);
  });

  it("is idempotent (running the strip twice yields the same result)", () => {
    const plan = buildKristinaPlan();
    const once = stripSkippedDayTips(plan, plan.skipSlots);
    const twice = stripSkippedDayTips(once, plan.skipSlots);

    expect(twice.prepTips).toEqual(once.prepTips);
  });

  // G-12-01: when the prep/batch-cook day is itself a fully-skipped meal day (e.g. skip
  // Fri/Sat/Sun with a Sunday week-start → prepDay = Saturday), the prep day must be
  // exempt — its prep-day tasks survive, but tips referencing OTHER skipped cook days
  // are still stripped.
  it("keeps prep-day tasks when the prep/batch-cook day is itself fully skipped (G-12-01)", () => {
    const skipSlots: SkipSlots = {};
    for (const day of ["Friday", "Saturday", "Sunday"]) {
      for (const mt of ["breakfast", "lunch", "dinner", "snack"]) {
        skipSlots[skipSlotKey(day, mt)] = true;
      }
    }
    const plan: MealPlanResponse = {
      weekPlan: {
        title: "Sunday-start week",
        batchCookDay: "Saturday", // prep day == a fully-skipped meal day
        days: [
          { day: "Monday", meals: [makeMeal("mon-dinner", "Za'atar Chicken", "dinner")] },
          { day: "Tuesday", meals: [makeMeal("tue-dinner", "Chicken Skillet", "dinner")] },
        ],
      },
      shoppingList: [],
      skipSlots,
      prepTips: [
        // prep-day task tagged the prep day (Saturday), and its text names "Saturday" —
        // must SURVIVE despite Saturday being a fully-skipped meal day.
        {
          id: "tip-prep-1",
          day: "Saturday",
          tip: "On Saturday, roast 3 lbs chicken for Monday and Tuesday dinners.",
          referenced_meal_ids: ["mon-dinner", "tue-dinner"],
        },
        // tagged a skipped COOK day (Friday, not the prep day) — must DROP.
        { id: "tip-fri", day: "Friday", tip: "Prep something.", referenced_meal_ids: ["mon-dinner"] },
        // names a skipped cook day (Sunday) in text — must DROP.
        { id: "tip-sun-text", day: "Monday", tip: "Get ready for Sunday brunch.", referenced_meal_ids: ["mon-dinner"] },
        // nightly tip on an active day — must SURVIVE.
        { id: "tip-mon-night", day: "Monday", tip: "For Tuesday, thaw the chicken.", referenced_meal_ids: ["tue-dinner"] },
      ],
    };

    const cleaned = stripSkippedDayTips(plan, skipSlots);
    const ids = cleaned.prepTips.map((t) => t.id);

    // Prep-day task survives even though it is tagged Saturday and names "Saturday".
    expect(ids).toContain("tip-prep-1");
    expect(cleaned.prepTips.find((t) => t.id === "tip-prep-1")!.referenced_meal_ids).toEqual([
      "mon-dinner",
      "tue-dinner",
    ]);
    // Skipped-cook-day references are still stripped.
    expect(ids).not.toContain("tip-fri");
    expect(ids).not.toContain("tip-sun-text");
    // Active-day nightly tip survives.
    expect(ids).toContain("tip-mon-night");
  });
});
