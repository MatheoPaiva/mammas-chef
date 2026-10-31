import { describe, expect, it } from "vitest";
import { estimatePrepTimeSavings, formatPrepTimeSavings, parseDurationMinutes } from "./prepTimeSavings";
import type { WeekPlan } from "@/types/mealPlan";

const weekPlan: WeekPlan = {
  title: "Timed Week",
  days: [
    {
      day: "Monday",
      meals: [
        {
          id: "meal-1",
          title: "Chicken Bowls",
          mealType: "dinner",
          prepTime: "20 min active / 40 min total",
          servings: 4,
          calories: 500,
          protein: 35,
          carbs: 45,
          fats: 18,
          tags: [],
          ingredients: [],
          steps: [],
        },
        {
          id: "meal-2",
          title: "Soup",
          mealType: "lunch",
          prepTime: "60 min",
          servings: 4,
          calories: 400,
          protein: 22,
          carbs: 35,
          fats: 12,
          tags: [],
          ingredients: [],
          steps: [],
        },
      ],
    },
  ],
};

describe("prep time savings", () => {
  it("parses minute, hour, and range estimates from prep text", () => {
    expect(parseDurationMinutes("Chop vegetables (~25 min)")).toBe(25);
    expect(parseDurationMinutes("Make sauce, about 5-10 minutes")).toBe(8);
    expect(parseDurationMinutes("Cook beans for 1 hr 15 min")).toBe(75);
  });

  it("estimates savings from timed prep-day tasks", () => {
    const estimate = estimatePrepTimeSavings({
      prepDay: "Sunday",
      weekPlan,
      prepTips: [
        { day: "Sunday", tip: "Cook grains for Monday and Wednesday (~20 min)." },
        { day: "Sunday", tip: "Chop vegetables for bowls, about 15 min." },
        { day: "Monday", tip: "Set out lunch containers, 5 min." },
      ],
    });

    expect(estimate).toEqual({ minutes: 35, taskCount: 2, capped: false, basis: "task-times" });
    expect(formatPrepTimeSavings(estimate!.minutes)).toBe("35 min");
  });

  it("caps very large estimates against weekly active cooking time", () => {
    const estimate = estimatePrepTimeSavings({
      prepDay: "Sunday",
      weekPlan,
      prepTips: [
        { day: "Sunday", tip: "Cook every component for the week (~90 min)." },
      ],
    });

    expect(estimate).toEqual({ minutes: 45, taskCount: 1, capped: true, basis: "task-times" });
  });

  it("sums real per-task durations into a task-times estimate (PREP-06 D-05)", () => {
    const estimate = estimatePrepTimeSavings({
      prepDay: "Sunday",
      prepTips: [
        { day: "Sunday", tip: "Roast the chicken (~20 min)." },
        { day: "Sunday", tip: "Cook the grains (~20 min)." },
        { day: "Sunday", tip: "Chop the vegetables (~20 min)." },
      ],
    });

    expect(estimate).toEqual({ minutes: 60, taskCount: 3, capped: false, basis: "task-times" });
  });

  it("returns null when prep-day tips carry no real duration tokens (PREP-06 D-05)", () => {
    const estimate = estimatePrepTimeSavings({
      prepDay: "Sunday",
      weekPlan,
      prepTips: [
        { day: "Sunday", tip: "Wash produce and make sauces." },
        { day: "Sunday", tip: "Cook grains and portion proteins." },
      ],
    });

    expect(estimate).toBeNull();
  });

  it("returns null when the real per-task total is below the 30 min/week floor (PREP-06 D-06)", () => {
    const estimate = estimatePrepTimeSavings({
      prepDay: "Sunday",
      prepTips: [
        { day: "Sunday", tip: "Set out lunch containers (~20 min)." },
      ],
    });

    expect(estimate).toBeNull();
  });

  it("applies the 30 min floor at the boundary — exactly 30 passes, 25 is unavailable (PREP-06 D-06)", () => {
    const exactlyThirty = estimatePrepTimeSavings({
      prepDay: "Sunday",
      prepTips: [{ day: "Sunday", tip: "Batch-cook the proteins (~30 min)." }],
    });
    expect(exactlyThirty).toEqual({ minutes: 30, taskCount: 1, capped: false, basis: "task-times" });

    const justBelow = estimatePrepTimeSavings({
      prepDay: "Sunday",
      prepTips: [{ day: "Sunday", tip: "Batch-cook the proteins (~25 min)." }],
    });
    expect(justBelow).toBeNull();
  });

  it("returns the capped figure only when it clears the floor (PREP-06 D-06)", () => {
    // 90 min raw capped to 60% of 80 active min = 48 → rounds to 45 (>= 30) → returned.
    const cappedAboveFloor = estimatePrepTimeSavings({
      prepDay: "Sunday",
      weekPlan,
      prepTips: [{ day: "Sunday", tip: "Cook everything (~90 min)." }],
    });
    expect(cappedAboveFloor).toEqual({ minutes: 45, taskCount: 1, capped: true, basis: "task-times" });
  });

  it("returns null when untimed prep tips do not have meal prep times to estimate from", () => {
    expect(estimatePrepTimeSavings({
      prepDay: "Sunday",
      prepTips: [{ day: "Sunday", tip: "Wash produce and make sauces." }],
    })).toBeNull();
  });
});

describe("prep time savings with re-tagged tips (Phase 11 D-08)", () => {
  it("correctly counts only prep-day tasks after re-tag", () => {
    // After normalizeMealPlan, tips that were mis-tagged to day-1 but carried
    // tip-prep- ids are now on "Sunday". estimatePrepTimeSavings should count only
    // the 2 prep-day tasks and exclude the night-before tip.
    const estimate = estimatePrepTimeSavings({
      prepDay: "Sunday",
      weekPlan,
      prepTips: [
        { id: "tip-prep-1", day: "Sunday", tip: "Roast chicken (~30 min)." },
        { id: "tip-prep-2", day: "Sunday", tip: "Cook rice (~20 min)." },
        { id: "tip-monday-night", day: "Monday", tip: "Set out Tuesday items." },
      ],
    });

    expect(estimate?.taskCount).toBe(2);
    expect(estimate?.basis).toBe("task-times");
  });
});
