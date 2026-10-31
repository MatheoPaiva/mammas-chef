/**
 * savedPlansService — shared helper for "saved plan list" surfaces.
 *
 * Mirrors the multi-table aggregation in `dashboardService.getWeeklyPlanSummaries`
 * (meal_plans + meal_plan_days + recipes) but returns the leaner `SavedPlanSummary`
 * shape (id, title, created_at, start_date, mealCount) consumed by:
 *   - Planner.tsx sidebar (limit=6)
 *   - Profile.tsx Saved Plans tab (no limit)
 *
 * Phase 10 TITLE-01 / D-25: no stored count column on meal_plans; the meal total
 * is computed on read so we keep one source of truth (this file) and the
 * dashboard helper unchanged.
 */

import { supabase } from "@/integrations/supabase/client";

export interface SavedPlanSummary {
  id: string;
  title: string;
  created_at: string;
  start_date: string | null;
  mealCount: number;
}

export async function listSavedPlans(
  userId: string,
  limit?: number,
): Promise<SavedPlanSummary[]> {
  let plansQuery = supabase
    .from("meal_plans")
    .select("id, title, created_at, start_date")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (typeof limit === "number") {
    plansQuery = plansQuery.limit(limit);
  }

  const { data: plans, error: plansError } = await plansQuery;

  if (plansError) throw new Error(plansError.message);
  if (!plans || plans.length === 0) return [];

  const planIds = plans.map((p) => p.id);

  const { data: days, error: daysError } = await supabase
    .from("meal_plan_days")
    .select("id, meal_plan_id")
    .in("meal_plan_id", planIds);

  if (daysError) throw new Error(daysError.message);

  const dayRows = days ?? [];
  const dayIds = dayRows.map((d) => d.id);

  const mealCountByDay = new Map<string, number>();
  if (dayIds.length > 0) {
    const { data: recipes, error: recipeError } = await supabase
      .from("recipes")
      .select("day_id")
      .in("day_id", dayIds);

    if (recipeError) throw new Error(recipeError.message);

    for (const recipe of recipes ?? []) {
      mealCountByDay.set(recipe.day_id, (mealCountByDay.get(recipe.day_id) ?? 0) + 1);
    }
  }

  const daysByPlan = new Map<string, string[]>();
  for (const day of dayRows) {
    const existing = daysByPlan.get(day.meal_plan_id) ?? [];
    existing.push(day.id);
    daysByPlan.set(day.meal_plan_id, existing);
  }

  return plans.map((plan) => {
    const planDayIds = daysByPlan.get(plan.id) ?? [];
    const mealCount = planDayIds.reduce(
      (sum, dayId) => sum + (mealCountByDay.get(dayId) ?? 0),
      0,
    );

    return {
      id: plan.id,
      title: plan.title,
      created_at: plan.created_at ?? new Date().toISOString(),
      start_date: plan.start_date,
      mealCount,
    };
  });
}
