import { format, parseISO } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import type { Json, Tables } from "@/integrations/supabase/types";
import type { MealPlanResponse, MealRecipe, DayPlan, PrepTip, PrepBatch } from "@/types/mealPlan";
import { normalizeGroceryItems, applyPantryStatus } from "@/lib/groceryUtils";
import { normalizeMealPlan, stripSkippedDayTips } from "@/lib/mealPlanParser";
import { asIngredients } from "@/lib/ingredientParser";
import { recipeIdentityKey } from "@/lib/recipeIdentity";
import { normalizeUuid } from "@/lib/uuid";
import { logAction, logError } from "@/services/activityLogger";
import { generateShoppingList, invalidateShoppingList } from "@/services/shoppingListService";

/** Safely cast a Json column to string[], returning [] if not an array of strings. */
function asStringArray(val: unknown): string[] {
  if (!Array.isArray(val)) return [];
  return val.filter((v): v is string => typeof v === "string");
}

/** Safely cast a Json column to PrepTip[], handling both old string[] and new object format. */
function asPrepTips(val: unknown): PrepTip[] {
  if (!Array.isArray(val)) return [];
  return val.map((v) => {
    if (typeof v === "string") return { day: "", tip: v };
    if (v && typeof v === "object" && "tip" in v) return v as PrepTip;
    return { day: "", tip: String(v) };
  });
}

type FavoriteRecipeRecord = Pick<Tables<"favorite_recipes">, "recipe_title" | "recipe_data">;
type DbError = {
  code?: string | null;
  details?: string | null;
  hint?: string | null;
  message?: string | null;
};

function dbErrorText(error?: DbError | string | null) {
  if (typeof error === "string") return error;
  if (!error) return "";
  return [error.code, error.message, error.details, error.hint].filter(Boolean).join(" ");
}

function isLibraryRecipeReferenceError(error?: DbError | null) {
  const message = dbErrorText(error).toLowerCase();
  return message.includes("library_recipe_id") ||
    message.includes("recipes_library_recipe_id_fkey") ||
    (message.includes("invalid input syntax") && message.includes("uuid"));
}

function isCustomRecipeReferenceError(error?: DbError | null) {
  const message = dbErrorText(error).toLowerCase();
  return message.includes("custom_recipe_id") ||
    message.includes("recipes_custom_recipe_id_fkey") ||
    (message.includes("invalid input syntax") && message.includes("uuid"));
}

function toOptionalPositiveInt(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const rounded = Math.round(value);
  return rounded > 0 ? rounded : null;
}

function toOptionalNonNegativeInt(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const rounded = Math.round(value);
  return rounded >= 0 ? rounded : null;
}

type RecipeInsertPayload = ReturnType<typeof buildRecipeInsertPayload>;

async function insertRecipeSnapshotRows(rows: RecipeInsertPayload[], source: string): Promise<void> {
  if (rows.length === 0) return;

  const firstAttempt = await supabase.from("recipes").insert(rows);
  if (!firstAttempt.error) return;

  if (isLibraryRecipeReferenceError(firstAttempt.error)) {
    logError("recipe_snapshot_library_reference_fallback", { error: firstAttempt.error.message, source });
    const fallbackRows = rows.map((row) => ({ ...row, library_recipe_id: null }));
    const fallbackAttempt = await supabase.from("recipes").insert(fallbackRows);
    if (!fallbackAttempt.error) return;
    throw new Error(fallbackAttempt.error.message);
  }

  if (isCustomRecipeReferenceError(firstAttempt.error)) {
    logError("recipe_snapshot_custom_reference_fallback", { error: firstAttempt.error.message, source });
    const fallbackRows = rows.map((row) => ({ ...row, custom_recipe_id: null }));
    const fallbackAttempt = await supabase.from("recipes").insert(fallbackRows);
    if (!fallbackAttempt.error) return;
    throw new Error(fallbackAttempt.error.message);
  }

  throw new Error(firstAttempt.error.message);
}

/** The meal_plans columns a save writes, shared by the insert and the in-place update.
 * Hand the result to insert/update as a VARIABLE: the generated types lack
 * meal_plans.batches, so an inline object literal would gain an excess-property error. */
function mealPlanRowFields(mealPlan: MealPlanResponse, startDate?: Date) {
  return {
    title: mealPlan.weekPlan.title,
    notes: mealPlan.notes ?? "",
    prep_tips: mealPlan.prepTips as unknown as Json,
    start_date: startDate ? format(startDate, "yyyy-MM-dd") : null,
    pantry_items: (mealPlan.pantryItems ?? []) as unknown as Json,
    skip_slots: (mealPlan.skipSlots ?? {}) as unknown as Json,
    batches: (mealPlan.weekPlan.batches ?? []) as unknown as Json,
  };
}

async function insertMealPlanRecord(userId: string, mealPlan: MealPlanResponse, startDate?: Date) {
  const payload = { user_id: userId, ...mealPlanRowFields(mealPlan, startDate) };

  const firstAttempt = await supabase
    .from("meal_plans")
    .insert(payload)
    .select("id")
    .single();

  return firstAttempt;
}

function newRecipeId(): string {
  // Mirrors mealPlanParser.ts's synthesizeId fallback (WR-02 precedent).
  return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Insert each day, then its recipes, under `planId`. Pushes every inserted day id
 * so a caller can roll back just those rows. Only inserts: errors propagate and
 * this never deletes anything (the insert branch deletes the plan it created; the
 * in-place branch must NEVER delete the plan, W2).
 */
async function insertDaysAndRecipes(
  planId: string,
  mealPlan: MealPlanResponse,
  idMap: Map<string, string>,
  insertedDayIds: string[] = [],
): Promise<void> {
  for (const day of mealPlan.weekPlan.days) {
    const { data: dayRow, error: dayErr } = await supabase
      .from("meal_plan_days")
      .insert({ meal_plan_id: planId, day_name: day.day })
      .select("id")
      .single();
    if (dayErr || !dayRow) throw new Error(dayErr?.message ?? "Failed to save day");
    insertedDayIds.push(dayRow.id);

    if (day.meals.length > 0) {
      const recipesInsert = day.meals.map((meal) => {
        const remappedSourceId = meal.source_meal_id ? idMap.get(meal.source_meal_id) : undefined;
        return buildRecipeInsertPayload(
          dayRow.id,
          { ...meal, source_meal_id: remappedSourceId ?? meal.source_meal_id },
          idMap.get(meal.id),
        );
      });
      await insertRecipeSnapshotRows(recipesInsert, "save_meal_plan");
    }
  }
}

/** Delete day rows by id (their recipes cascade). No-op for an empty list. */
async function deleteDayRows(dayIds: string[]): Promise<void> {
  if (dayIds.length === 0) return;
  const { error } = await supabase.from("meal_plan_days").delete().in("id", dayIds);
  if (error) throw new Error(error.message);
}

/**
 * Save a plan. Without `existingPlanId` this inserts a NEW meal_plans row. With it
 * the plan is rewritten IN PLACE (same id): insert the new days/recipes, delete the
 * old days, update the row, then delete the stored shopping list (Save Plan on an
 * already-saved plan used to add a duplicate row every time).
 */
export async function saveMealPlan(
  userId: string,
  mealPlan: MealPlanResponse,
  startDate?: Date,
  existingPlanId?: string,
): Promise<string> {
  logAction("save_meal_plan_start", { dayCount: mealPlan.weekPlan.days.length });

  // Leftover-swap-cascade fix (root cause link 1): the AI-era meal id
  // (mnemonic like "tue-dinner", or a synthesized "gen-<uuid>") is never the
  // row id the DB assigns on insert. source_meal_id was previously persisted
  // verbatim, so after load it pointed at nothing. Generate the new row ids
  // client-side UP FRONT so every meal's id is known before insert, then
  // remap source_meal_id through the same map — no dependency on multi-row
  // insert preserving order.
  const idMap = new Map<string, string>();
  for (const day of mealPlan.weekPlan.days) {
    for (const meal of day.meals) {
      idMap.set(meal.id, newRecipeId());
    }
  }

  // Prep tips carried the same AI-era ids, so on load stripSkippedDayTips dropped
  // every id-bearing tip of any plan with skip keys (prod-confirmed 2026-10-07,
  // 261007-cx9 D2a). Remap them through the same map; unknown ids pass through.
  const planToInsert: MealPlanResponse = {
    ...mealPlan,
    prepTips: (mealPlan.prepTips ?? []).map((t) => ({
      ...t,
      referenced_meal_ids: t.referenced_meal_ids?.map((id) => idMap.get(id) ?? id),
    })),
  };

  if (existingPlanId) {
    // ponytail: non-atomic; upgrade path = save_meal_plan RPC in one transaction
    // (a crash or a failed delete after the row update leaves duplicate day rows under
    // the plan until the next in-place save sweeps them)
    const { data: oldDays, error: oldDaysErr } = await supabase
      .from("meal_plan_days")
      .select("id")
      .eq("meal_plan_id", existingPlanId);
    if (oldDaysErr) {
      logError("save_meal_plan_error", { error: oldDaysErr.message });
      throw new Error(oldDaysErr.message);
    }
    const oldDayIds = (oldDays ?? []).map((d) => d.id);

    // Insert the new rows and point the plan row at them before deleting anything: a
    // failed insert or update removes only the NEW rows, so the old plan, its metadata
    // and its stored list stay intact. Never deleteMealPlan here: that would delete the
    // user's entire existing plan (W2).
    const newDayIds: string[] = [];
    try {
      await insertDaysAndRecipes(existingPlanId, mealPlan, idMap, newDayIds);
      const { error: updateErr } = await supabase
        .from("meal_plans")
        .update(mealPlanRowFields(planToInsert, startDate))
        .eq("id", existingPlanId);
      if (updateErr) throw new Error(updateErr.message);
    } catch (e) {
      logError("save_meal_plan_error", { error: e instanceof Error ? e.message : String(e) });
      await deleteDayRows(newDayIds).catch(() => {});
      throw e;
    }

    // The stored list describes the previous save, yet loadMealPlan, the Shopping tab
    // (a non-empty stored list wins) and /shopping all serve it as authoritative.
    // Phase B stores the fresh one; insertRecipeIntoPlan invalidates the same way.
    await invalidateShoppingList(existingPlanId).catch((e) =>
      logError("shopping_list_invalidate_error", { planId: existingPlanId, error: e instanceof Error ? e.message : String(e) }),
    );

    // Last, and never rolled back: the row already describes the new rows, and a delete
    // whose response was lost may still have applied. Duplicate days are recoverable
    // (the next in-place save reads both generations as old); an empty plan is not.
    await deleteDayRows(oldDayIds).catch((e) => {
      logError("save_meal_plan_error", { error: e instanceof Error ? e.message : String(e) });
      throw e;
    });

    logAction("save_meal_plan_complete", { planId: existingPlanId, inPlace: true });
    return existingPlanId;
  }

  // 1. Insert meal_plan
  const { data: plan, error: planErr } = await insertMealPlanRecord(userId, planToInsert, startDate);
  if (planErr || !plan) {
    logError("save_meal_plan_error", { error: planErr?.message ?? "Failed to save plan" });
    throw new Error(planErr?.message ?? "Failed to save plan");
  }

  try {
    // 2. Insert days + recipes
    await insertDaysAndRecipes(plan.id, mealPlan, idMap);
  } catch (e) {
    logError("save_meal_plan_error", { error: e instanceof Error ? e.message : String(e) });
    // Clean up the partially saved plan so we don't leave orphaned records. Right
    // here only: this save created that plan row (the in-place branch must not).
    await deleteMealPlan(plan.id, "save_rollback").catch(() => {});
    throw e;
  }

  logAction("save_meal_plan_complete", { planId: plan.id });
  return plan.id;
}

export async function loadMealPlan(planId: string): Promise<MealPlanResponse> {
  const { data: plan, error: planErr } = await supabase
    .from("meal_plans")
    .select("id, title, notes, prep_tips, start_date, pantry_items, skip_slots, batches")
    .eq("id", planId)
    .single();
  if (planErr || !plan) {
    logError("load_meal_plan_error", { planId, error: planErr?.message ?? "Plan not found" });
    throw new Error(planErr?.message ?? "Plan not found");
  }

  const { data: days, error: daysErr } = await supabase
    .from("meal_plan_days")
    .select("id, day_name")
    .eq("meal_plan_id", planId);
  if (daysErr) throw new Error(daysErr.message);

  const dayIds = (days ?? []).map((d) => d.id);
  const { data: recipes, error: recErr } = await supabase
    .from("recipes")
    .select("*")
    .in("day_id", dayIds.length ? dayIds : ["__none__"]);
  if (recErr) throw new Error(recErr.message);

  const { data: sl } = await supabase
    .from("shopping_lists")
    .select("items")
    .eq("meal_plan_id", planId)
    .maybeSingle();

  const dayPlans: DayPlan[] = (days ?? []).map((d) => ({
    day: d.day_name,
    meals: (recipes ?? [])
      .filter((r) => r.day_id === d.id)
      .map((r): MealRecipe => ({
        id: r.id,
        libraryRecipeId: "library_recipe_id" in r && typeof r.library_recipe_id === "string" ? r.library_recipe_id : undefined,
        customRecipeId: "custom_recipe_id" in r && typeof r.custom_recipe_id === "string" ? r.custom_recipe_id : undefined,
        title: r.title,
        mealType: (r.meal_type as MealRecipe["mealType"]) ?? "dinner",
        prepTime: r.prep_time ?? "",
        servings: r.servings ?? 2,
        calories: r.calories ?? 0,
        protein: r.protein ?? 0,
        carbs: r.carbs ?? 0,
        fats: r.fats ?? 0,
        tags: asStringArray(r.tags),
        ingredients: asIngredients(r.ingredients),
        steps: asStringArray(r.steps),
        toddlerTip: r.toddler_tip ?? undefined,
        glucoseTip: r.glucose_tip ?? undefined,
        flavorNotes: r.flavor_notes ?? undefined,
        // Phase 15 — "in r" guard style matches library_recipe_id above so this
        // tolerates the generated types lagging a fresh migration.
        source_meal_id: "source_meal_id" in r && typeof r.source_meal_id === "string" ? r.source_meal_id : undefined,
        status: "status" in r && (r.status === "fresh" || r.status === "prep-linked" || r.status === "leftover") ? r.status : undefined,
        cautionNote: "caution_note" in r && typeof r.caution_note === "string" ? r.caution_note : undefined,
        workflow: "workflow" in r && typeof r.workflow === "string" ? r.workflow : undefined,
        storage: "storage" in r && typeof r.storage === "string" ? r.storage : undefined,
        cookTime: "cook_time" in r && typeof r.cook_time === "string" ? r.cook_time : undefined,
        totalTime: "total_time" in r && typeof r.total_time === "string" ? r.total_time : undefined,
        // Phase 17 — "in r" guard style matches source_meal_id above; this table
        // uses select("*") so the guard tolerates generated-types lag rather than
        // a select-list omission (different risk than meal_plans.batches below).
        uses: "batch_uses" in r && Array.isArray(r.batch_uses) ? r.batch_uses as string[] : undefined,
        creates: "batch_creates" in r && typeof r.batch_creates === "string" ? r.batch_creates : undefined,
      })),
  }));

  const loadedPantryItems = asStringArray(plan.pantry_items);

  const loadedSkipSlots = (plan.skip_slots && typeof plan.skip_slots === "object" && !Array.isArray(plan.skip_slots))
    ? plan.skip_slots as Record<string, true>
    : undefined;

  // Phase 17 (Pitfall 3) — "in plan" guard tolerates generated-types lag until
  // the operator pushes the 20260709000000 migration (17-10); Array.isArray
  // guard, default [] so weekPlan.batches is always safely callable.
  const loadedBatches: PrepBatch[] = "batches" in plan && Array.isArray(plan.batches)
    ? plan.batches as PrepBatch[]
    : [];

  const result: MealPlanResponse = {
    weekPlan: { title: plan.title, days: dayPlans, batches: loadedBatches },
    shoppingList: applyPantryStatus(
      normalizeGroceryItems(Array.isArray(sl?.items) ? sl.items : []),
      loadedPantryItems
    ),
    prepTips: asPrepTips(plan.prep_tips),
    startDate: plan.start_date ?? undefined,
    notes: plan.notes ?? "",
    pantryItems: loadedPantryItems,
    skipSlots: loadedSkipSlots,
  };

  // Route every loaded plan through normalizeMealPlan so the saved-plan load
  // path gets the same prep-day contract as the generation path (CR-01 / the
  // verified BLOCKER — Kristina's f3409e16 plan). Derive batchCookDay from the
  // plan's start_date weekday (its TRUE week-start, WR-02), not positional
  // days[0]: loadMealPlan returns days in DB order and Planner.tsx re-sorts them
  // AFTER this call, so a positional derive would be wrong. batchCookDay rides
  // on weekPlan and is immune to the re-sort (the re-sort only reorders days).
  // No DB column, no migration — derive-on-read only (D-07).
  const weekStartHint =
    typeof plan.start_date === "string" && plan.start_date
      ? format(parseISO(plan.start_date), "EEEE")
      : undefined;

  // Strip skip-violating prep tips on every read (D-05) so legacy saved plans —
  // including ones saved before Phase 12 (e.g. Kristina's f3409e16) that never
  // re-save — display skip-clean tips. Deploy-free, no DB migration.
  return stripSkippedDayTips(normalizeMealPlan(result, weekStartHint), loadedSkipSlots);
}

export async function deleteMealPlan(planId: string, source?: string): Promise<void> {
  logAction("delete_meal_plan_start", { planId, source: source ?? "unknown" });
  const errors: string[] = [];

  const { error: slErr } = await supabase.from("shopping_lists").delete().eq("meal_plan_id", planId);
  if (slErr) errors.push(`shopping_lists: ${slErr.message}`);

  const { data: days } = await supabase.from("meal_plan_days").select("id").eq("meal_plan_id", planId);
  if (days && days.length > 0) {
    const { error: recErr } = await supabase.from("recipes").delete().in("day_id", days.map((d) => d.id));
    if (recErr) errors.push(`recipes: ${recErr.message}`);
  }

  const { error: dayErr } = await supabase.from("meal_plan_days").delete().eq("meal_plan_id", planId);
  if (dayErr) errors.push(`meal_plan_days: ${dayErr.message}`);

  const { error: planErr } = await supabase.from("meal_plans").delete().eq("id", planId);
  if (planErr) errors.push(`meal_plans: ${planErr.message}`);

  if (errors.length > 0) {
    logError("delete_meal_plan_error", { planId, errors: errors.join("; ") });
    throw new Error(`Delete failed: ${errors.join("; ")}`);
  }

  logAction("delete_meal_plan_complete", { planId, source: source ?? "unknown" });
}

// --- Update start date only ---

export async function updateMealPlanStartDate(planId: string, startDate: Date): Promise<void> {
  const { error } = await supabase
    .from("meal_plans")
    .update({ start_date: format(startDate, "yyyy-MM-dd") })
    .eq("id", planId);
  if (error) {
    logError("update_start_date_error", { planId, error: error.message });
    throw new Error(error.message);
  }
}

export async function updateMealPlanNotes(planId: string, notes: string): Promise<void> {
  const { error } = await supabase
    .from("meal_plans")
    .update({ notes })
    .eq("id", planId);
  if (error) {
    logError("update_notes_error", { planId, error: error.message });
    throw new Error(error.message);
  }
}

export async function renameMealPlan(planId: string, title: string): Promise<void> {
  const trimmed = (title ?? "").trim();
  if (trimmed.length === 0) {
    throw new Error("Plan title cannot be empty.");
  }
  if (trimmed.length > 100) {
    throw new Error("Plan title is too long (max 100 chars).");
  }

  const { error } = await supabase
    .from("meal_plans")
    .update({ title: trimmed })
    .eq("id", planId);
  if (error) {
    logError("rename_meal_plan_error", { planId, error: error.message });
    throw new Error(error.message);
  }

  logAction("rename_meal_plan_complete", { planId });
}

// --- Favorites ---

export async function addFavorite(userId: string, recipe: MealRecipe): Promise<void> {
  const { error } = await supabase.from("favorite_recipes").insert({
    user_id: userId,
    recipe_title: recipeIdentityKey(recipe),
    recipe_data: recipe as unknown as Json,
  });
  if (error) {
    logError("favorite_add_error", { error: error.message, recipe: recipe.title });
    throw new Error(error.message);
  }
}

export async function removeFavorite(userId: string, recipe: MealRecipe): Promise<void> {
  const key = recipeIdentityKey(recipe);
  const { error } = await supabase
    .from("favorite_recipes")
    .delete()
    .eq("user_id", userId)
    .eq("recipe_title", key);
  if (error) {
    logError("favorite_remove_error", { error: error.message, recipe: recipe.title });
    throw new Error(error.message);
  }

  // Older favorites stored the visible title as the key. Remove that legacy row
  // too so the UI does not rehydrate a stale favorite after refresh.
  if (key !== recipe.title) {
    const { error: legacyError } = await supabase
      .from("favorite_recipes")
      .delete()
      .eq("user_id", userId)
      .eq("recipe_title", recipe.title);
    if (legacyError) {
      logError("favorite_remove_legacy_error", { error: legacyError.message, recipe: recipe.title });
      throw new Error(legacyError.message);
    }
  }
}

export async function getFavorites(userId: string): Promise<{ recipe_title: string; recipe_data: MealRecipe }[]> {
  const { data, error } = await supabase
    .from("favorite_recipes")
    .select("recipe_title, recipe_data")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return ((data ?? []) as FavoriteRecipeRecord[]).map((record) => ({
    recipe_title: record.recipe_title,
    recipe_data: record.recipe_data as unknown as MealRecipe,
  }));
}

// --- Insert recipe into plan ---

export function buildRecipeInsertPayload(dayId: string, recipe: MealRecipe, id?: string) {
  return {
    // Explicit id lets callers (saveMealPlan) know the row's UUID before
    // insert so source_meal_id can be remapped consistently. Omitted (undefined
    // -> dropped from the JSON body) for the single-recipe insert path, where
    // the DB default (gen_random_uuid()) is fine.
    id,
    day_id: dayId,
    library_recipe_id: normalizeUuid(recipe.libraryRecipeId),
    custom_recipe_id: normalizeUuid(recipe.customRecipeId),
    title: recipe.title,
    meal_type: recipe.mealType,
    prep_time: recipe.prepTime,
    servings: toOptionalPositiveInt(recipe.servings),
    calories: toOptionalPositiveInt(recipe.calories),
    protein: toOptionalNonNegativeInt(recipe.protein),
    carbs: toOptionalNonNegativeInt(recipe.carbs),
    fats: toOptionalNonNegativeInt(recipe.fats),
    tags: recipe.tags as unknown as Json,
    ingredients: recipe.ingredients as unknown as Json,
    steps: recipe.steps as unknown as Json,
    toddler_tip: recipe.toddlerTip ?? null,
    glucose_tip: recipe.glucoseTip ?? null,
    flavor_notes: recipe.flavorNotes ?? null,
    // Phase 15 (also fixes the pre-existing source_meal_id persistence gap):
    source_meal_id: recipe.source_meal_id ?? null,
    status: recipe.status ?? null,
    caution_note: recipe.cautionNote ?? null,
    workflow: recipe.workflow ?? null,
    storage: recipe.storage ?? null,
    cook_time: recipe.cookTime ?? null,
    total_time: recipe.totalTime ?? null,
    // Phase 17 (BATCH-01):
    batch_uses: (recipe.uses ?? null) as unknown as Json,
    batch_creates: recipe.creates ?? null,
  };
}

export async function insertRecipeIntoPlan(dayId: string, recipe: MealRecipe, replace: boolean): Promise<void> {
  const payload = buildRecipeInsertPayload(dayId, recipe);
  let insertResult = await supabase.from("recipes").insert(payload).select("id").single();

  if (insertResult.error && isLibraryRecipeReferenceError(insertResult.error)) {
    logError("insert_recipe_library_reference_fallback", { error: insertResult.error.message, recipe: recipe.title });
    insertResult = await supabase.from("recipes").insert({ ...payload, library_recipe_id: null }).select("id").single();
  }

  if (insertResult.error && isCustomRecipeReferenceError(insertResult.error)) {
    logError("insert_recipe_custom_reference_fallback", { error: insertResult.error.message, recipe: recipe.title });
    insertResult = await supabase.from("recipes").insert({ ...payload, custom_recipe_id: null }).select("id").single();
  }

  const { data: newRow, error } = insertResult;
  if (error) throw new Error(error.message);

  if (replace && newRow) {
    await supabase.from("recipes").delete().eq("day_id", dayId).eq("meal_type", recipe.mealType).neq("id", newRow.id);
  }

  // Keep the cached shopping list coherent after library recipes are added to a saved plan.
  const { data: dayRow } = await supabase
    .from("meal_plan_days")
    .select("meal_plan_id")
    .eq("id", dayId)
    .single();
  if (dayRow) {
    await invalidateShoppingList(dayRow.meal_plan_id).catch(() => {});
    await generateShoppingList(dayRow.meal_plan_id).catch((error) => {
      logError("generate_shopping_list_after_recipe_insert_failed", {
        mealPlanId: dayRow.meal_plan_id,
        recipe: recipe.title,
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }
}
