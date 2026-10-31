import { describe, it, expect } from "vitest";
import { checkPlanCompleteness } from "./planCompleteness";
import type { DayPlan } from "@/types/mealPlan";

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

function makeDay(dayName: string, mealTypes = ["breakfast", "lunch", "dinner", "snack"]): DayPlan {
  return {
    day: dayName,
    meals: mealTypes.map((type) => ({
      id: `${dayName}-${type}`,
      title: `${dayName} ${type}`,
      mealType: type as "breakfast" | "lunch" | "dinner" | "snack",
      prepTime: "15 min",
      servings: 4,
      calories: 400,
      protein: 30,
      carbs: 40,
      fats: 15,
      tags: [],
      ingredients: ["1 cup rice"],
      steps: ["Cook"],
    })),
  };
}

describe("checkPlanCompleteness", () => {
  it("reports complete for a full 7-day plan", () => {
    const days = DAYS.map((d) => makeDay(d));
    const result = checkPlanCompleteness(days, DAYS);
    expect(result.isComplete).toBe(true);
    expect(result.missingDays).toEqual([]);
    expect(result.incompleteSlots).toEqual([]);
    expect(result.totalMissing).toBe(0);
  });

  it("detects a completely missing day", () => {
    const days = DAYS.filter((d) => d !== "Wednesday").map((d) => makeDay(d));
    const result = checkPlanCompleteness(days, DAYS);
    expect(result.isComplete).toBe(false);
    expect(result.missingDays).toEqual(["Wednesday"]);
    expect(result.totalMissing).toBe(4);
  });

  it("detects multiple missing days", () => {
    const days = DAYS.filter((d) => d !== "Monday" && d !== "Friday").map((d) => makeDay(d));
    const result = checkPlanCompleteness(days, DAYS);
    expect(result.missingDays).toEqual(["Monday", "Friday"]);
    expect(result.totalMissing).toBe(8);
  });

  it("detects an incomplete day (missing one meal)", () => {
    const days = DAYS.map((d) =>
      d === "Thursday" ? makeDay(d, ["breakfast", "lunch", "snack"]) : makeDay(d),
    );
    const result = checkPlanCompleteness(days, DAYS);
    expect(result.isComplete).toBe(false);
    expect(result.missingDays).toEqual([]);
    expect(result.incompleteSlots.length).toBe(1);
    expect(result.incompleteSlots[0].dayName).toBe("Thursday");
    expect(result.incompleteSlots[0].missingMealTypes).toEqual(["dinner"]);
    expect(result.totalMissing).toBe(1);
  });

  it("accounts for skip slots — skipped slots are not counted as missing", () => {
    const days = DAYS.map((d) =>
      d === "Wednesday" ? makeDay(d, ["breakfast", "lunch", "snack"]) : makeDay(d),
    );
    const skipSlots = { "Wednesday:dinner": true as const };
    const result = checkPlanCompleteness(days, DAYS, skipSlots);
    expect(result.isComplete).toBe(true);
    expect(result.totalMissing).toBe(0);
  });

  it("handles a fully skipped missing day", () => {
    // Wednesday is missing entirely, but all its slots are skipped
    const days = DAYS.filter((d) => d !== "Wednesday").map((d) => makeDay(d));
    const skipSlots = {
      "Wednesday:breakfast": true as const,
      "Wednesday:lunch": true as const,
      "Wednesday:dinner": true as const,
      "Wednesday:snack": true as const,
    };
    const result = checkPlanCompleteness(days, DAYS, skipSlots);
    expect(result.isComplete).toBe(true);
    expect(result.missingDays).toEqual([]);
  });

  it("handles empty plan", () => {
    const result = checkPlanCompleteness([], DAYS);
    expect(result.isComplete).toBe(false);
    expect(result.missingDays).toEqual(DAYS);
    expect(result.totalMissing).toBe(28);
  });

  it("handles 6-day plan (missing last day)", () => {
    const days = DAYS.slice(0, 6).map((d) => makeDay(d));
    const result = checkPlanCompleteness(days, DAYS);
    expect(result.missingDays).toEqual(["Sunday"]);
    expect(result.totalMissing).toBe(4);
  });
});
