import { skipSlotKey, type SkipSlots } from "@/types/mealPlan";

export const PLANNER_V2_MEAL_TYPES = ["breakfast", "lunch", "dinner", "snack"] as const;
export type PlannerV2MealType = (typeof PLANNER_V2_MEAL_TYPES)[number];

/** Default week shape: three meals a day, snacks off. */
export const DEFAULT_INCLUDED_MEALS: PlannerV2MealType[] = ["breakfast", "lunch", "dinner"];

const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

export function buildWeekSkipSlots(
  orderedDays: string[],
  includedMeals: readonly string[],
  skippedDays: readonly string[],
): SkipSlots {
  const included = new Set(includedMeals);
  const skipped = new Set(skippedDays);
  const skipSlots: SkipSlots = {};
  for (const day of orderedDays) {
    for (const mealType of PLANNER_V2_MEAL_TYPES) {
      if (skipped.has(day) || !included.has(mealType)) {
        skipSlots[skipSlotKey(day, mealType)] = true;
      }
    }
  }
  return skipSlots;
}

/** Skip every slot except one day + meal type. */
export function buildSingleMealSkipSlots(
  orderedDays: string[],
  day: string,
  mealType: string,
): SkipSlots {
  return buildWeekSkipSlots(
    orderedDays,
    [mealType],
    orderedDays.filter((d) => d !== day),
  );
}

export function countActiveSlots(orderedDays: string[], skipSlots: SkipSlots): number {
  return orderedDays.length * PLANNER_V2_MEAL_TYPES.length - Object.keys(skipSlots).length;
}

export function resolveWhenDay(when: string, now = new Date()): string {
  if (when === "today") return WEEKDAY_NAMES[now.getDay()];
  if (when === "tomorrow") return WEEKDAY_NAMES[(now.getDay() + 1) % 7];
  return when;
}

export function summarizeWeekShape(
  includedMeals: readonly PlannerV2MealType[],
  skippedDays: readonly string[],
  mealCount: number,
): string {
  const skippedSnack = !includedMeals.includes("snack");
  const dayNote = skippedDays.length === 0
    ? ""
    : skippedDays.length === 1
      ? ` · skip ${skippedDays[0]}`
      : ` · skip ${skippedDays.length} days`;
  const snackNote = skippedSnack ? " · no snacks" : "";
  const mealWord = mealCount === 1 ? "meal" : "meals";
  return `We'll plan ${mealCount} ${mealWord}${snackNote}${dayNote}`;
}
