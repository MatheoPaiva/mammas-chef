const MEAL_TYPES = ["breakfast", "lunch", "dinner", "snack"] as const;

/** Total meals across days (AI output may omit `meals` entirely — counts as 0). */
export function countMeals(days: Array<{ meals?: unknown[] }>): number {
  return days.reduce((sum, day) => sum + (Array.isArray(day.meals) ? day.meals.length : 0), 0);
}

/** Active (non-skipped) meal slots: 4 per day minus "Day:mealType" skip keys for those days. */
export function countActiveSlots(orderedDays: string[], skipSlots: Record<string, unknown>): number {
  let count = 0;
  for (const day of orderedDays) {
    for (const mealType of MEAL_TYPES) {
      if (!skipSlots[`${day}:${mealType}`]) count++;
    }
  }
  return count;
}
