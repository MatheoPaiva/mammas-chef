import { describe, expect, it } from "vitest";

import { preferredPlanSlotForRecipe } from "./recipePlanSlot";
import type { MealRecipe } from "@/types/mealPlan";

describe("preferredPlanSlotForRecipe", () => {
  it("defaults the add-to-plan dialog to the recipe meal type", () => {
    expect(preferredPlanSlotForRecipe({ mealType: "breakfast" })).toBe("breakfast");
    expect(preferredPlanSlotForRecipe({ mealType: "lunch" })).toBe("lunch");
    expect(preferredPlanSlotForRecipe({ mealType: "dinner" })).toBe("dinner");
    expect(preferredPlanSlotForRecipe({ mealType: "snack" })).toBe("snack");
  });

  it("falls back to dinner for stale favorite/imported recipe data", () => {
    expect(preferredPlanSlotForRecipe({ mealType: "side" as MealRecipe["mealType"] })).toBe("dinner");
    expect(preferredPlanSlotForRecipe({ mealType: undefined as unknown as MealRecipe["mealType"] })).toBe("dinner");
  });
});
