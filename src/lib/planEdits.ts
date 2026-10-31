/**
 * planEdits.ts — pure, in-memory post-generation plan edits (F2 per-meal skip,
 * F4 servings stepper). No I/O; inputs are never mutated.
 */
import type { MealPlanResponse, MealRecipe, PrepTip, SkipSlots } from "@/types/mealPlan";
import { isSlotSkipped, skipSlotKey } from "@/types/mealPlan";
import { ALL_WEEKDAYS } from "@/constants/preferences";
import { toDisplayFraction } from "@/lib/ingredientParser";
import { stripSkippedDayTips } from "@/lib/mealPlanParser";
import { findDependentMeals } from "@/lib/leftoverCascade";
import { PLANNER_V2_MEAL_TYPES } from "@/lib/plannerV2Slots";

/**
 * Scale ingredient quantities to `targetServings` (2dp, `displayQuantity`
 * re-derived). Macros are per-serving and untouched. Returns the SAME object
 * when the target is not an integer >= 1, the recipe has no usable servings,
 * or the target equals the current servings.
 */
export function scaleRecipeServings(recipe: MealRecipe, targetServings: number): MealRecipe {
  if (!Number.isInteger(targetServings) || targetServings < 1) return recipe;
  if (!(recipe.servings >= 1) || targetServings === recipe.servings) return recipe;

  const ratio = targetServings / recipe.servings;
  const ingredients = (recipe.ingredients ?? []).map((ing) => {
    if (!(ing.quantity > 0)) return ing;
    const quantity = Math.round(ing.quantity * ratio * 100) / 100;
    return { ...ing, quantity, displayQuantity: toDisplayFraction(quantity) };
  });
  return { ...recipe, servings: targetServings, ingredients };
}

export interface SkipMealResult {
  plan: MealPlanResponse;
  removedDependents: Array<{ day: string; mealType: string; title: string }>;
}

/**
 * Skip one meal after generation. Returns `{ plan, removedDependents: [] }`
 * (same plan object) when the day/meal is not found. Otherwise a NEW plan:
 * - skipSlots gains `skipSlotKey(day, mealType)`;
 * - the meal is removed by object identity (regenerated meals can share ids);
 * - every dependent from findDependentMeals is removed too — they surface as
 *   Missing in the existing completeness UI (no cascade into a replacement);
 * - the batch the meal `creates` is dropped when no remaining meal uses it;
 * - shoppingList is cleared (SwipeablePlanContent re-derives it, F3);
 * - when the skip empties a non-prep day, a tip sitting on that day that still
 *   references only live meals (a night-before thaw/marinate for a later meal)
 *   moves back ONE calendar night (the prep day when the emptied day is the
 *   week's first) instead of being dropped with the day. If that night is itself
 *   a skipped cook day the unchanged strip below drops the tip, deliberately:
 *   fridge-thawed poultry must be cooked within 1-2 days, so a tip never moves
 *   further back;
 * - prepTips go through stripSkippedDayTips. That helper resolves each tip's
 *   `referenced_meal_ids` against meals still present in the plan, so a tip
 *   that referenced only the skipped meal / its removed dependents is dropped
 *   and a tip with a mix keeps just the surviving ids. Its day-field and
 *   text-scan rejections fire only once ALL four slots of a day are skipped
 *   (prep day exempt), so a single-meal skip leaves the rest of that day's
 *   tips alone.
 */
export function skipMealInPlan(plan: MealPlanResponse, dayIndex: number, mealType: string): SkipMealResult {
  const day = plan.weekPlan?.days?.[dayIndex];
  const meal = day?.meals?.find((m) => m.mealType === mealType);
  if (!day || !meal) return { plan, removedDependents: [] };

  const dependents = findDependentMeals(plan.weekPlan, meal);
  const removed = new Set<MealRecipe>([meal, ...dependents.map((d) => d.meal)]);
  const days = plan.weekPlan.days.map((d) => ({ ...d, meals: (d.meals ?? []).filter((m) => !removed.has(m)) }));

  // Drop every batch this meal created OR consumed that no remaining meal
  // still uses — same orphan rule as applyLeftoverCascade Case 2 (D-12), so
  // "skip" and "swap" of the same meal leave the batch table in the same state.
  const touched = new Set<string>([...(meal.uses ?? []), ...(meal.creates ? [meal.creates] : [])]);
  const dead = [...touched].filter((id) => !days.some((d) => d.meals.some((m) => m.uses?.includes(id))));
  const batches = dead.length > 0 ? (plan.weekPlan.batches ?? []).filter((b) => !dead.includes(b.id)) : plan.weekPlan.batches;

  const skipSlots: SkipSlots = { ...plan.skipSlots, [skipSlotKey(day.day, mealType)]: true };

  // Re-home a night-before tip stranded on a day this skip just emptied (see doc above).
  let prepTips = plan.prepTips;
  const dayIdx = (ALL_WEEKDAYS as readonly string[]).indexOf(day.day);
  if (
    dayIdx >= 0 &&
    day.day !== plan.weekPlan.batchCookDay &&
    PLANNER_V2_MEAL_TYPES.every((mt) => isSlotSkipped(skipSlots, day.day, mt))
  ) {
    const liveIds = new Set(days.flatMap((d) => d.meals.map((m) => m.id)));
    const nightBefore = ALL_WEEKDAYS[(dayIdx + 6) % 7];
    prepTips = (plan.prepTips ?? []).map((t) =>
      t.day === day.day && t.referenced_meal_ids?.length && t.referenced_meal_ids.every((id) => liveIds.has(id))
        ? { ...t, day: nightBefore }
        : t,
    );
  }

  const next: MealPlanResponse = { ...plan, prepTips, weekPlan: { ...plan.weekPlan, days, batches }, shoppingList: [], skipSlots };

  return {
    plan: stripSkippedDayTips(next, skipSlots),
    removedDependents: dependents.map((d) => ({ day: d.day, mealType: d.meal.mealType, title: d.meal.title })),
  };
}

/**
 * Map each tip's `referenced_meal_ids` through `idMap` (unknown ids pass through;
 * ref-less tips come back unchanged). Regen delta tips are tagged by the edge with
 * the model's meal ids; the client's regenIdMap turns those into the ids it holds.
 */
export function remapTipRefs(tips: PrepTip[], idMap: Map<string, string>): PrepTip[] {
  return tips.map((t) =>
    t.referenced_meal_ids
      ? { ...t, referenced_meal_ids: t.referenced_meal_ids.map((id) => idMap.get(id) ?? id) }
      : t,
  );
}
