// Phase 0/1 throwaway spike (PLAN.md): generate, save and build a shopping list for one
// real plan from the terminal, then swap a meal and regenerate a day, saving each in place.
// Run: npx vite-node scripts/phase0-spike.ts   (needs `supabase start` + `supabase functions serve`)
import { supabase } from "@/integrations/supabase/client";
import { loadMealPlan } from "@/services/mealPlanDbService";
import {
  createPlan, swapMeal, regenerateDay, savePlanWithShoppingList, allergenFlaggedMeals, countMissingMeals, sortDays,
} from "@/services/planWorkflow";
import { getNextStartDate } from "@/constants/preferences";

// Local throwaway account; this database only exists on this machine.
const EMAIL = process.env.SPIKE_EMAIL ?? "phase0-spike@example.test";
const PASSWORD = process.env.SPIKE_PASSWORD ?? "phase0-local-only-pw";
const PROMPT = process.argv[2] ?? "Plan next week for two adults and a toddler";
const WEEK_START = "Sunday";
const timings: Record<string, number> = {};
async function timed<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const s = performance.now();
  try { return await fn(); } finally { timings[name] = Math.round((performance.now() - s) / 100) / 10; }
}

async function signIn() {
  const signedIn = await supabase.auth.signInWithPassword({ email: EMAIL, password: PASSWORD });
  if (!signedIn.error) return signedIn.data;
  const signedUp = await supabase.auth.signUp({ email: EMAIL, password: PASSWORD });
  if (signedUp.error || !signedUp.data.session) throw new Error(`sign-up failed: ${signedUp.error?.message}`);
  return signedUp.data;
}

async function reload(planId: string) {
  const p = await loadMealPlan(planId);
  p.weekPlan.days = sortDays(p.weekPlan.days, WEEK_START);
  return p;
}

async function main() {
  const { user, session } = await signIn();
  if (!user || !session) throw new Error("no session");
  const token = session.access_token;

  // Sesame is the README's hummus case: exercises the allergen warning path.
  const { error: profileErr } = await supabase
    .from("profiles")
    .update({ allergies: ["Sesame"], household_size: 3, onboarding_complete: true })
    .eq("id", user.id);
  if (profileErr) throw new Error(`profile update failed: ${profileErr.message}`);

  const generated = await timed("generate", () => createPlan({
    prompt: PROMPT, weekStart: WEEK_START, accessToken: token,
    onDelta: () => process.stderr.write("."),
    onRetryStart: (errs) => console.error(`\nretrying after ${errs.length} validation error(s)`),
  }));
  console.error("");

  const firstDay = generated.weekPlan.days[0]?.day;
  const saved = await timed("saveWithShoppingList", () =>
    savePlanWithShoppingList(user.id, generated, { weekStart: WEEK_START, startDate: firstDay ? getNextStartDate(firstDay) : undefined }));
  const planId = saved.planId;

  // Edits always start from the saved copy: its meal ids are the DB row ids.
  let current = await reload(planId);
  const swapDay = current.weekPlan.days[0];
  const swapType = swapDay.meals.find((m) => m.mealType === "dinner") ? "dinner" : swapDay.meals[0].mealType;
  const swapFrom = swapDay.meals.find((m) => m.mealType === swapType)!.title;
  const swapped = await timed("swap", () => swapMeal(current, { dayIndex: 0, mealType: swapType, hint: "something faster", accessToken: token }));
  await timed("swapSave", () => savePlanWithShoppingList(user.id, swapped.plan, { weekStart: WEEK_START, existingPlanId: planId }));

  current = await reload(planId);
  const regenIndex = Math.min(1, current.weekPlan.days.length - 1);
  const regen = await timed("regenDay", () => regenerateDay(current, { dayIndex: regenIndex, weekStart: WEEK_START, accessToken: token }));
  await timed("regenSave", () => savePlanWithShoppingList(user.id, regen.plan, { weekStart: WEEK_START, existingPlanId: planId }));

  // Reload and check: no duplicate slots, edits landed, leftovers point at real meals.
  const final = await reload(planId);
  const meals = final.weekPlan.days.flatMap((d) => d.meals.map((m) => ({ ...m, day: d.day })));
  const slots = meals.map((m) => `${m.day}:${m.mealType}`);
  const ids = new Set(meals.map((m) => m.id));
  const { count: planRows } = await supabase.from("meal_plans").select("id", { count: "exact", head: true }).eq("user_id", user.id);

  console.log(JSON.stringify({
    plan_id: planId,
    days: final.weekPlan.days.length,
    meals: meals.length,
    duplicate_slots: slots.length - new Set(slots).size,
    dangling_leftovers: meals.filter((m) => m.source_meal_id && !ids.has(m.source_meal_id)).length,
    missing_meals: countMissingMeals(final, WEEK_START),
    allergen_warnings: allergenFlaggedMeals(final).map(({ day, meal }) => ({ day, meal: meal.mealType, title: meal.title, note: meal.cautionNote })),
    shopping_items: saved.shoppingList?.items.length ?? saved.shoppingListError,
    swap: {
      from: swapFrom,
      to: swapped.newMeal.title,
      saved: final.weekPlan.days[0].meals.find((m) => m.mealType === swapType)?.title === swapped.newMeal.title,
      cascade: swapped.cascadeSuffixes,
    },
    regen: { day: final.weekPlan.days[regenIndex].day, cascade: regen.cascadeSuffixes },
    plans_for_user: planRows,
    seconds: timings,
    node: process.version,
  }, null, 2));
  process.exit(0); // supabase auto-refresh timer would keep the process alive
}

main().catch((e) => {
  console.error("\nSPIKE FAILED:", e instanceof Error ? e.message : e);
  process.exit(1);
});
