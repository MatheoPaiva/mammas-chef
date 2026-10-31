import { supabase } from "@/integrations/supabase/client";
import { buildShoppingListFromRecipes } from "@/lib/shoppingListBuilder";
import { applyPantryStatus, normalizeGroceryItems } from "@/lib/groceryUtils";
import { asIngredients } from "@/lib/ingredientParser";
import { logAction, logError } from "@/services/activityLogger";
import type { GroceryItem, MealRecipe } from "@/types/mealPlan";
import type { Json } from "@/integrations/supabase/types";

export type ShoppingListSource = "ai" | "local" | "ai-unsaved" | "local-unsaved";

export interface GeneratedShoppingList {
  items: GroceryItem[];
  source: ShoppingListSource;
  aiError?: string;
  saveError?: string;
}

function asStringArray(val: unknown): string[] {
  if (!Array.isArray(val)) return [];
  return val.filter((v): v is string => typeof v === "string");
}

/** Input shape `loadPlanShoppingInputs` hands to `buildShoppingListFromRecipes`
 * (D-18) — widened beyond the original SHOP-03 fields to also carry the
 * identity + day context the sources[] traceability threading needs. `id`,
 * `title`, `mealType`, and `day` are individually optional so a row missing any
 * one of them (defense against schema drift) still degrades to "no sources"
 * for that recipe rather than throwing. */
type ShoppingRecipeInput = Pick<MealRecipe, "ingredients" | "status" | "source_meal_id"> &
  Partial<Pick<MealRecipe, "id" | "title" | "mealType">> & { day?: string };

/** A single shopping-list traceability entry (mirrors GroceryItem.sources' element type). */
type GrocerySource = NonNullable<GroceryItem["sources"]>[number];

async function loadPlanShoppingInputs(planId: string): Promise<{ recipes: ShoppingRecipeInput[]; pantryItems: string[]; userId?: string }> {
  // Widened (D-18) to also select day_name — resolves recipes' day_id to a day
  // NAME for buildShoppingListFromRecipes' sources[] traceability, mirroring
  // mealPlanDbService.ts's own "id, day_name" select for this same table.
  const { data: days, error: daysErr } = await supabase
    .from("meal_plan_days")
    .select("id, day_name")
    .eq("meal_plan_id", planId);
  if (daysErr) throw new Error(daysErr.message);

  const dayIds = (days ?? []).map((d) => d.id);
  const dayNameById = new Map((days ?? []).map((d) => [d.id, d.day_name] as const));

  // Widened select (D-15/D-18) — status/source_meal_id feed buildShoppingListFromRecipes'
  // SHOP-03 dual-signal leftover skip; id/title/meal_type/day_id feed the D-18 sources[]
  // traceability threading so the DB-load path carries the same identity the in-memory
  // Planner seed path already has.
  const { data: recipes, error: recErr } = await supabase
    .from("recipes")
    .select("id, ingredients, status, source_meal_id, title, meal_type, day_id")
    .in("day_id", dayIds.length ? dayIds : ["__none__"]);
  if (recErr) throw new Error(recErr.message);

  const { data: plan } = await supabase
    .from("meal_plans")
    .select("pantry_items, user_id")
    .eq("id", planId)
    .single();

  return {
    recipes: (recipes ?? []).map((recipe) => ({
      id: recipe.id ?? undefined,
      ingredients: asIngredients(recipe.ingredients),
      status: recipe.status as MealRecipe["status"],
      source_meal_id: recipe.source_meal_id ?? undefined,
      title: recipe.title ?? undefined,
      mealType: recipe.meal_type as MealRecipe["mealType"],
      day: dayNameById.get(recipe.day_id),
    })),
    pantryItems: asStringArray(plan?.pantry_items),
    userId: plan?.user_id,
  };
}

async function saveShoppingList(planId: string, userId: string | undefined, items: GroceryItem[]): Promise<void> {
  const { data: existing } = await supabase
    .from("shopping_lists")
    .select("id")
    .eq("meal_plan_id", planId)
    .maybeSingle();

  if (existing) {
    const { error } = await supabase
      .from("shopping_lists")
      .update({ items: items as unknown as Json })
      .eq("id", existing.id);
    if (error) {
      logError("shopping_list_save_error", { planId, error: error.message });
      throw new Error(error.message);
    }
    return;
  }

  if (!userId) {
    throw new Error("Cannot save shopping list without a user id.");
  }

  {
    const { error } = await supabase.from("shopping_lists").insert({
      user_id: userId,
      meal_plan_id: planId,
      items: items as unknown as Json,
    });
    if (error) {
      logError("shopping_list_save_error", { planId, error: error.message });
      throw new Error(error.message);
    }
  }
}

// supabase-js attaches the Response object to FunctionsHttpError as error.context.
// Read it so we can surface the *real* error string from the edge function body,
// rather than the generic "Edge Function returned a non-2xx status code".
async function readFunctionErrorBody(error: unknown): Promise<string | undefined> {
  const ctx = (error as { context?: unknown } | null)?.context;
  if (!ctx || typeof (ctx as Response).text !== "function") return undefined;
  try {
    const text = await (ctx as Response).clone().text();
    if (!text) return undefined;
    try {
      const parsed = JSON.parse(text);
      if (parsed && typeof parsed === "object" && typeof parsed.error === "string") {
        return parsed.error;
      }
    } catch {
      // not JSON — return the raw text
    }
    return text.slice(0, 500);
  } catch {
    return undefined;
  }
}

async function tryHumanize(planId: string, aggregated: GroceryItem[]): Promise<{ items: GroceryItem[]; aiMs: number } | { error: string; aiMs: number }> {
  const aiStart = performance.now();

  // D-19 — assign a stable id per aggregated item BEFORE the AI call, and record
  // its sources (if any, from the D-18 builder threading) keyed by that id. The
  // edge function does not yet echo `id` back (that lands in 17-08/17-10) — until
  // it does, no rawItem will carry a matching id and every item below simply
  // degrades to "no sources" (graceful no-trace, never an error).
  const sourcesById = new Map<string, GrocerySource[]>();
  const itemsWithId = aggregated.map((item, index) => {
    const id = `item-${index}`;
    if (item.sources) sourcesById.set(id, item.sources);
    return { ...item, id };
  });

  const { data: fnData, error: fnErr } = await supabase.functions.invoke("generate-shopping-list", {
    body: { items: itemsWithId },
  });
  const aiMs = Math.round(performance.now() - aiStart);

  if (fnErr) {
    const bodyMessage = await readFunctionErrorBody(fnErr);
    return { error: bodyMessage ?? fnErr.message ?? "AI shopping list call failed", aiMs };
  }

  const rawItems: Array<Record<string, unknown>> = Array.isArray(fnData?.items) ? fnData.items : [];
  const normalized = normalizeGroceryItems(rawItems);
  if (normalized.length === 0) {
    return { error: "AI returned an empty shopping list.", aiMs };
  }

  // Re-attach sources by echoed id (D-19). NEVER fall back to fuzzy name/positional
  // matching — a mangled or non-round-tripped id means that item gets no trace,
  // full stop (T-17-06). `rawWithNameQty` mirrors normalizeGroceryItems' own
  // name/quantity filter+map exactly (same predicate, same order-preserving
  // filter+map), so index i in each array refers to the same logical item.
  const rawWithNameQty = rawItems.filter(
    (item) => typeof item?.name === "string" && typeof item?.quantity === "string",
  );
  const withSources = normalized.map((item, index) => {
    const echoedId = rawWithNameQty[index]?.id;
    const sources = typeof echoedId === "string" ? sourcesById.get(echoedId) : undefined;
    return sources ? { ...item, sources } : item;
  });

  return { items: withSources, aiMs };
}

/**
 * Build and persist a shopping list for a saved meal plan.
 *
 * Never throws on AI failure: if the edge function fails or returns garbage,
 * we fall back to the locally-aggregated list from `buildShoppingListFromRecipes`
 * so the user always ends up with a usable shopping list and the meal plan stays
 * saved. Only throws when the meal plan has no recipes to aggregate at all.
 *
 * Why: the previous behavior threw on AI failure, and the caller responded by
 * deleting the user's just-saved meal plan. With a 100% AI failure rate in
 * production (May 2026), this caused users to lose every plan they tried to save.
 *
 * `opts.shouldPersist` is read at write time, after the slow AI call: when it
 * returns false the list is still returned but not stored (a newer save owns the
 * stored list). Callers that pass nothing (ShoppingList.tsx, insertRecipeIntoPlan)
 * keep persisting.
 */
export async function generateShoppingList(
  planId: string,
  opts: { shouldPersist?: () => boolean } = {},
): Promise<GeneratedShoppingList> {
  const { recipes, pantryItems, userId } = await loadPlanShoppingInputs(planId);
  const persist = (items: GroceryItem[]) =>
    opts.shouldPersist?.() === false ? Promise.resolve() : saveShoppingList(planId, userId, items);

  const buildStart = performance.now();
  const aggregated = buildShoppingListFromRecipes(recipes);
  const buildMs = Math.round(performance.now() - buildStart);
  if (aggregated.length === 0) {
    throw new Error("Cannot generate shopping list because no recipe ingredients were found.");
  }

  const aiResult = await tryHumanize(planId, aggregated);

  if ("items" in aiResult) {
    const finalItems = applyPantryStatus(aiResult.items, pantryItems);
    try {
      await persist(finalItems);
    } catch (e) {
      const saveError = e instanceof Error ? e.message : String(e);
      logError("shopping_list_persist_error", { planId, error: saveError });
      logAction("generate_shopping_list_ai_unsaved", {
        planId,
        itemCount: finalItems.length,
        buildMs,
        aiMs: aiResult.aiMs,
        saveError,
      });
      return { items: finalItems, source: "ai-unsaved", saveError };
    }
    logAction("generate_shopping_list_ai", {
      planId,
      itemCount: finalItems.length,
      buildMs,
      aiMs: aiResult.aiMs,
      totalMs: buildMs + aiResult.aiMs,
    });
    return { items: finalItems, source: "ai" };
  }

  // AI failed — fall back to the locally-aggregated list so the user keeps a usable list.
  logError("generate_shopping_list_ai_error", { planId, error: aiResult.error, aiMs: aiResult.aiMs });
  const finalItems = applyPantryStatus(aggregated, pantryItems);
  try {
    await persist(finalItems);
  } catch (e) {
    const saveError = e instanceof Error ? e.message : String(e);
    logError("shopping_list_persist_error", { planId, error: saveError });
    logAction("generate_shopping_list_local_unsaved", {
      planId,
      itemCount: finalItems.length,
      buildMs,
      aiMs: aiResult.aiMs,
      aiError: aiResult.error,
      saveError,
    });
    return { items: finalItems, source: "local-unsaved", aiError: aiResult.error, saveError };
  }
  logAction("generate_shopping_list_local_fallback", {
    planId,
    itemCount: finalItems.length,
    buildMs,
    aiMs: aiResult.aiMs,
    aiError: aiResult.error,
  });
  return { items: finalItems, source: "local", aiError: aiResult.error };
}

/**
 * Delete the shopping list for a plan so the user is prompted to regenerate.
 * Call after meal swaps or day regenerations.
 */
export async function invalidateShoppingList(planId: string): Promise<void> {
  // supabase-js returns errors instead of throwing; surface them so callers can log.
  const { error } = await supabase.from("shopping_lists").delete().eq("meal_plan_id", planId);
  if (error) throw new Error(error.message);
}
