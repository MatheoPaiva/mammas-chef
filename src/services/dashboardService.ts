import { format, isValid, parseISO, startOfWeek } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";

export interface WeeklyPlanSummary {
  id: string;
  title: string;
  createdAt: string;
  weekStart: string;
  dayCount: number;
  mealCount: number;
  shoppingItemCount: number;
  hasGaps: boolean;
}

function toWeekStart(startDate: string | null, createdAt: string): string {
  if (startDate) {
    const parsed = parseISO(startDate);
    if (isValid(parsed)) return format(parsed, "yyyy-MM-dd");
  }

  const created = parseISO(createdAt);
  const anchor = isValid(created) ? created : new Date();
  return format(startOfWeek(anchor, { weekStartsOn: 1 }), "yyyy-MM-dd");
}

function shoppingItemCountFromJson(items: Json | null): number {
  return Array.isArray(items) ? items.length : 0;
}

function skipKeyCount(skipSlots: Json | null): number {
  return skipSlots && typeof skipSlots === "object" && !Array.isArray(skipSlots)
    ? Object.keys(skipSlots).length : 0;
}

export async function getWeeklyPlanSummaries(userId: string): Promise<WeeklyPlanSummary[]> {
  const { data: plans, error: plansError } = await supabase
    .from("meal_plans")
    .select("id, title, created_at, start_date, skip_slots")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (plansError) throw new Error(plansError.message);
  if (!plans || plans.length === 0) return [];

  // ponytail: a one-meal idea (Tonight's dinner / Lunch idea) is auto-saved as a plan with 27 of
  // 28 slots skipped; it must never become Home's This week / Upcoming card. Real fix is the
  // one-meal rewrite via regenerate-day (follow-up to 261007-cx9), which writes no plan row.
  const weekPlans = plans.filter((plan) => skipKeyCount(plan.skip_slots) < 27);
  if (weekPlans.length === 0) return [];

  const planIds = weekPlans.map((p) => p.id);

  const [{ data: days, error: daysError }, { data: shoppingLists, error: shoppingError }] = await Promise.all([
    supabase
      .from("meal_plan_days")
      .select("id, meal_plan_id")
      .in("meal_plan_id", planIds),
    supabase
      .from("shopping_lists")
      .select("meal_plan_id, items")
      .in("meal_plan_id", planIds),
  ]);

  if (daysError) throw new Error(daysError.message);
  if (shoppingError) throw new Error(shoppingError.message);

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

  const shoppingCountByPlan = new Map<string, number>();
  for (const row of shoppingLists ?? []) {
    if (!row.meal_plan_id) continue;
    shoppingCountByPlan.set(row.meal_plan_id, shoppingItemCountFromJson(row.items));
  }

  return weekPlans.map((plan) => {
    const planDayIds = daysByPlan.get(plan.id) ?? [];
    const mealCount = planDayIds.reduce((sum, dayId) => sum + (mealCountByDay.get(dayId) ?? 0), 0);
    const dayCount = planDayIds.length;
    // Every plan has 28 slots (7 days x 4 meal types). Counting day rows was wrong: the model may
    // omit the empty object for a fully skipped day, which flagged complete plans as gappy (D2b).
    const hasGaps = mealCount < 28 - skipKeyCount(plan.skip_slots);

    return {
      id: plan.id,
      title: plan.title,
      createdAt: plan.created_at ?? new Date().toISOString(),
      weekStart: toWeekStart(plan.start_date, plan.created_at ?? new Date().toISOString()),
      dayCount,
      mealCount,
      shoppingItemCount: shoppingCountByPlan.get(plan.id) ?? 0,
      hasGaps,
    };
  });
}
