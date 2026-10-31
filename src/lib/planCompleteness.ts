/**
 * planCompleteness.ts — Detects missing or incomplete days/meals in a plan.
 *
 * Pure function: no side effects, fully testable.
 */

import type { DayPlan, SkipSlots } from "@/types/mealPlan";
import { isSlotSkipped } from "@/types/mealPlan";

const MEAL_TYPES = ["breakfast", "lunch", "dinner", "snack"] as const;

export interface IncompleteSlot {
  dayIndex: number;
  dayName: string;
  missingMealTypes: string[];
}

export interface CompletenessResult {
  isComplete: boolean;
  /** Day names that are entirely absent from the plan. */
  missingDays: string[];
  /** Days that exist but have fewer meals than expected (accounting for skips). */
  incompleteSlots: IncompleteSlot[];
  /** Total number of missing meal slots. */
  totalMissing: number;
}

/**
 * Check a meal plan for missing days and incomplete meal slots.
 */
export function checkPlanCompleteness(
  days: DayPlan[],
  orderedDays: string[],
  skipSlots?: SkipSlots,
): CompletenessResult {
  const dayMap = new Map(days.map((d, i) => [d.day, { ...d, index: i }]));

  const missingDays: string[] = [];
  const incompleteSlots: IncompleteSlot[] = [];
  let totalMissing = 0;

  for (const dayName of orderedDays) {
    const day = dayMap.get(dayName);

    if (!day) {
      // Entire day is missing — count non-skipped slots
      const missingTypes = MEAL_TYPES.filter((t) => !isSlotSkipped(skipSlots, dayName, t));
      if (missingTypes.length > 0) {
        missingDays.push(dayName);
        totalMissing += missingTypes.length;
      }
      continue;
    }

    // Day exists — check for missing meal types
    const existingTypes = new Set(day.meals.map((m) => m.mealType));
    const missingTypes = MEAL_TYPES.filter(
      (t) => !existingTypes.has(t) && !isSlotSkipped(skipSlots, dayName, t),
    );

    if (missingTypes.length > 0) {
      incompleteSlots.push({
        dayIndex: day.index,
        dayName,
        missingMealTypes: missingTypes as string[],
      });
      totalMissing += missingTypes.length;
    }
  }

  return {
    isComplete: totalMissing === 0,
    missingDays,
    incompleteSlots,
    totalMissing,
  };
}
