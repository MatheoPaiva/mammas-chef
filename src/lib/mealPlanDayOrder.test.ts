import { describe, expect, it } from "vitest";
import { sortMealPlanDays } from "./mealPlanDayOrder";

describe("sortMealPlanDays", () => {
  it("sorts saved meal-plan days in natural week order", () => {
    const days = [
      { id: "fri", day_name: "Friday" },
      { id: "mon", day_name: "Monday" },
      { id: "wed", day_name: "Wednesday" },
      { id: "sun", day_name: "Sunday" },
    ];

    expect(sortMealPlanDays(days).map((day) => day.day_name)).toEqual([
      "Monday",
      "Wednesday",
      "Friday",
      "Sunday",
    ]);
  });

  it("keeps unknown/custom labels stable after known weekdays", () => {
    const days = [
      { id: "custom-1", day_name: "Prep Day" },
      { id: "tue", day_name: "Tuesday" },
      { id: "custom-2", day_name: "Travel Day" },
      { id: "mon", day_name: "monday" },
    ];

    expect(sortMealPlanDays(days)).toEqual([
      { id: "mon", day_name: "monday" },
      { id: "tue", day_name: "Tuesday" },
      { id: "custom-1", day_name: "Prep Day" },
      { id: "custom-2", day_name: "Travel Day" },
    ]);
  });
});
