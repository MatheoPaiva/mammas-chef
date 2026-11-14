// Phase 0 throwaway spike (PLAN.md): generate, save and build a shopping list for one
// real plan from the terminal, then time a swap and a day regeneration.
// Run: npx vite-node scripts/phase0-spike.ts   (needs `supabase start` + `supabase functions serve`)
import { supabase } from "@/integrations/supabase/client";
import { generateAndValidateMealPlan } from "@/services/mealPlanService";
import { saveMealPlan, loadMealPlan } from "@/services/mealPlanDbService";
import { generateShoppingList } from "@/services/shoppingListService";
import { streamMealSwap } from "@/services/mealSwapService";
import { streamDayRegeneration } from "@/services/dayRegenerationService";
import { hydrateLibraryRecipeReferences } from "@/services/recipeLibraryService";
import { extractPantryItemsFromPrompt, applyPantryStatus } from "@/lib/groceryUtils";
import { buildShoppingListFromRecipes } from "@/lib/shoppingListBuilder";
import { stripSkippedDayTips, parseSwapResponse, parseDayRegenerationResponse } from "@/lib/mealPlanParser";
import { checkPlanCompleteness } from "@/lib/planCompleteness";
import { getNextStartDate, getOrderedDays } from "@/constants/preferences";
import type { MealPlanResponse } from "@/types/mealPlan";

// Local throwaway account; this database only exists on this machine.
const EMAIL = process.env.SPIKE_EMAIL ?? "phase0-spike@example.test";
const PASSWORD = process.env.SPIKE_PASSWORD ?? "phase0-local-only-pw";
const PROMPT = process.argv[2] ?? "Plan next week for two adults and a toddler";
const timings: Record<string, number> = {};
const t = () => performance.now();
const secs = (ms: number) => Math.round(ms / 100) / 10;

async function signIn() {
  const signedIn = await supabase.auth.signInWithPassword({ email: EMAIL, password: PASSWORD });
  if (!signedIn.error) return signedIn.data;
  const signedUp = await supabase.auth.signUp({ email: EMAIL, password: PASSWORD });
  if (signedUp.error || !signedUp.data.session) throw new Error(`sign-up failed: ${signedUp.error?.message}`);
  return signedUp.data;
}

function generate(token: string): Promise<MealPlanResponse> {
  return new Promise((resolve, reject) => {
    void generateAndValidateMealPlan({
      prompt: PROMPT,
      startDate: undefined,
      accessToken: token,
      onDelta: () => process.stderr.write("."),
      onRetryStart: (errs) => console.error(`\nretrying after ${errs.length} validation error(s)`),
      onSuccess: resolve,
      onError: (msg) => reject(new Error(`generation error: ${msg}`)),
      onValidationFailed: ({ errors }) => reject(new Error(`validation failed twice: ${JSON.stringify(errors)}`)),
    }).catch(reject);
  });
}

// streamMealSwap / streamDayRegeneration share the onDelta/onDone/onError shape.
function collect(run: (cb: { onDelta: (s: string) => void; onDone: () => void; onError: (e: string) => void }) => Promise<unknown>) {
  return new Promise<string>((resolve, reject) => {
    let text = "";
    void run({ onDelta: (s) => { text += s; }, onDone: () => resolve(text), onError: (e) => reject(new Error(e)) }).catch(reject);
  });
}

async function main() {
  const { user, session } = await signIn();
  if (!user || !session) throw new Error("no session");
  const token = session.access_token;

  // Sesame is the README's hummus case: exercises the allergen warning path.
  const { error: profileErr } = await supabase
    .from("profiles")
    .update({ allergies: ["sesame"], household_size: 3, onboarding_complete: true })
    .eq("id", user.id);
  if (profileErr) throw new Error(`profile update failed: ${profileErr.message}`);

  // --- Generate (mirrors Planner onSuccess, minus pinned stubs and UI) ---
  let s = t();
  const parsed = await generate(token);
  timings.generate = t() - s;
  console.error("");

  const weekStart = "Sunday";
  const order = getOrderedDays(weekStart);
  parsed.weekPlan.days = [...parsed.weekPlan.days].sort((a, b) => order.indexOf(a.day) - order.indexOf(b.day));
  const pantryItems = extractPantryItemsFromPrompt(PROMPT);
  const enriched = await hydrateLibraryRecipeReferences({ ...parsed, shoppingList: [], pantryItems, skipSlots: undefined });
  const plan = stripSkippedDayTips(enriched, undefined);
  const seed = buildShoppingListFromRecipes(plan.weekPlan.days.flatMap((d) => d.meals.map((m) => ({ ...m, day: d.day }))));
  if (seed.length > 0) plan.shoppingList = applyPantryStatus(seed, pantryItems);

  const firstDay = plan.weekPlan.days[0]?.day;
  s = t();
  const planId = await saveMealPlan(user.id, plan, firstDay ? getNextStartDate(firstDay) : undefined);
  timings.save = t() - s;

  s = t();
  const list = await generateShoppingList(planId);
  timings.shoppingList = t() - s;

  // --- Reload from the DB to prove it round-trips ---
  const saved = await loadMealPlan(planId);
  const allergenWarnings = saved.weekPlan.days.flatMap((d) =>
    d.meals.filter((m) => m.cautionNote?.startsWith("Allergy warning"))
      .map((m) => ({ day: d.day, meal: m.mealType, title: m.title, note: m.cautionNote })),
  );
  const missing = checkPlanCompleteness(saved.weekPlan.days, order, saved.skipSlots).totalMissing;

  // --- Swap one meal (AI call + parse only; placement is Phase 1 work) ---
  const day = saved.weekPlan.days[0];
  const oldMeal = day.meals.find((m) => m.mealType === "dinner") ?? day.meals[0];
  const others = saved.weekPlan.days.flatMap((d) => d.meals).filter((m) => m !== oldMeal)
    .map(({ id, title, mealType, ingredients }) => ({ id, title, mealType, ingredients }));
  s = t();
  const swapText = await collect((cb) => streamMealSwap({
    oldMeal, dayLabel: day.day, mealType: oldMeal.mealType, remainingMeals: others,
    currentPrepTips: saved.prepTips ?? [], hint: "something faster", skipSlots: saved.skipSlots, accessToken: token, ...cb,
  }));
  timings.swap = t() - s;
  const swapped = parseSwapResponse(swapText).newMeal.title;

  // --- Regenerate one day (AI call + parse only) ---
  const regenDay = saved.weekPlan.days[1] ?? day;
  const outside = saved.weekPlan.days.filter((d) => d !== regenDay).flatMap((d) => d.meals)
    .map(({ id, title, mealType, ingredients }) => ({ id, title, mealType, ingredients }));
  s = t();
  const regenText = await collect((cb) => streamDayRegeneration({
    dayLabel: regenDay.day, activeMealTypes: regenDay.meals.map((m) => m.mealType), remainingMeals: outside,
    currentPrepTips: saved.prepTips ?? [], batches: saved.batches, skipSlots: saved.skipSlots,
    replacedMealIds: regenDay.meals.map((m) => m.id), accessToken: token, ...cb,
  }));
  timings.regenDay = t() - s;
  const regenMeals = parseDayRegenerationResponse(regenText).newMeals.length;

  console.log(JSON.stringify({
    plan_id: planId,
    title: saved.weekPlan.title ?? null,
    days: saved.weekPlan.days.length,
    meals: saved.weekPlan.days.reduce((n, d) => n + d.meals.length, 0),
    missing_meals: missing,
    allergen_warnings: allergenWarnings,
    shopping_items: list.items.length,
    shopping_source: list.source,
    swap: { from: oldMeal.title, to: swapped },
    regen: { day: regenDay.day, meals: regenMeals },
    seconds: Object.fromEntries(Object.entries(timings).map(([k, v]) => [k, secs(v)])),
    node: process.version,
  }, null, 2));
  process.exit(0); // supabase auto-refresh timer would keep the process alive
}

main().catch((e) => {
  console.error("\nSPIKE FAILED:", e instanceof Error ? e.message : e);
  process.exit(1);
});
