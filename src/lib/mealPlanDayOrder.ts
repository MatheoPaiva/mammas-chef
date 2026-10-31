export interface MealPlanDayOption {
  id: string;
  day_name: string;
}

const WEEKDAY_ORDER = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const WEEKDAY_INDEX = new Map(WEEKDAY_ORDER.map((day, index) => [day.toLowerCase(), index]));

function dayOrderValue(dayName: string): number {
  return WEEKDAY_INDEX.get(dayName.trim().toLowerCase()) ?? Number.MAX_SAFE_INTEGER;
}

/**
 * Supabase returns meal_plan_days without a guaranteed row order. Keep the add-to-plan
 * picker in natural week order while preserving DB order for unknown/custom labels.
 */
export function sortMealPlanDays<T extends MealPlanDayOption>(days: T[]): T[] {
  return days
    .map((day, originalIndex) => ({ day, originalIndex }))
    .sort((a, b) => {
      const orderDelta = dayOrderValue(a.day.day_name) - dayOrderValue(b.day.day_name);
      return orderDelta || a.originalIndex - b.originalIndex;
    })
    .map(({ day }) => day);
}
